/**
 * Credit Note Schema Definition
 * Represents a refund or credit issued to a client
 */

const creditNoteSchema = {
  _id: 'ObjectId',
  creditNoteNumber: 'String', // Unique identifier (e.g., CN-2023-001)
  organizationId: 'String',
  
  // Linked Invoice (Optional - can be general credit)
  originalInvoiceId: 'ObjectId',
  originalInvoiceNumber: 'String',
  
  // Client details
  clientId: 'String',
  clientEmail: 'String',
  clientName: 'String',
  
  // Financials
  amount: 'Number',
  currency: 'String', // Default: 'AUD'
  reason: 'String', // Reason for credit (e.g., 'Overcharge', 'Service Cancellation')
  
  // Status
  status: 'String', // 'draft', 'issued', 'applied', 'refunded', 'void'
  
  // Usage tracking
  balanceRemaining: 'Number', // Amount not yet applied to other invoices or refunded
  
  // Application history
  applications: [{
    invoiceId: 'ObjectId',
    invoiceNumber: 'String',
    amountApplied: 'Number',
    date: 'Date'
  }],
  
  // Refund history (if money returned)
  refunds: [{
    amount: 'Number',
    date: 'Date',
    method: 'String', // 'bank_transfer', 'stripe', etc.
    reference: 'String'
  }],
  
  // Dates
  issueDate: 'Date',
  expiryDate: 'Date', // Optional
  
  // Metadata
  createdBy: 'String',
  createdAt: 'Date',
  updatedAt: 'Date',
  notes: 'String'
};

const CreditNoteStatus = {
  DRAFT: 'draft',
  ISSUED: 'issued',
  APPLIED: 'applied', // Fully applied
  PARTIAL: 'partial', // Partially applied
  REFUNDED: 'refunded',
  VOID: 'void'
};

module.exports = {
  creditNoteSchema,
  CreditNoteStatus
};
