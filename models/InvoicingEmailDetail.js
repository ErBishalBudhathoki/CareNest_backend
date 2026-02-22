const mongoose = require('mongoose');

const invoicingEmailDetailSchema = new mongoose.Schema(
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
    invoicingBusinessName: {
      type: String,
      default: '',
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    encryptedPassword: {
      type: String,
      required: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'invoicingEmailDetails',
  }
);

invoicingEmailDetailSchema.index(
  { userEmail: 1, organizationId: 1 },
  { unique: true }
);

module.exports = mongoose.model(
  'InvoicingEmailDetail',
  invoicingEmailDetailSchema
);

