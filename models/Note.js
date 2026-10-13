const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema({
  userEmail: {
    type: String,
    required: true,
    index: true
  },
  clientEmail: {
    type: String,
    required: true,
    index: true
  },
  notes: {
    type: String,
    default: '',
    maxlength: 5000
  },
  organizationId: {
    type: String,
    required: true,
    index: true
  },
  // --- Phase 2: structured progress notes (all optional / additive) ---
  noteType: {
    type: String,
    enum: ['free_text', 'structured'],
    default: 'free_text',
    index: true
  },
  templateId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'NoteTemplate',
    default: null
  },
  shiftId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Shift',
    default: null,
    index: true
  },
  // Answers keyed by template section key: { sectionKey: value }
  structuredData: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  attachments: {
    type: [{
      url: { type: String, required: true },
      kind: { type: String, default: 'file' },
      name: { type: String, default: '' },
      uploadedAt: { type: Date, default: Date.now }
    }],
    default: []
  },
  // Client-generated idempotency key for offline draft sync.
  clientNoteId: {
    type: String,
    default: null,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'notes',
  toJSON: {
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
      if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
      return ret;
    }
  }
});

// Compound indexes for common queries
noteSchema.index({ userEmail: 1, clientEmail: 1, createdAt: -1 });
noteSchema.index({ organizationId: 1, createdAt: -1 });
noteSchema.index({ organizationId: 1, clientNoteId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Note', noteSchema);
