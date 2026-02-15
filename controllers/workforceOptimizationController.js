/**
 * Workforce Optimization Controller
 * Handles all workforce optimization API endpoints
 */

const workforcePlanningService = require('../services/workforcePlanningService');
const resourceAllocationService = require('../services/resourceAllocationService');
const performanceAnalyticsService = require('../services/performanceAnalyticsService');
const qualityAssuranceService = require('../services/qualityAssuranceService');
const businessIntelligenceService = require('../services/businessIntelligenceService');
const mlModelService = require('../services/mlModelService');

// ============================================================================
// Workforce Planning Endpoints
// ============================================================================

/**
 * POST /api/workforce/planning/forecast
 * Forecast demand using time series analysis
 */
exports.forecastDemand = async (req, res) => {
  try {
    const result = await workforcePlanningService.forecastDemand(req.body);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in forecastDemand:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to forecast demand'
    });
  }
};

/**
 * POST /api/workforce/planning/optimize
 * Optimize staff requirements
 */
exports.optimizeStaffing = async (req, res) => {
  try {
    const result = await workforcePlanningService.optimizeStaffing(req.body);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in optimizeStaffing:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to optimize staffing'
    });
  }
};

/**
 * POST /api/workforce/planning/turnover
 * Predict employee turnover
 */
exports.predictTurnover = async (req, res) => {
  try {
    const result = await workforcePlanningService.predictTurnover(req.body);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in predictTurnover:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to predict turnover'
    });
  }
};

/**
 * POST /api/workforce/planning/scenarios
 * Analyze capacity scenarios
 */
exports.analyzeScenarios = async (req, res) => {
  try {
    const result = await workforcePlanningService.analyzeScenarios(req.body);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in analyzeScenarios:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to analyze scenarios'
    });
  }
};

// ============================================================================
// Resource Allocation Endpoints
// ============================================================================

/**
 * POST /api/workforce/allocation/optimize
 * Optimize resource allocation
 */
exports.optimizeAllocation = async (req, res) => {
  try {
    const result = await resourceAllocationService.optimizeAllocation(req.body);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in optimizeAllocation:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to optimize allocation'
    });
  }
};

/**
 * POST /api/workforce/allocation/reallocate
 * Reallocate resources dynamically
 */
exports.reallocateResources = async (req, res) => {
  try {
    const result = await resourceAllocationService.reallocateResources(req.body);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in reallocateResources:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to reallocate resources'
    });
  }
};

/**
 * GET /api/workforce/allocation/recommendations/:appointmentId
 * Get allocation recommendations for an appointment
 */
exports.getAllocationRecommendations = async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { organizationId } = req.query;
    
    const result = await resourceAllocationService.getAllocationRecommendations({
      organizationId,
      appointmentId
    });
    
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in getAllocationRecommendations:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get recommendations'
    });
  }
};

/**
 * GET /api/workforce/allocation/workload-balance
 * Analyze workload balance
 */
exports.analyzeWorkloadBalance = async (req, res) => {
  try {
    const result = await resourceAllocationService.analyzeWorkloadBalance(req.query);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in analyzeWorkloadBalance:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to analyze workload balance'
    });
  }
};

// ============================================================================
// Performance Analytics Endpoints
// ============================================================================

/**
 * GET /api/workforce/performance/analytics
 * Get performance analytics
 */
exports.getPerformanceAnalytics = async (req, res) => {
  try {
    const result = await performanceAnalyticsService.getPerformanceAnalytics(req.query);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in getPerformanceAnalytics:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get performance analytics'
    });
  }
};

/**
 * GET /api/workforce/performance/trends/:employeeId
 * Analyze performance trends
 */
exports.analyzePerformanceTrends = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { organizationId, period } = req.query;
    
    const result = await performanceAnalyticsService.analyzePerformanceTrends({
      organizationId,
      employeeId,
      period
    });
    
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in analyzePerformanceTrends:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to analyze trends'
    });
  }
};

