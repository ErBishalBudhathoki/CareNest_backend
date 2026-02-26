const mongoose = require('mongoose');

const invoicingEmailKeySchema = new mongoose.Schema(
  {
    userEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    organizationId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    invoicingBusinessKey: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: true,
    collection: 'invoicingEmailKeys',
  }
);

invoicingEmailKeySchema.index(
  { userEmail: 1, organizationId: 1 },
  { unique: true }
);

module.exports = mongoose.model('InvoicingEmailKey', invoicingEmailKeySchema);

