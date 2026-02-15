/**
 * Performance Analytics Service
 * Advanced performance tracking and analytics
 */

const Employee = require('../models/Employee');
const Appointment = require('../models/Appointment');

/**
 * Get performance analytics
 * @param {Object} params - Analytics parameters
 * @returns {Object} Performance analytics
 */
exports.getPerformanceAnalytics = async (params) => {
  const { organizationId, employeeId, startDate, endDate } = params;

  try {
    const query = { organizationId };
    if (employeeId) query._id = employeeId;

    const employees = await Employee.find(query).select(
      'name performanceScore skills completedAppointments totalRevenue'
    );

    const analytics = await Promise.all(employees.map(async (emp) => {
      const appointments = await Appointment.find({
        organizationId,
        assignedTo: emp._id,
        date: { $gte: new Date(startDate), $lte: new Date(endDate) },
        status: 'completed'
      });

      const metrics = calculatePerformanceMetrics(emp, appointments);
      const trends = analyzeTrends(appointments);
      const comparison = await compareToPeers(emp, organizationId);

      return {
        employeeId: emp._id,
        employeeName: emp.name,
        metrics,
        trends,
        comparison,
        score: calculateOverallScore(metrics)
      };
    }));

    return {
      success: true,
      data: {
        analytics,
        summary: generateSummary(analytics),
        insights: generateInsights(analytics)
      }
    };
  } catch (error) {
    console.error('Error getting performance analytics:', error);
    throw error;
  }
};

/**
 * Analyze performance trends
 * @param {Object} params - Trend parameters
 * @returns {Object} Trend analysis
 */
