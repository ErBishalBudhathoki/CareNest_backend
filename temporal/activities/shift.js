const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const logger = require('../../config/logger');
const { getZonedDateParts } = require('../../utils/dateHelpers');

const uri = process.env.MONGODB_URI;

// Canonical collection (see models/WorkedTime.js). The saga used to write to
// the legacy `workedTime` collection, which no reader looks at, so completed
// shifts disappeared from earnings and invoicing.
const WORKED_TIME_COLLECTION = 'worked_times';
const TIMEZONE = 'Australia/Sydney';

let dbClient = null;

async function getDb() {
  if (!dbClient) {
    if (!uri) throw new Error('MONGODB_URI is not configured');
    dbClient = new MongoClient(uri, { tls: true, family: 4, serverApi: ServerApiVersion.v1 });
  }
  if (!dbClient.topology || !dbClient.topology.isConnected()) {
    await dbClient.connect();
  }
  return dbClient.db('Invoice');
}

const { formatDurationFromSeconds } = require('../../utils/timeHelpers');

const pad2 = (n) => String(n).padStart(2, '0');

function zonedDateKey(date) {
  const p = getZonedDateParts(date, TIMEZONE);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

function zonedTimeKey(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || '00';
  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0;
  return `${pad2(hour)}:${get('minute')}`;
}

function calculateHours(start, end, breakMins) {
  const s = new Date(start);
  const e = new Date(end);
  const diff = (e - s) / (1000 * 60 * 60);
  const breakHours = (breakMins || 0) / 60;
  return Math.max(0, diff - breakHours);
}

/**
 * Upsert the WorkedTime record for a completed shift.
 * Moved here from ShiftSubscriber so completion survives restarts and
 * runs with retries outside the request/event process.
 */
async function upsertWorkedTimeActivity({ shift }) {
  const shiftId = shift.id || shift._id;
  const hours = calculateHours(shift.startTime, shift.endTime, shift.breakDuration);
  const totalSeconds = Math.round(hours * 3600);
  const workedTimeEntry = {
    shiftId,
    userEmail: shift.employeeEmail,
    clientEmail: shift.clientEmail,
    date: new Date(shift.startTime),
    startTime: new Date(shift.startTime),
    endTime: new Date(shift.endTime),
    // WorkedTime.timeWorked is "HH:mm:ss"; the saga used to write a number,
    // which breaks every consumer that splits on ':'.
    timeWorked: formatDurationFromSeconds(totalSeconds),
    totalSeconds,
    totalHours: hours,
    // Shift linkage keys used by invoice matching and the app's visit history.
    shiftDate: zonedDateKey(new Date(shift.startTime)),
    shiftStartTime: zonedTimeKey(new Date(shift.startTime)),
    shiftEndTime: zonedTimeKey(new Date(shift.endTime)),
    providerType: 'standard',
    organizationId: shift.organizationId,
    createdAt: new Date(),
    status: 'verified',
  };

  const db = await getDb();

  // Deduplicate against a clock-in for the same shift. Workers who clock in
  // through the app already have a worked_times row (linked by silShiftId or
  // by date + start); writing the saga row too would double-pay the shift.
  const shiftStart = new Date(shift.startTime);
  const shiftIdValue = String(shiftId);
  const objectId = ObjectId.isValid(shiftIdValue)
    ? new ObjectId(shiftIdValue)
    : null;
  const duplicateQuery = {
    isActive: { $ne: false },
    $or: [
      { shiftId: shiftIdValue },
      ...(objectId ? [{ shiftId: objectId }, { silShiftId: objectId }] : []),
      {
        userEmail: String(shift.employeeEmail || '').toLowerCase(),
        clientEmail: String(shift.clientEmail || '').toLowerCase(),
        shiftDate: zonedDateKey(shiftStart),
        shiftStartTime: zonedTimeKey(shiftStart),
      },
    ],
  };

  const existing = await db
    .collection(WORKED_TIME_COLLECTION)
    .findOne(duplicateQuery);
  if (existing) {
    logger.info(
      `[Temporal] WorkedTime already exists for shift ${shiftId}; skipping saga write`,
    );
    return {
      shiftId,
      timeWorked: existing.timeWorked ?? workedTimeEntry.timeWorked,
      skipped: true,
    };
  }

  await db.collection(WORKED_TIME_COLLECTION).updateOne(
    { shiftId: workedTimeEntry.shiftId },
    { $set: workedTimeEntry },
    { upsert: true },
  );
  logger.info(`[Temporal] WorkedTime upserted for shift ${shiftId}`);
  return { shiftId, timeWorked: workedTimeEntry.timeWorked };
}

/**
 * Compensation for shift cancellation: remove the auto-created WorkedTime
 * row (keyed by shiftId, exactly what completion creates) and leave an
 * audit trail. Invoice reversal for already-sent invoices stays a manual
 * credit-note flow — invoices carry no shift link to void safely.
 */
async function voidShiftArtifactsActivity({ shiftId, organizationId }) {
  const db = await getDb();
  const result = await db
    .collection(WORKED_TIME_COLLECTION)
    .deleteMany({ shiftId, organizationId });
  await db.collection('auditLogs').insertOne({
    action: 'SHIFT_CANCEL_COMPENSATION',
    entityType: WORKED_TIME_COLLECTION,
    entityId: String(shiftId),
    organizationId,
    details: { deletedCount: result.deletedCount || 0 },
    timestamp: new Date(),
  });
  logger.info(`[Temporal] Shift-cancel compensation for ${shiftId}`, {
    deletedCount: result.deletedCount || 0,
  });
  return { shiftId, voided: result.deletedCount || 0 };
}

module.exports = {
  upsertWorkedTimeActivity,
  voidShiftArtifactsActivity,
};
