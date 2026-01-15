const Certification = require('../models/Certification');
const TrainingModule = require('../models/TrainingModule');
const TrainingProgress = require('../models/TrainingProgress');
const ComplianceChecklist = require('../models/ComplianceChecklist');
const UserChecklistStatus = require('../models/UserChecklistStatus');

class TrainingComplianceController {
  // --- Certifications ---

  async uploadCertification(req, res, next) {
    try {
      const { name, issuer, expiryDate, notes } = req.body;
      // Fallback: if req.user is string, use it; if object, use email or id
      const userId = req.user.email || req.user.id || req.user; 

      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
      }

      // Construct file URL based on storage config
      // If R2/S3 is used, use the public domain if available
      let fileUrl;
      if (req.file.location || req.file.key) {
        if (process.env.R2_PUBLIC_DOMAIN && req.file.key) {
           // Ensure no double slashes if domain ends with / or key starts with /
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
        expiryDate,
        notes,
        status: 'Pending'
      });

      res.status(201).json({ success: true, data: certification });
    } catch (error) {
      next(error);
    }
  }

  async getCertifications(req, res, next) {
    try {
      const { userId, status } = req.query;
      const currentUser = req.user.email || req.user.id || req.user;
      const query = {};

      if (userId) query.userId = userId;
      else if (!status) query.userId = currentUser; // Default to self if not filtering by status (admin view)

      if (status) query.status = status;

      const certifications = await Certification.find(query).sort({ createdAt: -1 });
      res.json({ success: true, data: certifications });
    } catch (error) {
      next(error);
    }
  }

  async auditCertification(req, res, next) {
    try {
      const { id } = req.params;
      const { status, notes } = req.body;
      const auditorId = req.user.email || req.user.id || req.user;

      const certification = await Certification.findByIdAndUpdate(
        id,
        {
          status,
          notes,
          auditedBy: auditorId,
          auditDate: new Date()
        },
        { new: true }
      );

      if (!certification) {
        return res.status(404).json({ success: false, message: 'Certification not found' });
      }

      res.json({ success: true, data: certification });
    } catch (error) {
      next(error);
    }
  }

  // --- Training ---

  async createTrainingModule(req, res, next) {
    try {
      const createdBy = req.user.email || req.user.id || req.user;
      const moduleData = { ...req.body, createdBy };
      const module = await TrainingModule.create(moduleData);
      res.status(201).json({ success: true, data: module });
    } catch (error) {
      next(error);
    }
  }

  async getTrainingModules(req, res, next) {
    try {
      const modules = await TrainingModule.find({ isPublished: true });
      const userId = req.user.email || req.user.id || req.user;

      // Attach progress
      const modulesWithProgress = await Promise.all(modules.map(async (mod) => {
        const progress = await TrainingProgress.findOne({ userId, moduleId: mod._id });
        return {
          ...mod.toObject(),
          userProgress: progress || null
        };
      }));

      res.json({ success: true, data: modulesWithProgress });
    } catch (error) {
      next(error);
    }
  }

  async updateTrainingProgress(req, res, next) {
    try {
      const { id } = req.params; // moduleId
      const { status, progressPercentage } = req.body;
      const userId = req.user.email || req.user.id || req.user;

      let progress = await TrainingProgress.findOne({ userId, moduleId: id });

      if (progress) {
        progress.status = status;
        progress.progressPercentage = progressPercentage;
        if (status === 'Completed' && !progress.completedAt) {
          progress.completedAt = new Date();
        }
        await progress.save();
      } else {
        progress = await TrainingProgress.create({
          userId,
          moduleId: id,
          status,
          progressPercentage,
          completedAt: status === 'Completed' ? new Date() : null
        });
      }

      res.json({ success: true, data: progress });
    } catch (error) {
      next(error);
    }
  }

  // --- Compliance Checklists ---

  async createChecklist(req, res, next) {
    try {
      const checklist = await ComplianceChecklist.create(req.body);
      res.status(201).json({ success: true, data: checklist });
    } catch (error) {
      next(error);
    }
  }

  async getChecklists(req, res, next) {
    try {
      const checklists = await ComplianceChecklist.find();
      const userId = req.user.email || req.user.id || req.user;

      const checklistsWithStatus = await Promise.all(checklists.map(async (list) => {
        const status = await UserChecklistStatus.findOne({ userId, checklistId: list._id });
        return {
          ...list.toObject(),
          userStatus: status || null
        };
      }));

      res.json({ success: true, data: checklistsWithStatus });
    } catch (error) {
      next(error);
    }
  }

  async updateChecklistStatus(req, res, next) {
    try {
      const { checklistId, itemsStatus, isCompleted } = req.body;
      const userId = req.user.email || req.user.id || req.user;

      let status = await UserChecklistStatus.findOne({ userId, checklistId });

      if (status) {
        status.itemsStatus = itemsStatus;
        status.isCompleted = isCompleted;
        status.lastUpdated = new Date();
        await status.save();
      } else {
        status = await UserChecklistStatus.create({
          userId,
          checklistId,
          itemsStatus,
          isCompleted,
          lastUpdated: new Date()
        });
      }

      res.json({ success: true, data: status });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new TrainingComplianceController();
