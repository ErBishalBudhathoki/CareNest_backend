/**
 * Durable, best-effort dedupe ledger for invoice-email delivery.
 *
 * Temporal retries an activity when the worker dies after SMTP accepted the
 * message but before the activity result was recorded. Without a durable
 * marker that retry sends the invoice a second time. A workflow-id reuse
 * policy only collapses duplicate *requests*; it does not protect against
 * retries inside one workflow.
 *
 * The ledger uses the mongoose connection the Temporal worker already opens.
 * When it is unavailable the activity degrades to a deterministic RFC
 * Message-ID (see temporal/activities/invoice.js) rather than dropping mail.
 */
const mongoose = require('mongoose');
const logger = require('../config/logger');

const COLLECTION = 'invoiceemaildeliveries';

let indexReady = false;

function collection() {
  if (mongoose.connection.readyState !== 1) return null;
  return mongoose.connection.collection(COLLECTION);
}

async function ensureIndex(col) {
  if (indexReady) return;
  await col.createIndex({ deliveryKey: 1 }, { unique: true, name: 'uniq_delivery_key' });
  indexReady = true;
}

/**
 * Claim a delivery. Returns { deduped: true } when a previous attempt has
 * already been marked sent, so the caller must not call sendMail again.
 */
async function claim(deliveryKey) {
  const col = collection();
  if (!col) {
    logger.warn('[invoice-email] delivery ledger unavailable; using Message-ID dedupe only', {
      deliveryKey,
    });
    return { deduped: false, durable: false };
  }

  await ensureIndex(col);
  try {
    await col.insertOne({
      deliveryKey,
      status: 'sending',
      claimedAt: new Date(),
    });
    return { deduped: false, durable: true };
  } catch (error) {
    if (error && error.code !== 11000) throw error;

    const existing = await col.findOne({ deliveryKey });
    if (existing && existing.status === 'sent') {
      return { deduped: true, durable: true, messageId: existing.messageId || null };
    }
    // A previous attempt died mid-send. Re-send, but with the same deterministic
    // Message-ID so mail servers and clients can collapse the duplicate.
    return { deduped: false, durable: true, replay: true };
  }
}

async function markSent(deliveryKey, messageId) {
  const col = collection();
  if (!col) return;
  await col.updateOne(
    { deliveryKey },
    { $set: { status: 'sent', messageId, sentAt: new Date() } },
  );
}

/** Remove an unconfirmed claim so a Temporal retry can attempt delivery again. */
async function release(deliveryKey) {
  const col = collection();
  if (!col) return;
  await col.deleteOne({ deliveryKey, status: 'sending' });
}

module.exports = { claim, markSent, release, COLLECTION };
