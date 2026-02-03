const mongoose = require('mongoose');

const rosterTemplateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  organizationId: {
    type: String, // Keeping as String to match original definition, but ideally ObjectId if referencing Organization model
    required: true,
    index: true
  },
  pattern: {
    dayOfWeek: {
      type: Number,
      required: true,
      min: 0,
      max: 6
    },
    startTime: {
      type: String,
      required: true,
      match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
    },
    endTime: {
      type: String,
      required: true,
      match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
    },
    breakDuration: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  defaultEmployeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  defaultEmployeeEmail: String,
  defaultClientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client'
  },
  defaultClientEmail: String,
  supportItems: [{
    itemNumber: String,
    itemName: String,
    unit: String,
    supportCategoryNumber: String,
    supportCategoryName: String
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: String
}, {
  timestamps: true,
  collection: 'rosterTemplates',
  toJSON: {
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      
      if (ret.defaultEmployeeId) ret.defaultEmployeeId = ret.defaultEmployeeId.toString();
      if (ret.defaultClientId) ret.defaultClientId = ret.defaultClientId.toString();
      
      if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
      if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
      return ret;
    }
  }
});

// Indexes
rosterTemplateSchema.index({ organizationId: 1, isActive: 1 });
rosterTemplateSchema.index({ organizationId: 1, 'pattern.dayOfWeek': 1 });
rosterTemplateSchema.index({ name: 1, organizationId: 1 }, { unique: true });

module.exports = mongoose.model('RosterTemplate', rosterTemplateSchema);
