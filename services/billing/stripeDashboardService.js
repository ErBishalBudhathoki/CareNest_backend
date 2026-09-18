const { Invoice } = require('../../models/Invoice');
const Organization = require('../../models/Organization');
const logger = require('../../config/logger');

/**
 * Read-model service for the in-app Stripe revenue dashboard.
 *
 * Everything here is READ-ONLY except `createRefund`, which is hard-gated
 * behind the ENABLE_INAPP_REFUNDS environment flag (dev only; unset/false
 * in production) AND re-checked in the controller. All Stripe calls run on
 * the organisation's connected account via the `stripeAccount` header, and
 * every query is scoped by the exact organizationId — one organisation's
 * figures can never leak into another's.
 */

let stripe;
function getStripe() {
  if (stripe) return stripe;
  const key =
    process.env.STRIPE_SECRET_KEY ||
    (process.env.NODE_ENV === 'test' ? 'sk_test_mock' : null);
  if (key) {
    stripe = require('stripe')(key);
    return stripe;
  }
  return null;
}

function refundsEnabled() {
  return (
    String(process.env.ENABLE_INAPP_REFUNDS || '').toLowerCase() === 'true'
  );
}

function centsToDollars(cents) {
  return Math.round(Number(cents) || 0) / 100;
}

async function loadOrg(organizationId) {
  const organization = await Organization.findById(organizationId);
  if (!organization?.stripeAccountId) {
    const error = new Error('Organization has no linked Stripe account');
    error.statusCode = 404;
    error.code = 'STRIPE_NOT_CONNECTED';
    throw error;
  }
  return organization;
}

// Friendly labels for the most common Stripe `requirements.currently_due`
// codes. Unknown codes pass through raw so nothing is ever hidden.
const REQUIREMENT_LABELS = {
  'individual.first_name': 'Account holder first name',
  'individual.last_name': 'Account holder last name',
  'individual.dob.day': 'Account holder date of birth',
  'individual.address.line1': 'Account holder address',
  'individual.phone': 'Account holder phone number',
  'individual.id_number': 'Account holder ID number',
  'individual.verification.document': 'Identity document',
  'company.name': 'Company legal name',
  'company.tax_id': 'Company tax ID',
  'company.verification.document': 'Company verification document',
  'external_account': 'Bank account for payouts',
  'business_profile.url': 'Business website URL',
  'business_profile.mcc': 'Business category',
  tos_acceptance_date: 'Terms of service acceptance',
};

function labelRequirement(code) {
  if (REQUIREMENT_LABELS[code]) return REQUIREMENT_LABELS[code];
  if (code === 'individual.dob.month' || code === 'individual.dob.year') {
    return 'Account holder date of birth';
  }
  return String(code).replace(/[_.]/g, ' ');
}

async function getAccountOverview({ organizationId }) {
  const organization = await loadOrg(organizationId);
  const stripeClient = getStripe();
  if (!stripeClient) {
    const error = new Error('Stripe is not configured');
    error.statusCode = 503;
    error.code = 'STRIPE_NOT_CONFIGURED';
    throw error;
  }
  const account = await stripeClient.accounts.retrieve(
    organization.stripeAccountId
  );
  const currentlyDue = account.requirements?.currently_due || [];
  return {
    connected: true,
    stripeAccountId: organization.stripeAccountId,
    chargesEnabled: account.charges_enabled === true,
    detailsSubmitted: account.details_submitted === true,
    payoutsEnabled: account.payouts_enabled === true,
    disabledReason: account.requirements?.disabled_reason || null,
    businessName:
      account.business_profile?.name ||
      account.settings?.dashboard?.display_name ||
      organization.name ||
      organization.tradingName ||
      null,
    email: account.email || null,
    country: account.country || null,
    defaultCurrency: account.default_currency || 'aud',
    requirementsDue: currentlyDue.map((code) => ({
      code,
      label: labelRequirement(code),
    })),
    connectedAt: organization.subscription?.connectedAt || null,
    connectedAccountSource:
      organization.subscription?.connectedAccountSource || null,
    refundsEnabled: refundsEnabled(),
  };
}

