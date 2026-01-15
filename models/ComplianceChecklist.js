const mongoose = require('mongoose');

const complianceChecklistSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  items: [{
    text: {
      type: String,
      required: true
    },
    isRequired: {
      type: Boolean,
      default: true
    }
  }],
  targetRoles: [{
    type: String // e.g., 'Employee', 'Manager'
  }]
}, { timestamps: true });

module.exports = mongoose.model('ComplianceChecklist', complianceChecklistSchema);
