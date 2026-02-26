const mongoose = require('mongoose');

const serviceFeedbackSchema = new mongoose.Schema(
  {
    appointmentId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    assignmentId: {
      type: String,
      required: true,
      trim: true,
    },
    scheduleId: {
      type: String,
      required: true,
      trim: true,
    },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      required: true,
      index: true,
    },
    clientEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    workerId: {
      type: String,
      required: true,
      trim: true,
    },
    workerEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    organizationId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    serviceName: {
      type: String,
      default: 'Support Service',
      trim: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comments: {
      type: String,
      default: '',
      trim: true,
      maxlength: 2000,
    },
    categories: {
      type: [String],
      default: [],
    },
    submittedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'service_feedback',
  }
);

serviceFeedbackSchema.index({ appointmentId: 1, clientId: 1 }, { unique: true });
serviceFeedbackSchema.index({ clientId: 1, submittedAt: -1 });

module.exports = mongoose.model('ServiceFeedback', serviceFeedbackSchema);
