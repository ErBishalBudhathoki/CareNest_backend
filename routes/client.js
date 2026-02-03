const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const clientController = require('../controllers/clientController');
const { authenticateUser } = require('../middleware/auth');

// Rate limiting
const clientLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many client requests.' }
});

// Validation
const addClientValidation = [
  body('clientEmail').isEmail(),
  body('clientFirstName').trim().notEmpty(),
  body('clientLastName').trim().notEmpty(),
  body('organizationId').optional().isMongoId()
];

const assignValidation = [
  body('userEmail').isEmail(),
  body('clientEmail').isEmail(),
  body('dateList').isArray(),
  body('startTimeList').isArray(),
  body('endTimeList').isArray()
];

// Protected routes
router.use(authenticateUser);

router.post('/activate', clientLimiter, body('email').isEmail(), clientController.activateClient);
router.post('/addClient', clientLimiter, addClientValidation, clientController.addClient);
router.get('/clients/:organizationId', clientLimiter, param('organizationId').isMongoId(), clientController.getClients);
router.get('/getClients', clientLimiter, clientController.getClients);

// Get client details by ID
router.get('/details/:clientId', clientLimiter, param('clientId').isMongoId(), clientController.getClientById);

router.post('/updateCareNotes/:clientId', clientLimiter, param('clientId').isMongoId(), clientController.updateCareNotes);
router.get('/getMultipleClients/:emails', clientLimiter, clientController.getMultipleClients);
router.post('/assignClientToUser', clientLimiter, assignValidation, clientController.assignClientToUser);
router.get('/getUserAssignments/:userEmail', clientLimiter, param('userEmail').isEmail(), clientController.getUserAssignments);

module.exports = router;
