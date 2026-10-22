// Inspect the current (Sydney) week's SIL shifts for the mock house client.
// Usage: node scripts/inspect_sil_week.js
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const SILRoster = require('../models/SILRoster');
const SILRosterOfCare = require('../models/SILRosterOfCare');
const SILProperty = require('../models/SILProperty');
const Client = require('../models/Client');
const Shift = require('../models/Shift');
const dateHelpers = require('../utils/dateHelpers');

const ORG = '699980eb8fd21a3864b1aade';
const PROPERTY_NAME = 'SIL Mock House';
const CLIENT_EMAIL = 'sil.ndia@mailinator.com';
const TZ = 'Australia/Sydney';

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME || 'Invoice' });

  const property = await SILProperty.findOne({ organizationId: ORG, name: PROPERTY_NAME }).lean();
  const client = await Client.findOne({ organizationId: ORG, clientEmail: CLIENT_EMAIL }).lean();
  const roc = await SILRosterOfCare.findOne({
    organizationId: ORG, clientId: client._id, propertyId: property._id,
  }).lean();
  console.log('property:', String(property._id), '| client:', String(client._id), '| roc:', String(roc._id), '| roc.status:', roc.status);

  const nowParts = dateHelpers.getZonedDateParts(new Date(), TZ);
  const d = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const mondayWall = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
  const startUtc = dateHelpers.zonedWallClockToUtc(mondayWall.year, mondayWall.month, mondayWall.day, 0, 0, TZ);
  const endUtc = new Date(startUtc.getTime() + 7 * 864e5);
  console.log('window:', startUtc.toISOString(), '→', endUtc.toISOString());

  const shifts = await Shift.find({ silRosterOfCareId: roc._id }).sort({ startTime: 1 }).lean();
  console.log(`shifts(silRosterOfCareId=roc) total: ${shifts.length}`);
  for (const s of shifts) {
    const inWindow = s.startTime >= startUtc && s.startTime < endUtc;
    console.log(
      `  ${s.startTime.toISOString()} → ${s.endTime.toISOString()} | ${s.shiftType} | status=${s.status} | ` +
      `assigned=${(s.assignedStaff || []).length}${(s.assignedStaff || []).map(String).join(',')} | ` +
      `clientId=${String(s.clientId)} org=${String(s.organizationId)} | inWindow=${inWindow}`,
    );
  }

  const roster = await SILRoster.findOne({
    organizationId: ORG, propertyId: property._id,
  }).sort({ weekStarting: -1 }).lean();
  if (roster) {
    console.log(`latest roster: week=${roster.weekStarting.toISOString()} status=${roster.status} entries=${(roster.entries || []).length} | assigned entries=${(roster.entries || []).filter((e) => (e.assignedStaff || []).length > 0).length}`);
  } else {
    console.log('no roster doc exists for the property');
  }

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
