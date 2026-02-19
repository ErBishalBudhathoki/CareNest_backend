const Certification = require('../models/Certification');
const TrainingModule = require('../models/TrainingModule');
const TrainingProgress = require('../models/TrainingProgress');
const ComplianceChecklist = require('../models/ComplianceChecklist');
const UserChecklistStatus = require('../models/UserChecklistStatus');
const catchAsync = require('../utils/catchAsync');
const logger = require('../utils/logger');

class TrainingComplianceController {
  // --- Certifications ---

  uploadCertification = catchAsync(async (req, res) => {
    const { name, issuer, expiryDate, notes } = req.body;
    const userId = req.user.id; // Auth middleware sets this

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
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
    const query = {};

    // Admin can filter by userId, otherwise users see their own
    if (userId && req.user.role === 'admin') {
        query.userId = userId;
    } else {
        query.userId = currentUser;
    }

    if (status) query.status = status;

    const certifications = await Certification.find(query).sort({ createdAt: -1 });

    res.json({ success: true, data: certifications });
  });

  auditCertification = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { status, notes } = req.body;
    const auditorId = req.user.id;

    // Use findByIdAndUpdate
    const certification = await Certification.findByIdAndUpdate(
      id,
      {
        status,
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

    logger.info(`Certification ${id} audited by ${auditorId}: ${status}`);

    res.json({ success: true, data: certification });
  });

  // --- Training ---

  createTrainingModule = catchAsync(async (req, res) => {
    // Check admin role
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const module = await TrainingModule.create(req.body);
    
    logger.info(`Training module created: ${module.title}`);

    res.status(201).json({ success: true, data: module });
  });

  getTrainingModules = catchAsync(async (req, res) => {
    const modules = await TrainingModule.find({ isPublished: true }).sort({ createdAt: -1 });
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
        userProgress: progress || null
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
    
    let updateOps = {
        status,
        progress: progressPercentage, // Schema uses 'progress' not 'progressPercentage'
        lastAccessedAt: new Date()
    };

    if (status === 'completed') { // Schema enum is lowercase 'completed'
        // Only set completedAt if not already set? Mongoose update operators:
        // $setOnInsert logic works for create, but for update we need conditional.
        // Easiest is to fetch first or use $cond (aggregation) but that's complex.
        // Let's fetch first to be safe and simple.
    }

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

    res.json({ success: true, data: progress });
  });

  // --- Compliance Checklists ---

  createChecklist = catchAsync(async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const checklist = await ComplianceChecklist.create(req.body);
    
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
    const { checklistId, completedItems, isCompleted } = req.body; // Schema uses completedItems (array)
    const userId = req.user.id;

    const status = await UserChecklistStatus.findOneAndUpdate(
      { userId, checklistId },
      {
          completedItems, // Array of strings
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