/**
 * POST /api/workforce/performance/predict
 * Predict future performance
 */
exports.predictPerformance = async (req, res) => {
  try {
    const result = await performanceAnalyticsService.predictPerformance(req.body);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in predictPerformance:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to predict performance'
    });
  }
};

/**
 * GET /api/workforce/performance/skills/:employeeId
 * Track skill proficiency
 */
exports.trackSkillProficiency = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { organizationId } = req.query;
    
    const result = await performanceAnalyticsService.trackSkillProficiency({
      organizationId,
      employeeId
    });
    
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in trackSkillProficiency:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to track skill proficiency'
    });
  }
};

// ============================================================================
// Quality Assurance Endpoints
// ============================================================================

/**
 * POST /api/workforce/quality/score
 * Score service quality
 */
exports.scoreServiceQuality = async (req, res) => {
  try {
    const result = await qualityAssuranceService.scoreServiceQuality(req.body);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in scoreServiceQuality:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to score service quality'
    });
  }
};

/**
 * POST /api/workforce/quality/compliance-check
 * Perform compliance check
 */
exports.performComplianceCheck = async (req, res) => {
  try {
    const result = await qualityAssuranceService.performComplianceCheck(req.body);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in performComplianceCheck:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to perform compliance check'
    });
  }
};

/**
 * POST /api/workforce/quality/sentiment
 * Analyze feedback sentiment
 */
exports.analyzeFeedbackSentiment = async (req, res) => {
  try {
    const result = await qualityAssuranceService.analyzeFeedbackSentiment(req.body);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in analyzeFeedbackSentiment:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to analyze sentiment'
    });
  }
};

/**
 * POST /api/workforce/quality/risk-assessment
 * Assess risk
 */
exports.assessRisk = async (req, res) => {
  try {
    const result = await qualityAssuranceService.assessRisk(req.body);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in assessRisk:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to assess risk'
    });
  }
};

/**
 * GET /api/workforce/quality/incident-patterns
 * Detect incident patterns
 */
exports.detectIncidentPatterns = async (req, res) => {
  try {
    const result = await qualityAssuranceService.detectIncidentPatterns(req.query);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in detectIncidentPatterns:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to detect patterns'
    });
  }
};

/**
 * GET /api/workforce/quality/audit-trail
 * Generate audit trail
 */
exports.generateAuditTrail = async (req, res) => {
  try {
    const result = await qualityAssuranceService.generateAuditTrail(req.query);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in generateAuditTrail:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate audit trail'
    });
  }
};

// ============================================================================
// Business Intelligence Endpoints
// ============================================================================

/**
 * GET /api/workforce/bi/dashboard
 * Get executive dashboard
 */
exports.getExecutiveDashboard = async (req, res) => {
  try {
    const result = await businessIntelligenceService.getExecutiveDashboard(req.query);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in getExecutiveDashboard:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get dashboard'
    });
  }
};

/**
 * POST /api/workforce/bi/forecast-revenue
 * Forecast revenue
 */
exports.forecastRevenue = async (req, res) => {
  try {
    const result = await businessIntelligenceService.forecastRevenue(req.body);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in forecastRevenue:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to forecast revenue'
    });
  }
};

/**
 * POST /api/workforce/bi/predict-churn
 * Predict customer churn
 */
exports.predictChurn = async (req, res) => {
  try {
    const result = await businessIntelligenceService.predictChurn(req.body);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in predictChurn:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to predict churn'
    });
  }
};

/**
 * GET /api/workforce/bi/profitability
 * Analyze profitability
 */
exports.analyzeProfitability = async (req, res) => {
  try {
    const result = await businessIntelligenceService.analyzeProfitability(req.query);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in analyzeProfitability:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to analyze profitability'
    });
  }
};

/**
 * POST /api/workforce/bi/what-if
 * Analyze what-if scenario
 */
