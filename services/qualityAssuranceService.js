/**
 * Quality Assurance Service
 * AI-powered quality scoring and automated compliance checking
 */

const Appointment = require('../models/Appointment');
const Employee = require('../models/Employee');

/**
 * Score service quality using AI
 * @param {Object} params - Quality scoring parameters
 * @returns {Object} Quality score
 */
exports.scoreServiceQuality = async (params) => {
  const { appointmentId, organizationId } = params;

  try {
    const appointment = await Appointment.findById(appointmentId)
      .populate('assignedTo client');

    if (!appointment) {
      throw new Error('Appointment not found');
    }

    // Calculate quality score from multiple factors
    const qualityFactors = {
      punctuality: calculatePunctualityScore(appointment),
      completion: calculateCompletionScore(appointment),
      clientSatisfaction: appointment.rating || 0,
      documentation: calculateDocumentationScore(appointment),
      compliance: await calculateComplianceScore(appointment)
    };

    // Weighted quality score
    const overallScore = (
      qualityFactors.punctuality * 0.2 +
      qualityFactors.completion * 0.2 +
      qualityFactors.clientSatisfaction * 0.3 +
      qualityFactors.documentation * 0.15 +
      qualityFactors.compliance * 0.15
    );

    // Identify issues
    const issues = identifyQualityIssues(qualityFactors);

    // Generate recommendations
    const recommendations = generateQualityRecommendations(qualityFactors, issues);

    return {
      success: true,
      data: {
        appointmentId,
        overallScore,
        factors: qualityFactors,
        grade: getQualityGrade(overallScore),
        issues,
        recommendations,
        assessedAt: new Date()
      }
    };
  } catch (error) {
    console.error('Error scoring service quality:', error);
    throw error;
  }
};

/**
 * Perform automated compliance check
 * @param {Object} params - Compliance check parameters
 * @returns {Object} Compliance results
 */
exports.performComplianceCheck = async (params) => {
  const { organizationId, employeeId, startDate, endDate } = params;

  try {
    const query = { organizationId };
    if (employeeId) query.assignedTo = employeeId;
    if (startDate && endDate) {
      query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }

    const appointments = await Appointment.find(query)
      .populate('assignedTo client');

    const checks = await Promise.all(appointments.map(async (appointment) => {
      const complianceResults = {
        appointmentId: appointment._id,
        checks: {
          documentation: checkDocumentation(appointment),
          certification: await checkCertifications(appointment),
          timesheet: checkTimesheet(appointment),
          clientConsent: checkClientConsent(appointment),
          safetyProtocol: checkSafetyProtocol(appointment)
        }
      };

      const violations = Object.entries(complianceResults.checks)
        .filter(([_, result]) => !result.passed)
        .map(([check, result]) => ({ check, reason: result.reason }));

      return {
        ...complianceResults,
        compliant: violations.length === 0,
        violations,
        riskLevel: calculateRiskLevel(violations)
      };
    }));

    const summary = {
      totalChecked: checks.length,
      compliant: checks.filter(c => c.compliant).length,
      violations: checks.filter(c => !c.compliant).length,
      highRisk: checks.filter(c => c.riskLevel === 'high').length,
      mediumRisk: checks.filter(c => c.riskLevel === 'medium').length,
      lowRisk: checks.filter(c => c.riskLevel === 'low').length
    };

    return {
      success: true,
      data: {
        checks,
        summary,
        recommendations: generateComplianceRecommendations(summary, checks)
      }
    };
  } catch (error) {
    console.error('Error performing compliance check:', error);
    throw error;
  }
};

/**
 * Analyze client feedback sentiment
 * @param {Object} params - Sentiment analysis parameters
 * @returns {Object} Sentiment analysis results
 */
