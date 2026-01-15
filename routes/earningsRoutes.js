const express = require('express');
const router = express.Router();
const earningsController = require('../controllers/earningsController');
const { authenticateUser } = require('../middleware/auth');
const {
  requireAdmin,
  requireSelfOrAdmin,
} = require('../middleware/rbac');

// Get earnings summary
// GET /api/earnings/summary/:userEmail?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
router.get(
  '/summary/:userEmail',
  authenticateUser,
  requireSelfOrAdmin('userEmail'),
  earningsController.getEarningsSummary
);

// Get projected earnings
// GET /api/earnings/projected/:userEmail?startDate=YYYY-MM-DD
router.get(
  '/projected/:userEmail',
  authenticateUser,
  requireSelfOrAdmin('userEmail'),
  earningsController.getProjectedEarnings
);

// Get earnings history (bucketed)
// GET /api/earnings/history/:userEmail?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&bucket=week|month
router.get(
  '/history/:userEmail',
  authenticateUser,
  requireSelfOrAdmin('userEmail'),
  earningsController.getEarningsHistory
);

// Set pay rate (Admin)
// POST /api/earnings/rate/:userEmail
router.post(
  '/rate/:userEmail',
  authenticateUser,
  requireAdmin,
  earningsController.setPayRate
);

module.exports = router;
