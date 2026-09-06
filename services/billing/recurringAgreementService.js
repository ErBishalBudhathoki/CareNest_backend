const crypto = require('crypto');
const RecurringInvoiceAgreement = require('../../models/billing/RecurringInvoiceAgreement');
const Invoice = require('../../models/Invoice');
const Organization = require('../../models/Organization');
const logger = require('../../config/logger');

let stripe;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

const CONSENT_TEXT_VERSION = '2024-09-01';

const FREQUENCY_TO_DAYS = {
  weekly: 7,
  fortnightly: 14,
  monthly: 30,
};

async function createConsent({ organizationId, createdByUser, payload }) {
  if (!stripe) throw new Error('Stripe is not configured on the server');

  const { invoiceId, frequency, consentAccepted, consentIp, consentUserAgent } = payload;
  if (!consentAccepted) throw new Error('Client must accept the recurring-payment consent');

  const [invoice, org] = await Promise.all([
    Invoice.findOne({ _id: invoiceId, organizationId }),
    Organization.findById(organizationId),
  ]);
  if (!invoice) throw new Error('Invoice not found');
  if (!org?.stripeAccountId) {
    throw new Error('Organization must complete Stripe Connect onboarding');
  }

  const totalAmount = Number(invoice.financialSummary?.totalAmount || 0);
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new Error('Invoice does not have a recurring amount');
  }
  const amountCents = Math.round(totalAmount * 100);
  const currency = String(invoice.financialSummary?.currency || 'AUD').toUpperCase();

  const customer = await stripe.customers.create(
    {
      email: invoice.clientEmail,
      name: invoice.clientName,
      metadata: { organizationId: String(organizationId) },
    },
    { stripeAccount: org.stripeAccountId }
  );

  const session = await stripe.checkout.sessions.create(
    {
      mode: 'setup',
      customer: customer.id,
      payment_method_types: ['card'],
      metadata: {
        organizationId: String(organizationId),
        invoiceId: String(invoiceId),
      },
    },
    { stripeAccount: org.stripeAccountId }
  );

  const consentText = `I authorise ${org.name || 'this organization'} to charge my saved payment method on the ${frequency} cadence to pay CareNest invoice ${invoice.invoiceNumber} (${currency} ${totalAmount.toFixed(2)}). I can cancel at any time before the next scheduled charge.`;
  const consentHash = crypto
    .createHash('sha256')
    .update(consentText)
    .digest('hex');

  const agreement = await RecurringInvoiceAgreement.create({
    organizationId,
    invoiceTemplateId: invoiceId,
    clientName: invoice.clientName,
    clientEmail: invoice.clientEmail,
    stripeCustomerId: customer.id,
    stripePaymentMethodId: 'pending-setup',
    stripeAccountId: org.stripeAccountId,
    frequency,
    amountCents,
    currency,
    consentTextVersion: CONSENT_TEXT_VERSION,
    consentTextHash: consentHash,
    consentIpAddress: consentIp,
    consentUserAgent: consentUserAgent,
    consentedAt: new Date(),
    status: 'paused',
    nextRunAt: new Date(Date.now() + (FREQUENCY_TO_DAYS[frequency] || 30) * 24 * 60 * 60 * 1000),
  });

  return { agreement, setupSessionUrl: session.url };
}

async function activateFromSetup({ organizationId, agreementId, paymentMethodId, customerId }) {
  const agreement = await RecurringInvoiceAgreement.findOne({
    _id: agreementId,
    organizationId,
  });
  if (!agreement) throw new Error('Recurring agreement not found');
  if (paymentMethodId) agreement.stripePaymentMethodId = paymentMethodId;
  if (customerId) agreement.stripeCustomerId = customerId;
  agreement.status = 'active';
  await agreement.save();
  return agreement;
}

async function cancelAgreement({ organizationId, agreementId, canceledBy, reason }) {
  const agreement = await RecurringInvoiceAgreement.findOne({
    _id: agreementId,
    organizationId,
  });
  if (!agreement) throw new Error('Recurring agreement not found');
  if (agreement.status === 'canceled') return agreement;
  agreement.status = 'canceled';
  agreement.canceledAt = new Date();
  agreement.canceledBy = canceledBy;
  agreement.cancellationReason = reason;
  agreement.nextRunAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 10);
  await agreement.save();
  logger.info('Recurring agreement canceled', { organizationId, agreementId });
  return agreement;
}

async function listAgreements(organizationId) {
  return RecurringInvoiceAgreement.find({ organizationId })
    .sort({ nextRunAt: 1 })
    .lean();
}

module.exports = {
  createConsent,
  activateFromSetup,
  cancelAgreement,
  listAgreements,
  CONSENT_TEXT_VERSION,
};