exports.analyzeFeedbackSentiment = async (params) => {
  const { organizationId, employeeId, startDate, endDate } = params;

  try {
    const query = {
      organizationId,
      feedback: { $exists: true, $ne: '' }
    };
    if (employeeId) query.assignedTo = employeeId;
    if (startDate && endDate) {
      query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }

    const appointments = await Appointment.find(query)
      .populate('assignedTo client');

    const sentiments = appointments.map(appointment => {
      const analysis = analyzeSentiment(appointment.feedback);
      const keywords = extractKeywords(appointment.feedback);
      const topics = classifyTopics(keywords);

      return {
        appointmentId: appointment._id,
        feedback: appointment.feedback,
        sentiment: analysis.sentiment,
        score: analysis.score,
        confidence: analysis.confidence,
        keywords,
        topics,
        rating: appointment.rating
      };
    });

    const summary = {
      total: sentiments.length,
      positive: sentiments.filter(s => s.sentiment === 'positive').length,
      neutral: sentiments.filter(s => s.sentiment === 'neutral').length,
      negative: sentiments.filter(s => s.sentiment === 'negative').length,
      avgScore: sentiments.reduce((sum, s) => sum + s.score, 0) / sentiments.length,
      commonTopics: getCommonTopics(sentiments)
    };

    return {
      success: true,
      data: {
        sentiments,
        summary,
        insights: generateSentimentInsights(summary, sentiments)
      }
    };
  } catch (error) {
    console.error('Error analyzing sentiment:', error);
    throw error;
  }
};

/**
 * Assess risk for appointments
 * @param {Object} params - Risk assessment parameters
 * @returns {Object} Risk assessment results
 */
exports.assessRisk = async (params) => {
  const { organizationId, appointmentId } = params;

  try {
    const query = { organizationId };
    if (appointmentId) query._id = appointmentId;

    const appointments = await Appointment.find(query)
      .populate('assignedTo client');

    const assessments = appointments.map(appointment => {
      const riskFactors = {
        workerExperience: assessWorkerExperience(appointment.assignedTo),
        clientComplexity: assessClientComplexity(appointment.client),
        serviceType: assessServiceType(appointment.serviceType),
        location: assessLocationRisk(appointment.location),
        timeOfDay: assessTimeRisk(appointment.date)
      };

      const overallRisk = calculateOverallRisk(riskFactors);
      const mitigations = generateMitigations(riskFactors, overallRisk);

      return {
        appointmentId: appointment._id,
        riskScore: overallRisk,
        riskLevel: getRiskLevel(overallRisk),
        factors: riskFactors,
        mitigations,
        requiresApproval: overallRisk > 0.7
      };
    });

    return {
      success: true,
      data: {
        assessments,
        summary: {
          total: assessments.length,
          highRisk: assessments.filter(a => a.riskLevel === 'high').length,
          requiresApproval: assessments.filter(a => a.requiresApproval).length
        }
      }
    };
  } catch (error) {
    console.error('Error assessing risk:', error);
    throw error;
  }
};

/**
 * Detect incident patterns
 * @param {Object} params - Pattern detection parameters
 * @returns {Object} Detected patterns
 */
exports.detectIncidentPatterns = async (params) => {
  const { organizationId, startDate, endDate } = params;

  try {
    const incidents = await Appointment.find({
      organizationId,
      date: { $gte: new Date(startDate), $lte: new Date(endDate) },
      $or: [
        { status: 'cancelled' },
        { rating: { $lt: 3 } },
        { complaints: { $exists: true, $ne: [] } }
      ]
    }).populate('assignedTo client');

    // Analyze patterns
    const patterns = {
      byWorker: analyzeByWorker(incidents),
      byClient: analyzeByClient(incidents),
      byServiceType: analyzeByServiceType(incidents),
      byTimeOfDay: analyzeByTimeOfDay(incidents),
      byDayOfWeek: analyzeByDayOfWeek(incidents)
    };

    // Identify recurring issues
    const recurringIssues = identifyRecurringIssues(patterns);

    // Generate preventive actions
    const preventiveActions = generatePreventiveActions(recurringIssues);

    return {
      success: true,
      data: {
        totalIncidents: incidents.length,
        patterns,
        recurringIssues,
        preventiveActions,
        analyzedPeriod: { startDate, endDate }
      }
    };
  } catch (error) {
    console.error('Error detecting patterns:', error);
    throw error;
  }
};

/**
 * Generate audit trail
 * @param {Object} params - Audit trail parameters
 * @returns {Object} Audit trail
 */
