const mongoose = require('mongoose');

const reminderLogSchema = new mongoose.Schema({
  type: { type: String, required: true }, // 'timesheet_reminder', 'expense_reminder', etc.
  userEmail: { type: String, required: true, index: true },
  organizationId: { type: String, required: true, index: true },
  
  details: { type: Object }, // Flexible structure for reminder details
  
  sentAt: { type: Date, default: Date.now },
  fcmResponse: { type: String } // Store message ID or error
}, {
  timestamps: true,
  collection: 'reminderLogs'
});

module.exports = mongoose.model('ReminderLog', reminderLogSchema);