async function getBalance({ organizationId }) {
  const organization = await loadOrg(organizationId);
  const stripeClient = getStripe();
  if (!stripeClient) {
    const error = new Error('Stripe is not configured');
    error.statusCode = 503;
    error.code = 'STRIPE_NOT_CONFIGURED';
    throw error;
  }
  const balance = await stripeClient.balance.retrieve({
    stripeAccount: organization.stripeAccountId,
  });
  const map = (entries) =>
    (entries || []).map((entry) => ({
      currency: String(entry.currency || 'aud').toUpperCase(),
      amount: centsToDollars(entry.amount),
    }));
  return {
    available: map(balance.available),
    pending: map(balance.pending),
  };
}

function toIsoDay(date) {
  return date.toISOString().slice(0, 10);
}

async function getRevenueSeries({ organizationId, days = 30 }) {
  const parsedDays = Math.min(Math.max(Number(days) || 30, 1), 365);
  const cutoff = new Date(Date.now() - parsedDays * 24 * 60 * 60 * 1000);
  const invoices = await Invoice.find({
    organizationId,
    'deletion.isDeleted': { $ne: true },
    'payment.status': 'paid',
    'payment.paidDate': { $gte: cutoff },
  })
    .select('payment.paidAmount payment.paidDate')
    .lean();

  const byDay = new Map();
  for (const invoice of invoices) {
    const paidDate = invoice?.payment?.paidDate
      ? new Date(invoice.payment.paidDate)
      : null;
    if (!paidDate || Number.isNaN(paidDate.getTime())) continue;
    const day = toIsoDay(paidDate);
    byDay.set(day, (byDay.get(day) || 0) + Number(invoice.payment.paidAmount || 0));
  }

  const series = [];
  let total = 0;
  for (let i = parsedDays - 1; i >= 0; i -= 1) {
    const day = toIsoDay(new Date(Date.now() - i * 24 * 60 * 60 * 1000));
    const dayTotal = Math.round((byDay.get(day) || 0) * 100) / 100;
    total += dayTotal;
    series.push({ date: day, total: dayTotal });
  }
  return {
    days: parsedDays,
    currency: 'AUD',
    total: Math.round(total * 100) / 100,
    invoiceCount: invoices.length,
    series,
  };
}

async function listRecentPayments({ organizationId, limit = 20 }) {
  const parsedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const invoices = await Invoice.find({
    organizationId,
    'deletion.isDeleted': { $ne: true },
  })
    .select(
      'invoiceNumber clientName financialSummary.totalAmount payment.status ' +
        'payment.paidAmount payment.balanceDue payment.paidDate ' +
        'payment.paymentLinkStatus workflow.status updatedAt'
    )
    .sort({ updatedAt: -1 })
    .limit(parsedLimit)
    .lean();

  return invoices.map((invoice) => ({
    invoiceId: String(invoice._id),
    invoiceNumber: invoice.invoiceNumber || String(invoice._id),
    clientName: invoice.clientName || 'Unknown client',
    totalAmount: Number(invoice.financialSummary?.totalAmount || 0),
    status: invoice.payment?.status || 'pending',
    paidAmount: Number(invoice.payment?.paidAmount || 0),
    balanceDue: Number(invoice.payment?.balanceDue || 0),
    paidDate: invoice.payment?.paidDate || null,
    paymentLinkStatus: invoice.payment?.paymentLinkStatus || null,
    workflowStatus: invoice.workflow?.status || null,
  }));
}