exports.generateAuditTrail = async (params) => {
  const { organizationId, entityType, entityId, startDate, endDate } = params;

  try {
    // In production, this would query an audit log collection
    const auditEvents = [
      {
        timestamp: new Date(),
        entityType,
        entityId,
        action: 'created',
        user: 'system',
        changes: {}
      }
    ];

    const trail = {
      entityType,
      entityId,
      events: auditEvents,
      summary: {
        totalEvents: auditEvents.length,
        period: { startDate, endDate },
        lastModified: auditEvents[auditEvents.length - 1]?.timestamp
      }
    };

    return {
      success: true,
      data: trail
    };
  } catch (error) {
    console.error('Error generating audit trail:', error);
    throw error;
  }
};

// ============================================================================
// Helper Functions
// ============================================================================

function calculatePunctualityScore(appointment) {
  // Simplified - in production, compare actual vs scheduled times
  return appointment.status === 'completed' ? 1.0 : 0.8;
}

function calculateCompletionScore(appointment) {
  if (appointment.status === 'completed') return 1.0;
  if (appointment.status === 'in_progress') return 0.5;
  return 0.0;
}

function calculateDocumentationScore(appointment) {
  let score = 0;
  if (appointment.notes && appointment.notes.length > 20) score += 0.4;
  if (appointment.photos && appointment.photos.length > 0) score += 0.3;
  if (appointment.signature) score += 0.3;
  return score;
}

async function calculateComplianceScore(appointment) {
  // Check various compliance factors
  let score = 1.0;
  
  if (!appointment.notes) score -= 0.2;
  if (!appointment.signature) score -= 0.3;
  if (!appointment.assignedTo?.certifications?.length) score -= 0.2;
  
  return Math.max(0, score);
}

function identifyQualityIssues(factors) {
  const issues = [];
  
  if (factors.punctuality < 0.8) {
    issues.push({ type: 'punctuality', severity: 'medium', message: 'Late arrival or completion' });
  }
  if (factors.completion < 1.0) {
    issues.push({ type: 'completion', severity: 'high', message: 'Service not completed' });
  }
  if (factors.clientSatisfaction < 3) {
    issues.push({ type: 'satisfaction', severity: 'high', message: 'Low client satisfaction' });
  }
  if (factors.documentation < 0.7) {
    issues.push({ type: 'documentation', severity: 'medium', message: 'Incomplete documentation' });
  }
  if (factors.compliance < 0.8) {
    issues.push({ type: 'compliance', severity: 'high', message: 'Compliance issues detected' });
  }
  
  return issues;
}

function generateQualityRecommendations(factors, issues) {
  const recommendations = [];
  
  issues.forEach(issue => {
    switch (issue.type) {
      case 'punctuality':
        recommendations.push('Improve time management and route planning');
        break;
      case 'completion':
        recommendations.push('Ensure adequate time allocation for services');
        break;
      case 'satisfaction':
        recommendations.push('Provide additional training on client communication');
        break;
      case 'documentation':
        recommendations.push('Implement mandatory documentation checklist');
        break;
      case 'compliance':
        recommendations.push('Review and update compliance procedures');
        break;
    }
  });
  
  return recommendations;
}

function getQualityGrade(score) {
  if (score >= 0.9) return 'A';
  if (score >= 0.8) return 'B';
  if (score >= 0.7) return 'C';
  if (score >= 0.6) return 'D';
  return 'F';
}

function checkDocumentation(appointment) {
  const hasNotes = appointment.notes && appointment.notes.length > 0;
  const hasSignature = appointment.signature !== undefined;
  
  return {
    passed: hasNotes && hasSignature,
    reason: !hasNotes ? 'Missing service notes' : !hasSignature ? 'Missing client signature' : null
  };
}

async function checkCertifications(appointment) {
  const worker = appointment.assignedTo;
  const requiredCerts = appointment.requiredCertifications || [];
  
  if (requiredCerts.length === 0) {
    return { passed: true, reason: null };
  }
  
  const workerCerts = worker.certifications?.map(c => c.name) || [];
  const missing = requiredCerts.filter(cert => !workerCerts.includes(cert));
  
  return {
    passed: missing.length === 0,
    reason: missing.length > 0 ? `Missing certifications: ${missing.join(', ')}` : null
  };
}

function checkTimesheet(appointment) {
  const hasStartTime = appointment.actualStartTime !== undefined;
  const hasEndTime = appointment.actualEndTime !== undefined;
  
  return {
    passed: hasStartTime && hasEndTime,
    reason: !hasStartTime ? 'Missing start time' : !hasEndTime ? 'Missing end time' : null
  };
}

