/**
 * Care Intelligence Controller
 * Handles all care intelligence, risk prediction, care planning, and incident management endpoints
 */

const careIntelligenceService = require('../services/careIntelligenceService');
const riskPredictionService = require('../services/riskPredictionService');
const carePlanService = require('../services/carePlanService');
const incidentManagementService = require('../services/incidentManagementService');
const medicationService = require('../services/medicationService');

class CareIntelligenceController {
  // ============================================================================
  // Care Intelligence Endpoints
  // ============================================================================

  async generateIntelligenceReport(req, res) {
    try {
      const { clientId } = req.params;
      const { organizationId } = req.body;
      
      const result = await careIntelligenceService.generateIntelligenceReport(clientId, organizationId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async analyzeCarePatterns(req, res) {
    try {
      const { clientId } = req.params;
      const { startDate, endDate } = req.body;
      
      const result = await careIntelligenceService.analyzeCarePatterns(clientId, startDate, endDate);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async predictCareNeeds(req, res) {
    try {
      const { clientId } = req.params;
      const { horizon } = req.body;
      
      const result = await careIntelligenceService.predictCareNeeds(clientId, horizon);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async optimizeCareDelivery(req, res) {
    try {
      const { clientId } = req.params;
      const { constraints } = req.body;
      
      const result = await careIntelligenceService.optimizeCareDelivery(clientId, constraints);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async generatePersonalizedInsights(req, res) {
    try {
      const { clientId } = req.params;
      
      const result = await careIntelligenceService.generatePersonalizedInsights(clientId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // ============================================================================
  // Risk Prediction Endpoints
  // ============================================================================

  async predictAllRisks(req, res) {
    try {
      const { clientId } = req.params;
      const { organizationId } = req.body;
      
      const result = await riskPredictionService.predictAllRisks(clientId, organizationId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async predictFallsRisk(req, res) {
    try {
      const { clientId } = req.params;
      const { factors } = req.body;
      
      const result = await riskPredictionService.predictFallsRisk(clientId, factors);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async predictBehaviorEscalation(req, res) {
    try {
      const { clientId } = req.params;
      const { historicalData } = req.body;
      
      const result = await riskPredictionService.predictBehaviorEscalation(clientId, historicalData);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async predictHealthDeterioration(req, res) {
    try {
      const { clientId } = req.params;
      const { healthData } = req.body;
      
      const result = await riskPredictionService.predictHealthDeterioration(clientId, healthData);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async predictMedicationRisk(req, res) {
    try {
      const { clientId } = req.params;
      const { medicationData } = req.body;
      
      const result = await riskPredictionService.predictMedicationRisk(clientId, medicationData);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async analyzeRiskTrends(req, res) {
    try {
      const { clientId } = req.params;
      const { startDate, endDate } = req.body;
      
      const result = await riskPredictionService.analyzeRiskTrends(clientId, startDate, endDate);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // ============================================================================
  // Care Plan Endpoints
  // ============================================================================

  async generateCarePlan(req, res) {
    try {
      const { clientId, organizationId, clientData } = req.body;
      
      const result = await carePlanService.generateCarePlan(clientId, organizationId, clientData);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async generateSmartGoals(req, res) {
    try {
      const { clientId } = req.params;
      const { outcomeAreas } = req.body;
      
      const result = await carePlanService.generateSmartGoals(clientId, outcomeAreas);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async recommendServices(req, res) {
    try {
      const { clientId } = req.params;
      const { goals, needs } = req.body;
      
      const result = await carePlanService.recommendServices(clientId, goals, needs);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async adaptCarePlan(req, res) {
    try {
      const { planId } = req.params;
      const { progressData } = req.body;
      
      const result = await carePlanService.adaptCarePlan(planId, progressData);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async trackGoalProgress(req, res) {
    try {
      const { goalId } = req.params;
      const { progressData, progressUpdate } = req.body;
      const payload = progressData || progressUpdate || {};
      
      const result = await carePlanService.trackGoalProgress(goalId, payload);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async generateEvidenceBasedRecommendations(req, res) {
    try {
      const clientProfile = req.body.clientProfile || req.body;
      
      const result = await carePlanService.generateEvidenceBasedRecommendations(clientProfile);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // ============================================================================
  // Incident Management Endpoints
  // ============================================================================

  async reportIncident(req, res) {
    try {
      const incidentData = req.body;
      
      const result = await incidentManagementService.reportIncident(incidentData);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async analyzeRootCause(req, res) {
    try {
      const { incidentId } = req.params;
      const { incidentDetails } = req.body;
      
      const result = await incidentManagementService.analyzeRootCause(incidentId, incidentDetails);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async detectPatterns(req, res) {
    try {
      const { organizationId } = req.params;
      const { timeframe, startDate, endDate } = req.body;
      const computedTimeframe = timeframe ||
        (startDate && endDate ? `${startDate} to ${endDate}` : 'last_30_days');
      
      const result = await incidentManagementService.detectPatterns(
        organizationId,
        computedTimeframe
      );
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async predictRecurrence(req, res) {
    try {
      const { incidentId } = req.params;
      const { incidentData } = req.body;
      
      const result = await incidentManagementService.predictRecurrence(incidentId, incidentData);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async generateCorrectiveActions(req, res) {
    try {
      const { incidentId } = req.params;
      const { rootCauses } = req.body;
      
      const result = await incidentManagementService.generateCorrectiveActions(incidentId, rootCauses);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // ============================================================================
  // Medication Management Endpoints
  // ============================================================================

  async checkInteractions(req, res) {
    try {
      const { medications } = req.body;
      
      const result = await medicationService.checkInteractions(medications || []);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async trackCompliance(req, res) {
    try {
      const { clientId } = req.params;
      const { period, startDate, endDate } = req.body;
      const resolvedPeriod = period ||
        (startDate && endDate ? `${startDate} to ${endDate}` : 'last_30_days');
      
      const result = await medicationService.trackCompliance(clientId, resolvedPeriod);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async generateMedicationAlerts(req, res) {
    try {
      const { clientId } = req.params;
      
      const result = await medicationService.generateAlerts(clientId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async optimizeMedicationSchedule(req, res) {
    try {
      const { clientId } = req.params;
      const { medications } = req.body;
      
      const result = await medicationService.optimizeSchedule(clientId, medications);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async monitorSideEffects(req, res) {
    try {
      const { clientId } = req.params;
      const { medications } = req.body;
      
      const result = await medicationService.monitorSideEffects(clientId, medications);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new CareIntelligenceController();
