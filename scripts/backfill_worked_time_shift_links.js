#!/usr/bin/env node
/**
 * Backfill shift linkage on worked-time rows created by older app versions.
 *
 * Older builds stopped the timer through POST /active-timers/stop without
 * sending shift details, so the WorkedTime row had neither `silShiftId` (SIL)
 * nor `assignedClientId` (regular assignment). Payroll and NDIS reporting could
 * not trace those hours to a shift.
 *
 * This script links each unlinked row to:
 *   1. the SIL shift whose window contains the clock-in time, else
 *   2. the participant's active ClientAssignment.
 *
 * Dry-run by default; pass --apply to write. Rows that cannot be matched
 * unambiguously are left untouched and reported.
 *
 * Usage:
 *   node scripts/backfill_worked_time_shift_links.js            # report only
 *   node scripts/backfill_worked_time_shift_links.js --apply    # write changes
 *   node scripts/backfill_worked_time_shift_links.js --apply --org=<orgId>
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const WorkedTime = require('../models/WorkedTime');
const Shift = require('../models/Shift');
const Client = require('../models/Client');
const ClientAssignment = require('../models/ClientAssignment');
const { normalizeToIsoDate } = require('../utils/dateHelpers');

const HOUR = 60 * 60 * 1000;
// Clock-in can be slightly early/late relative to the rostered window.
const WINDOW_PAD_MS = 2 * HOUR;

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const orgArg = args.find((arg) => arg.startsWith('--org='));
const ORG = orgArg ? orgArg.split('=')[1] : null;

function anchorFor(row) {
  const candidates = [row.workDate, row.startTime, row.date];
  for (const value of candidates) {
    if (!value) continue;
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

async function findSilShift(row, anchor) {
  const client = await Client.findOne({
    clientEmail: String(row.clientEmail || '').toLowerCase(),
    ...(ORG ? { organizationId: ORG } : {}),
  })
    .select('_id')
    .lean();
  if (!client) return null;

  return Shift.findOne({
    employeeEmail: String(row.userEmail || '').toLowerCase(),
    clientId: client._id,
    silRosterOfCareId: { $ne: null },
    status: { $ne: 'cancelled' },
    startTime: { $lte: new Date(anchor.getTime() + WINDOW_PAD_MS) },
    endTime: { $gte: new Date(anchor.getTime() - WINDOW_PAD_MS) },
  })
    .sort({ startTime: 1 })
    .select('_id startTime endTime')
    .lean();
}

async function findAssignment(row, anchor) {
  const assignment = await ClientAssignment.findOne({
    userEmail: String(row.userEmail || '').toLowerCase(),
    clientEmail: String(row.clientEmail || '').toLowerCase(),
    isActive: true,
    ...(ORG ? { organizationId: ORG } : {}),
  })
    .select('_id schedule')
    .lean();
  if (!assignment) return null;

  // When the assignment carries a schedule, require an entry on the same day.
  // Linking a March shift to an assignment that only covers October would be
  // worse than leaving it for manual review.
  const schedule = Array.isArray(assignment.schedule) ? assignment.schedule : [];
  if (schedule.length === 0) return assignment;

  const dateKey =
    normalizeToIsoDate(row.shiftDate) ||
    normalizeToIsoDate(anchor) ||
    anchor.toISOString().slice(0, 10);

  const matchesDate = schedule.some((entry) => {
    const entryDate = normalizeToIsoDate(entry && entry.date);
    return entryDate && entryDate === dateKey;
  });

  return matchesDate ? assignment : null;
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, {
    dbName: process.env.DB_NAME || 'Invoice',
  });

  const query = {
    isActive: { $ne: false },
    $and: [
      { $or: [{ silShiftId: { $exists: false } }, { silShiftId: null }] },
      { $or: [{ assignedClientId: { $exists: false } }, { assignedClientId: null }] },
    ],
  };

  const cursor = WorkedTime.find(query).select(
    'userEmail clientEmail workDate date startTime shiftDate organizationId'
  ).cursor();

  const stats = { scanned: 0, linkedSil: 0, linkedAssignment: 0, unmatched: 0, badDate: 0 };
  const unmatchedSamples = [];

  for await (const row of cursor) {
    stats.scanned += 1;
    const anchor = anchorFor(row);
    if (!anchor) {
      stats.badDate += 1;
      continue;
    }

    const silShift = await findSilShift(row, anchor);
    if (silShift) {
      stats.linkedSil += 1;
      if (APPLY) {
        await WorkedTime.updateOne({ _id: row._id }, { $set: { silShiftId: silShift._id } });
      }
      continue;
    }

    const assignment = await findAssignment(row, anchor);
    if (assignment) {
      stats.linkedAssignment += 1;
      if (APPLY) {
        await WorkedTime.updateOne(
          { _id: row._id },
          { $set: { assignedClientId: assignment._id } }
        );
      }
      continue;
    }

    stats.unmatched += 1;
    if (unmatchedSamples.length < 10) {
      unmatchedSamples.push({
        id: String(row._id),
        userEmail: row.userEmail,
        clientEmail: row.clientEmail,
        at: anchor.toISOString(),
      });
    }
  }

  console.log(APPLY ? 'Backfill applied.' : 'Dry run (pass --apply to write).');
  console.log(stats);
  if (unmatchedSamples.length > 0) {
    console.log('Unmatched samples (need manual review):');
    console.table(unmatchedSamples);
  }

  await mongoose.disconnect();
})().catch(async (error) => {
  console.error('Backfill failed:', error.message);
  try {
    await mongoose.disconnect();
  } catch (_) {
    // ignore
  }
  process.exit(1);
});
