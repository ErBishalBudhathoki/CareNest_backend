const mongoose = require('mongoose');

const recurringExpenseSchema = new mongoose.Schema({
  organizationId: { type: String, required: true, index: true },
  clientId: { type: String, default: null },
  
  description: { type: String, required: true },
  amount: { type: Number, required: true },
  category: { type: String, required: true },
  subcategory: String,
  
  frequency: { 
    type: String, 
    enum: ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'], 
    required: true 
  },
  
  startDate: { type: Date, required: true },
  endDate: Date,
  nextRunDate: { type: Date, required: true },
  lastRunDate: Date,
  
  supportItemNumber: String,
  supportItemName: String,
  
  isReimbursable: { type: Boolean, default: true },
  requiresApproval: { type: Boolean, default: false },
  
  status: { type: String, enum: ['active', 'paused', 'cancelled'], default: 'active' },
  
  submittedBy: { type: String, required: true },
  createdBy: { type: String, required: true },
  updatedBy: String,
  
  history: [{
    action: String,
    date: { type: Date, default: Date.now },
    details: String
  }]
}, {
  timestamps: true,
  collection: 'recurring_expenses',
  toJSON: {
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      
      if (ret.startDate) ret.startDate = ret.startDate.toISOString();
      if (ret.endDate) ret.endDate = ret.endDate.toISOString();
      if (ret.nextRunDate) ret.nextRunDate = ret.nextRunDate.toISOString();
      if (ret.lastRunDate) ret.lastRunDate = ret.lastRunDate.toISOString();
      if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
      if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
      
      return ret;
    }
  }
});

recurringExpenseSchema.index({ organizationId: 1, status: 1 });
recurringExpenseSchema.index({ nextRunDate: 1, status: 1 });

module.exports = mongoose.model('RecurringExpense', recurringExpenseSchema);
