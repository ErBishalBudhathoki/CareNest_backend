const mongoose = require('mongoose');

const invoiceLineItemSchema = new mongoose.Schema({
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true, index: true },
  invoiceNumber: String,
  organizationId: { type: String, required: true, index: true },
  clientEmail: String,
  
  // Line item details
  description: String,
  ndisItemNumber: String,
  quantity: Number,
  unitPrice: Number,
  totalPrice: Number,
  date: Date,
  hours: Number,
  employeeId: String,
  
  // Analytics metadata
  createdAt: { type: Date, default: Date.now },
  // ... other fields copied from invoice line item
}, {
  timestamps: true,
  collection: 'invoiceLineItems',
  strict: false // Allow flexible fields as it copies from dynamic line items
});

module.exports = mongoose.model('InvoiceLineItem', invoiceLineItemSchema);