exports.analyzeWhatIfScenario = async (req, res) => {
  try {
    const result = await businessIntelligenceService.analyzeWhatIfScenario(req.body);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in analyzeWhatIfScenario:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to analyze scenario'
    });
  }
};

/**
 * GET /api/workforce/bi/customer-lifetime-value
 * Calculate customer lifetime value
 */
exports.calculateCustomerLifetimeValue = async (req, res) => {
  try {
    const result = await businessIntelligenceService.calculateCustomerLifetimeValue(req.query);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in calculateCustomerLifetimeValue:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to calculate CLV'
    });
  }
};

// ============================================================================
// ML Model Endpoints
// ============================================================================

/**
 * POST /api/workforce/ml/train
 * Train ML model
 */
exports.trainModel = async (req, res) => {
  try {
    const result = await mlModelService.trainModel(req.body);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in trainModel:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to train model'
    });
  }
};

/**
 * POST /api/workforce/ml/evaluate
 * Evaluate ML model
 */
exports.evaluateModel = async (req, res) => {
  try {
    const result = await mlModelService.evaluateModel(req.body);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in evaluateModel:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to evaluate model'
    });
  }
};

/**
 * POST /api/workforce/ml/predict
 * Make prediction
 */
exports.predict = async (req, res) => {
  try {
    const result = await mlModelService.predict(req.body);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in predict:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to make prediction'
    });
  }
};

/**
 * POST /api/workforce/ml/batch-predict
 * Batch predictions
 */
exports.batchPredict = async (req, res) => {
  try {
    const result = await mlModelService.batchPredict(req.body);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in batchPredict:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to make batch predictions'
    });
  }
};

/**
 * GET /api/workforce/ml/models
 * List all models
 */
exports.listModels = async (req, res) => {
  try {
    const result = await mlModelService.listModels(req.query);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in listModels:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to list models'
    });
  }
};

/**
 * GET /api/workforce/ml/models/:modelId
 * Get model information
 */
exports.getModelInfo = async (req, res) => {
  try {
    const { modelId } = req.params;
    const result = await mlModelService.getModelInfo({ modelId });
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in getModelInfo:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get model info'
    });
  }
};

/**
 * PUT /api/workforce/ml/models/:modelId
 * Update model
 */
exports.updateModel = async (req, res) => {
  try {
    const { modelId } = req.params;
    const result = await mlModelService.updateModel({
      modelId,
      updates: req.body
    });
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in updateModel:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update model'
    });
  }
};

/**
 * DELETE /api/workforce/ml/models/:modelId
 * Delete model
 */
exports.deleteModel = async (req, res) => {
  try {
    const { modelId } = req.params;
    const result = await mlModelService.deleteModel({ modelId });
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in deleteModel:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete model'
    });
  }
};

/**
 * POST /api/workforce/ml/feature-engineering
 * Engineer features
 */
exports.engineerFeatures = async (req, res) => {
  try {
    const result = await mlModelService.engineerFeatures(req.body);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in engineerFeatures:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to engineer features'
    });
  }
};

/**
 * POST /api/workforce/ml/ab-test
 * A/B test models
 */
exports.abTestModels = async (req, res) => {
  try {
    const result = await mlModelService.abTestModels(req.body);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in abTestModels:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to run A/B test'
    });
  }
};

/**
 * GET /api/workforce/ml/monitor/:modelId
 * Monitor model performance
 */
exports.monitorPerformance = async (req, res) => {
  try {
    const { modelId } = req.params;
    const { timeRange } = req.query;
    
    const result = await mlModelService.monitorPerformance({
      modelId,
      timeRange
    });
    
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in monitorPerformance:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to monitor performance'
    });
  }
};

/**
 * POST /api/workforce/ml/export/:modelId
 * Export model
 */
exports.exportModel = async (req, res) => {
  try {
    const { modelId } = req.params;
    const { format } = req.body;
    
    const result = await mlModelService.exportModel({
      modelId,
      format
    });
    
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in exportModel:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to export model'
    });
  }
};

module.exports = exports;
