const mongoose = require('mongoose');

const CreditNoteStatus = {
  DRAFT: 'draft',
  ISSUED: 'issued',
  APPLIED: 'applied', // Fully applied
  PARTIAL: 'partial', // Partially applied
  REFUNDED: 'refunded',
  VOID: 'void'
};

const applicationSchema = new mongoose.Schema({
  invoiceId: mongoose.Schema.Types.ObjectId,
  invoiceNumber: String,
  amountApplied: Number,
  date: Date
}, { _id: false });

const refundSchema = new mongoose.Schema({
  amount: Number,
  date: Date,
  method: String, // 'bank_transfer', 'stripe', etc.
  reference: String
}, { _id: false });

const creditNoteSchema = new mongoose.Schema({
  creditNoteNumber: { type: String, required: true, unique: true }, // e.g., CN-2023-001
  organizationId: { type: String, required: true, index: true },
  
  // Linked Invoice (Optional - can be general credit)
  originalInvoiceId: mongoose.Schema.Types.ObjectId,
  originalInvoiceNumber: String,
  
  // Client details
  clientId: String,
  clientEmail: String,
  clientName: String,
  
  // Financials
  amount: { type: Number, required: true },
  currency: { type: String, default: 'AUD' },
  reason: String, // Reason for credit
  
  // Status
  status: { 
    type: String, 
    enum: Object.values(CreditNoteStatus),
    default: CreditNoteStatus.DRAFT,
    index: true
  },
  
  // Usage tracking
  balanceRemaining: { type: Number, required: true }, // Amount not yet applied
  
  // Application history
  applications: [applicationSchema],
  
  // Refund history (if money returned)
  refunds: [refundSchema],
  
  // Dates
  issueDate: Date,
  expiryDate: Date,
  
  // Metadata
  createdBy: String,
  notes: String
}, {
  timestamps: true,
  collection: 'creditNotes'
});

module.exports = {
  CreditNote: mongoose.model('CreditNote', creditNoteSchema),
  CreditNoteStatus
};
