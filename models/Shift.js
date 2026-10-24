
const mongoose = require('mongoose');

const shiftSchema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  employeeEmail: String,
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  clientEmail: String,
  organizationId: { type: String, required: true, index: true },
  startTime: { type: Date, required: true, index: true },
  endTime: { type: Date, required: true },
  supportItems: [{
    itemNumber: String,
    itemName: String,
    unit: String,
    supportCategoryNumber: String,
    supportCategoryName: String
  }],
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] }
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'completed', 'cancelled', 'published'], // Added 'published' as used in scheduler
    default: 'pending',
    index: true
  },
  isRecurring: { type: Boolean, default: false },
  recurringTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: 'RosterTemplate' },
  // SIL (Phase 4): shifts materialised from a roster of care carry its id so
  // materialisation is idempotent and the roster can be traced to its plan.
  silRosterOfCareId: { type: mongoose.Schema.Types.ObjectId, ref: 'SILRosterOfCare', default: null, index: true },
  shiftType: {
    type: String,
    enum: ['day', 'evening', 'active_night', 'sleepover', 'split'],
    default: null,
  },
  notes: { type: String, default: '' },
  breakDuration: { type: Number, default: 0 }, // in minutes
  isActive: { type: Boolean, default: true },
  // Cancellation evidence and NDIS short-notice billing outcome. Kept on the
  // shift so the original booking is never destroyed for audit purposes.
  cancellation: {
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: String, default: '' },
    reason: { type: String, enum: ['NSCC', 'NSDH', ''], default: '' },
    noticeHours: { type: Number, default: null },
    shortNotice: { type: Boolean, default: false },
    billable: { type: Boolean, default: false },
    feeAmount: { type: Number, default: 0 },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
  },
  createdBy: String
}, {
  timestamps: true,
  collection: 'shifts',
  toJSON: {
    transform: function (doc, ret) {
      // Transform _id to id (Flutter expects 'id' as string)
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      
      // Transform ObjectId refs to strings for Flutter
      if (ret.employeeId) ret.employeeId = ret.employeeId.toString();
      if (ret.clientId) ret.clientId = ret.clientId.toString();
      if (ret.recurringTemplateId) ret.recurringTemplateId = ret.recurringTemplateId.toString();
      if (ret.cancellation?.invoiceId) {
        ret.cancellation.invoiceId = ret.cancellation.invoiceId.toString();
      }
      if (ret.cancellation?.cancelledAt) {
        ret.cancellation.cancelledAt = new Date(ret.cancellation.cancelledAt).toISOString();
      }
      
      // Transform dates to ISO 8601 strings
      if (ret.startTime) ret.startTime = ret.startTime.toISOString();
      if (ret.endTime) ret.endTime = ret.endTime.toISOString();
      if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
      if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
      
      return ret;
    }
  }
});

// Indexes
shiftSchema.index({ employeeId: 1, startTime: 1, endTime: 1, status: 1 });
shiftSchema.index({ organizationId: 1, startTime: 1, status: 1 });
shiftSchema.index({ location: '2dsphere' });
shiftSchema.index({ employeeEmail: 1, organizationId: 1 });
shiftSchema.index({ clientEmail: 1, organizationId: 1 });

module.exports = mongoose.model('Shift', shiftSchema);
