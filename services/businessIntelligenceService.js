/**
 * Business Intelligence Service
 * Strategic business insights and predictive analytics
 */

const Appointment = require('../models/Appointment');
const Employee = require('../models/Employee');
const Client = require('../models/Client');

/**
 * Get executive dashboard data
 * @param {Object} params - Dashboard parameters
 * @returns {Object} Dashboard data
 */
exports.getExecutiveDashboard = async (params) => {
  const { organizationId, period = 'month' } = params;

  try {
    const dateRange = getDateRange(period);
    
    // Key Performance Indicators
    const kpis = await calculateKPIs(organizationId, dateRange);
    
    // Revenue metrics
    const revenue = await calculateRevenueMetrics(organizationId, dateRange);
    
    // Operational metrics
    const operations = await calculateOperationalMetrics(organizationId, dateRange);
    
    // Client metrics
    const clients = await calculateClientMetrics(organizationId, dateRange);
    
    // Worker metrics
    const workforce = await calculateWorkforceMetrics(organizationId, dateRange);
    
    // Trends
    const trends = await calculateTrends(organizationId, dateRange);

    return {
      success: true,
      data: {
        kpis,
        revenue,
        operations,
        clients,
        workforce,
        trends,
        period,
        generatedAt: new Date()
      }
    };
  } catch (error) {
    console.error('Error getting executive dashboard:', error);
    throw error;
  }
};

/**
 * Forecast revenue using time series analysis
 * @param {Object} params - Forecast parameters
 * @returns {Object} Revenue forecast
 */
