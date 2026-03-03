const Certification = require('../models/Certification');
const TrainingModule = require('../models/TrainingModule');
const TrainingProgress = require('../models/TrainingProgress');
const ComplianceChecklist = require('../models/ComplianceChecklist');
const UserChecklistStatus = require('../models/UserChecklistStatus');
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

  // --- Certifications ---

  uploadCertification = catchAsync(async (req, res) => {
    const { name, issuer, expiryDate, notes } = req.body;
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
    const { status, notes } = req.body;
    const auditorId = req.user.id;
    const isAdminUser = this._hasAdminAccess(req);

    if (!isAdminUser) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const normalizedStatus = this._normalizeCertificationStatus(status);

    // Use findByIdAndUpdate
    const certification = await Certification.findByIdAndUpdate(
      id,
      {
        status: normalizedStatus,
        notes,
        // auditedBy: auditorId, // Schema doesn't have auditedBy yet, maybe add to notes or schema update?
        // For now, logging audit action is enough or update schema if critical.
        updatedAt: new Date()
      },
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
    const { name, issuer, expiryDate, notes } = req.body;
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

    const hasMetadataUpdate = name != null || issuer != null || expiryDate != null || notes != null;
    if (name != null) certification.name = name;
    if (issuer != null) certification.issuer = issuer;
    if (notes != null) certification.notes = notes;
    if (expiryDate != null) certification.expiryDate = new Date(expiryDate);

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
