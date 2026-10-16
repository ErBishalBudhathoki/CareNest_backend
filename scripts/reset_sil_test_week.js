// Reset the SIL roster for the current (Sydney) week to a clean, unassigned
// draft state so the app-side plan -> assign -> publish flow can be tested.
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const SILRoster = require('../models/SILRoster');
const Shift = require('../models/Shift');
const Client = require('../models/Client');
const dateHelpers = require('../utils/dateHelpers');
const SILRosterService = require('../services/silRosterService');

const ORG = '699980eb8fd21a3864b1aade';
const PROPERTY = '6acfbe67ab50fe6b41f6775f'; // SIL Mock House
const CLIENT_EMAIL = 'sil.ndia@mailinator.com';
const TZ = 'Australia/Sydney';

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME || 'Invoice' });

  const nowParts = dateHelpers.getZonedDateParts(new Date(), TZ);
  const d = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const monday = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
  const startUtc = dateHelpers.zonedWallClockToUtc(monday.year, monday.month, monday.day, 0, 0, TZ);
  const endUtc = new Date(startUtc.getTime() + 7 * 864e5);
  const week = startUtc;

  const client = await Client.findOne({ organizationId: ORG, clientEmail: CLIENT_EMAIL }).lean();
  if (!client) throw new Error('client not found');

  const mondayUtc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const rosterRes = await SILRoster.deleteMany({
    organizationId: ORG,
    propertyId: PROPERTY,
    weekStarting: { $gte: new Date(mondayUtc.getTime() - 12 * 36e5), $lt: new Date(mondayUtc.getTime() + 36e5) },
  });
  const shiftRes = await Shift.deleteMany({
    organizationId: ORG,
    clientId: client._id,
    startTime: { $gte: startUtc, $lt: endUtc },
  });

  console.log(`week ${startUtc.toISOString()} .. ${endUtc.toISOString()}`);
  console.log(`deleted rosters: ${rosterRes.deletedCount}`);
  console.log(`deleted shifts : ${shiftRes.deletedCount}`);

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
