const express = require('express');
const router = express.Router();
const configController = require('../controllers/configController');

// Job Roles
router.get('/job-roles/:organizationId', configController.getJobRoles);
router.post('/job-roles', configController.createJobRole);

// Leave Types
router.get('/leave-types/:organizationId', configController.getLeaveTypes);
router.post('/leave-types', configController.createLeaveType);

module.exports = router;
