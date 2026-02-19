/**
 * Care Intelligence Routes
 * API routes for care intelligence, risk prediction, care planning, incidents, and medication
 */

const express = require('express');
const router = express.Router();
const careIntelligenceController = require('../controllers/careIntelligenceController');

// ============================================================================
// Care Intelligence Routes
// ============================================================================

// Generate comprehensive intelligence report
router.post('/intelligence/report/:clientId', careIntelligenceController.generateIntelligenceReport);

// Analyze care patterns
router.post('/intelligence/patterns/:clientId', careIntelligenceController.analyzeCarePatterns);

// Predict care needs
router.post('/intelligence/predict-needs/:clientId', careIntelligenceController.predictCareNeeds);

// Optimize care delivery
router.post('/intelligence/optimize/:clientId', careIntelligenceController.optimizeCareDelivery);

// Generate personalized insights
router.get('/intelligence/insights/:clientId', careIntelligenceController.generatePersonalizedInsights);

// ============================================================================
// Risk Prediction Routes
// ============================================================================

// Predict all risk types
router.post('/risk/predict-all/:clientId', careIntelligenceController.predictAllRisks);

// Predict falls risk
router.post('/risk/falls/:clientId', careIntelligenceController.predictFallsRisk);

// Predict behavior escalation
router.post('/risk/behavior/:clientId', careIntelligenceController.predictBehaviorEscalation);

// Predict health deterioration
router.post('/risk/health/:clientId', careIntelligenceController.predictHealthDeterioration);

// Predict medication risk
router.post('/risk/medication/:clientId', careIntelligenceController.predictMedicationRisk);

// Analyze risk trends
router.post('/risk/trends/:clientId', careIntelligenceController.analyzeRiskTrends);

// ============================================================================
// Care Plan Routes
// ============================================================================

// Generate AI-assisted care plan
router.post('/care-plan/generate', careIntelligenceController.generateCarePlan);

// Generate SMART goals
router.post('/care-plan/goals/:clientId', careIntelligenceController.generateSmartGoals);

// Recommend services
router.post('/care-plan/services/:clientId', careIntelligenceController.recommendServices);

// Adapt care plan
router.put('/care-plan/adapt/:planId', careIntelligenceController.adaptCarePlan);

// Track goal progress
router.post('/care-plan/progress/:goalId', careIntelligenceController.trackGoalProgress);

// Generate evidence-based recommendations
router.post('/care-plan/evidence-based', careIntelligenceController.generateEvidenceBasedRecommendations);

// ============================================================================
// Incident Management Routes
// ============================================================================

// Report incident
router.post('/incident/report', careIntelligenceController.reportIncident);

// Analyze root cause
router.post('/incident/root-cause/:incidentId', careIntelligenceController.analyzeRootCause);

// Detect patterns
router.post('/incident/patterns/:organizationId', careIntelligenceController.detectPatterns);

// Predict recurrence
router.post('/incident/predict-recurrence/:incidentId', careIntelligenceController.predictRecurrence);

// Generate corrective actions
router.post('/incident/corrective-actions/:incidentId', careIntelligenceController.generateCorrectiveActions);

// ============================================================================
// Medication Management Routes
// ============================================================================

// Check drug interactions
router.post('/medication/check-interactions', careIntelligenceController.checkInteractions);

// Track compliance
router.post('/medication/compliance/:clientId', careIntelligenceController.trackCompliance);

// Generate alerts
router.get('/medication/alerts/:clientId', careIntelligenceController.generateMedicationAlerts);

// Optimize schedule
router.post('/medication/optimize-schedule/:clientId', careIntelligenceController.optimizeMedicationSchedule);

// Monitor side effects
router.post('/medication/side-effects/:clientId', careIntelligenceController.monitorSideEffects);

module.exports = router;
