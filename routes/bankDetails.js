const express = require('express');
const router = express.Router();
const bankDetailsController = require('../controllers/bankDetailsController');
const { validateBankDetailsPayload, validateBankDetailsQuery } = require('../validators/bankDetailsValidator');

/**
 * Bank details routes
 * Maintains existing paths for compatibility
 */
router.post('/saveBankDetails', validateBankDetailsPayload, (req, res) => bankDetailsController.saveBankDetails(req, res));
router.get('/getBankDetails', validateBankDetailsQuery, (req, res) => bankDetailsController.getBankDetails(req, res));

module.exports = router;