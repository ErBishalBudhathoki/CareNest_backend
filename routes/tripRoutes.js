const express = require('express');
const router = express.Router();
const tripController = require('../controllers/tripController');
const { authenticateUser } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');

// Create a trip
router.post(
  '/',
  authenticateUser,
  tripController.createTrip
);

// Get all trips (Admin only)
router.get(
  '/',
  authenticateUser,
  requireAdmin,
  tripController.getAllTrips
);

// Get Enhanced Invoice Analytics (Admin only)
router.get(
  '/analytics',
  authenticateUser,
  requireAdmin,
  tripController.getInvoiceAnalytics
);

// Update Trip Details (Admin only) - includes status, distance, client
router.patch(
  '/:tripId',
  authenticateUser,
  requireAdmin,
  tripController.updateTripDetails
);

// Approve/Reject Trip (Admin only) - Deprecated in favor of PATCH /:tripId but kept for backward compatibility if needed
router.patch(
  '/:tripId/status',
  authenticateUser,
  requireAdmin,
  tripController.updateTripStatus
);

// Get employee trips
router.get(
  '/employee/:userId',
  authenticateUser,
  tripController.getTripsByEmployee
);

module.exports = router;
