/**
 * Workforce Optimization Routes
 * All routes for workforce optimization features
 */

const express = require('express');
const router = express.Router();
const workforceController = require('../controllers/workforceOptimizationController');

// ============================================================================
// Workforce Planning Routes
// ============================================================================

// POST /api/workforce/planning/forecast - Forecast demand
router.post('/planning/forecast', workforceController.forecastDemand);

// POST /api/workforce/planning/optimize - Optimize staffing
router.post('/planning/optimize', workforceController.optimizeStaffing);

// POST /api/workforce/planning/turnover - Predict turnover
router.post('/planning/turnover', workforceController.predictTurnover);

// POST /api/workforce/planning/scenarios - Analyze scenarios
router.post('/planning/scenarios', workforceController.analyzeScenarios);

// ============================================================================
// Resource Allocation Routes
// ============================================================================

// POST /api/workforce/allocation/optimize - Optimize allocation
router.post('/allocation/optimize', workforceController.optimizeAllocation);

// POST /api/workforce/allocation/reallocate - Reallocate resources
router.post('/allocation/reallocate', workforceController.reallocateResources);

// GET /api/workforce/allocation/recommendations/:appointmentId - Get recommendations
router.get('/allocation/recommendations/:appointmentId', workforceController.getAllocationRecommendations);

// GET /api/workforce/allocation/workload-balance - Analyze workload balance
router.get('/allocation/workload-balance', workforceController.analyzeWorkloadBalance);

// ============================================================================
// Performance Analytics Routes
// ============================================================================

// GET /api/workforce/performance/analytics - Get performance analytics
router.get('/performance/analytics', workforceController.getPerformanceAnalytics);

// GET /api/workforce/performance/trends/:employeeId - Analyze trends
router.get('/performance/trends/:employeeId', workforceController.analyzePerformanceTrends);

// POST /api/workforce/performance/predict - Predict performance
router.post('/performance/predict', workforceController.predictPerformance);

// GET /api/workforce/performance/skills/:employeeId - Track skill proficiency
router.get('/performance/skills/:employeeId', workforceController.trackSkillProficiency);

// ============================================================================
// Quality Assurance Routes
// ============================================================================

// POST /api/workforce/quality/score - Score service quality
router.post('/quality/score', workforceController.scoreServiceQuality);

// POST /api/workforce/quality/compliance-check - Perform compliance check
router.post('/quality/compliance-check', workforceController.performComplianceCheck);

// POST /api/workforce/quality/sentiment - Analyze sentiment
router.post('/quality/sentiment', workforceController.analyzeFeedbackSentiment);

// POST /api/workforce/quality/risk-assessment - Assess risk
router.post('/quality/risk-assessment', workforceController.assessRisk);

// GET /api/workforce/quality/incident-patterns - Detect patterns
router.get('/quality/incident-patterns', workforceController.detectIncidentPatterns);

// GET /api/workforce/quality/audit-trail - Generate audit trail
router.get('/quality/audit-trail', workforceController.generateAuditTrail);

// ============================================================================
// Business Intelligence Routes
// ============================================================================

// GET /api/workforce/bi/dashboard - Get executive dashboard
router.get('/bi/dashboard', workforceController.getExecutiveDashboard);

// POST /api/workforce/bi/forecast-revenue - Forecast revenue
router.post('/bi/forecast-revenue', workforceController.forecastRevenue);

// POST /api/workforce/bi/predict-churn - Predict churn
router.post('/bi/predict-churn', workforceController.predictChurn);

// GET /api/workforce/bi/profitability - Analyze profitability
router.get('/bi/profitability', workforceController.analyzeProfitability);

// POST /api/workforce/bi/what-if - Analyze what-if scenario
router.post('/bi/what-if', workforceController.analyzeWhatIfScenario);

// GET /api/workforce/bi/customer-lifetime-value - Calculate CLV
router.get('/bi/customer-lifetime-value', workforceController.calculateCustomerLifetimeValue);

// ============================================================================
// ML Model Routes
// ============================================================================

// POST /api/workforce/ml/train - Train model
router.post('/ml/train', workforceController.trainModel);

// POST /api/workforce/ml/evaluate - Evaluate model
router.post('/ml/evaluate', workforceController.evaluateModel);

// POST /api/workforce/ml/predict - Make prediction
router.post('/ml/predict', workforceController.predict);

// POST /api/workforce/ml/batch-predict - Batch predictions
router.post('/ml/batch-predict', workforceController.batchPredict);

// GET /api/workforce/ml/models - List models
router.get('/ml/models', workforceController.listModels);

// GET /api/workforce/ml/models/:modelId - Get model info
router.get('/ml/models/:modelId', workforceController.getModelInfo);

// PUT /api/workforce/ml/models/:modelId - Update model
router.put('/ml/models/:modelId', workforceController.updateModel);

// DELETE /api/workforce/ml/models/:modelId - Delete model
router.delete('/ml/models/:modelId', workforceController.deleteModel);

// POST /api/workforce/ml/feature-engineering - Engineer features
router.post('/ml/feature-engineering', workforceController.engineerFeatures);

// POST /api/workforce/ml/ab-test - A/B test models
router.post('/ml/ab-test', workforceController.abTestModels);

// GET /api/workforce/ml/monitor/:modelId - Monitor performance
router.get('/ml/monitor/:modelId', workforceController.monitorPerformance);

// POST /api/workforce/ml/export/:modelId - Export model
router.post('/ml/export/:modelId', workforceController.exportModel);

module.exports = router;
