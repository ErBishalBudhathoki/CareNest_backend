/**
 * Financial Intelligence Routes
 * API routes for Phase 10 - Advanced Financial Intelligence & Predictive Revenue System
 */

const express = require('express');
const router = express.Router();
const financialIntelligenceController = require('../controllers/financialIntelligenceController');

// ============================================================================
// Revenue Forecasting Routes (8 endpoints)
// ============================================================================

router.post('/revenue/forecast', financialIntelligenceController.generateForecast);
router.post('/revenue/drivers', financialIntelligenceController.analyzeRevenueDrivers);
router.post('/revenue/scenarios', financialIntelligenceController.generateScenarios);
router.post('/revenue/what-if', financialIntelligenceController.whatIfAnalysis);
router.get('/revenue/trends/:organizationId', financialIntelligenceController.getRevenueTrends);
router.get('/revenue/confidence/:forecastId', financialIntelligenceController.getForecastAccuracy);
router.post('/revenue/update-model', financialIntelligenceController.updateModels);

// ============================================================================
// Pricing Optimization Routes (7 endpoints)
// ============================================================================

router.post('/pricing/optimize', financialIntelligenceController.optimizePrices);
router.post('/pricing/test', financialIntelligenceController.setupABTest);
router.post('/pricing/recommendations/:serviceId', financialIntelligenceController.getPricingRecommendations);
router.post('/pricing/margin-analysis', financialIntelligenceController.analyzeMargins);
router.post('/pricing/competitor-analysis', financialIntelligenceController.analyzeCompetitorPricing);
router.post('/pricing/elasticity/:serviceId', financialIntelligenceController.calculatePriceElasticity);
router.post('/pricing/bundle-optimization', financialIntelligenceController.optimizeBundlePricing);

// ============================================================================
// Billing Automation Routes (8 endpoints)
// ============================================================================

router.post('/billing/generate', financialIntelligenceController.generateInvoices);
router.post('/billing/validate', financialIntelligenceController.validateBilling);
router.post('/billing/anomaly-detection', financialIntelligenceController.detectBillingAnomalies);
router.post('/billing/approve', financialIntelligenceController.approveInvoices);
router.post('/billing/credit-note', financialIntelligenceController.generateCreditNote);
router.get('/billing/pending/:organizationId', financialIntelligenceController.getPendingInvoices);
router.post('/billing/batch-process', financialIntelligenceController.batchProcessInvoices);
router.post('/billing/reconcile', financialIntelligenceController.reconcileInvoices);

// ============================================================================
// Cash Flow Management Routes (7 endpoints)
// ============================================================================

router.post('/cashflow/forecast', financialIntelligenceController.forecastCashFlow);
router.post('/cashflow/payment-prediction', financialIntelligenceController.predictPayments);
router.post('/cashflow/optimize', financialIntelligenceController.optimizeCash);
router.get('/cashflow/position/:organizationId', financialIntelligenceController.getCurrentCashPosition);
router.post('/cashflow/scenario', financialIntelligenceController.generateCashFlowScenario);
router.get('/cashflow/alerts/:organizationId', financialIntelligenceController.getCashFlowAlerts);
router.post('/cashflow/recommendations', financialIntelligenceController.getCashFlowRecommendations);

// ============================================================================
// Financial Analytics Routes (6 endpoints)
// ============================================================================

router.get('/analytics/dashboard/:organizationId', financialIntelligenceController.getFinancialDashboard);
router.post('/analytics/profitability', financialIntelligenceController.analyzeProfitability);
router.post('/analytics/variance', financialIntelligenceController.analyzeVariance);
router.get('/analytics/kpis/:organizationId', financialIntelligenceController.getFinancialKPIs);
router.post('/analytics/trends', financialIntelligenceController.analyzeFinancialTrends);
router.post('/analytics/drill-down', financialIntelligenceController.drillDownAnalysis);

// ============================================================================
// Budget Management Routes (6 endpoints)
// ============================================================================

router.post('/budget/create', financialIntelligenceController.createBudget);
router.post('/budget/monitor', financialIntelligenceController.monitorBudget);
router.post('/budget/variance', financialIntelligenceController.analyzeBudgetVariance);
router.post('/budget/forecast', financialIntelligenceController.generateRollingForecast);
router.post('/budget/optimize', financialIntelligenceController.optimizeBudgetAllocation);
router.get('/budget/status/:organizationId', financialIntelligenceController.getBudgetStatus);

// ============================================================================
// Payment Processing Routes (5 endpoints)
// ============================================================================

router.post('/payment/process', financialIntelligenceController.processPayment);
router.post('/payment/reconcile', financialIntelligenceController.reconcilePayments);
router.post('/payment/optimize-routing', financialIntelligenceController.optimizePaymentRouting);
router.get('/payment/analytics/:organizationId', financialIntelligenceController.getPaymentAnalytics);
router.post('/payment/fraud-check', financialIntelligenceController.checkPaymentFraud);

// ============================================================================
// Compliance & Audit Routes (3 endpoints)
// ============================================================================

router.post('/compliance/check', financialIntelligenceController.checkCompliance);
router.post('/compliance/audit-trail', financialIntelligenceController.generateAuditTrail);
router.get('/compliance/status/:organizationId', financialIntelligenceController.getComplianceStatus);

// ============================================================================
// Client Financial Management Routes (3 endpoints)
// ============================================================================

router.post('/client/credit-limit', financialIntelligenceController.manageCreditLimit);
router.post('/client/lifetime-value', financialIntelligenceController.calculateLifetimeValue);
router.post('/client/financial-health', financialIntelligenceController.assessFinancialHealth);

// ============================================================================
// Financial Reporting Routes (3 endpoints)
// ============================================================================

router.post('/reporting/executive', financialIntelligenceController.generateExecutiveReport);
router.post('/reporting/custom', financialIntelligenceController.buildCustomReport);
router.post('/reporting/regulatory', financialIntelligenceController.generateRegulatoryReport);

module.exports = router;
