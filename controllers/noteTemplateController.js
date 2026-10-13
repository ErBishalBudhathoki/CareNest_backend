const NoteTemplate = require('../models/NoteTemplate');
const logger = require('../config/logger');
const catchAsync = require('../utils/catchAsync');

/**
 * Progress-note template CRUD (Phase 2). Org-scoped; every query filters by
 * the authenticated user's organizationId.
 */
class NoteTemplateController {
  /** GET /api/notes/templates */
  listTemplates = catchAsync(async (req, res) => {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_ORGANIZATION',
        message: 'Organization context is required.',
      });
    }

    const filter = { organizationId };
    if (req.query.active !== undefined) {
      filter.active = req.query.active === 'true';
    }
    if (req.query.serviceType) {
      filter['appliesTo.serviceTypes'] = req.query.serviceType;
    }

    const templates = await NoteTemplate.find(filter).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      code: 'NOTE_TEMPLATES_RETRIEVED',
      data: { templates },
    });
  });

  /** GET /api/notes/templates/:id */
  getTemplate = catchAsync(async (req, res) => {
    const organizationId = req.user?.organizationId;
    const template = await NoteTemplate.findOne({
      _id: req.params.id,
      organizationId,
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        code: 'NOTE_TEMPLATE_NOT_FOUND',
        message: 'Template not found.',
      });
    }

    res.status(200).json({ success: true, data: template });
  });

  /** POST /api/notes/templates */
  createTemplate = catchAsync(async (req, res) => {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_ORGANIZATION',
        message: 'Organization context is required.',
      });
    }

    const { name, description, sections, appliesTo, active } = req.body;

    const normalizedSections = this._normalizeSections(sections);

    const template = await NoteTemplate.create({
      organizationId,
      name,
      description: description || '',
      sections: normalizedSections,
      appliesTo: appliesTo || {},
      active: active !== false,
      createdBy: req.user?.email || '',
      updatedBy: req.user?.email || '',
    });

    logger.business('Note Template Created', {
      event: 'note_template_created',
      organizationId,
      templateId: template._id.toString(),
      timestamp: new Date().toISOString(),
    });

    res.status(201).json({
      success: true,
      code: 'NOTE_TEMPLATE_CREATED',
      message: 'Template created successfully.',
      data: template,
    });
  });

  /** PUT /api/notes/templates/:id */
  updateTemplate = catchAsync(async (req, res) => {
    const organizationId = req.user?.organizationId;
    const { name, description, sections, appliesTo, active } = req.body;

    const update = { updatedBy: req.user?.email || '' };
    if (name !== undefined) update.name = name;
    if (description !== undefined) update.description = description;
    if (sections !== undefined) update.sections = this._normalizeSections(sections);
    if (appliesTo !== undefined) update.appliesTo = appliesTo;
    if (active !== undefined) update.active = active;

    const template = await NoteTemplate.findOneAndUpdate(
      { _id: req.params.id, organizationId },
      update,
      { new: true, runValidators: true },
    );

    if (!template) {
      return res.status(404).json({
        success: false,
        code: 'NOTE_TEMPLATE_NOT_FOUND',
        message: 'Template not found.',
      });
    }

    res.status(200).json({
      success: true,
      code: 'NOTE_TEMPLATE_UPDATED',
      message: 'Template updated successfully.',
      data: template,
    });
  });

  /** DELETE /api/notes/templates/:id — soft delete via active=false */
  deleteTemplate = catchAsync(async (req, res) => {
    const organizationId = req.user?.organizationId;
    const template = await NoteTemplate.findOneAndUpdate(
      { _id: req.params.id, organizationId },
      { active: false, updatedBy: req.user?.email || '' },
      { new: true },
    );

    if (!template) {
      return res.status(404).json({
        success: false,
        code: 'NOTE_TEMPLATE_NOT_FOUND',
        message: 'Template not found.',
      });
    }

    res.status(200).json({
      success: true,
      code: 'NOTE_TEMPLATE_DELETED',
      message: 'Template deactivated.',
    });
  });

  _normalizeSections(sections) {
    if (!Array.isArray(sections)) return [];
    return sections
      .filter((s) => s && typeof s === 'object' && s.key && s.label)
      .map((s, index) => ({
        key: String(s.key).trim(),
        label: String(s.label).trim(),
        type: s.type || 'text',
        required: !!s.required,
        options: Array.isArray(s.options) ? s.options.map(String) : [],
        helpText: s.helpText ? String(s.helpText) : '',
        order: s.order != null ? Number(s.order) : index,
      }))
      .sort((a, b) => a.order - b.order);
  }
}

module.exports = new NoteTemplateController();
