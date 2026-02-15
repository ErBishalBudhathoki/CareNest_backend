const express = require('express');
const router = express.Router();
const smartExpenseController = require('../controllers/smartExpenseController');

// Scan receipt
router.post('/scan-receipt', smartExpenseController.scanReceipt);

// Categorize expense
router.post('/categorize', smartExpenseController.categorizeExpense);

// Validate expense policy
router.post('/validate-policy', smartExpenseController.validateExpensePolicy);

// Detect duplicate receipt
router.post('/detect-duplicate', smartExpenseController.detectDuplicateReceipt);

// Calculate mileage
router.post('/calculate-mileage', smartExpenseController.calculateMileage);

module.exports = router;
