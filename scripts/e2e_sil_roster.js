/* eslint-disable no-console */
/**
 * End-to-end check of the SIL "plan a roster of care → assign → publish →
 * notify" flow against the dev database. Prints each step; read-mostly except
 * materialising/assigning/publishing the seeded test week.
 */
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const Organization = require('../models/Organization');
const Client = require('../models/Client');
const SILProperty = require('../models/SILProperty');
const SILOccupancy = require('../models/SILOccupancy');
const SILRosterOfCare = require('../models/SILRosterOfCare');
const User = require('../models/User');
const UserOrganization = require('../models/UserOrganization');
const Shift = require('../models/Shift');
const Notification = require('../models/Notification');
const silRosterService = require('../services/silRosterService');

const MS_DAY = 24 * 60 * 60 * 1000;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME || 'Invoice' });
  const orgId = process.argv[2] || '699980eb8fd21a3864b1aade';
  const org = await Organization.findById(orgId);
  console.log(`Org: ${org.name} | ndisReg=${org.ndisRegistration?.registrationNumber} abn=${org.abn}`);

  // 1. Funded client present?
  const ndia = await Client.findOne({ organizationId: orgId, clientEmail: 'sil.ndia@mailinator.com' });
  console.log(`\n[1] NDIA client: ${ndia.clientEmail} funding=${ndia.fundingType} ndis=${ndia.ndisNumber}`);
  if (ndia.fundingType !== 'ndia_managed') throw new Error('client is not ndia_managed');

  // 2. RoC + agreed pattern
  const roc = await SILRosterOfCare.findOne({ organizationId: orgId, clientId: ndia._id, status: 'active' });
  console.log(`[2] RoC ${roc._id} supports:`);
  for (const s of roc.supports) {
    console.log(`     ${s.supportNumber} days=${JSON.stringify(s.days)} ${s.startTime}-${s.endTime}`);
  }

  // 3. Property + occupancy
  const property = await SILProperty.findOne({ organizationId: orgId, name: 'SIL Mock House' });
  const occ = await SILOccupancy.findOne({ organizationId: orgId, propertyId: property._id, status: 'active' });
  console.log(`[3] Property "${property.name}" rooms=${property.rooms.length} | occupancy room=${occ?.roomId} client=${String(occ?.clientId)}`);

  // 4. Materialise the week
  const weekStart = silRosterService.constructor.startOfWeek(new Date());
  const weekIso = weekStart.toISOString().slice(0, 10);
  const weekEnd = new Date(weekStart.getTime() + 7 * MS_DAY);
  const mat = await silRosterService.materializeRocShifts(orgId, roc._id, { weekStarting: weekIso }, 'e2e');
  console.log(`[4] materialize week ${weekIso}: created=${mat.created?.length} skipped=${mat.skipped?.length}`);

  // 5. Assign an employee to the materialised shifts
  const employee =
    (await User.findOne({ organizationId: orgId, role: 'employee' }).lean()) ||
    (await User.findOne({ organizationId: orgId, roles: 'employee' }).lean());
  if (!employee) throw new Error('no employee found to assign');
  const upd = await Shift.updateMany(
    { organizationId: orgId, silRosterOfCareId: roc._id },
    { $set: { employeeId: employee._id, employeeEmail: employee.email } },
  );
  console.log(`[5] assigned ${employee.email} (${employee._id}) to ${upd.modifiedCount} shift(s)`);

  // 6. Build the weekly SIL roster (reflects the shift assignments)
  const roster = await silRosterService.buildRoster(orgId, { propertyId: property._id, weekStarting: weekIso }, 'e2e');
  const assignedEntries = roster.entries.filter((e) => e.assignedStaff > 0).length;
  console.log(`[6] roster ${roster._id} entries=${roster.entries.length} assigned=${assignedEntries} warnings=${roster.ratioWarnings.length}`);

  // 7. Publish (fires notifications)
  const pub = await silRosterService.publishRoster(orgId, roster._id, {}, 'e2e');
  console.log(`[7] publish -> status=${pub.roster?.status}${pub.blocked ? ' BLOCKED' : ''}`);

  // 8. Wait for the fire-and-forget notification fan-out
  await new Promise((r) => setTimeout(r, 5000));

  // 9. Who was notified?
  const notifs = await Notification.find({
    type: 'sil_roster_published',
    'data.rosterId': String(roster._id),
  }).lean();
  console.log(`\n[8] notifications for roster ${roster._id}: ${notifs.length}`);
  for (const n of notifs) {
    const u = await User.findById(n.userId).select('email').lean();
    console.log(`     -> ${u?.email || n.userId} | status=${n.status} | "${n.title}"`);
  }

  // 10. Admin membership sanity (compulsory recipients)
  const admins = await UserOrganization.find({
    organizationId: org._id,
    isActive: true,
    $or: [{ role: { $in: ['owner', 'admin'] } }, { permissions: { $in: ['*', 'manage_users'] } }],
  }).lean();
  console.log(`\n[9] admin/owner memberships: ${admins.length}`);
  for (const m of admins) {
    const u = await User.findById(m.userId).select('email').lean();
    console.log(`     ${u?.email} role=${m.role || '-'}`);
  }

  await mongoose.disconnect();
})().catch(async (e) => {
  console.error('E2E FAILED:', e.message);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
