const mongoose = require('mongoose');
const UserOrganization = require('../../models/UserOrganization');
const User = require('../../models/User');
const Notification = require('../../models/Notification');
const NotificationPreference = require('../../models/NotificationPreference');
const FcmToken = require('../../models/FcmToken');
const firebaseConfig = require('../../config/firebase');
const logger = require('../../config/logger');

/**
 * Billing push notifications for organisation billing staff.
 *
 * Recipients are resolved STRICTLY within the given organisation: active
 * members who hold the `manage_billing` permission or the owner/admin role.
 * The query is always scoped by the exact organizationId, so notifications
 * (and any data they carry) can never leak to another organisation's users,
 * employees, or clients.
 *
 * Delivery is two-step, mirroring the bulk-actions pattern:
 *  1. Persist one `Notification` document per recipient (in-app history).
 *  2. Best-effort FCM multicast to registered device tokens.
 * Step 2 never blocks or fails step 1.
 *
 * Frontend contract: every push carries
 *   data = { type: 'invoice', kind: <specific>, invoiceId?, organizationId,
 *             channelId: 'payments', title, body }
 * `type: 'invoice'` keeps compatibility with the app's existing
 * notification handler (tap-to-open invoice); `kind` carries specificity.
 */

const KIND = {
  INVOICE_APPROVED: 'invoice_approved',
  INVOICE_DISPUTED: 'invoice_disputed',
  PAYMENT_RECEIVED: 'payment_received',
  STRIPE_DISPUTE_OPENED: 'stripe_dispute_opened',
  PAYOUT_PAID: 'payout_paid',
  PAYOUT_FAILED: 'payout_failed',
};

const audFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
});

function formatAud(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return 'AUD 0.00';
  return audFormatter.format(value);
}

function toObjectId(value) {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) return null;
  return new mongoose.Types.ObjectId(value);
}

/**
 * Resolve push recipients for an organisation. Only active memberships in
 * THIS organisation holding manage_billing or an owner/admin role.
 * Returns [{ userId, email }].
 */
async function resolveRecipients(organizationId) {
  const orgId = toObjectId(organizationId) || organizationId;
  const memberships = await UserOrganization.find({
    organizationId: orgId,
    isActive: true,
    $or: [
      { permissions: 'manage_billing' },
      { role: { $in: ['owner', 'admin'] } },
    ],
  }).lean();

  if (!memberships.length) return [];

  const userIds = memberships
    .map((m) => m.userId)
    .filter((id) => id != null);
  const users = await User.find({ _id: { $in: userIds } })
    .select('_id email')
    .lean();
  const emailById = new Map(
    users.map((u) => [String(u._id), (u.email || '').toLowerCase()])
  );

  return memberships
    .map((m) => ({
      userId: m.userId,
      email: emailById.get(String(m.userId)) || '',
    }))
    .filter((r) => r.email);
}

/**
 * Honour per-user notification preferences. Users without a preference
 * document default to opted-in (matches the geofence convention).
 */
async function filterByPreference(recipients) {
  if (!recipients.length) return recipients;
  const prefs = await NotificationPreference.find({
    $or: [
      { userId: { $in: recipients.map((r) => String(r.userId)) } },
      { userEmail: { $in: recipients.map((r) => r.email) } },
    ],
  }).lean();

  const byUserId = new Map();
  const byEmail = new Map();
  for (const p of prefs) {
    if (p.userId) byUserId.set(String(p.userId), p);
    if (p.userEmail) byEmail.set(String(p.userEmail).toLowerCase(), p);
  }

  return recipients.filter((r) => {
    const pref =
      byUserId.get(String(r.userId)) || byEmail.get(r.email) || null;
    if (!pref) return true;
    return pref.categoryEnabled?.billing !== false;
  });
}

/**
 * Persist + push one billing notification to all eligible recipients.
 * Push failures are logged, never thrown.
 */