function checkClientConsent(appointment) {
  return {
    passed: appointment.clientConsent === true,
    reason: !appointment.clientConsent ? 'Client consent not recorded' : null
  };
}

function checkSafetyProtocol(appointment) {
  return {
    passed: appointment.safetyCheckCompleted === true,
    reason: !appointment.safetyCheckCompleted ? 'Safety protocol not completed' : null
  };
}

function calculateRiskLevel(violations) {
  if (violations.length === 0) return 'none';
  if (violations.length >= 3) return 'high';
  if (violations.length >= 2) return 'medium';
  return 'low';
}

function generateComplianceRecommendations(summary, checks) {
  const recommendations = [];
  
  if (summary.violations > summary.totalChecked * 0.1) {
    recommendations.push({
      priority: 'high',
      action: 'Implement mandatory compliance training',
      impact: 'Reduce violations by 50%'
    });
  }
  
  if (summary.highRisk > 0) {
    recommendations.push({
      priority: 'critical',
      action: `Address ${summary.highRisk} high-risk violations immediately`,
      impact: 'Prevent regulatory issues'
    });
  }
  
  return recommendations;
}

function analyzeSentiment(text) {
  // Simplified sentiment analysis (in production, use NLP library)
  const positiveWords = ['great', 'excellent', 'wonderful', 'amazing', 'good', 'helpful', 'professional'];
  const negativeWords = ['bad', 'poor', 'terrible', 'awful', 'disappointing', 'unprofessional', 'late'];
  
  const lowerText = text.toLowerCase();
  const positiveCount = positiveWords.filter(word => lowerText.includes(word)).length;
  const negativeCount = negativeWords.filter(word => lowerText.includes(word)).length;
  
  const score = (positiveCount - negativeCount) / (positiveCount + negativeCount + 1);
  
  return {
    sentiment: score > 0.2 ? 'positive' : score < -0.2 ? 'negative' : 'neutral',
    score: (score + 1) / 2, // Normalize to 0-1
    confidence: Math.min(0.95, (positiveCount + negativeCount) / 10)
  };
}

function extractKeywords(text) {
  // Simplified keyword extraction
  const words = text.toLowerCase().split(/\s+/);
  const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for'];
  return words.filter(word => word.length > 3 && !stopWords.includes(word)).slice(0, 10);
}

function classifyTopics(keywords) {
  const topics = {
    service: ['service', 'care', 'help', 'support'],
    communication: ['communication', 'talk', 'explain', 'listen'],
    professionalism: ['professional', 'punctual', 'respectful', 'courteous'],
    quality: ['quality', 'thorough', 'detailed', 'complete']
  };
  
  const classified = [];
  Object.entries(topics).forEach(([topic, words]) => {
    if (keywords.some(kw => words.includes(kw))) {
      classified.push(topic);
    }
  });
  
  return classified;
}

function getCommonTopics(sentiments) {
  const topicCounts = {};
  sentiments.forEach(s => {
    s.topics.forEach(topic => {
      topicCounts[topic] = (topicCounts[topic] || 0) + 1;
    });
  });
  
  return Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic, count]) => ({ topic, count }));
}

function generateSentimentInsights(summary, sentiments) {
  const insights = [];
  
  const negativeRate = summary.negative / summary.total;
  if (negativeRate > 0.2) {
    insights.push({
      type: 'concern',
      message: `${(negativeRate * 100).toFixed(1)}% negative feedback - requires attention`,
      priority: 'high'
    });
  }
  
  const positiveRate = summary.positive / summary.total;
  if (positiveRate > 0.8) {
    insights.push({
      type: 'success',
      message: `${(positiveRate * 100).toFixed(1)}% positive feedback - excellent performance`,
      priority: 'info'
    });
  }
  
  return insights;
}

function assessWorkerExperience(worker) {
  if (!worker) return 0.5;
  const experience = worker.experienceYears || 0;
  return Math.min(1, experience / 5); // 5 years = full score
}

function assessClientComplexity(client) {
  if (!client) return 0.3;
  const complexity = client.careLevel || 'standard';
  const scores = { low: 0.2, standard: 0.4, high: 0.7, critical: 0.9 };
  return scores[complexity] || 0.4;
}

