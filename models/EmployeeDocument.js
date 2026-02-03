const mongoose = require('mongoose');

const employeeDocumentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  organizationId: { type: String, required: true, index: true },
  
  type: { 
    type: String, 
    required: true,
    enum: ['passport', 'drivers_license', 'first_aid', 'ndis_screening', 'other', 'visa', 'police_check'] 
  },
  
  documentNumber: String,
  fileUrl: { type: String, required: true },
  expiryDate: Date,
  
  status: { 
    type: String, 
    enum: ['pending', 'verified', 'rejected'], 
    default: 'pending' 
  },
  
  rejectionReason: String,
  uploadedAt: { type: Date, default: Date.now },
  verifiedAt: Date,
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, {
  timestamps: true,
  collection: 'employee_documents',
  toJSON: {
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      
      if (ret.userId) ret.userId = ret.userId.toString();
      if (ret.verifiedBy) ret.verifiedBy = ret.verifiedBy.toString();
      
      if (ret.expiryDate) ret.expiryDate = ret.expiryDate.toISOString();
      if (ret.uploadedAt) ret.uploadedAt = ret.uploadedAt.toISOString();
      if (ret.verifiedAt) ret.verifiedAt = ret.verifiedAt.toISOString();
      if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
      if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
      
      return ret;
    }
  }
});

module.exports = mongoose.model('EmployeeDocument', employeeDocumentSchema);