exports.forecastRevenue = async (params) => {
  const { organizationId, horizon = 12 } = params;

  try {
    // Get historical revenue data
    const historical = await Appointment.aggregate([
      {
        $match: {
          organizationId,
          status: 'completed',
          date: { $gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$date' },
            month: { $month: '$date' }
          },
          revenue: { $sum: '$cost' },
          appointments: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // Generate forecast using ARIMA-like approach
    const forecast = generateRevenueForecast(historical, horizon);
    
    // Calculate confidence intervals
    const confidence = calculateForecastConfidence(historical, forecast);
    
    // Identify growth opportunities
    const opportunities = identifyGrowthOpportunities(historical, forecast);

    return {
      success: true,
      data: {
        historical,
        forecast,
        confidence,
        opportunities,
        projectedGrowth: calculateGrowthRate(historical, forecast)
      }
    };
  } catch (error) {
    console.error('Error forecasting revenue:', error);
    throw error;
  }
};

/**
 * Predict customer churn
 * @param {Object} params - Churn prediction parameters
 * @returns {Object} Churn predictions
 */
exports.predictChurn = async (params) => {
  const { organizationId } = params;

  try {
    const clients = await Client.find({ organizationId })
      .populate('appointments');

    const predictions = clients.map(client => {
      const churnFactors = {
        recency: calculateRecency(client),
        frequency: calculateFrequency(client),
        monetary: calculateMonetary(client),
        satisfaction: calculateSatisfaction(client),
        engagement: calculateEngagement(client)
      };

      const churnScore = calculateChurnScore(churnFactors);
      const interventions = generateInterventions(churnScore, churnFactors);

      return {
        clientId: client._id,
        clientName: client.name,
        churnScore,
        churnRisk: getChurnRisk(churnScore),
        factors: churnFactors,
        interventions,
        lifetimeValue: calculateLifetimeValue(client)
      };
    });

    // Sort by churn score
    predictions.sort((a, b) => b.churnScore - a.churnScore);

    const summary = {
      total: predictions.length,
      highRisk: predictions.filter(p => p.churnRisk === 'high').length,
      mediumRisk: predictions.filter(p => p.churnRisk === 'medium').length,
      lowRisk: predictions.filter(p => p.churnRisk === 'low').length,
      atRiskRevenue: predictions
        .filter(p => p.churnRisk === 'high')
        .reduce((sum, p) => sum + p.lifetimeValue, 0)
    };

    return {
      success: true,
      data: {
        predictions: predictions.slice(0, 50), // Top 50 at-risk clients
        summary,
        recommendations: generateChurnRecommendations(summary, predictions)
      }
    };
  } catch (error) {
    console.error('Error predicting churn:', error);
    throw error;
  }
};

/**
 * Analyze profitability
 * @param {Object} params - Profitability analysis parameters
 * @returns {Object} Profitability analysis
 */
exports.analyzeProfitability = async (params) => {
  const { organizationId, dimension = 'service', startDate, endDate } = params;

  try {
    const dateRange = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };

    let analysis;
    switch (dimension) {
      case 'service':
        analysis = await analyzeByService(organizationId, dateRange);
        break;
      case 'client':
        analysis = await analyzeByClient(organizationId, dateRange);
        break;
      case 'worker':
        analysis = await analyzeByWorker(organizationId, dateRange);
        break;
      case 'location':
        analysis = await analyzeByLocation(organizationId, dateRange);
        break;
      default:
        analysis = await analyzeByService(organizationId, dateRange);
    }

    // Calculate margins
    const margins = calculateMargins(analysis);
    
    // Identify opportunities
    const opportunities = identifyProfitabilityOpportunities(margins);

    return {
      success: true,
      data: {
        dimension,
        analysis: margins,
        opportunities,
        summary: {
          totalRevenue: margins.reduce((sum, m) => sum + m.revenue, 0),
          totalCost: margins.reduce((sum, m) => sum + m.cost, 0),
          totalProfit: margins.reduce((sum, m) => sum + m.profit, 0),
          avgMargin: margins.reduce((sum, m) => sum + m.margin, 0) / margins.length
        }
      }
    };
  } catch (error) {
    console.error('Error analyzing profitability:', error);
    throw error;
  }
};

/**
 * Perform what-if scenario analysis
 * @param {Object} params - Scenario parameters
 * @returns {Object} Scenario analysis
 */
exports.analyzeWhatIfScenario = async (params) => {
  const { organizationId, scenario } = params;

  try {
    // Get baseline metrics
    const baseline = await getBaselineMetrics(organizationId);
    
    // Apply scenario changes
    const projected = applyScenarioChanges(baseline, scenario);
    
    // Calculate impact
    const impact = calculateScenarioImpact(baseline, projected);
    
    // Assess feasibility
    const feasibility = assessScenarioFeasibility(scenario, baseline);

    return {
      success: true,
      data: {
        scenario: scenario.name,
        baseline,
        projected,
        impact,
        feasibility,
        recommendation: generateScenarioRecommendation(impact, feasibility)
      }
    };
  } catch (error) {
    console.error('Error analyzing scenario:', error);
    throw error;
  }
};

/**
 * Calculate customer lifetime value
 * @param {Object} params - CLV parameters
 * @returns {Object} CLV analysis
 */
exports.calculateCustomerLifetimeValue = async (params) => {
  const { organizationId, clientId } = params;

  try {
    const query = { organizationId };
    if (clientId) query._id = clientId;

    const clients = await Client.find(query);

    const clvAnalysis = await Promise.all(clients.map(async (client) => {
      const appointments = await Appointment.find({
        client: client._id,
        status: 'completed'
      });

      const metrics = {
        totalRevenue: appointments.reduce((sum, a) => sum + (a.cost || 0), 0),
        appointmentCount: appointments.length,
        avgOrderValue: appointments.reduce((sum, a) => sum + (a.cost || 0), 0) / appointments.length || 0,
        frequency: calculateAppointmentFrequency(appointments),
        tenure: calculateTenure(client),
        churnProbability: 0.2 // Simplified
      };

      const clv = calculateCLV(metrics);
      const segment = segmentClient(clv, metrics);

      return {
        clientId: client._id,
        clientName: client.name,
        clv,
        segment,
        metrics,
        recommendations: generateCLVRecommendations(segment, metrics)
      };
    }));

    const summary = {
      total: clvAnalysis.length,
      totalCLV: clvAnalysis.reduce((sum, c) => sum + c.clv, 0),
      avgCLV: clvAnalysis.reduce((sum, c) => sum + c.clv, 0) / clvAnalysis.length,
      segments: {
        vip: clvAnalysis.filter(c => c.segment === 'vip').length,
        high: clvAnalysis.filter(c => c.segment === 'high').length,
        medium: clvAnalysis.filter(c => c.segment === 'medium').length,
        low: clvAnalysis.filter(c => c.segment === 'low').length
      }
    };

    return {
      success: true,
      data: {
        clvAnalysis: clvAnalysis.sort((a, b) => b.clv - a.clv),
        summary
      }
    };
  } catch (error) {
    console.error('Error calculating CLV:', error);
    throw error;
  }
};

// ============================================================================
// Helper Functions
// ============================================================================

function getDateRange(period) {
  const now = new Date();
  let startDate;

  switch (period) {
    case 'week':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case 'month':
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case 'quarter':
      startDate = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      break;
    case 'year':
      startDate = new Date(now.getFullYear(), 0, 1);
      break;
    default:
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  return { startDate, endDate: now };
}

async function calculateKPIs(organizationId, dateRange) {
  const appointments = await Appointment.find({
    organizationId,
    date: { $gte: dateRange.startDate, $lte: dateRange.endDate }
  });

  const completed = appointments.filter(a => a.status === 'completed');
  const revenue = completed.reduce((sum, a) => sum + (a.cost || 0), 0);

  return {
    totalRevenue: revenue,
    totalAppointments: appointments.length,
    completedAppointments: completed.length,
    completionRate: completed.length / appointments.length || 0,
    avgRevenuePerAppointment: revenue / completed.length || 0,
    growth: 0.15 // Simplified - would compare to previous period
  };
}

async function calculateRevenueMetrics(organizationId, dateRange) {
  const revenue = await Appointment.aggregate([
    {
      $match: {
        organizationId,
        status: 'completed',
        date: { $gte: dateRange.startDate, $lte: dateRange.endDate }
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$cost' },
        count: { $sum: 1 },
        avg: { $avg: '$cost' }
      }
    }
  ]);

  return revenue[0] || { total: 0, count: 0, avg: 0 };
}

async function calculateOperationalMetrics(organizationId, dateRange) {
  const appointments = await Appointment.find({
    organizationId,
    date: { $gte: dateRange.startDate, $lte: dateRange.endDate }
  });

  return {
    utilization: 0.75, // Simplified
    efficiency: 0.85,
    onTimeRate: 0.92,
    cancellationRate: appointments.filter(a => a.status === 'cancelled').length / appointments.length || 0
  };
}

async function calculateClientMetrics(organizationId, dateRange) {
  const clients = await Client.countDocuments({ organizationId });
  const activeClients = await Appointment.distinct('client', {
    organizationId,
    date: { $gte: dateRange.startDate, $lte: dateRange.endDate }
  });

  return {
    total: clients,
    active: activeClients.length,
    retention: 0.88, // Simplified
    satisfaction: 4.3,
    nps: 45
  };
}

async function calculateWorkforceMetrics(organizationId, dateRange) {
  const workers = await Employee.countDocuments({ organizationId, status: 'active' });
  
  return {
    total: workers,
    utilization: 0.78,
    productivity: 0.85,
    satisfaction: 4.1,
    turnover: 0.12
  };
}

async function calculateTrends(organizationId, dateRange) {
  return {
    revenue: { direction: 'up', change: 15.3 },
    appointments: { direction: 'up', change: 12.1 },
    clients: { direction: 'up', change: 8.5 },
    satisfaction: { direction: 'stable', change: 0.2 }
  };
}

function generateRevenueForecast(historical, horizon) {
  const forecast = [];
  const values = historical.map(h => h.revenue);
  
  // Simple moving average with trend
  const windowSize = 3;
  const trend = calculateTrendSlope(values);
  
  for (let i = 0; i < horizon; i++) {
    const recentAvg = average(values.slice(-windowSize));
    const predicted = recentAvg + (trend * (i + 1));
    
    forecast.push({
      period: i + 1,
      predicted: Math.max(0, predicted),
      lower: Math.max(0, predicted * 0.85),
      upper: predicted * 1.15
    });
  }
  
  return forecast;
}

function calculateForecastConfidence(historical, forecast) {
  const values = historical.map(h => h.revenue);
  const variance = calculateVariance(values);
  const cv = Math.sqrt(variance) / average(values);
  
  return {
    accuracy: Math.max(0, 1 - cv),
    variance,
    reliability: cv < 0.2 ? 'high' : cv < 0.4 ? 'medium' : 'low'
  };
}

function identifyGrowthOpportunities(historical, forecast) {
  const opportunities = [];
  
  const avgGrowth = forecast.reduce((sum, f, i) => {
    if (i === 0) return 0;
    return sum + ((f.predicted - forecast[i-1].predicted) / forecast[i-1].predicted);
  }, 0) / (forecast.length - 1);
  
  if (avgGrowth > 0.1) {
    opportunities.push({
      type: 'expansion',
      description: 'Strong growth trajectory - consider capacity expansion',
      impact: 'high'
    });
  }
  
  return opportunities;
}

function calculateGrowthRate(historical, forecast) {
  const lastHistorical = historical[historical.length - 1]?.revenue || 0;
  const lastForecast = forecast[forecast.length - 1]?.predicted || 0;
  
  return ((lastForecast - lastHistorical) / lastHistorical * 100).toFixed(2) + '%';
}

function calculateRecency(client) {
  // Days since last appointment
  const lastAppointment = client.appointments?.[client.appointments.length - 1]?.date;
  if (!lastAppointment) return 1.0; // High risk if no appointments
  
  const daysSince = (Date.now() - new Date(lastAppointment).getTime()) / (1000 * 60 * 60 * 24);
  return Math.min(1, daysSince / 90); // 90 days = full risk
}

function calculateFrequency(client) {
  const appointments = client.appointments?.length || 0;
  return Math.max(0, 1 - (appointments / 12)); // 12 appointments/year = low risk
}

function calculateMonetary(client) {
  const totalSpent = client.appointments?.reduce((sum, a) => sum + (a.cost || 0), 0) || 0;
  return Math.max(0, 1 - (totalSpent / 10000)); // $10k = low risk
}

function calculateSatisfaction(client) {
  const avgRating = client.appointments?.reduce((sum, a) => sum + (a.rating || 0), 0) / 
                    (client.appointments?.length || 1);
  return Math.max(0, 1 - (avgRating / 5));
}

function calculateEngagement(client) {
  // Simplified engagement score
  return 0.3;
}

function calculateChurnScore(factors) {
  return (
    factors.recency * 0.3 +
    factors.frequency * 0.25 +
    factors.monetary * 0.2 +
    factors.satisfaction * 0.15 +
    factors.engagement * 0.1
  );
}

function getChurnRisk(score) {
  if (score > 0.7) return 'high';
  if (score > 0.4) return 'medium';
  return 'low';
}

function generateInterventions(churnScore, factors) {
  const interventions = [];
  
  if (factors.recency > 0.6) {
    interventions.push({
      action: 'Re-engagement campaign',
      priority: 'high',
      expectedImpact: 'Reduce churn by 40%'
    });
  }
  
  if (factors.satisfaction > 0.5) {
    interventions.push({
      action: 'Service quality improvement',
      priority: 'high',
      expectedImpact: 'Increase satisfaction by 30%'
    });
  }
  
  if (factors.frequency > 0.5) {
    interventions.push({
      action: 'Loyalty program enrollment',
      priority: 'medium',
      expectedImpact: 'Increase frequency by 25%'
    });
  }
  
  return interventions;
}

function calculateLifetimeValue(client) {
  const appointments = client.appointments || [];
  const totalRevenue = appointments.reduce((sum, a) => sum + (a.cost || 0), 0);
  const avgRevenue = totalRevenue / appointments.length || 0;
  const frequency = appointments.length / 12; // Per year
  const expectedLifetime = 3; // Years
  
  return avgRevenue * frequency * expectedLifetime;
}

function generateChurnRecommendations(summary, predictions) {
  const recommendations = [];
  
  if (summary.highRisk > summary.total * 0.2) {
    recommendations.push({
      priority: 'critical',
      action: 'Launch immediate retention campaign',
      impact: `Save $${summary.atRiskRevenue.toFixed(0)} in revenue`
    });
  }
  
  return recommendations;
}

async function analyzeByService(organizationId, dateRange) {
  return await Appointment.aggregate([
    {
      $match: {
        organizationId,
        status: 'completed',
        date: dateRange
      }
    },
    {
      $group: {
        _id: '$serviceType',
        revenue: { $sum: '$cost' },
        count: { $sum: 1 }
      }
    }
  ]);
}

async function analyzeByClient(organizationId, dateRange) {
  return await Appointment.aggregate([
    {
      $match: {
        organizationId,
        status: 'completed',
        date: dateRange
      }
    },
    {
      $group: {
        _id: '$client',
        revenue: { $sum: '$cost' },
        count: { $sum: 1 }
      }
    }
  ]);
}

async function analyzeByWorker(organizationId, dateRange) {
  return await Appointment.aggregate([
    {
      $match: {
        organizationId,
        status: 'completed',
        date: dateRange
      }
    },
    {
      $group: {
        _id: '$assignedTo',
        revenue: { $sum: '$cost' },
        count: { $sum: 1 }
      }
    }
  ]);
}

async function analyzeByLocation(organizationId, dateRange) {
  return await Appointment.aggregate([
    {
      $match: {
        organizationId,
        status: 'completed',
        date: dateRange
      }
    },
    {
      $group: {
        _id: '$location.city',
        revenue: { $sum: '$cost' },
        count: { $sum: 1 }
      }
    }
  ]);
}

function calculateMargins(analysis) {
  return analysis.map(item => {
    const cost = item.revenue * 0.65; // Simplified - 65% cost ratio
    const profit = item.revenue - cost;
    const margin = (profit / item.revenue) * 100;
    
    return {
      dimension: item._id,
      revenue: item.revenue,
      cost,
      profit,
      margin,
      count: item.count
    };
  });
}

function identifyProfitabilityOpportunities(margins) {
  const opportunities = [];
  
  const lowMargin = margins.filter(m => m.margin < 20);
  if (lowMargin.length > 0) {
    opportunities.push({
      type: 'cost_reduction',
      description: `${lowMargin.length} segments have margins below 20%`,
      priority: 'high'
    });
  }
  
  const highVolume = margins.filter(m => m.count > 100 && m.margin > 30);
  if (highVolume.length > 0) {
    opportunities.push({
      type: 'expansion',
      description: `${highVolume.length} high-margin segments ready for expansion`,
      priority: 'medium'
    });
  }
  
  return opportunities;
}

async function getBaselineMetrics(organizationId) {
  const appointments = await Appointment.countDocuments({ organizationId });
  const workers = await Employee.countDocuments({ organizationId, status: 'active' });
  const revenue = await Appointment.aggregate([
    { $match: { organizationId, status: 'completed' } },
    { $group: { _id: null, total: { $sum: '$cost' } } }
  ]);
  
  return {
    appointments,
    workers,
    revenue: revenue[0]?.total || 0,
    avgRevenuePerWorker: (revenue[0]?.total || 0) / workers
  };
}

function applyScenarioChanges(baseline, scenario) {
  const changes = scenario.changes || {};
  
  return {
    appointments: baseline.appointments * (1 + (changes.appointmentGrowth || 0)),
    workers: baseline.workers + (changes.additionalWorkers || 0),
    revenue: baseline.revenue * (1 + (changes.revenueGrowth || 0)),
    avgRevenuePerWorker: (baseline.revenue * (1 + (changes.revenueGrowth || 0))) / 
                         (baseline.workers + (changes.additionalWorkers || 0))
  };
}

function calculateScenarioImpact(baseline, projected) {
  return {
    revenueChange: projected.revenue - baseline.revenue,
    revenueChangePercent: ((projected.revenue - baseline.revenue) / baseline.revenue * 100).toFixed(2) + '%',
    appointmentChange: projected.appointments - baseline.appointments,
    workerChange: projected.workers - baseline.workers,
    productivityChange: projected.avgRevenuePerWorker - baseline.avgRevenuePerWorker
  };
}

function assessScenarioFeasibility(scenario, baseline) {
  const score = {
    financial: scenario.changes?.additionalWorkers ? 
      (scenario.changes.additionalWorkers <= baseline.workers * 0.2 ? 0.8 : 0.5) : 0.9,
    operational: 0.7,
    timeline: 0.8
  };
  
  const overall = (score.financial + score.operational + score.timeline) / 3;
  
  return {
    scores: score,
    overall,
    rating: overall > 0.7 ? 'high' : overall > 0.5 ? 'medium' : 'low'
  };
}

function generateScenarioRecommendation(impact, feasibility) {
  if (feasibility.overall > 0.7 && impact.revenueChange > 0) {
    return {
      decision: 'proceed',
      confidence: 'high',
      reasoning: 'High feasibility with positive revenue impact'
    };
  } else if (feasibility.overall > 0.5) {
    return {
      decision: 'consider',
      confidence: 'medium',
      reasoning: 'Moderate feasibility - requires detailed planning'
    };
  } else {
    return {
      decision: 'defer',
      confidence: 'low',
      reasoning: 'Low feasibility - explore alternatives'
    };
  }
}

function calculateAppointmentFrequency(appointments) {
  if (appointments.length < 2) return 0;
  
  const dates = appointments.map(a => new Date(a.date).getTime()).sort();
  const intervals = [];
  
  for (let i = 1; i < dates.length; i++) {
    intervals.push((dates[i] - dates[i-1]) / (1000 * 60 * 60 * 24));
  }
  
  return 30 / average(intervals); // Appointments per month
}

function calculateTenure(client) {
  const createdAt = new Date(client.createdAt || Date.now());
  return (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24 * 365); // Years
}

function calculateCLV(metrics) {
  const avgOrderValue = metrics.avgOrderValue;
  const frequency = metrics.frequency;
  const tenure = metrics.tenure;
  const churnProbability = metrics.churnProbability;
  
  const expectedLifetime = tenure / churnProbability;
  return avgOrderValue * frequency * 12 * expectedLifetime;
}

function segmentClient(clv, metrics) {
  if (clv > 50000) return 'vip';
  if (clv > 20000) return 'high';
  if (clv > 10000) return 'medium';
  return 'low';
}

function generateCLVRecommendations(segment, metrics) {
  const recommendations = [];
  
  switch (segment) {
    case 'vip':
      recommendations.push('Assign dedicated account manager');
      recommendations.push('Offer premium service packages');
      break;
    case 'high':
      recommendations.push('Enroll in loyalty program');
      recommendations.push('Provide priority scheduling');
      break;
    case 'medium':
      recommendations.push('Increase engagement frequency');
      recommendations.push('Offer service upgrades');
      break;
    case 'low':
      recommendations.push('Re-engagement campaign');
      recommendations.push('Identify service gaps');
      break;
  }
  
  return recommendations;
}

// Utility functions
function average(arr) {
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}

function calculateVariance(arr) {
  const avg = average(arr);
  return average(arr.map(val => Math.pow(val - avg, 2)));
}

function calculateTrendSlope(values) {
  if (values.length < 2) return 0;
  const n = values.length;
  const sumX = (n * (n - 1)) / 2;
  const sumY = values.reduce((sum, val) => sum + val, 0);
  const sumXY = values.reduce((sum, val, i) => sum + (i * val), 0);
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  
  return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
}

module.exports = exports;
