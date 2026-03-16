const Certification = require('../models/Certification');
const CertificationRequirement = require('../models/CertificationRequirement');
const TrainingModule = require('../models/TrainingModule');
const TrainingProgress = require('../models/TrainingProgress');
const ComplianceChecklist = require('../models/ComplianceChecklist');
const UserChecklistStatus = require('../models/UserChecklistStatus');
const User = require('../models/User');
const catchAsync = require('../utils/catchAsync');
const logger = require('../utils/logger');
const fs = require('fs');

class TrainingComplianceController {
  _hasAdminAccess(req) {
    const role = String(req.user?.role || '').toLowerCase();
    const roles = Array.isArray(req.user?.roles)
      ? req.user.roles.map((r) => String(r || '').toLowerCase())
      : [];
    return role === 'admin' ||
        role === 'superadmin' ||
        role === 'owner' ||
        roles.includes('admin') ||
        roles.includes('superadmin') ||
        roles.includes('owner');
  }

  _normalizeCertificationStatus(status) {
    const normalized = String(status || '').toLowerCase().trim();
    if (!normalized) return normalized;
    if (normalized === 'pending') return 'pending_approval';
    if (normalized === 'approved') return 'active';
    return normalized;
  }

  async _ensureDefaultCertificationRequirements() {
    const existing = await CertificationRequirement.find({ isActive: true }).limit(1);
    if (existing.length > 0) return;

    const defaults = [
      { name: 'First Aid', description: 'Valid First Aid certification' },
      { name: 'Cert III in Aged Care', description: 'Aged care qualification' },
      { name: 'Disability Support Certification', description: 'Disability support qualification' },
      { name: 'Cert IV in Aged Care', description: 'Advanced aged care qualification' },
      { name: 'NDIS Worker Check', description: 'NDIS worker screening check' }
    ];

    await CertificationRequirement.insertMany(defaults.map((item) => ({
      ...item,
      isRequired: true,
      isActive: true
    })));
  }

  async _ensureDefaultComplianceChecklist() {
    const existing = await ComplianceChecklist.find({ isActive: true }).limit(1);
    if (existing.length > 0) return;

    const checklist = await ComplianceChecklist.create({
      title: 'Employee Compliance Basics',
      description: 'Core documents and certifications required for onboarding',
      items: [
        { text: 'Police Check', isMandatory: true },
        { text: 'Certifications for aged care', isMandatory: true },
        { text: 'Certifications for disability support', isMandatory: true },
        { text: 'Resume', isMandatory: true }
      ],
      isRequired: true,
      isActive: true
    });

    logger.info(`Default compliance checklist created: ${checklist.title}`);
  }

  // --- Certifications ---