async function listPayouts({ organizationId, limit = 20, startingAfter }) {
  const organization = await loadOrg(organizationId);
  const stripeClient = getStripe();
  if (!stripeClient) {
    const error = new Error('Stripe is not configured');
    error.statusCode = 503;
    error.code = 'STRIPE_NOT_CONFIGURED';
    throw error;
  }
  const params = { limit: Math.min(Math.max(Number(limit) || 20, 1), 100) };
  if (startingAfter) params.starting_after = startingAfter;
  const page = await stripeClient.payouts.list(params, {
    stripeAccount: organization.stripeAccountId,
  });

  // Best-effort: resolve the default bank account once for a friendly label.
  let bankLabel = null;
  try {
    const externals = await stripeClient.accounts.listExternalAccounts(
      organization.stripeAccountId,
      { object: 'bank_account', limit: 10 }
    );
    const match =
      (externals.data || []).find((a) => a.default_for_currency) ||
      (externals.data || [])[0];
    if (match) {
      bankLabel = `${match.bank_name || 'Bank'} •••• ${match.last4 || '????'}`;
    }
  } catch (error) {
    logger.warn('Could not resolve payout bank label', {
      organizationId: String(organizationId),
      error: error.message,
    });
  }

  return {
    bankLabel,
    hasMore: page.has_more === true,
    payouts: (page.data || []).map((payout) => ({
      id: payout.id,
      amount: centsToDollars(payout.amount),
      currency: String(payout.currency || 'aud').toUpperCase(),
      arrivalDate: payout.arrival_date
        ? new Date(Number(payout.arrival_date) * 1000).toISOString()
        : null,
      status: payout.status,
      failureCode: payout.failure_code || null,
      failureMessage: payout.failure_message || null,
    })),
  };
}

/**
 * Resolve our invoice for a Stripe payment intent id using the transaction
 * references our services persist. Scoped to the organisation.
 */
async function findInvoiceByPaymentIntent(organizationId, paymentIntentId) {
  if (!paymentIntentId) return null;
  return Invoice.findOne({
    organizationId,
    'deletion.isDeleted': { $ne: true },
    'payment.transactions.reference': String(paymentIntentId),
  })
    .select('invoiceNumber clientName')
    .lean();
}

async function getRisk({ organizationId }) {
  const organization = await loadOrg(organizationId);
  const stripeClient = getStripe();
  if (!stripeClient) {
    const error = new Error('Stripe is not configured');
    error.statusCode = 503;
    error.code = 'STRIPE_NOT_CONFIGURED';
    throw error;
  }
  const header = { stripeAccount: organization.stripeAccountId };
  const [refundPage, disputePage] = await Promise.all([
    stripeClient.refunds.list({ limit: 10 }, header),
    stripeClient.disputes.list({ limit: 10 }, header),
  ]);

  const refunds = await Promise.all(
    (refundPage.data || []).map(async (refund) => {
      const invoice = await findInvoiceByPaymentIntent(
        organizationId,
        refund.payment_intent
      );
      return {
        id: refund.id,
        kind: 'refund',
        amount: centsToDollars(refund.amount),
        currency: String(refund.currency || 'aud').toUpperCase(),
        reason: refund.reason || null,
        status: refund.status,
        createdAt: refund.created
          ? new Date(Number(refund.created) * 1000).toISOString()
          : null,
        invoiceId: invoice ? String(invoice._id) : null,
        invoiceNumber: invoice?.invoiceNumber || null,
      };
    })
  );

  const disputes = await Promise.all(
    (disputePage.data || []).map(async (dispute) => {
      const paymentIntentId =
        typeof dispute.payment_intent === 'string'
          ? dispute.payment_intent
          : dispute.payment_intent?.id || null;
      const invoice = await findInvoiceByPaymentIntent(
        organizationId,
        paymentIntentId
      );
      return {
        id: dispute.id,
        kind: 'dispute',
        amount: centsToDollars(dispute.amount),
        currency: String(dispute.currency || 'aud').toUpperCase(),
        reason: dispute.reason || null,
        status: dispute.status,
        dueBy: dispute.evidence_details?.due_by
          ? new Date(Number(dispute.evidence_details.due_by) * 1000).toISOString()
          : null,
        createdAt: dispute.created
          ? new Date(Number(dispute.created) * 1000).toISOString()
          : null,
        invoiceId: invoice ? String(invoice._id) : null,
        invoiceNumber: invoice?.invoiceNumber || null,
      };
    })
  );

  return { refunds, disputes };
}

/**
 * Issue a refund on the connected account and mirror it in the local ledger.
 *
 * DEV ONLY: throws unless ENABLE_INAPP_REFUNDS=true. Supports full and
 * partial amounts. The controller re-checks the flag so a client can never
 * enable this by itself.
 */