exports.analyzePerformanceTrends = async (params) => {
  const { organizationId, employeeId, period = 'monthly' } = params;

  try {
    const appointments = await Appointment.aggregate([
      {
        $match: {
          organizationId,
          assignedTo: employeeId,
          status: 'completed'
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$date' },
            month: { $month: '$date' }
          },
          count: { $sum: 1 },
          avgRating: { $avg: '$rating' },
          totalRevenue: { $sum: '$cost' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    const trends = {
      appointments: detectTrend(appointments.map(a => a.count)),
      rating: detectTrend(appointments.map(a => a.avgRating)),
      revenue: detectTrend(appointments.map(a => a.totalRevenue))
    };

    const anomalies = detectAnomalies(appointments);
    const forecast = forecastPerformance(appointments, 3);

    return {
      success: true,
      data: {
        historical: appointments,
        trends,
        anomalies,
        forecast
      }
    };
  } catch (error) {
    console.error('Error analyzing trends:', error);
    throw error;
  }
};

/**
 * Predict future performance
 * @param {Object} params - Prediction parameters
 * @returns {Object} Performance prediction
 */
exports.predictPerformance = async (params) => {
  const { employeeId, features } = params;

  try {
    const employee = await Employee.findById(employeeId);
    
    // Simple prediction model (in production, use ML model)
    const prediction = {
      predictedScore: calculatePredictedScore(employee, features),
      confidence: 0.85,
      factors: {
        experience: features.experienceYears * 0.2,
        training: features.trainingHours * 0.15,
        recentPerformance: features.recentScore * 0.35,
        clientFeedback: features.avgRating * 0.3
      },
      recommendations: generatePerformanceRecommendations(employee, features)
    };

    return {
      success: true,
      data: prediction
    };
  } catch (error) {
    console.error('Error predicting performance:', error);
    throw error;
  }
};

/**
 * Track skill proficiency
 * @param {Object} params - Skill tracking parameters
 * @returns {Object} Skill proficiency data
 */
exports.trackSkillProficiency = async (params) => {
  const { organizationId, employeeId } = params;

  try {
    const employee = await Employee.findById(employeeId);
    
    const proficiency = employee.skills.map(skill => ({
      skill: skill.name,
      level: skill.level || 'intermediate',
      certifications: skill.certifications || [],
      lastAssessed: skill.lastAssessed || new Date(),
      growthRate: calculateGrowthRate(skill),
      recommendation: getSkillRecommendation(skill)
    }));

    return {
      success: true,
      data: {
        employeeId,
        proficiency,
        overallScore: calculateSkillScore(proficiency),
        gaps: identifySkillGaps(proficiency)
      }
    };
  } catch (error) {
    console.error('Error tracking skill proficiency:', error);
    throw error;
  }
};

// ============================================================================
// Helper Functions
// ============================================================================

function calculatePerformanceMetrics(employee, appointments) {
  const totalAppointments = appointments.length;
  const avgRating = appointments.reduce((sum, a) => sum + (a.rating || 0), 0) / totalAppointments || 0;
  const completionRate = totalAppointments / (employee.completedAppointments || 1);
  const revenue = appointments.reduce((sum, a) => sum + (a.cost || 0), 0);

  return {
    totalAppointments,
    avgRating,
    completionRate,
    revenue,
    revenuePerAppointment: revenue / totalAppointments || 0,
    punctualityScore: 0.95, // Simplified
    qualityScore: avgRating / 5
  };
}

function analyzeTrends(appointments) {
  const monthly = groupByMonth(appointments);
  return {
    direction: monthly.length > 1 && monthly[monthly.length - 1].count > monthly[0].count ? 'up' : 'down',
    growth: calculateGrowthRate(monthly),
    volatility: calculateVolatility(monthly)
  };
}

async function compareToPeers(employee, organizationId) {
  const peers = await Employee.find({
    organizationId,
    _id: { $ne: employee._id }
  }).select('performanceScore');

  const avgPeerScore = peers.reduce((sum, p) => sum + (p.performanceScore || 0), 0) / peers.length;
  const percentile = calculatePercentile(employee.performanceScore, peers.map(p => p.performanceScore));

  return {
    avgPeerScore,
    percentile,
    ranking: percentile > 75 ? 'top' : percentile > 50 ? 'above_average' : 'below_average'
  };
}

function calculateOverallScore(metrics) {
  return (
    metrics.avgRating * 0.3 +
    metrics.completionRate * 0.2 +
    metrics.punctualityScore * 5 * 0.2 +
    metrics.qualityScore * 5 * 0.3
  );
}

function generateSummary(analytics) {
  return {
    totalEmployees: analytics.length,
    avgScore: analytics.reduce((sum, a) => sum + a.score, 0) / analytics.length,
    topPerformers: analytics.filter(a => a.score > 4).length,
    needsImprovement: analytics.filter(a => a.score < 3).length
  };
}

function generateInsights(analytics) {
  const insights = [];
  
  const topPerformer = analytics.reduce((max, a) => a.score > max.score ? a : max);
  insights.push({
    type: 'top_performer',
    message: `${topPerformer.employeeName} is the top performer with score ${topPerformer.score.toFixed(2)}`,
    priority: 'info'
  });

  const needsImprovement = analytics.filter(a => a.score < 3);
  if (needsImprovement.length > 0) {
    insights.push({
      type: 'improvement_needed',
      message: `${needsImprovement.length} employees need performance improvement`,
      priority: 'high'
    });
  }

  return insights;
}

function detectTrend(data) {
  if (data.length < 2) return { direction: 'stable', slope: 0 };
  
  const first = data[0];
  const last = data[data.length - 1];
  const slope = (last - first) / data.length;
  
  return {
    direction: slope > 0.1 ? 'increasing' : slope < -0.1 ? 'decreasing' : 'stable',
    slope,
    change: ((last - first) / first * 100).toFixed(2) + '%'
  };
}

function detectAnomalies(data) {
  const values = data.map(d => d.count);
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const stdDev = Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length);
  
  return data.filter(d => Math.abs(d.count - mean) > 2 * stdDev).map(d => ({
    period: `${d._id.year}-${d._id.month}`,
    value: d.count,
    deviation: ((d.count - mean) / stdDev).toFixed(2)
  }));
}

function forecastPerformance(historical, periods) {
  const values = historical.map(h => h.count);
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
  const trend = (values[values.length - 1] - values[0]) / values.length;
  
  return Array.from({ length: periods }, (_, i) => ({
    period: i + 1,
    predicted: Math.round(avg + trend * (values.length + i)),
    confidence: 0.75 - (i * 0.1)
  }));
}

function calculatePredictedScore(employee, features) {
  return Math.min(5, 
    features.experienceYears * 0.1 +
    features.trainingHours * 0.02 +
    features.recentScore * 0.5 +
    features.avgRating * 0.4
  );
}

function generatePerformanceRecommendations(employee, features) {
  const recommendations = [];
  
  if (features.trainingHours < 20) {
    recommendations.push('Increase training hours to improve skills');
  }
  if (features.avgRating < 4) {
    recommendations.push('Focus on client satisfaction improvement');
  }
  if (features.recentScore < 3.5) {
    recommendations.push('Schedule performance review and coaching session');
  }
  
  return recommendations;
}

function calculateGrowthRate(skill) {
  return 0.15; // Simplified - 15% growth rate
}

function getSkillRecommendation(skill) {
  if (!skill.certifications || skill.certifications.length === 0) {
    return 'Consider obtaining certification';
  }
  return 'Maintain current skill level';
}

function calculateSkillScore(proficiency) {
  const levelScores = { beginner: 1, intermediate: 3, advanced: 4, expert: 5 };
  const scores = proficiency.map(p => levelScores[p.level] || 3);
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}

function identifySkillGaps(proficiency) {
  return proficiency.filter(p => p.level === 'beginner' || !p.certifications.length);
}

function groupByMonth(appointments) {
  const groups = {};
  appointments.forEach(a => {
    const key = `${a.date.getFullYear()}-${a.date.getMonth() + 1}`;
    groups[key] = (groups[key] || 0) + 1;
  });
  return Object.entries(groups).map(([key, count]) => ({ period: key, count }));
}

function calculateVolatility(data) {
  const values = data.map(d => d.count);
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function calculatePercentile(value, dataset) {
  const sorted = dataset.sort((a, b) => a - b);
  const index = sorted.findIndex(v => v >= value);
  return (index / sorted.length) * 100;
}

module.exports = exports;
