const mongoose = require('mongoose');

const sharedEmployeeAssignmentSchema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  assignmentType: { type: String, enum: ['primary', 'secondary', 'contract'], required: true },
  costAllocation: { type: Number, min: 0, max: 100, default: 100 },
  hourlyRate: { type: Number, default: 0 },
  startDate: { type: Date, required: true },
  endDate: Date,
  status: { type: String, enum: ['active', 'inactive', 'suspended'], default: 'active' },
  notes: String
}, {
  timestamps: true,
  collection: 'shared_employee_assignments',
  toJSON: {
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      
      if (ret.employeeId) ret.employeeId = ret.employeeId.toString();
      if (ret.organizationId) ret.organizationId = ret.organizationId.toString();
      
      if (ret.startDate) ret.startDate = ret.startDate.toISOString();
      if (ret.endDate) ret.endDate = ret.endDate.toISOString();
      if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
      if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
      return ret;
    }
  }
});

// Compound index for efficient queries
sharedEmployeeAssignmentSchema.index({ employeeId: 1, organizationId: 1 });
sharedEmployeeAssignmentSchema.index({ organizationId: 1, status: 1 });

module.exports = mongoose.model('SharedEmployeeAssignment', sharedEmployeeAssignmentSchema);
