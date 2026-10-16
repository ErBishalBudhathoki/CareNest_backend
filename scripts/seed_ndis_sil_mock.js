/* eslint-disable no-console */
/**
 * Seed mock data for the SIL → invoice → NDIS-claiming flow.
 *
 * Creates/ensures, under one organisation:
 *   - valid NDIS registration number + ABN on the organisation
 *   - an NDIA-managed participant with a 9-digit NDIS number
 *   - a SIL property (3 rooms) + a participant occupancy
 *   - SIL ratio rules (day 1:1, active night 2:1)
 *   - an accepted quote → active roster-of-care with billable hourly supports
 *   - a SIL invoice for the current month (so NDIS claiming has data)
 *   - a plan-managed participant's SIL invoice (to exercise PDF routing)
 *
 * Idempotent: re-running does not duplicate records or re-bill a period.
 *
 * Usage:
 *   node scripts/seed_ndis_sil_mock.js [organizationId]
 *   SEED_PERIOD_FROM=2026-10-01 SEED_PERIOD_TO=2026-10-31 node scripts/seed_ndis_sil_mock.js
 */
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const Organization = require('../models/Organization');
const Client = require('../models/Client');
const SILProperty = require('../models/SILProperty');
const SILOccupancy = require('../models/SILOccupancy');
const SILRatioRule = require('../models/SILRatioRule');
const SILQuote = require('../models/SILQuote');
const SILRosterOfCare = require('../models/SILRosterOfCare');
const silBillingService = require('../services/silBillingService');
const { Invoice } = require('../models/Invoice');

const NDIA_EMAIL = 'sil.ndia@mailinator.com';
const PLAN_EMAIL = 'sil.plan@mailinator.com';

// Hourly support items that exist in `support_items`, priced below their caps.
// `days` + `startTime`/`endTime` form the agreed weekly pattern that
// `materializeRocShifts` turns into shifts for a week.
const SUPPORTS = [
  { supportNumber: '01_002_0107_1_1', supportName: 'Assistance With Self-Care Activities - Weekday Night', shiftType: 'active_night', hoursPerWeek: 21, unitPrice: 80, days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], startTime: '22:00', endTime: '01:00' },
  { supportNumber: '01_016_0104_1_1', supportName: 'Specialised Home Based Assistance', shiftType: 'day', hoursPerWeek: 10, unitPrice: 60, days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], startTime: '09:00', endTime: '11:00' },
];

function isValidAbn(abn) {
  const d = String(abn || '').replace(/\s/g, '');
  if (!/^\d{11}$/.test(d)) return false;
  const n = d.split('').map(Number);
  n[0] -= 1;
  const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  return n.reduce((a, x, i) => a + x * w[i], 0) % 89 === 0;
}

