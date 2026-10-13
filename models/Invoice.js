const mongoose = require('mongoose');

const lineItemSchema = new mongoose.Schema({
  supportItemNumber: String,
  supportItemName: String,
  price: Number,
  quantity: Number,
  unit: String,
  totalPrice: Number,
  date: Date,
  organizationId: String,
  providerType: String,
  serviceLocationPostcode: String,
  pricingMetadata: {
    timeBand: String,
    mmmRating: Number,
    mmmMultiplier: Number,
    priceCapBase: Number,
    priceCapApplied: Number
  }
});

const transactionSchema = new mongoose.Schema({
  date: Date,
  amount: Number,
  method: String,
  reference: String,
  status: String,
  notes: String
}, { _id: false });

const creditNoteSchema = new mongoose.Schema({
  creditNoteId: mongoose.Schema.Types.ObjectId,
  creditNoteNumber: String,
  amount: Number,
  appliedDate: Date,
  reason: String
}, { _id: false });

const changeHistorySchema = new mongoose.Schema({
  timestamp: Date,
  userId: String,
  action: String,
  changes: Object,
  reason: String
}, { _id: false });

const shareHistorySchema = new mongoose.Schema({
  sharedWith: String,
  sharedBy: String,
  sharedAt: Date,
  accessCount: Number,
  lastAccessed: Date
}, { _id: false });

const invoiceSchema = new mongoose.Schema({
  invoiceNumber: { type: String, unique: true, required: true },
  organizationId: { type: String, required: true, index: true },
  
  clientId: String,
  clientEmail: String,
  clientName: String,
  
  lineItems: [lineItemSchema],
  
  financialSummary: {
    subtotal: Number,
    taxAmount: Number,
    discountAmount: Number,
    expenseAmount: Number,
    totalAmount: Number,
    currency: { type: String, default: 'AUD' },
    exchangeRate: { type: Number, default: 1.0 },
    paymentTerms: Number,
    dueDate: Date
  },
  
  metadata: {
    invoiceType: String,
    generationMethod: String,
    templateUsed: String,
    customizations: [String],
    tags: [String],
    category: String,
    priority: String,
    internalNotes: String
  },

  // Phase 6: funding route determines the billing artefact
  // (ndia_managed -> claim CSV; plan_managed -> plan-manager PDF;
  //  self_managed -> participant PDF).
  billing: {
    fundingType: {
      type: String,
      enum: ['ndia_managed', 'plan_managed', 'self_managed']
    },
    recipientType: {
      type: String,
      enum: ['participant', 'plan_manager', 'ndia']
    },
    planManagerStakeholderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Stakeholder'
    }
  },

  // Preserved for employee payroll workflows and PDF regeneration.
  header: {
    issuer: mongoose.Schema.Types.Mixed,
    billedTo: mongoose.Schema.Types.Mixed
  },

  calculatedPayloadData: mongoose.Schema.Types.Mixed,
  // Full input used to generate the invoice PDF (immutable snapshot).
  // This allows deterministic re-rendering without re-calculating business logic.
  pdfRenderSnapshot: mongoose.Schema.Types.Mixed,
  // Stored PDF artifact metadata (Firebase/R2/etc) for direct retrieval.
  pdfArtifact: mongoose.Schema.Types.Mixed,
  // Runtime params/flags used by PDF generator (tax, expenses, attachments, etc).
  pdfGenerationParams: mongoose.Schema.Types.Mixed,
  // Keep original expense rows used during generation.
  expenses: [mongoose.Schema.Types.Mixed],

  employeeContext: {
    employeeId: String,
    employeeEmail: String,
    employeeName: String
  },
  
  compliance: {
    ndisCompliant: Boolean,
    validationPassed: Boolean,
    validationErrors: [String],
    auditRequired: Boolean,
    complianceNotes: String,
    lastComplianceCheck: Date,
    complianceOfficer: String
  },
  
  delivery: {
    method: String,
    status: String,
    sentDate: Date,
    deliveredDate: Date,
    recipientEmail: String,
    deliveryAttempts: Number,
    lastAttemptDate: Date,
    deliveryNotes: String
  },
  
  payment: {
    status: { 
      type: String, 
      enum: ['pending', 'partial', 'paid', 'overdue', 'cancelled', 'credited', 'refunded'],
      default: 'pending',
      index: true
    },
    method: String,
    paidAmount: { type: Number, default: 0 },
    balanceDue: Number,
    paidDate: Date,
    transactionReference: String,
    paymentNotes: String,
    remindersSent: Number,
    lastReminderDate: Date,
    writeOffAmount: Number,
    writeOffReason: String,
    // Stripe Payment Link created automatically when the invoice is generated.
    // The link is a bearer URL; it is deactivated once the invoice is paid.
    paymentLinkId: String,
    paymentLinkUrl: String,
    paymentLinkStatus: {
      type: String,
      enum: ['active', 'deactivated'],
    },
    paymentLinkAmountCents: Number,
    paymentLinkStripeAccountId: String,
    paymentLinkCreatedAt: Date,
    transactions: [transactionSchema]
  },
  
  recurrence: {
    isRecurring: Boolean,
    frequency: String,
    startDate: Date,
    nextDate: Date,
    endDate: Date,
    parentInvoiceId: mongoose.Schema.Types.ObjectId,
    lastGeneratedDate: Date
  },
  
  creditNotes: [creditNoteSchema],
  
  workflow: {
    status: { 
      type: String, 
      enum: ['draft', 'pending_approval', 'approved', 'generated', 'sent', 'paid', 'cancelled', 'disputed', 'deleted'],
      default: 'draft',
      index: true
    },
    approvalRequired: Boolean,
    approvedBy: String,
    approvalDate: Date,
    rejectionReason: String,
    workflowNotes: String,
    currentStep: String,
    nextAction: String
  },
  
  auditTrail: {
    createdBy: String,
    createdAt: Date,
    updatedBy: String,
    updatedAt: Date,
    version: Number,
    changeHistory: [changeHistorySchema]
  },
  
  sharing: {
    isShared: Boolean,
    sharedWith: [String],
    shareToken: { type: String, index: true },
    shareExpiryDate: Date,
    sharePermissions: String,
    shareHistory: [shareHistorySchema]
  },
  
  deletion: {
    isDeleted: { type: Boolean, default: false, index: true },
    deletedBy: String,
    deletedAt: Date,
    deletionReason: String,
    canRestore: Boolean,
    permanentDeletionDate: Date
  }
}, {
  timestamps: true,
  collection: 'invoices'
});

