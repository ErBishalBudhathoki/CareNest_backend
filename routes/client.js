const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const clientController = require('../controllers/clientController');
const { authenticateUser, requireRoles } = require('../middleware/auth');
const { 
  organizationContextMiddleware, 
  requireOrganizationOwnership,
  requireOrganizationMatch 
} = require('../middleware/organizationContext');

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

router.post('/activate', clientLimiter, organizationContextMiddleware, body('email').isEmail(), clientController.activateClient);
router.post('/addClient', clientLimiter, organizationContextMiddleware, addClientValidation, clientController.addClient);
router.get('/clients/:organizationId', clientLimiter, organizationContextMiddleware, param('organizationId').isMongoId(), requireOrganizationMatch('organizationId'), clientController.getClients);
router.get('/getClients', clientLimiter, organizationContextMiddleware, clientController.getClients);

// Get client details by ID
router.get('/details/:clientId', clientLimiter, organizationContextMiddleware, param('clientId').isMongoId(), requireOrganizationOwnership('clientId', () => require('../models/Client')), clientController.getClientById);

// Update client core details
router.put(
  '/client/:clientId',
  clientLimiter,
  organizationContextMiddleware,
  param('clientId').isMongoId(),
  body('organizationId').optional().isMongoId(),
  body('userEmail').optional().isEmail(),
  requireOrganizationOwnership('clientId', () => require('../models/Client')),
  clientController.updateClient
);

// Update the participant's NDIS plan period/budget (used by the plan gate)
router.put(
  '/client/:clientId/plan',
  clientLimiter,
  organizationContextMiddleware,
  param('clientId').isMongoId(),
  body('organizationId').optional().isMongoId(),
  body('userEmail').optional().isEmail(),
  body('startDate').optional({ nullable: true }).isISO8601(),
  body('endDate').optional({ nullable: true }).isISO8601(),
  body('totalBudget').optional().isFloat({ min: 0 }),
  body('documentUrl').optional({ nullable: true }).isString().isLength({ max: 2000 }),
  body('documentName').optional({ nullable: true }).isString().isLength({ max: 255 }),
  body('notes').optional({ nullable: true }).isString().isLength({ max: 2000 }),
  requireOrganizationOwnership('clientId', () => require('../models/Client')),
  clientController.updateClientPlan
);

// Delete (soft-delete) client
router.post(
  '/client/:clientId/delete',
  clientLimiter,
  organizationContextMiddleware,
  param('clientId').isMongoId(),
  body('organizationId').optional().isMongoId(),
  body('userEmail').optional().isEmail(),
  body('forceDelete').optional().isBoolean().toBoolean(),
  requireOrganizationOwnership('clientId', () => require('../models/Client')),
  clientController.deleteClient
);

router.post(
  '/client/:clientId/mark-activated',
  clientLimiter,
  organizationContextMiddleware,
  param('clientId').isMongoId(),
  body('organizationId').optional().isMongoId(),
  body('userEmail').optional().isEmail(),
  requireRoles(['admin', 'superadmin']),
  requireOrganizationOwnership('clientId', () => require('../models/Client')),
  clientController.markClientActivated
);

router.post(
  '/client/:clientId/restore',
  clientLimiter,
  organizationContextMiddleware,
  param('clientId').isMongoId(),
  body('organizationId').optional().isMongoId(),
  body('userEmail').optional().isEmail(),
  requireOrganizationOwnership('clientId', () => require('../models/Client')),
  clientController.restoreClient
);

router.post('/updateCareNotes/:clientId', clientLimiter, organizationContextMiddleware, param('clientId').isMongoId(), requireOrganizationOwnership('clientId', () => require('../models/Client')), clientController.updateCareNotes);
router.get('/getMultipleClients/:emails', clientLimiter, organizationContextMiddleware, clientController.getMultipleClients);
router.post('/assignClientToUser', clientLimiter, organizationContextMiddleware, assignValidation, clientController.assignClientToUser);
router.get('/getUserAssignments/:userEmail', clientLimiter, organizationContextMiddleware, param('userEmail').isEmail(), clientController.getUserAssignments);

module.exports = router;
