// Plan the CURRENT (Sydney) week for the SIL mock house so the app-side
// plan -> assign -> publish -> worker-consume flow can be tested end-to-end.
//
// Steps:
//  1. Clear any current-week roster + shifts for the mock house client (clean
//     slate for the same idempotent materialisation the app performs).
//  2. Materialise the active RoC's agreed weekly pattern into this week's
//     unassigned Shifts via silRosterService.materializeRocShifts.
//
// Usage: node scripts/plan_sil_current_week.js
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const SILRoster = require('../models/SILRoster');
const SILRosterOfCare = require('../models/SILRosterOfCare');
const SILProperty = require('../models/SILProperty');
const Client = require('../models/Client');
const Shift = require('../models/Shift');
const dateHelpers = require('../utils/dateHelpers');
const SILRosterService = require('../services/silRosterService');

const ORG = process.env.SEED_ORG_ID || '699980eb8fd21a3864b1aade';
const PROPERTY_NAME = 'SIL Mock House';
const CLIENT_EMAIL = 'sil.ndia@mailinator.com';
const TZ = 'Australia/Sydney';

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME || 'Invoice' });

  const property = await SILProperty.findOne({ organizationId: ORG, name: PROPERTY_NAME }).lean();
  if (!property) throw new Error(`property not found: ${PROPERTY_NAME}`);

  const client = await Client.findOne({ organizationId: ORG, clientEmail: CLIENT_EMAIL }).lean();
  if (!client) throw new Error(`client not found: ${CLIENT_EMAIL}`);

  const roc = await SILRosterOfCare.findOne({ organizationId: ORG, clientId: client._id, propertyId: property._id, status: { $in: ['active', 'under_review'] } }).lean();
  if (!roc) throw new Error('active roster of care not found for client/property');

  // Current week Monday anchor — identical to SILRosterService.startOfWeek:
  // Monday 00:00 UTC of the week containing "now" (UTC-anchored weeks).
  const nowD = new Date();
  const weekDiff = (nowD.getUTCDay() + 6) % 7; // days since Monday
  const week = new Date(Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth(), nowD.getUTCDate() - weekDiff));
  const endUtc = new Date(week.getTime() + 7 * 864e5);
  console.log(`week ${week.toISOString()} .. ${endUtc.toISOString()}`);

  // 1. Clean slate for this week only (draft *and* published leftovers).
  const mondayUtc = new Date(week.getTime());
  const rosterRes = await SILRoster.deleteMany({
    organizationId: ORG,
    propertyId: property._id,
    weekStarting: mondayUtc,
  });
  const shiftRes = await Shift.deleteMany({
    organizationId: ORG,
    clientId: client._id,
    startTime: { $gte: mondayUtc, $lt: endUtc },
  });
  console.log(`cleared rosters: ${rosterRes.deletedCount}, shifts: ${shiftRes.deletedCount}`);

  // 2. Materialise the agreed pattern (idempotent, unassigned shifts).
  const result = await SILRosterService.materializeRocShifts(ORG, roc._id, { weekStarting: week }, 'plan_current_week_script');
  if (result.notFound || result.noPattern || result.clientNotFound) {
    console.error('materialize failed →', JSON.stringify(result));
    process.exitCode = 1;
  } else {
    console.log(`materialized: created=${result.created.length} skipped=${result.skipped.length}`);
    result.created.slice(0, 14).forEach((s) => console.log(`  ${s.shiftType} ${s.startTime.toISOString()} → ${s.endTime.toISOString()}`));
  }

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
