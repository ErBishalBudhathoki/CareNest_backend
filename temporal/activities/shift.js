const { MongoClient, ServerApiVersion } = require('mongodb');
const logger = require('../../config/logger');

const uri = process.env.MONGODB_URI;

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
  const workedTimeEntry = {
    shiftId,
    userEmail: shift.employeeEmail,
    clientEmail: shift.clientEmail,
    date: new Date(shift.startTime),
    startTime: new Date(shift.startTime),
    endTime: new Date(shift.endTime),
    timeWorked: calculateHours(shift.startTime, shift.endTime, shift.breakDuration),
    providerType: 'standard',
    organizationId: shift.organizationId,
    createdAt: new Date(),
    status: 'verified',
  };

  const db = await getDb();
  await db.collection('workedTime').updateOne(
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
    .collection('workedTime')
    .deleteMany({ shiftId, organizationId });
  await db.collection('auditLogs').insertOne({
    action: 'SHIFT_CANCEL_COMPENSATION',
    entityType: 'workedTime',
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
