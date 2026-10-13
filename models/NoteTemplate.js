const mongoose = require('mongoose');

/**
 * Organisation-configurable progress-note template (Phase 2).
 *
 * A template is an ordered list of typed sections. The mobile composer renders
 * one input per section and stores answers in `Note.structuredData` keyed by
 * `section.key`. Templates are additive and org-scoped; the free-text note path
 * (`Note.noteType = 'free_text'`) is unaffected.
 */

const sectionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['text', 'longText', 'select', 'checkbox', 'number', 'voice'],
      default: 'text',
    },
    required: { type: Boolean, default: false },
    options: { type: [String], default: [] },
    helpText: { type: String, default: '' },
    order: { type: Number, default: 0 },
  },
  { _id: false },
);

const noteTemplateSchema = new mongoose.Schema(
  {
    organizationId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    active: { type: Boolean, default: true, index: true },
    sections: { type: [sectionSchema], default: [] },
    // Optional scoping so a template only appears for relevant work.
    appliesTo: {
      serviceTypes: { type: [String], default: [] },
      clientIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    },
    createdBy: { type: String, default: '' },
    updatedBy: { type: String, default: '' },
  },
  {
    timestamps: true,
    collection: 'noteTemplates',
    toJSON: {
      transform: function (doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
        if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
        return ret;
      },
    },
  },
);

noteTemplateSchema.index({ organizationId: 1, active: 1, createdAt: -1 });

module.exports = mongoose.model('NoteTemplate', noteTemplateSchema);