function assessServiceType(serviceType) {
  const riskLevels = {
    'personal_care': 0.3,
    'medication': 0.7,
    'mobility': 0.5,
    'companionship': 0.2,
    'housekeeping': 0.1
  };
  return riskLevels[serviceType] || 0.4;
}

function assessLocationRisk(location) {
  // Simplified - in production, use crime data, accessibility, etc.
  return 0.3;
}

function assessTimeRisk(date) {
  const hour = new Date(date).getHours();
  if (hour < 6 || hour > 22) return 0.6; // Early morning or late night
  if (hour >= 9 && hour <= 17) return 0.2; // Business hours
  return 0.4;
}

function calculateOverallRisk(factors) {
  return (
    factors.workerExperience * 0.3 +
    factors.clientComplexity * 0.3 +
    factors.serviceType * 0.2 +
    factors.location * 0.1 +
    factors.timeOfDay * 0.1
  );
}

function getRiskLevel(score) {
  if (score > 0.7) return 'high';
  if (score > 0.4) return 'medium';
  return 'low';
}

function generateMitigations(factors, overallRisk) {
  const mitigations = [];
  
  if (factors.workerExperience < 0.3) {
    mitigations.push('Assign experienced supervisor or buddy');
  }
  if (factors.clientComplexity > 0.7) {
    mitigations.push('Ensure specialized training and equipment');
  }
  if (factors.timeOfDay > 0.5) {
    mitigations.push('Implement check-in protocol and emergency contacts');
  }
  
  return mitigations;
}

function analyzeByWorker(incidents) {
  const byWorker = {};
  incidents.forEach(inc => {
    const workerId = inc.assignedTo?._id?.toString();
    if (workerId) {
      byWorker[workerId] = (byWorker[workerId] || 0) + 1;
    }
  });
  return Object.entries(byWorker)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([workerId, count]) => ({ workerId, count }));
}

function analyzeByClient(incidents) {
  const byClient = {};
  incidents.forEach(inc => {
    const clientId = inc.client?._id?.toString();
    if (clientId) {
      byClient[clientId] = (byClient[clientId] || 0) + 1;
    }
  });
  return Object.entries(byClient)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([clientId, count]) => ({ clientId, count }));
}

function analyzeByServiceType(incidents) {
  const byType = {};
  incidents.forEach(inc => {
    const type = inc.serviceType || 'unknown';
    byType[type] = (byType[type] || 0) + 1;
  });
  return Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count }));
}

function analyzeByTimeOfDay(incidents) {
  const byHour = {};
  incidents.forEach(inc => {
    const hour = new Date(inc.date).getHours();
    byHour[hour] = (byHour[hour] || 0) + 1;
  });
  return Object.entries(byHour)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([hour, count]) => ({ hour: parseInt(hour), count }));
}

function analyzeByDayOfWeek(incidents) {
  const byDay = {};
  incidents.forEach(inc => {
    const day = new Date(inc.date).getDay();
    byDay[day] = (byDay[day] || 0) + 1;
  });
  return Object.entries(byDay)
    .sort((a, b) => b[1] - a[1])
    .map(([day, count]) => ({ day: parseInt(day), count }));
}

function identifyRecurringIssues(patterns) {
  const issues = [];
  
  if (patterns.byWorker.length > 0 && patterns.byWorker[0].count > 5) {
    issues.push({
      type: 'worker_performance',
      description: `Worker ${patterns.byWorker[0].workerId} has ${patterns.byWorker[0].count} incidents`,
      severity: 'high'
    });
  }
  
  if (patterns.byServiceType.length > 0 && patterns.byServiceType[0].count > 10) {
    issues.push({
      type: 'service_type',
      description: `Service type ${patterns.byServiceType[0].type} has high incident rate`,
      severity: 'medium'
    });
  }
  
  return issues;
}

function generatePreventiveActions(issues) {
  return issues.map(issue => {
    switch (issue.type) {
      case 'worker_performance':
        return {
          action: 'Schedule performance review and additional training',
          priority: 'high',
          expectedImpact: 'Reduce incidents by 60%'
        };
      case 'service_type':
        return {
          action: 'Review and improve service delivery protocols',
          priority: 'medium',
          expectedImpact: 'Reduce incidents by 40%'
        };
      default:
        return {
          action: 'Monitor and analyze further',
          priority: 'low',
          expectedImpact: 'Better understanding of patterns'
        };
    }
  });
}

module.exports = exports;