async function fanOut({
  organizationId,
  kind,
  title,
  message,
  invoiceId,
  priority = 'medium',
}) {
  const orgIdString = String(organizationId);
  const recipients = await filterByPreference(
    await resolveRecipients(organizationId)
  );

  if (!recipients.length) {
    logger.info('Billing notification skipped: no eligible recipients', {
      organizationId: orgIdString,
      kind,
    });
    return { delivered: 0, pushed: 0, kind };
  }

  const data = {
    organizationId: orgIdString,
    ...(invoiceId ? { invoiceId: String(invoiceId) } : {}),
  };

  await Notification.insertMany(
    recipients.map((r) => ({
      userId: r.userId,
      organizationId,
      type: kind,
      title,
      message,
      data,
      channels: ['push'],
      priority,
      status: 'pending',
      createdAt: new Date(),
    }))
  );

  let pushed = 0;
  try {
    const tokenDocs = await FcmToken.find({
      userEmail: { $in: recipients.map((r) => r.email) },
    }).lean();
    const tokens = [
      ...new Set(tokenDocs.map((t) => t.fcmToken).filter(Boolean)),
    ];
    if (tokens.length) {
      const pushData = {
        type: 'invoice',
        kind,
        organizationId: orgIdString,
        ...(invoiceId ? { invoiceId: String(invoiceId) } : {}),
        channelId: 'payments',
        title,
        body: message,
      };
      const response = await firebaseConfig.sendMulticastNotification(
        tokens,
        pushData,
        { title, body: message }
      );
      pushed = response?.successCount ?? tokens.length;
      await Notification.updateMany(
        {
          organizationId,
          type: kind,
          status: 'pending',
          'data.invoiceId': data.invoiceId,
        },
        { $set: { status: pushed > 0 ? 'sent' : 'failed', sentAt: new Date() } }
      );
    }
  } catch (error) {
    logger.warn('Billing push delivery failed (history retained)', {
      organizationId: orgIdString,
      kind,
      error: error.message,
    });
  }

  logger.info('Billing notification fanned out', {
    organizationId: orgIdString,
    kind,
    delivered: recipients.length,
    pushed,
  });
  return { delivered: recipients.length, pushed, kind };
}

function invoiceLabel(invoice) {
  return invoice?.invoiceNumber || String(invoice?._id || 'invoice');
}

async function notifyInvoiceApproved({ organizationId, invoice, approvedBy }) {
  const label = invoiceLabel(invoice);
  const client = invoice?.clientName || 'A client';
  return fanOut({
    organizationId,
    kind: KIND.INVOICE_APPROVED,
    title: `Invoice ${label} approved`,
    message: `${client} approved invoice ${label}${
      approvedBy ? ` (${approvedBy})` : ''
    }.`,
    invoiceId: invoice?._id,
    priority: 'medium',
  });
}

async function notifyInvoiceDisputed({ organizationId, invoice, reason }) {
  const label = invoiceLabel(invoice);
  const client = invoice?.clientName || 'A client';
  return fanOut({
    organizationId,
    kind: KIND.INVOICE_DISPUTED,
    title: `Invoice ${label} disputed`,
    message: `${client} does not agree with invoice ${label}: ${reason}`,
    invoiceId: invoice?._id,
    priority: 'high',
  });
}

async function notifyPaymentReceived({ organizationId, invoice, amount, method }) {
  const label = invoiceLabel(invoice);
  return fanOut({
    organizationId,
    kind: KIND.PAYMENT_RECEIVED,
    title: `Payment received: ${formatAud(amount)}`,
    message: `${formatAud(amount)} received for invoice ${label}${
      method ? ` via ${method}` : ''
    }.`,
    invoiceId: invoice?._id,
    priority: 'medium',
  });
}

async function notifyStripeDisputeOpened({
  organizationId,
  invoiceId,
  invoiceNumber,
  amount,
  reason,
  dueBy,
}) {
  const label = invoiceNumber || (invoiceId ? String(invoiceId) : 'invoice');
  return fanOut({
    organizationId,
    kind: KIND.STRIPE_DISPUTE_OPENED,
    title: `Chargeback on invoice ${label}`,
    message:
      `A ${formatAud(amount)} payment on invoice ${label} was disputed` +
      `${reason ? ` (${reason})` : ''}` +
      `${dueBy ? `. Respond by ${dueBy}` : ''}.`,
    invoiceId,
    priority: 'high',
  });
}

async function notifyPayout({ organizationId, amount, arrivalDate, status, failureMessage }) {
  const failed = status === 'failed';
  return fanOut({
    organizationId,
    kind: failed ? KIND.PAYOUT_FAILED : KIND.PAYOUT_PAID,
    title: failed
      ? `Payout of ${formatAud(amount)} failed`
      : `Payout of ${formatAud(amount)} on its way`,
    message: failed
      ? `Your ${formatAud(amount)} payout failed${
          failureMessage ? `: ${failureMessage}` : '.'
        } Check your bank details in Stripe.`
      : `Your ${formatAud(amount)} payout is arriving${
          arrivalDate ? ` ${arrivalDate}` : ''
        }.`,
    priority: failed ? 'high' : 'medium',
  });
}

module.exports = {
  KIND,
  fanOut,
  resolveRecipients,
  notifyInvoiceApproved,
  notifyInvoiceDisputed,
  notifyPaymentReceived,
  notifyStripeDisputeOpened,
  notifyPayout,
};