  uploadCertification = catchAsync(async (req, res) => {
    const { name, issuer, expiryDate, notes, certificationNumber, requirementId } = req.body;
    const userId = req.user.id; // Auth middleware sets this

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    // Certifications must be stored in Cloudflare R2 under certifications/
    const r2Key = req.file.key ? String(req.file.key) : '';
    const r2Location = req.file.location ? String(req.file.location) : '';
    const isR2Upload = Boolean(r2Key || r2Location);

    if (!isR2Upload) {
      if (req.file.path) {
        fs.unlink(req.file.path, () => {});
      }
      return res.status(500).json({
        success: false,
        message: 'Certification upload requires Cloudflare R2 configuration.'
      });
    }

    if (r2Key && !r2Key.startsWith('certifications/')) {
      return res.status(500).json({
        success: false,
        message: 'Certification file was not uploaded to certifications folder.'
      });
    }

    // Construct file URL
    let fileUrl;
    if (req.file.location || req.file.key) {
      if (process.env.R2_PUBLIC_DOMAIN && req.file.key) {
         const domain = process.env.R2_PUBLIC_DOMAIN.replace(/\/$/, '');
         const key = req.file.key.replace(/^\//, '');
         fileUrl = `${domain}/${key}`;
      } else {
         fileUrl = req.file.location;
      }
    } else {
      fileUrl = `${req.protocol}://${req.get('host')}/uploads/certifications/${req.file.filename}`;
    }

    const certification = await Certification.create({
      userId,
      name,
      issuer,
      certificationNumber,
      requirementId,
      fileUrl,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
      notes,
      status: 'pending_approval' // Enum value from schema
    });

    logger.info(`Certification uploaded by ${userId}: ${name}`);

    res.status(201).json({ success: true, data: certification });
  });

  getCertifications = catchAsync(async (req, res) => {
    const { userId, status } = req.query;
    const currentUser = req.user.id;
    const isAdminUser = this._hasAdminAccess(req);
    const query = {};

    // Admin can filter by userId; employees can only view their own certifications.
    if (isAdminUser) {
      if (userId) query.userId = userId;
    } else {
      query.userId = currentUser;
    }

    if (status) query.status = this._normalizeCertificationStatus(status);

    const certifications = await Certification.find(query).sort({ createdAt: -1 });

    res.json({ success: true, data: certifications });
  });

  auditCertification = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { status, notes, certificationNumber, expiryDate } = req.body;
    const auditorId = req.user.id;
    const isAdminUser = this._hasAdminAccess(req);

    if (!isAdminUser) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const normalizedStatus = this._normalizeCertificationStatus(status);

    // Use findByIdAndUpdate
    const updatePayload = {
      status: normalizedStatus,
      notes,
      updatedAt: new Date()
    };
    if (certificationNumber != null) {
      updatePayload.certificationNumber = certificationNumber;
    }
    if (expiryDate != null) {
      updatePayload.expiryDate = new Date(expiryDate);
    }

    const certification = await Certification.findByIdAndUpdate(
      id,
      updatePayload,
      { new: true, runValidators: true }
    );

    if (!certification) {
      return res.status(404).json({ success: false, message: 'Certification not found' });
    }

    logger.info(`Certification ${id} audited by ${auditorId}: ${normalizedStatus}`);

    res.json({ success: true, data: certification });
  });

  updateCertification = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { name, issuer, expiryDate, notes, certificationNumber, requirementId } = req.body;
    const currentUserId = String(req.user.id);
    const isAdminUser = this._hasAdminAccess(req);

    const certification = await Certification.findById(id);
    if (!certification) {
      return res.status(404).json({ success: false, message: 'Certification not found' });
    }

    const ownerId = String(certification.userId || '');
    if (!isAdminUser && ownerId !== currentUserId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const hasMetadataUpdate =
      name != null ||
      issuer != null ||
      expiryDate != null ||
      notes != null ||
      certificationNumber != null ||
      requirementId != null;
    if (name != null) certification.name = name;
    if (issuer != null) certification.issuer = issuer;
    if (notes != null) certification.notes = notes;
    if (expiryDate != null) certification.expiryDate = new Date(expiryDate);
    if (certificationNumber != null) {
      certification.certificationNumber = certificationNumber;
    }
    if (requirementId != null) {
      certification.requirementId = requirementId;
    }

    // Employee updates must be re-audited by admin.
    if (hasMetadataUpdate && !isAdminUser) {
      certification.status = 'pending_approval';
    }

    await certification.save();
    res.json({ success: true, data: certification });
  });

  deleteCertification = catchAsync(async (req, res) => {
    const { id } = req.params;
    const currentUserId = String(req.user.id);
    const isAdminUser = this._hasAdminAccess(req);

    const certification = await Certification.findById(id);
    if (!certification) {
      return res.status(404).json({ success: false, message: 'Certification not found' });
    }

    const ownerId = String(certification.userId || '');
    if (!isAdminUser && ownerId !== currentUserId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    await Certification.deleteOne({ _id: id });
    res.json({ success: true, message: 'Certification deleted successfully' });
  });

  // --- Certification Requirements ---

  createCertificationRequirement = catchAsync(async (req, res) => {
    if (!this._hasAdminAccess(req)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const payload = {
      name: req.body.name,
      description: req.body.description,
      isRequired: req.body.isRequired ?? true,
      isActive: req.body.isActive ?? true,
      roles: Array.isArray(req.body.roles) ? req.body.roles : [],
      createdBy: req.user.id
    };

    const requirement = await CertificationRequirement.create(payload);
    res.status(201).json({ success: true, data: requirement });
  });

  getCertificationRequirements = catchAsync(async (req, res) => {
    await this._ensureDefaultCertificationRequirements();
    const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true';
    const query = includeInactive && this._hasAdminAccess(req) ? {} : { isActive: true };
    const requirements = await CertificationRequirement.find(query).sort({ createdAt: -1 });
    res.json({ success: true, data: requirements });
  });

  updateCertificationRequirement = catchAsync(async (req, res) => {
    if (!this._hasAdminAccess(req)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { id } = req.params;
    const update = {
      name: req.body.name,
      description: req.body.description,
      isRequired: req.body.isRequired,
      isActive: req.body.isActive,
      roles: Array.isArray(req.body.roles) ? req.body.roles : undefined
    };

    const requirement = await CertificationRequirement.findByIdAndUpdate(
      id,
      update,
      { new: true, runValidators: true }
    );

    if (!requirement) {
      return res.status(404).json({ success: false, message: 'Requirement not found' });
    }

    res.json({ success: true, data: requirement });
  });

  deleteCertificationRequirement = catchAsync(async (req, res) => {
    if (!this._hasAdminAccess(req)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { id } = req.params;
    const requirement = await CertificationRequirement.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    );

    if (!requirement) {
      return res.status(404).json({ success: false, message: 'Requirement not found' });
    }

    res.json({ success: true, data: requirement });
  });

  // --- Training ---

  createTrainingModule = catchAsync(async (req, res) => {
    if (!this._hasAdminAccess(req)) {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const payload = {
      ...req.body,
      createdBy: req.user.id,
      isPublished: req.body.isPublished ?? true,
      contentType: req.body.contentType || 'Text',
    };

    const module = await TrainingModule.create(payload);
    
    logger.info(`Training module created: ${module.title}`);

    res.status(201).json({ success: true, data: module });
  });

  getTrainingModules = catchAsync(async (req, res) => {
    const moduleQuery = this._hasAdminAccess(req) ? {} : { isPublished: true };
    const modules = await TrainingModule.find(moduleQuery).sort({ createdAt: -1 });
    const userId = req.user.id;

    // Attach progress
    // Using lean() would be faster but we need to attach virtuals/transforms if any.
    // Since we attach 'userProgress' manually, we convert toObject().
    const modulesWithProgress = await Promise.all(modules.map(async (mod) => {
      const progress = await TrainingProgress.findOne({ 
        userId, 
        moduleId: mod.id 
      });
      return {
        ...mod.toJSON(),
        userProgress: progress
          ? {
              ...progress.toJSON(),
              progressPercentage: progress.progress ?? 0,
            }
          : null
      };
    }));

    res.json({ success: true, data: modulesWithProgress });
  });

  updateTrainingModule = catchAsync(async (req, res) => {
    if (!this._hasAdminAccess(req)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { id } = req.params;
    const update = {
      title: req.body.title,
      description: req.body.description,
      contentType: req.body.contentType,
      contentUrl: req.body.contentUrl,
      contentText: req.body.contentText,
      durationMinutes: req.body.durationMinutes,
      isPublished: req.body.isPublished,
      isRequired: req.body.isRequired,
      roles: Array.isArray(req.body.roles) ? req.body.roles : undefined,
      category: req.body.category,
      thumbnailUrl: req.body.thumbnailUrl
    };

    const module = await TrainingModule.findByIdAndUpdate(
      id,
      update,
      { new: true, runValidators: true }
    );

    if (!module) {
      return res.status(404).json({ success: false, message: 'Training module not found' });
    }

    res.json({ success: true, data: module });
  });

  deleteTrainingModule = catchAsync(async (req, res) => {
    if (!this._hasAdminAccess(req)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { id } = req.params;
    const module = await TrainingModule.findById(id);
    if (!module) {
      return res.status(404).json({ success: false, message: 'Training module not found' });
    }

    await TrainingModule.deleteOne({ _id: id });
    res.json({ success: true, message: 'Training module deleted' });
  });

  getTrainingModuleProgress = catchAsync(async (req, res) => {
    if (!this._hasAdminAccess(req)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { id } = req.params;
    const progress = await TrainingProgress.find({ moduleId: id }).sort({ updatedAt: -1 });
    const userIds = progress.map((p) => p.userId).filter(Boolean);
    const users = await User.find({ _id: { $in: userIds } })
      .select('firstName lastName email role roles organizationId')
      .lean();
    const userById = new Map(users.map((u) => [String(u._id), u]));

    const data = progress.map((entry) => {
      const json = entry.toJSON();
      return {
        ...json,
        progressPercentage: json.progress ?? 0,
        user: userById.get(String(entry.userId)) || null
      };
    });

    const summary = {
      total: data.length,
      completed: data.filter((p) => p.status === 'completed').length,
      inProgress: data.filter((p) => p.status === 'in_progress').length,
      notStarted: data.filter((p) => p.status === 'not_started').length
    };

    res.json({ success: true, data, summary });
  });

  updateTrainingProgress = catchAsync(async (req, res) => {
    const { id } = req.params; // moduleId
    const { status, progressPercentage } = req.body;
    const userId = req.user.id;

    // Using findOneAndUpdate with upsert
    // We need to handle 'completedAt' logic: set only if becoming completed for first time
    
    let progress = await TrainingProgress.findOne({ userId, moduleId: id });

    if (progress) {
        progress.status = status;
        progress.progress = progressPercentage;
        progress.lastAccessedAt = new Date();
        if (status === 'completed' && !progress.completedAt) {
            progress.completedAt = new Date();
        }
        await progress.save();
    } else {
        progress = await TrainingProgress.create({
            userId,
            moduleId: id,
            status,
            progress: progressPercentage,
            completedAt: status === 'completed' ? new Date() : null
        });
    }

    const normalizedProgress = {
      ...progress.toJSON(),
      progressPercentage: progress.progress ?? 0,
    };
    res.json({ success: true, data: normalizedProgress });
  });

  // --- Compliance Checklists ---

  createChecklist = catchAsync(async (req, res) => {
    if (!this._hasAdminAccess(req)) {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const items = (req.body.items || []).map((item) => {
      if (typeof item === 'string') {
        return { text: item, isMandatory: true };
      }
      return {
        text: item.text,
        isMandatory: item.isRequired ?? item.isMandatory ?? true,
      };
    });

    const checklist = await ComplianceChecklist.create({
      ...req.body,
      items,
    });
    
    logger.info(`Compliance checklist created: ${checklist.title}`);

    res.status(201).json({ success: true, data: checklist });
  });

  getChecklists = catchAsync(async (req, res) => {
    await this._ensureDefaultComplianceChecklist();
    const checklists = await ComplianceChecklist.find({ isActive: true });
    const userId = req.user.id;

    const checklistsWithStatus = await Promise.all(checklists.map(async (list) => {
      const status = await UserChecklistStatus.findOne({ 
          userId, 
          checklistId: list.id 
      });
      return {
        ...list.toJSON(),
        userStatus: status || null
      };
    }));

    res.json({ success: true, data: checklistsWithStatus });
  });

  updateChecklist = catchAsync(async (req, res) => {
    if (!this._hasAdminAccess(req)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { id } = req.params;
    const items = (req.body.items || []).map((item) => {
      if (typeof item === 'string') {
        return { text: item, isMandatory: true };
      }
      return {
        text: item.text,
        isMandatory: item.isRequired ?? item.isMandatory ?? true,
      };
    });

    const update = {
      title: req.body.title,
      description: req.body.description,
      items: items.length > 0 ? items : undefined,
      targetRoles: req.body.targetRoles,
      isRequired: req.body.isRequired,
      isActive: req.body.isActive
    };

    const checklist = await ComplianceChecklist.findByIdAndUpdate(
      id,
      update,
      { new: true, runValidators: true }
    );

    if (!checklist) {
      return res.status(404).json({ success: false, message: 'Checklist not found' });
    }

    res.json({ success: true, data: checklist });
  });

  deleteChecklist = catchAsync(async (req, res) => {
    if (!this._hasAdminAccess(req)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { id } = req.params;
    const checklist = await ComplianceChecklist.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    );

    if (!checklist) {
      return res.status(404).json({ success: false, message: 'Checklist not found' });
    }

    res.json({ success: true, data: checklist });
  });

  updateChecklistStatus = catchAsync(async (req, res) => {
    const { checklistId, completedItems, itemsStatus, isCompleted } = req.body;
    const userId = req.user.id;

    const normalizedCompletedItems = Array.isArray(completedItems)
      ? completedItems
      : Object.entries(itemsStatus || {})
          .filter(([, isChecked]) => Boolean(isChecked))
          .map(([itemId]) => itemId);

    const status = await UserChecklistStatus.findOneAndUpdate(
      { userId, checklistId },
      {
          completedItems: normalizedCompletedItems,
          isCompleted,
          completedAt: isCompleted ? new Date() : null, // Set date if completed
          // updatedAt handled by timestamp
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true, data: status });
  });
}

module.exports = new TrainingComplianceController();
