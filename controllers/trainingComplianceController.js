const { getDatabase } = require('../config/database');
const { ObjectId } = require('mongodb');

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

      const db = await getDatabase();
      const certificationData = {
        userId,
        name,
        issuer,
        fileUrl,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        notes,
        status: 'Pending',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await db.collection('certifications').insertOne(certificationData);
      certificationData._id = result.insertedId;

      res.status(201).json({ success: true, data: certificationData });
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

      const db = await getDatabase();
      const certifications = await db.collection('certifications')
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();

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

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: 'Invalid ID format' });
      }

      const db = await getDatabase();
      const result = await db.collection('certifications').findOneAndUpdate(
        { _id: new ObjectId(id) },
        {
          $set: {
            status,
            notes,
            auditedBy: auditorId,
            auditDate: new Date(),
            updatedAt: new Date()
          }
        },
        { returnDocument: 'after' }
      );

      if (!result) {
        return res.status(404).json({ success: false, message: 'Certification not found' });
      }

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // --- Training ---

  async createTrainingModule(req, res, next) {
    try {
      const createdBy = req.user.email || req.user.id || req.user;
      const moduleData = { 
        ...req.body, 
        createdBy,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const db = await getDatabase();
      const result = await db.collection('trainingModules').insertOne(moduleData);
      moduleData._id = result.insertedId;

      res.status(201).json({ success: true, data: moduleData });
    } catch (error) {
      next(error);
    }
  }

  async getTrainingModules(req, res, next) {
    try {
      const db = await getDatabase();
      const modules = await db.collection('trainingModules').find({ isPublished: true }).toArray();
      const userId = req.user.email || req.user.id || req.user;

      // Attach progress
      const modulesWithProgress = await Promise.all(modules.map(async (mod) => {
        const progress = await db.collection('trainingProgress').findOne({ 
          userId, 
          moduleId: mod._id // Assuming stored as ObjectId
        });
        return {
          ...mod,
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

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: 'Invalid module ID' });
      }

      const db = await getDatabase();
      const moduleId = new ObjectId(id);

      const updateData = {
        userId,
        moduleId,
        status,
        progressPercentage,
        updatedAt: new Date()
      };

      if (status === 'Completed') {
        // We need to check if it's already completed to preserve original completion date or update it?
        // Simple approach: set completedAt if not present, or update it.
        // For upsert, we can use $setOnInsert for createdAt and $set for others.
        // But logic below was: if completed && !completedAt -> set it.
        updateData.completedAt = new Date();
      }

      // We'll use findOneAndUpdate with upsert to handle both create and update
      // But we need to be careful not to overwrite completedAt if it already exists and we don't want to change it?
      // The original logic: if exists, update. if status completed and !completedAt, set it.
      
      let progress = await db.collection('trainingProgress').findOne({ userId, moduleId });
      
      if (progress) {
        const setFields = {
            status,
            progressPercentage,
            updatedAt: new Date()
        };
        if (status === 'Completed' && !progress.completedAt) {
            setFields.completedAt = new Date();
        }
        
        await db.collection('trainingProgress').updateOne(
            { _id: progress._id },
            { $set: setFields }
        );
        progress = { ...progress, ...setFields };
      } else {
        const newProgress = {
            userId,
            moduleId,
            status,
            progressPercentage,
            createdAt: new Date(),
            updatedAt: new Date(),
            completedAt: status === 'Completed' ? new Date() : null
        };
        const result = await db.collection('trainingProgress').insertOne(newProgress);
        progress = { ...newProgress, _id: result.insertedId };
      }

      res.json({ success: true, data: progress });
    } catch (error) {
      next(error);
    }
  }

  // --- Compliance Checklists ---

  async createChecklist(req, res, next) {
    try {
      const checklistData = {
        ...req.body,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const db = await getDatabase();
      const result = await db.collection('complianceChecklists').insertOne(checklistData);
      checklistData._id = result.insertedId;

      res.status(201).json({ success: true, data: checklistData });
    } catch (error) {
      next(error);
    }
  }

  async getChecklists(req, res, next) {
    try {
      const db = await getDatabase();
      const checklists = await db.collection('complianceChecklists').find().toArray();
      const userId = req.user.email || req.user.id || req.user;

      const checklistsWithStatus = await Promise.all(checklists.map(async (list) => {
        const status = await db.collection('userChecklistStatus').findOne({ 
            userId, 
            checklistId: list._id 
        });
        return {
          ...list,
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

      if (!ObjectId.isValid(checklistId)) {
          return res.status(400).json({ success: false, message: 'Invalid checklist ID' });
      }

      const db = await getDatabase();
      const cId = new ObjectId(checklistId);

      // Using updateOne with upsert is cleaner here
      const result = await db.collection('userChecklistStatus').findOneAndUpdate(
        { userId, checklistId: cId },
        {
            $set: {
                itemsStatus,
                isCompleted,
                lastUpdated: new Date(),
                updatedAt: new Date()
            },
            $setOnInsert: {
                userId,
                checklistId: cId,
                createdAt: new Date()
            }
        },
        { upsert: true, returnDocument: 'after' }
      );

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new TrainingComplianceController();