function startOfMonth(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

async function ensureOrg(orgId) {
  const org = await Organization.findById(orgId);
  if (!org) throw new Error(`Organisation ${orgId} not found`);

  const changes = {};
  if (!/^\d{6,9}$/.test(String(org.ndisRegistration?.registrationNumber || ''))) {
    changes['ndisRegistration.registrationNumber'] = '93940595';
    changes['ndisRegistration.isRegistered'] = true;
  }
  if (!isValidAbn(org.abn)) {
    changes.abn = '53004085616';
  }
  if (Object.keys(changes).length) {
    await Organization.updateOne({ _id: org._id }, { $set: changes });
    console.log(`  org: patched ${Object.keys(changes).join(', ')}`);
  } else {
    console.log('  org: registration + ABN already valid');
  }
  return org;
}

async function ensureClient(orgId, { email, first, last, fundingType, ndisNumber }) {
  let client = await Client.findOne({ organizationId: orgId, clientEmail: email });
  if (!client) {
    client = await Client.create({
      organizationId: orgId,
      clientEmail: email,
      clientFirstName: first,
      clientLastName: last,
      clientPhone: '0400000000',
      clientAddress: '1 Mock St',
      clientCity: 'Sydney',
      clientState: 'NSW',
      clientZip: '2000',
      fundingType,
      ndisNumber,
      isActive: true,
    });
    console.log(`  client: created ${email}`);
  } else {
    const patch = {};
    if (client.fundingType !== fundingType) patch.fundingType = fundingType;
    if (client.ndisNumber !== ndisNumber) patch.ndisNumber = ndisNumber;
    if (Object.keys(patch).length) {
      await Client.updateOne({ _id: client._id }, { $set: patch });
      console.log(`  client: patched ${email} (${Object.keys(patch).join(', ')})`);
    } else {
      console.log(`  client: ok ${email}`);
    }
  }
  return client;
}

async function ensureProperty(orgId) {
  let property = await SILProperty.findOne({ organizationId: orgId, name: 'SIL Mock House' });
  if (!property) {
    property = await SILProperty.create({
      organizationId: orgId,
      name: 'SIL Mock House',
      reference: 'SIL-MOCK',
      propertyType: 'house',
      silDesignCategory: 'robust',
      rooms: [
        { roomId: 'room-1', label: 'Room 1', accessibility: ['ensuite'] },
        { roomId: 'room-2', label: 'Room 2' },
        { roomId: 'room-3', label: 'Room 3', accessibility: ['hoist'] },
      ],
      bedrooms: 3,
      maxOccupancy: 3,
      amenities: ['hoist', 'ramp'],
      active: true,
    });
    console.log('  property: created SIL Mock House (3 rooms)');
  } else {
    console.log('  property: SIL Mock House exists');
  }
  return property;
}

async function ensureOccupancy(orgId, property, client) {
  const existing = await SILOccupancy.findOne({
    organizationId: orgId,
    propertyId: property._id,
    clientId: client._id,
    status: 'active',
  });
  if (existing) {
    console.log('  occupancy: exists');
    return existing;
  }
  // Put the participant in the first vacant room.
  const taken = await SILOccupancy.find({ organizationId: orgId, propertyId: property._id, status: 'active' });
  const takenRooms = new Set(taken.map((o) => o.roomId));
  const room = (property.rooms || []).find((r) => !takenRooms.has(r.roomId)) || property.rooms[0];
  const occupancy = await SILOccupancy.create({
    organizationId: orgId,
    propertyId: property._id,
    roomId: room.roomId,
    clientId: client._id,
    startDate: new Date(),
    status: 'active',
    fundingType: client.fundingType,
  });
  console.log(`  occupancy: created (${room.roomId})`);
  return occupancy;
}

async function ensureRatioRules(orgId) {
  const defs = [
    { name: 'Day 1:1', ratio: { staff: 1, participants: 1 }, shiftType: 'day' },
    { name: 'Active night 2:1', ratio: { staff: 2, participants: 1 }, shiftType: 'active_night' },
  ];
  for (const def of defs) {
    const exists = await SILRatioRule.findOne({ organizationId: orgId, name: def.name });
    if (!exists) {
      await SILRatioRule.create({ organizationId: orgId, ...def, isActive: true });
      console.log(`  ratio rule: created ${def.name}`);
    } else {
      console.log(`  ratio rule: ${def.name} exists`);
    }
  }
}

async function ensureRosterOfCare(orgId, client) {
  let roc = await SILRosterOfCare.findOne({
    organizationId: orgId,
    clientId: client._id,
    status: { $in: ['active', 'under_review'] },
  });
  if (roc) {
    // Patch the agreed weekly pattern onto supports created before it existed.
    let changed = false;
    roc.supports = (roc.supports || []).map((s) => {
      const def = SUPPORTS.find((d) => d.supportNumber === s.supportNumber);
      if (def && (!s.days || s.days.length === 0)) {
        changed = true;
        return { ...s.toObject?.() ?? s, days: def.days, startTime: def.startTime, endTime: def.endTime };
      }
      return s;
    });
    if (changed) {
      roc.markModified('supports');
      await roc.save();
      console.log('  roster of care: patched weekly pattern');
    } else {
      console.log('  roster of care: exists');
    }
    return roc;
  }

  const lines = SUPPORTS.map((s) => ({
    supportNumber: s.supportNumber,
    supportName: s.supportName,
    shiftType: s.shiftType,
    hoursPerWeek: s.hoursPerWeek,
    unitPrice: s.unitPrice,
    gstCode: 'P2',
    amount: Math.round(s.hoursPerWeek * s.unitPrice * 100) / 100,
    days: s.days || [],
    startTime: s.startTime || '',
    endTime: s.endTime || '',
    priceValidation: { passed: true, capApplied: null, type: 'seeded', errors: [] },
  }));

  const quote = await SILQuote.create({
    organizationId: orgId,
    clientId: client._id,
    fundingType: client.fundingType,
    status: 'accepted',
    lines,
    totals: {
      weeklyHours: lines.reduce((a, l) => a + l.hoursPerWeek, 0),
      weeklyAmount: lines.reduce((a, l) => a + l.amount, 0),
      annualAmount: lines.reduce((a, l) => a + l.amount, 0) * 52,
    },
    approvedBy: 'seed',
    approvedAt: new Date(),
  });

  roc = await SILRosterOfCare.create({
    organizationId: orgId,
    clientId: client._id,
    quoteId: quote._id,
    effectiveFrom: startOfMonth(new Date()),
    supports: lines.map((l) => ({
      supportNumber: l.supportNumber,
      supportName: l.supportName,
      shiftType: l.shiftType,
      hoursPerWeek: l.hoursPerWeek,
      unitPrice: l.unitPrice,
      gstCode: l.gstCode,
      amount: l.amount,
      days: l.days,
      startTime: l.startTime,
      endTime: l.endTime,
    })),
    reviewSchedule: { cadence: 'quarterly', nextReviewDate: new Date(Date.now() + 90 * 864e5) },
    status: 'active',
    history: [{ changedAt: new Date(), changedBy: 'seed', change: 'Created by seed script' }],
  });
  console.log('  roster of care: created (quote + RoC)');
  return roc;
}

async function billRoc(orgId, roc, from, to, label) {
  // Skip if already billed for this exact period (service is also idempotent).
  const result = await silBillingService.generateInvoiceFromRosterOfCare(
    orgId,
    roc._id,
    { from, to },
    'seed',
  );
  if (result.invoice) {
    console.log(
      `  invoice: ${label} → ${result.invoice.invoiceNumber} | $${result.invoice.financialSummary?.totalAmount} | billing=${JSON.stringify(result.billing || null)}`,
    );
  } else if (result.conflict) {
    console.log(`  invoice: ${label} already billed for this period (${result.existingInvoiceId})`);
  } else {
    console.log(`  invoice: ${label} skipped → ${JSON.stringify(result)}`);
  }
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.DB_NAME || 'Invoice';
  if (!uri) throw new Error('MONGODB_URI missing');

  await mongoose.connect(uri, { dbName });

  let orgId = process.argv[2] || process.env.SEED_ORG_ID;
  if (!orgId) {
    const firstOrg = await Organization.findOne({}).select('_id');
    if (!firstOrg) throw new Error('No organisation found; pass an organizationId');
    orgId = String(firstOrg._id);
  }
  console.log(`\nSeeding NDIS + SIL mock data for org ${orgId}\n`);

  const from = process.env.SEED_PERIOD_FROM
    ? new Date(process.env.SEED_PERIOD_FROM)
    : startOfMonth(new Date());
  const to = process.env.SEED_PERIOD_TO ? new Date(process.env.SEED_PERIOD_TO) : new Date();
  console.log(`Billing period: ${from.toISOString().slice(0, 10)} .. ${to.toISOString().slice(0, 10)}\n`);

  await ensureOrg(orgId);
  const ndia = await ensureClient(orgId, {
    email: NDIA_EMAIL,
    first: 'Nadia',
    last: 'NDIA',
    fundingType: 'ndia_managed',
    ndisNumber: '430000123',
  });
  const plan = await ensureClient(orgId, {
    email: PLAN_EMAIL,
    first: 'Paul',
    last: 'Plan',
    fundingType: 'plan_managed',
    ndisNumber: '430000456',
  });

  const property = await ensureProperty(orgId);
  await ensureOccupancy(orgId, property, ndia);
  await ensureRatioRules(orgId);

  const ndiaRoc = await ensureRosterOfCare(orgId, ndia);
  await billRoc(orgId, ndiaRoc, from, to, `NDIA-managed ${ndia.clientEmail}`);

  const planRoc = await ensureRosterOfCare(orgId, plan);
  await billRoc(orgId, planRoc, from, to, `plan-managed ${plan.clientEmail}`);

  console.log('\nDone.');
  console.log(`  NDIA participant: ${ndia.clientEmail} (ndis ${ndia.ndisNumber})`);
  console.log(`  Plan participant: ${plan.clientEmail}`);
  console.log(`  RoC (NDIA): ${ndiaRoc._id}`);
  console.log('\nNext: in the app → Admin → NDIS Claiming → generate for the period above.');

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
