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
  collection: 'employee_documents'
});

module.exports = mongoose.model('EmployeeDocument', employeeDocumentSchema);