// Indexes from schema definition
invoiceSchema.index({ organizationId: 1, 'workflow.status': 1 });
invoiceSchema.index({ organizationId: 1, clientEmail: 1 });
invoiceSchema.index({ organizationId: 1, 'auditTrail.createdAt': -1 });
invoiceSchema.index({ organizationId: 1, 'payment.status': 1 });
invoiceSchema.index({ organizationId: 1, 'financialSummary.dueDate': 1 });
invoiceSchema.index({ createdAt: -1 });
// Org-scoped console analytics filter on organizationId + createdAt. Without
// this a tenant-scoped timeseries still scans every tenant's invoices.
invoiceSchema.index({ organizationId: 1, createdAt: -1 });
// Per-tenant top-clients grouping (clientEmail) inside a date window.
invoiceSchema.index({ organizationId: 1, clientEmail: 1, createdAt: -1 });

// Phase 6: stamp the funding/billing route on new invoices so the billing
// artefact (NDIA claim CSV vs plan-manager/participant PDF) is recorded at
// creation time regardless of which service created the invoice. Additive and
// best-effort: a lookup failure must never block invoice creation.
invoiceSchema.pre('save', async function stampBillingRoute() {
  try {
    if (!this.isNew) return;
    if (this.billing && this.billing.fundingType) return;
    if (!this.clientId) return;

    // Lazy requires avoid import cycles at module load.
    const Client = require('./Client');
    const billingRoutingService = require('../services/billingRoutingService');

    const client = await Client.findById(this.clientId).lean();
    if (client) {
      this.billing = billingRoutingService.buildInvoiceBilling(client);
    }
  } catch (_) {
    // Never block invoice creation on routing metadata.
  }
});

const InvoiceStatus = {
  DRAFT: 'draft',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  GENERATED: 'generated',
  SENT: 'sent',
  DELIVERED: 'delivered',
  PAID: 'paid',
  OVERDUE: 'overdue',
  CANCELLED: 'cancelled',
  DELETED: 'deleted',
  DISPUTED: 'disputed'
};

const PaymentStatus = {
  PENDING: 'pending',
  PARTIAL: 'partial',
  PAID: 'paid',
  OVERDUE: 'overdue',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded'
};

module.exports = {
  Invoice: mongoose.model('Invoice', invoiceSchema),
  InvoiceStatus,
  PaymentStatus
};
