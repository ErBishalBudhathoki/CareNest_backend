/**
 * Care Intelligence Routes
 * API routes for care intelligence, risk prediction, care planning, incidents, and medication
 */

const express = require('express');
const router = express.Router();
const careIntelligenceController = require('../controllers/careIntelligenceController');
const { authenticateUser } = require('../middleware/auth');
const {
  organizationContextMiddleware,
  requireOrganizationOwnership,
} = require('../middleware/organizationContext');

// BOLA protection: every endpoint requires an authenticated user with a
// validated organization membership. Resource routes additionally verify
// the target belongs to the caller's organization (403 otherwise).
router.use(authenticateUser);
router.use(organizationContextMiddleware);

// Client model getter for ownership checks (Client.organizationId).
const ClientModel = () => require('../models/Client');
const ownsClient = requireOrganizationOwnership('clientId', ClientModel);

// The generic requireOrganizationMatch prefers body over params, but
// detectPatterns reads organizationId from PARAMS — so validate the param
// value itself (plus any body value, defensively) against membership.
const requireParamOrgMatch = (req, res, next) => {
  const ctxOrg =
    req.organizationContext && req.organizationContext.organizationId;
  if (!ctxOrg) {
    return res.status(400).json({ success: false, message: 'Organization context required' });
  }
  const paramOrg = req.params.organizationId;
  const bodyOrg = req.body && req.body.organizationId;
  if (!paramOrg || paramOrg !== ctxOrg || (bodyOrg && bodyOrg !== ctxOrg)) {
    return res.status(403).json({ success: false, message: 'Access denied to this resource' });
  }
  next();
};

// ============================================================================
// Care Intelligence Routes
// ============================================================================

// Generate comprehensive intelligence report
router.post('/intelligence/report/:clientId', ownsClient, careIntelligenceController.generateIntelligenceReport);

// Analyze care patterns
router.post('/intelligence/patterns/:clientId', ownsClient, careIntelligenceController.analyzeCarePatterns);

// Predict care needs
router.post('/intelligence/predict-needs/:clientId', ownsClient, careIntelligenceController.predictCareNeeds);

// Optimize care delivery
router.post('/intelligence/optimize/:clientId', ownsClient, careIntelligenceController.optimizeCareDelivery);

// Generate personalized insights
router.get('/intelligence/insights/:clientId', ownsClient, careIntelligenceController.generatePersonalizedInsights);

// ============================================================================
// Risk Prediction Routes
// ============================================================================

// Predict all risk types
router.post('/risk/predict-all/:clientId', ownsClient, careIntelligenceController.predictAllRisks);

// Predict falls risk
router.post('/risk/falls/:clientId', ownsClient, careIntelligenceController.predictFallsRisk);

// Predict behavior escalation
router.post('/risk/behavior/:clientId', ownsClient, careIntelligenceController.predictBehaviorEscalation);

// Predict health deterioration
router.post('/risk/health/:clientId', ownsClient, careIntelligenceController.predictHealthDeterioration);

// Predict medication risk
router.post('/risk/medication/:clientId', ownsClient, careIntelligenceController.predictMedicationRisk);

// Analyze risk trends
router.post('/risk/trends/:clientId', ownsClient, careIntelligenceController.analyzeRiskTrends);

// ============================================================================
// Care Plan Routes
// ============================================================================

// Generate AI-assisted care plan (clientId + organizationId in body)
router.post('/care-plan/generate', ownsClient, careIntelligenceController.generateCarePlan);

// Generate SMART goals
router.post('/care-plan/goals/:clientId', ownsClient, careIntelligenceController.generateSmartGoals);

// Recommend services
router.post('/care-plan/services/:clientId', ownsClient, careIntelligenceController.recommendServices);

// Adapt care plan (planId is an AI-operation handle, not a stored cross-org
// record; auth + validated membership applies — see module notes)
router.put('/care-plan/adapt/:planId', careIntelligenceController.adaptCarePlan);

// Track goal progress (goalId is an AI-operation handle — same note)
router.post('/care-plan/progress/:goalId', careIntelligenceController.trackGoalProgress);

// Generate evidence-based recommendations (clientId in body)
router.post('/care-plan/evidence-based', ownsClient, careIntelligenceController.generateEvidenceBasedRecommendations);

// ============================================================================
// Incident Management Routes
// ============================================================================

// Report incident (clientId + organizationId in body)
router.post('/incident/report', ownsClient, careIntelligenceController.reportIncident);

// Analyze root cause (incidentId is an AI-operation handle — same note)
router.post('/incident/root-cause/:incidentId', careIntelligenceController.analyzeRootCause);

// Detect patterns (organizationId in params must match membership)
router.post(
  '/incident/patterns/:organizationId',
  requireParamOrgMatch,
  careIntelligenceController.detectPatterns
);

// Predict recurrence (incidentId is an AI-operation handle — same note)
router.post('/incident/predict-recurrence/:incidentId', careIntelligenceController.predictRecurrence);

// Generate corrective actions (incidentId is an AI-operation handle)
router.post('/incident/corrective-actions/:incidentId', careIntelligenceController.generateCorrectiveActions);

// ============================================================================
// Medication Management Routes
// ============================================================================

// Check drug interactions (drug list only, no stored PII — auth + membership)
router.post('/medication/check-interactions', careIntelligenceController.checkInteractions);

// Track compliance
router.post('/medication/compliance/:clientId', ownsClient, careIntelligenceController.trackCompliance);

// Generate alerts
router.get('/medication/alerts/:clientId', ownsClient, careIntelligenceController.generateMedicationAlerts);

// Optimize schedule
router.post('/medication/optimize-schedule/:clientId', ownsClient, careIntelligenceController.optimizeMedicationSchedule);

// Monitor side effects
router.post('/medication/side-effects/:clientId', ownsClient, careIntelligenceController.monitorSideEffects);

module.exports = router;
