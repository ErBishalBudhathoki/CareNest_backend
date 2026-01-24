
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
  notes: { type: String, default: '' },
  breakDuration: { type: Number, default: 0 }, // in minutes
  isActive: { type: Boolean, default: true },
  createdBy: String
}, {
  timestamps: true,
  collection: 'shifts'
});

// Indexes
shiftSchema.index({ employeeId: 1, startTime: 1, endTime: 1, status: 1 });
shiftSchema.index({ organizationId: 1, startTime: 1, status: 1 });
shiftSchema.index({ location: '2dsphere' });
shiftSchema.index({ employeeEmail: 1, organizationId: 1 });
shiftSchema.index({ clientEmail: 1, organizationId: 1 });

module.exports = mongoose.model('Shift', shiftSchema);