async function createRefund({ organizationId, invoiceId, amount }) {
  if (!refundsEnabled()) {
    const error = new Error('In-app refunds are disabled');
    error.statusCode = 403;
    error.code = 'REFUNDS_DISABLED';
    throw error;
  }
  const organization = await loadOrg(organizationId);
  const stripeClient = getStripe();
  if (!stripeClient) {
    const error = new Error('Stripe is not configured');
    error.statusCode = 503;
    error.code = 'STRIPE_NOT_CONFIGURED';
    throw error;
  }

  const invoice = await Invoice.findOne({
    _id: invoiceId,
    organizationId,
    'deletion.isDeleted': { $ne: true },
  });
  if (!invoice) {
    const error = new Error('Invoice not found');
    error.statusCode = 404;
    error.code = 'INVOICE_NOT_FOUND';
    throw error;
  }

  const paidAmount = Number(invoice.payment?.paidAmount || 0);
  const alreadyRefunded = (invoice.payment?.transactions || [])
    .filter((t) => t.method === 'refund' && t.status !== 'failed')
    .reduce((sum, t) => sum + Math.abs(Number(t.amount) || 0), 0);
  const refundable = Math.round((paidAmount - alreadyRefunded) * 100) / 100;
  if (refundable <= 0) {
    const error = new Error('Nothing left to refund on this invoice');
    error.statusCode = 400;
    error.code = 'NOTHING_TO_REFUND';
    throw error;
  }

  const requested = amount == null ? refundable : Number(amount);
  if (!Number.isFinite(requested) || requested <= 0 || requested - refundable > 0.001) {
    const error = new Error(
      `Refund amount must be between 0 and ${refundable.toFixed(2)}`
    );
    error.statusCode = 400;
    error.code = 'INVALID_REFUND_AMOUNT';
    throw error;
  }

  // Find the Stripe payment intent behind the payment (our transaction refs).
  const stripeTx = (invoice.payment?.transactions || [])
    .filter((t) => t.method === 'stripe' && t.reference)
    .pop();
  if (!stripeTx?.reference) {
    const error = new Error('No Stripe payment found on this invoice');
    error.statusCode = 400;
    error.code = 'NO_STRIPE_PAYMENT';
    throw error;
  }

  const refund = await stripeClient.refunds.create(
    {
      payment_intent: String(stripeTx.reference),
      amount: Math.round(requested * 100),
      metadata: {
        invoiceId: String(invoice._id),
        organizationId: String(organizationId),
      },
    },
    { stripeAccount: organization.stripeAccountId }
  );

  const newPaidAmount =
    Math.round((paidAmount - requested) * 100) / 100;
  const totalAmount = Number(invoice.financialSummary?.totalAmount || 0);
  const balanceDue = Math.round((totalAmount - newPaidAmount) * 100) / 100;
  invoice.payment.transactions.push({
    date: new Date(),
    amount: -requested,
    method: 'refund',
    reference: refund.id,
    status: refund.status === 'failed' ? 'failed' : 'success',
    notes: 'Refund issued from CareNest dashboard (dev)',
  });
  if (refund.status !== 'failed') {
    invoice.payment.paidAmount = newPaidAmount;
    invoice.payment.balanceDue = balanceDue;
    invoice.payment.status = balanceDue <= 0.01 ? 'paid' : 'partial';
    if (invoice.payment.status !== 'paid') {
      invoice.payment.paidDate = null;
    }
  }
  await invoice.save();

  logger.info('Dashboard refund issued', {
    organizationId: String(organizationId),
    invoiceId: String(invoice._id),
    refundId: refund.id,
    amount: requested,
  });

  return {
    refundId: refund.id,
    amount: requested,
    currency: String(refund.currency || 'aud').toUpperCase(),
    status: refund.status,
    newPaidAmount: invoice.payment.paidAmount,
    balanceDue: invoice.payment.balanceDue,
    paymentStatus: invoice.payment.status,
  };
}

module.exports = {
  refundsEnabled,
  getAccountOverview,
  getBalance,
  getRevenueSeries,
  listRecentPayments,
  listPayouts,
  getRisk,
  createRefund,
};
