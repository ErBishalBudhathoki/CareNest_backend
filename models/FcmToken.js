const mongoose = require('mongoose');

const fcmTokenSchema = new mongoose.Schema({
  userEmail: { type: String, required: true, unique: true, index: true },
  fcmToken: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now },
  deviceType: String, // 'android', 'ios', 'web'
  lastUsed: Date
}, {
  timestamps: true,
  collection: 'fcmTokens'
});

module.exports = mongoose.model('FcmToken', fcmTokenSchema);
