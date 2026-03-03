const mongoose = require('mongoose');

const workedTimeSchema = new mongoose.Schema({
  userEmail: {
    type: String,
    required: true,
    index: true,
    trim: true,
    lowercase: true
  },
  clientEmail: {
    type: String,
    required: true, // Legacy required, but maybe optional if non-client work? Keeping as required to match existing
    index: true,
    trim: true,
    lowercase: true
  },
  workDate: {
    type: Date,
    required: true,
    index: true
  },
  organizationId: {
    type: String,
    index: true
  },
  // Legacy fields kept for backward compatibility if needed, but workDate is primary
  shiftDate: { type: String }, // YYYY-MM-DD
  date: { type: Date }, // Legacy alias?
  shiftStartTime: { type: String },
  shiftEndTime: { type: String },
  shiftBreak: { type: mongoose.Schema.Types.Mixed },
  shiftIndex: { type: Number, default: 0 },
  shiftKey: { type: String },
  assignedClientId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClientAssignment' },
  ndisItem: { type: mongoose.Schema.Types.Mixed },
  highIntensity: { type: Boolean, default: false },
  startTime: { type: Date },
  endTime: { type: Date },
  totalSeconds: { type: Number, default: 0 },
  
  isActive: { 
    type: Boolean, 
    default: true,
    index: true 
  },
  
  timeWorked: {
    type: String, // "HH:mm:ss"
    required: true
  },
  totalHours: {
    type: Number, // Calculated hours for easier querying
    default: 0
  },
  
  providerType: {
    type: String,
    default: 'standard'
  },
  serviceLocationPostcode: {
    type: String,
    default: null
  },
  postcode: {
    type: String,
    default: null
  },
  state: {
    type: String,
    default: 'NSW'
  }
}, {
  timestamps: true,
  collection: 'worked_times',
  toJSON: {
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      
      if (ret.workDate) ret.workDate = ret.workDate.toISOString();
      if (ret.date) ret.date = ret.date.toISOString();
      if (ret.startTime) ret.startTime = ret.startTime.toISOString();
      if (ret.endTime) ret.endTime = ret.endTime.toISOString();
      if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
      if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
      return ret;
    }
  }
});

// Indexes
workedTimeSchema.index({ userEmail: 1, clientEmail: 1, workDate: 1 });
workedTimeSchema.index({ userEmail: 1, workDate: 1 });
workedTimeSchema.index({ organizationId: 1, workDate: 1 });

module.exports = mongoose.model('WorkedTime', workedTimeSchema);
