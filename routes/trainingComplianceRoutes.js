const express = require('express');
const router = express.Router();
const controller = require('../controllers/trainingComplianceController');
const auth = require('../middleware/auth');
const { upload } = require('../config/storage');

// Certifications
router.post('/certifications/upload', auth, upload.single('certification'), controller.uploadCertification);
router.get('/certifications', auth, controller.getCertifications);
router.put('/certifications/:id/audit', auth, controller.auditCertification);

// Training
router.post('/training', auth, controller.createTrainingModule);
router.get('/training', auth, controller.getTrainingModules);
router.post('/training/:id/progress', auth, controller.updateTrainingProgress);

// Compliance Checklists
router.post('/compliance', auth, controller.createChecklist);
router.get('/compliance', auth, controller.getChecklists);
router.post('/compliance/status', auth, controller.updateChecklistStatus);

module.exports = router;
