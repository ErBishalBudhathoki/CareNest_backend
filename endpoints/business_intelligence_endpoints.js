const { Invoice } = require('../models/Invoice');
const InvoiceLineItem = require('../models/InvoiceLineItem');
const logger = require('../config/logger');

/**
 * Get Business Intelligence Dashboard
 */
async function getBusinessIntelligenceDashboard(req, res) {
  try {
    const { organizationId } = req.params;

    // 1. Revenue Trends
    const revenueForecast = await generateRevenueForecast(organizationId, {}, 3);

    // 2. Operational Efficiency
    const efficiency = await getOperationalEfficiencyInsights(organizationId, {});

    // 3. Risk Factors
    const riskFactors = await identifyRevenueRiskFactors(organizationId);

    // 4. Seasonality
    const seasonality = await analyzeSeasonalityPatterns(organizationId);

    // 5. Recommendations
    const recommendations = [
      ...generateForecastRecommendations(revenueForecast, seasonality, riskFactors),
      ...generateOptimizationSuggestions(efficiency, [])
    ];

    res.json({
      success: true,
      data: {
        revenueForecast,
        efficiency,
        riskFactors,
        seasonality,
        recommendations
      }
    });

  } catch (error) {
    logger.error('Error generating BI dashboard', {
      error: error.message,
      stack: error.stack,
      organizationId: req.params.organizationId
    });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * Get Revenue Forecast Analysis
 */
async function getRevenueForecastAnalysis(req, res) {
  try {
    const { organizationId } = req.params;
    const { periods = 6, confidence = 0.95 } = req.query;

    const forecast = await generateDetailedRevenueForecast(organizationId, parseInt(periods), parseFloat(confidence));

    res.json({
      success: true,
      data: forecast
    });

  } catch (error) {
    logger.error('Error generating revenue forecast', {
      error: error.message,
      stack: error.stack,
      organizationId: req.params.organizationId
    });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * Get Operational Efficiency Report
 */
async function getOperationalEfficiencyReport(req, res) {
  try {
    const { organizationId } = req.params;

    const efficiency = await getOperationalEfficiencyInsights(organizationId, {});
    const bottlenecks = await identifyPerformanceBottlenecks(organizationId, {});
    const suggestions = generateOptimizationSuggestions(efficiency, bottlenecks);
    const benchmarks = generateEfficiencyBenchmarks(efficiency);

    res.json({
      success: true,
      data: {
        efficiency,
        bottlenecks,
        suggestions,
        benchmarks
      }
    });

  } catch (error) {
    logger.error('Error generating efficiency report', {
      error: error.message,
      stack: error.stack,
      organizationId: req.params.organizationId
    });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// --- Helper Functions ---

async function generateRevenueForecast(organizationId, dateFilter, _periods) {
  // Basic linear regression forecast
  const historicalData = await InvoiceLineItem.aggregate([
    { $match: { organizationId, ...dateFilter } },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' }
        },
        revenue: { $sum: '$totalPrice' }
      }
    },
    { $sort: { '_id.year': 1, '_id.month': 1 } }
  ]);

  const dataPoints = historicalData.map((d, i) => ({ x: i, y: d.revenue }));
  const n = dataPoints.length;

  let slope = 0, intercept = 0;
  if (n > 1) {
    const sumX = dataPoints.reduce((sum, p) => sum + p.x, 0);
    const sumY = dataPoints.reduce((sum, p) => sum + p.y, 0);
    const sumXY = dataPoints.reduce((sum, p) => sum + p.x * p.y, 0);
    const sumXX = dataPoints.reduce((sum, p) => sum + p.x * p.x, 0);

    slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    intercept = (sumY - slope * sumX) / n;
  }

  const avgMonthlyRevenue = n > 0 ? dataPoints.reduce((sum, p) => sum + p.y, 0) / n : 0;

  return {
    historicalData: historicalData.map(d => ({
      period: `${d._id.year}-${d._id.month}`,
      revenue: d.revenue
    })),
    currentPeriod: {
      avgMonthlyRevenue
    },
    forecast: {
      slope,
      intercept,
      trend: slope > 0 ? 'increasing' : 'decreasing'
    },
    trendAnalysis: {
      direction: slope > 0 ? 'increasing' : 'decreasing'
    }
  };
}

async function getOperationalEfficiencyInsights(organizationId, _dateFilter) {
  // Mock efficiency calculation based on invoice processing time or similar
  const invoices = await Invoice.find({ organizationId }).lean();
  const totalInvoices = invoices.length;
  const processedInvoices = invoices.filter(i => i.status === 'processed').length;

  return {
    overallMetrics: {
      utilizationRate: 85, // Mock value
      revenuePerEmployee: 12500 // Mock value
    },
    efficiency: {
      overallEfficiencyScore: (processedInvoices / (totalInvoices || 1)) * 100
    }
  };
}

async function identifyPerformanceBottlenecks(_organizationId, _dateFilter) {
  return [
    { type: 'process', description: 'Invoice approval delay detected' }
  ];
}

/**
 * Generate detailed revenue forecast
 */
async function generateDetailedRevenueForecast(organizationId, periods, confidence) {
  // Reuse the base logic but add more detail
  const dateFilter = {}; // Use all history for detailed forecast
  const baseForecast = await generateRevenueForecast(organizationId, dateFilter, periods);

  // Add confidence intervals
  const stdDev = Math.sqrt(
    baseForecast.historicalData.reduce((sum, d) => {
      const mean = baseForecast.currentPeriod.avgMonthlyRevenue;
      return sum + Math.pow(d.revenue - mean, 2);
    }, 0) / (baseForecast.historicalData.length || 1)
  );

  const zScore = confidence === 0.99 ? 2.576 : confidence === 0.95 ? 1.96 : 1.645;
  const marginOfError = zScore * (stdDev / Math.sqrt(baseForecast.historicalData.length || 1));

  const predictions = [];
  for (let i = 1; i <= periods; i++) {
    const predictedRevenue = baseForecast.forecast.slope * (baseForecast.historicalData.length + i) + baseForecast.forecast.intercept;
    predictions.push({
      period: i,
      revenue: predictedRevenue,
      lowerBound: predictedRevenue - marginOfError,
      upperBound: predictedRevenue + marginOfError
    });
  }

  return {
    ...baseForecast,
    predictions,
    marginOfError,
    confidenceLevel: confidence
  };
}

/**
 * Analyze seasonality patterns
 */
async function analyzeSeasonalityPatterns(organizationId) {
  const historicalData = await InvoiceLineItem.aggregate([
    {
      $match: { organizationId }
    },
    {
      $group: {
        _id: { month: { $month: '$createdAt' } },
        revenue: { $avg: '$totalPrice' },
        count: { $sum: 1 }
      }
    },
    { $sort: { '_id.month': 1 } }
  ]);

  const totalRevenue = historicalData.reduce((sum, h) => sum + h.revenue, 0);
  const avgRevenue = totalRevenue / (historicalData.length || 1);

  const seasonalIndices = historicalData.map(d => ({
    month: d._id.month,
    index: avgRevenue > 0 ? d.revenue / avgRevenue : 1,
    avgRevenue: d.revenue
  }));

  return {
    hasSeasonality: seasonalIndices.some(s => s.index > 1.2 || s.index < 0.8),
    seasonalIndices,
    peakMonths: seasonalIndices.filter(s => s.index > 1.1).map(s => s.month),
    lowMonths: seasonalIndices.filter(s => s.index < 0.9).map(s => s.month)
  };
}

/**
 * Identify revenue risk factors
 */
async function identifyRevenueRiskFactors(organizationId) {
  const risks = [];

  // Check client concentration
  const clientRevenue = await InvoiceLineItem.aggregate([
    { $match: { organizationId } },
    {
      $group: {
        _id: '$clientId',
        revenue: { $sum: '$totalPrice' }
      }
    },
    { $sort: { revenue: -1 } }
  ]);

  const totalRevenue = clientRevenue.reduce((sum, c) => sum + c.revenue, 0);
  if (clientRevenue.length > 0 && totalRevenue > 0) {
    const topClientShare = clientRevenue[0].revenue / totalRevenue;
    if (topClientShare > 0.2) {
      risks.push({
        type: 'client_concentration',
        severity: 'high',
        description: `Top client contributes ${(topClientShare * 100).toFixed(1)}% of total revenue`
      });
    }
  }

  return risks;
}

/**
 * Generate forecast recommendations
 */
function generateForecastRecommendations(forecast, seasonality, riskFactors) {
  const recommendations = [];

  if (forecast.trendAnalysis.direction === 'decreasing') {
    recommendations.push({
      priority: 'high',
      category: 'revenue',
      action: 'Immediate action required to reverse declining revenue trend'
    });
  }

  if (seasonality.hasSeasonality) {
    recommendations.push({
      priority: 'medium',
      category: 'planning',
      action: `Prepare for peak demand in months: ${seasonality.peakMonths.join(', ')}`
    });
  }

  riskFactors.forEach(risk => {
    recommendations.push({
      priority: risk.severity === 'high' ? 'high' : 'medium',
      category: 'risk',
      action: `Mitigate risk: ${risk.description}`
    });
  });

  return recommendations;
}

/**
 * Calculate operational efficiency (Alias to getOperationalEfficiencyInsights for consistency)
 */
async function calculateOperationalEfficiency(organizationId, dateFilter) {
  return getOperationalEfficiencyInsights(organizationId, dateFilter);
}

/**
 * Identify operational bottlenecks (Alias to identifyPerformanceBottlenecks for consistency)
 */
async function identifyOperationalBottlenecks(organizationId, dateFilter) {
  return identifyPerformanceBottlenecks(organizationId, dateFilter);
}

/**
 * Generate optimization suggestions
 */
function generateOptimizationSuggestions(efficiency, bottlenecks) {
  const suggestions = [];

  // Suggestion based on utilization
  const utilization = efficiency.overallMetrics?.utilizationRate || 0;
  if (utilization < 70) {
    suggestions.push({
      priority: 'medium',
      category: 'efficiency',
      action: 'Increase billable hours target per employee',
      potentialImpact: 'High revenue growth'
    });
  } else if (utilization > 95) {
    suggestions.push({
      priority: 'medium',
      category: 'hr',
      action: 'Hire more staff to prevent burnout',
      potentialImpact: 'Sustainable growth'
    });
  }

  // Suggestion based on bottlenecks
  bottlenecks.forEach(bottleneck => {
    suggestions.push({
      priority: 'high',
      category: 'operations',
      action: `Resolve ${bottleneck.type}: ${bottleneck.description}`,
      potentialImpact: 'Efficiency improvement'
    });
  });

  if (efficiency.efficiency && efficiency.efficiency.overallEfficiencyScore < 60) {
    suggestions.push({
      priority: 'medium',
      category: 'efficiency',
      action: 'Review operational processes and employee productivity'
    });
  }

  return suggestions;
}

/**
 * Generate efficiency benchmarks
 */
function generateEfficiencyBenchmarks(efficiency) {
  return {
    industryAvgUtilization: 75,
    industryAvgRevenuePerEmployee: 150000, // Annualized
    organizationUtilization: efficiency.overallMetrics?.utilizationRate || 0,
    organizationRevenuePerEmployee: (efficiency.overallMetrics?.revenuePerEmployee || 0) * 12, // Annualized estimate
    status: (efficiency.overallMetrics?.utilizationRate || 0) > 75 ? 'above_average' : 'below_average'
  };
}

module.exports = {
  getBusinessIntelligenceDashboard,
  getRevenueForecastAnalysis,
  getOperationalEfficiencyReport,
  generateDetailedRevenueForecast,
  analyzeSeasonalityPatterns,
  identifyRevenueRiskFactors,
  generateForecastRecommendations,
  calculateOperationalEfficiency,
  identifyOperationalBottlenecks,
  generateOptimizationSuggestions,
  generateEfficiencyBenchmarks
};
