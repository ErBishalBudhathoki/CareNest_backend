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

// Every revenue read filters on organizationId plus a range on createdAt — `date`
// is stored but never used in a query, so indexing it would be dead weight. With
// only the single-field organizationId index, Mongo fetches every matching
// document and discards most of them after the date filter, and
// dashboardController.getRevenueComparison used to run that scan 13 times per
// request.
//
// The explicit names are load-bearing. scripts/migrate_dashboard_indexes.js
// creates these same indexes, and Mongoose's autoIndex derives names from the key
// pattern (`organizationId_1_createdAt_1`). Without an explicit name the two
// definitions collide and every boot fails with Mongo error 85
// (IndexOptionsConflict: "Index already exists with a different name"), because
// Mongo rejects a duplicate key pattern under a different name.
invoiceLineItemSchema.index(
  { organizationId: 1, createdAt: 1 },
  { name: 'org_createdAt_idx' }
);

// Utilization analytics group by employeeId inside the same date window.
invoiceLineItemSchema.index(
  { organizationId: 1, employeeId: 1, createdAt: 1 },
  { name: 'org_employee_createdAt_idx' }
);

module.exports = mongoose.model('InvoiceLineItem', invoiceLineItemSchema);
