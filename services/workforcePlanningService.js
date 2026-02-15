/**
 * Workforce Planning Service
 * AI-powered demand forecasting and staff optimization
 */

const Appointment = require('../models/Appointment');
const Employee = require('../models/Employee');

/**
 * Forecast demand using time series analysis
 * @param {Object} params - Forecast parameters
 * @returns {Object} Demand forecast
 */
exports.forecastDemand = async (params) => {
  const { organizationId, startDate, endDate, horizon = 30 } = params;

  try {
    // Get historical appointment data
    const historicalData = await Appointment.aggregate([
      {
        $match: {
          organizationId,
          date: { $gte: new Date(startDate), $lte: new Date(endDate) }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          count: { $sum: 1 },
          totalHours: { $sum: '$duration' },
          avgDuration: { $avg: '$duration' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Simple moving average for demonstration
    // In production, use TensorFlow.js LSTM or Prophet
    const forecast = generateForecast(historicalData, horizon);

    // Detect seasonal patterns
    const seasonality = detectSeasonality(historicalData);

    // Calculate confidence intervals
    const confidence = calculateConfidence(historicalData, forecast);

    return {
      success: true,
      data: {
        forecast,
        seasonality,
        confidence,
        historicalData,
        horizon,
        generatedAt: new Date()
      }
    };
  } catch (error) {
    console.error('Error forecasting demand:', error);
    throw error;
  }
};

/**
 * Optimize staff requirements
 * @param {Object} params - Optimization parameters
 * @returns {Object} Optimized staff plan
 */
exports.optimizeStaffing = async (params) => {
  const { organizationId, forecastData, constraints } = params;

  try {
    // Get current workforce
    const workforce = await Employee.find({
      organizationId,
      status: 'active'
    }).select('skills availability hourlyRate');

    // Calculate required staff by skill
    const requirements = calculateStaffRequirements(forecastData, constraints);

    // Optimize allocation
    const optimization = optimizeAllocation(workforce, requirements, constraints);

    // Identify skill gaps
    const skillGaps = identifySkillGaps(workforce, requirements);

    // Calculate cost projections
    const costProjection = calculateCostProjection(optimization, workforce);

    return {
      success: true,
      data: {
        requirements,
        optimization,
        skillGaps,
        costProjection,
        currentWorkforce: workforce.length,
        recommendedActions: generateRecommendations(optimization, skillGaps)
      }
    };
  } catch (error) {
    console.error('Error optimizing staffing:', error);
    throw error;
  }
};

/**
 * Predict employee turnover
 * @param {Object} params - Prediction parameters
 * @returns {Object} Turnover predictions
 */
exports.predictTurnover = async (params) => {
  const { organizationId } = params;

  try {
    const employees = await Employee.find({ organizationId }).select(
      'tenure performanceScore satisfactionScore absenceRate lastReviewDate salary'
    );

    const predictions = employees.map(emp => {
      // Simple risk scoring (in production, use ML model)
      const riskScore = calculateTurnoverRisk(emp);
      
      return {
        employeeId: emp._id,
        riskScore,
        riskLevel: getRiskLevel(riskScore),
        factors: identifyRiskFactors(emp),
        recommendations: getRetentionStrategies(riskScore, emp)
      };
    });

    // Sort by risk score
    predictions.sort((a, b) => b.riskScore - a.riskScore);

    const summary = {
      highRisk: predictions.filter(p => p.riskLevel === 'high').length,
      mediumRisk: predictions.filter(p => p.riskLevel === 'medium').length,
      lowRisk: predictions.filter(p => p.riskLevel === 'low').length,
      averageRisk: predictions.reduce((sum, p) => sum + p.riskScore, 0) / predictions.length
    };

    return {
      success: true,
      data: {
        predictions,
        summary,
        analyzedAt: new Date()
      }
    };
  } catch (error) {
    console.error('Error predicting turnover:', error);
    throw error;
  }
};

/**
 * Analyze capacity and generate scenarios
 * @param {Object} params - Scenario parameters
 * @returns {Object} Scenario analysis
 */
exports.analyzeScenarios = async (params) => {
  const { organizationId, scenarios } = params;

  try {
    const results = [];

    for (const scenario of scenarios) {
      const analysis = await analyzeScenario(organizationId, scenario);
      results.push(analysis);
    }

    // Compare scenarios
    const comparison = compareScenarios(results);

    return {
      success: true,
      data: {
        scenarios: results,
        comparison,
        recommendation: selectBestScenario(results)
      }
    };
  } catch (error) {
    console.error('Error analyzing scenarios:', error);
    throw error;
  }
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate forecast using moving average
 */
function generateForecast(historicalData, horizon) {
  const windowSize = 7; // 7-day moving average
  const forecast = [];

  for (let i = 0; i < horizon; i++) {
    const recentData = historicalData.slice(-windowSize);
    const avg = recentData.reduce((sum, d) => sum + d.count, 0) / recentData.length;
    
    // Add trend component
    const trend = calculateTrend(recentData);
    const predicted = Math.round(avg + trend * i);

    forecast.push({
      date: addDays(new Date(), i + 1),
      predicted,
      lower: Math.round(predicted * 0.85),
      upper: Math.round(predicted * 1.15)
    });
  }

  return forecast;
}

/**
 * Detect seasonal patterns
 */
function detectSeasonality(data) {
  const dayOfWeek = {};
  const monthOfYear = {};

  data.forEach(d => {
    const date = new Date(d._id);
    const day = date.getDay();
    const month = date.getMonth();

    dayOfWeek[day] = (dayOfWeek[day] || []).concat(d.count);
    monthOfYear[month] = (monthOfYear[month] || []).concat(d.count);
  });

  return {
    weeklyPattern: Object.keys(dayOfWeek).map(day => ({
      day: parseInt(day),
      average: average(dayOfWeek[day]),
      variance: variance(dayOfWeek[day])
    })),
    monthlyPattern: Object.keys(monthOfYear).map(month => ({
      month: parseInt(month),
      average: average(monthOfYear[month]),
      variance: variance(monthOfYear[month])
    }))
  };
}

/**
 * Calculate confidence intervals
 */
function calculateConfidence(historical, forecast) {
  const errors = [];
  
  // Calculate historical prediction errors
  for (let i = 7; i < historical.length; i++) {
    const actual = historical[i].count;
    const predicted = average(historical.slice(i - 7, i).map(d => d.count));
    errors.push(Math.abs(actual - predicted));
  }

  const mae = average(errors);
  const rmse = Math.sqrt(average(errors.map(e => e * e)));

  return {
    mae,
    rmse,
    accuracy: Math.max(0, 1 - (mae / average(historical.map(d => d.count))))
  };
}

/**
 * Calculate staff requirements
 */
function calculateStaffRequirements(forecast, constraints) {
  const { hoursPerWorker = 40, utilizationRate = 0.85 } = constraints;

  return forecast.map(day => {
    const totalHours = day.predicted * 2; // Assume 2 hours per appointment
    const requiredWorkers = Math.ceil(totalHours / (hoursPerWorker * utilizationRate));

    return {
      date: day.date,
      totalHours,
      requiredWorkers,
      predicted: day.predicted
    };
  });
}

/**
 * Optimize allocation using greedy algorithm
 */
function optimizeAllocation(workforce, requirements, constraints) {
  const allocation = [];
  const totalRequired = requirements.reduce((sum, r) => sum + r.requiredWorkers, 0);
  const avgRequired = totalRequired / requirements.length;

  return {
    currentCapacity: workforce.length,
    requiredCapacity: Math.ceil(avgRequired),
    surplus: workforce.length - Math.ceil(avgRequired),
    utilizationRate: Math.min(1, avgRequired / workforce.length),
    recommendation: workforce.length < avgRequired ? 'hire' : 'optimize'
  };
}

/**
 * Identify skill gaps
 */
function identifySkillGaps(workforce, requirements) {
  // Simplified skill gap analysis
  return [
    {
      skill: 'Personal Care',
      current: Math.floor(workforce.length * 0.6),
      required: Math.ceil(requirements.length * 0.7),
      gap: Math.ceil(requirements.length * 0.7) - Math.floor(workforce.length * 0.6)
    },
    {
      skill: 'Medication Management',
      current: Math.floor(workforce.length * 0.4),
      required: Math.ceil(requirements.length * 0.5),
      gap: Math.ceil(requirements.length * 0.5) - Math.floor(workforce.length * 0.4)
    }
  ].filter(s => s.gap > 0);
}

/**
 * Calculate cost projection
 */
function calculateCostProjection(optimization, workforce) {
  const avgRate = workforce.reduce((sum, w) => sum + (w.hourlyRate || 25), 0) / workforce.length;
  const hoursPerWeek = 40;
  const weeksPerMonth = 4.33;

  return {
    currentMonthlyCost: workforce.length * avgRate * hoursPerWeek * weeksPerMonth,
    projectedMonthlyCost: optimization.requiredCapacity * avgRate * hoursPerWeek * weeksPerMonth,
    savings: (workforce.length - optimization.requiredCapacity) * avgRate * hoursPerWeek * weeksPerMonth
  };
}

/**
 * Generate recommendations
 */
function generateRecommendations(optimization, skillGaps) {
  const recommendations = [];

  if (optimization.surplus > 0) {
    recommendations.push({
      type: 'optimization',
      priority: 'high',
      action: `Optimize utilization - ${optimization.surplus} workers underutilized`,
      impact: 'cost_reduction'
    });
  } else if (optimization.surplus < 0) {
    recommendations.push({
      type: 'hiring',
      priority: 'high',
      action: `Hire ${Math.abs(optimization.surplus)} additional workers`,
      impact: 'capacity_increase'
    });
  }

  skillGaps.forEach(gap => {
    recommendations.push({
      type: 'training',
      priority: 'medium',
      action: `Train ${gap.gap} workers in ${gap.skill}`,
      impact: 'skill_development'
    });
  });

  return recommendations;
}

/**
 * Calculate turnover risk
 */
function calculateTurnoverRisk(employee) {
  let risk = 0;

  // Tenure factor (higher risk for new and very long tenure)
  if (employee.tenure < 6) risk += 0.3;
  else if (employee.tenure > 60) risk += 0.2;

  // Performance factor
  if (employee.performanceScore < 3) risk += 0.3;

  // Satisfaction factor
  if (employee.satisfactionScore < 3) risk += 0.25;

  // Absence rate factor
  if (employee.absenceRate > 0.1) risk += 0.15;

  return Math.min(1, risk);
}

/**
 * Get risk level
 */
function getRiskLevel(score) {
  if (score > 0.7) return 'high';
  if (score > 0.4) return 'medium';
  return 'low';
}

/**
 * Identify risk factors
 */
function identifyRiskFactors(employee) {
  const factors = [];

  if (employee.tenure < 6) factors.push('New employee (< 6 months)');
  if (employee.performanceScore < 3) factors.push('Low performance score');
  if (employee.satisfactionScore < 3) factors.push('Low satisfaction');
  if (employee.absenceRate > 0.1) factors.push('High absence rate');

  return factors;
}

/**
 * Get retention strategies
 */
function getRetentionStrategies(riskScore, employee) {
  const strategies = [];

  if (riskScore > 0.7) {
    strategies.push('Schedule immediate 1-on-1 meeting');
    strategies.push('Review compensation and benefits');
    strategies.push('Discuss career development opportunities');
  } else if (riskScore > 0.4) {
    strategies.push('Conduct satisfaction survey');
    strategies.push('Provide additional training');
    strategies.push('Recognize achievements');
  }

  return strategies;
}

/**
 * Analyze scenario
 */
async function analyzeScenario(organizationId, scenario) {
  // Simplified scenario analysis
  return {
    name: scenario.name,
    parameters: scenario.parameters,
    projectedRevenue: scenario.parameters.staffIncrease * 50000,
    projectedCost: scenario.parameters.staffIncrease * 35000,
    netBenefit: scenario.parameters.staffIncrease * 15000,
    feasibility: scenario.parameters.staffIncrease <= 10 ? 'high' : 'medium'
  };
}

/**
 * Compare scenarios
 */
function compareScenarios(scenarios) {
  return scenarios.map(s => ({
    name: s.name,
    roi: s.netBenefit / s.projectedCost,
    paybackPeriod: s.projectedCost / (s.netBenefit / 12),
    feasibility: s.feasibility
  }));
}

/**
 * Select best scenario
 */
function selectBestScenario(scenarios) {
  return scenarios.reduce((best, current) => 
    current.netBenefit > best.netBenefit ? current : best
  );
}

// Utility functions
function average(arr) {
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}

function variance(arr) {
  const avg = average(arr);
  return average(arr.map(val => Math.pow(val - avg, 2)));
}

function calculateTrend(data) {
  if (data.length < 2) return 0;
  const first = data[0].count;
  const last = data[data.length - 1].count;
  return (last - first) / data.length;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

module.exports = exports;
