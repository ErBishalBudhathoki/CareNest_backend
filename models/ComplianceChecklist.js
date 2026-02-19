const mongoose = require('mongoose');

const complianceChecklistSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  items: [{
    text: { type: String, required: true },
    isMandatory: { type: Boolean, default: true }
  }],
  targetRoles: {
    type: [String],
    default: []
  },
  isRequired: {
    type: Boolean,
    default: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  collection: 'complianceChecklists',
  toJSON: {
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      // Transform items to have id if needed, Mongoose subdocs have _id by default
      if (ret.items) {
        ret.items = ret.items.map(item => {
          const i = { ...item };
          if (i._id) {
            i.id = i._id.toString();
            delete i._id;
          }
          return i;
        });
      }
      if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
      if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
      return ret;
    }
  }
});

module.exports = mongoose.model('ComplianceChecklist', complianceChecklistSchema);
