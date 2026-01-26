const express = require('express');
const organizationController = require('../../controllers/organizationController');
const multiTenantController = require('../../controllers/multiTenantController');
const router = express.Router();

/**
 * Create a new organization
 * POST /organization/create
 */
router.post('/create', organizationController.createOrganization);

/**
 * Create a new organization (legacy endpoint)
 * POST /createOrganization
 */
router.post('/createOrganization', organizationController.createOrganizationLegacy);

/**
 * Verify organization code
 * POST /organization/verify-code
 */
router.post('/verify-code', organizationController.verifyOrganizationCode);

router.get('/my-list', organizationController.getMyOrganizations);

/**
 * Get cross-organization report
 * GET /organization/cross-report
 */
router.get('/cross-report', multiTenantController.getCrossOrgReport);

/**
 * Verify organization code (frontend endpoint)
 * GET /organization/verify/:organizationCode
 */
router.get('/verify/:organizationCode', organizationController.verifyOrganizationCodeGet);

/**
 * Verify organization code (legacy endpoint)
 * GET /verifyOrganizationCode/:code
 */
router.get('/verifyOrganizationCode/:code', organizationController.verifyOrganizationCodeLegacy);

/**
 * Get organization details
 * GET /organization/:organizationId
 */
router.get('/:organizationId', organizationController.getOrganizationById);

/**
 * Update organization details
 * PUT /organization/:organizationId
 */
router.put('/:organizationId', organizationController.updateOrganizationDetails);

/**
 * Get organization members
 * GET /organization/:organizationId/members
 */
router.get('/:organizationId/members', organizationController.getOrganizationMembers);

/**
 * Get organization businesses
 * GET /organization/:organizationId/businesses
 */
router.get('/:organizationId/businesses', organizationController.getOrganizationBusinesses);

/**
 * Get organization clients
 * GET /organization/:organizationId/clients
 */
router.get('/:organizationId/clients', organizationController.getOrganizationClients);

/**
 * Get organization employees
 * GET /organization/:organizationId/employees
 */
router.get('/:organizationId/employees', organizationController.getOrganizationEmployees);

/**
 * Switch active organization
 * POST /organization/:organizationId/switch
 */
router.post('/:organizationId/switch', organizationController.switchOrganization);

/**
 * Get organization branding
 * GET /organization/:organizationId/branding
 */
router.get('/:organizationId/branding', organizationController.getBranding);

/**
 * Update organization branding
 * PUT /organization/:organizationId/branding
 */
router.put('/:organizationId/branding', organizationController.updateBranding);

module.exports = router;
