/**
 * Prediction Service
 * Provides ML/statistical models for predictive analytics
 */

/**
 * Predict Worker Churn
 * Analyzes worker metrics to calculate churn probability
 * 
 * @param {Object} metrics - Worker metrics (shifts, no-shows, etc.)
 * @param {Object} worker - Worker details
 * @returns {Object} Churn prediction with score, factors, and recommendations
 */
exports.predictWorkerChurn = (metrics, worker) => {
  const factors = [];
  let churnScore = 0;

  // Factor 1: Shift Acceptance Rate
  const acceptanceRate = metrics.offeredShifts > 0 
    ? (metrics.totalShifts / metrics.offeredShifts) 
    : 1;
  
  if (acceptanceRate < 0.5) {
    const impact = 0.9;
    churnScore += 30 * impact;
    factors.push({
      factor: 'Low shift acceptance',
      impact,
      description: `Accepting only ${(acceptanceRate * 100).toFixed(0)}% of offered shifts`
    });
  } else if (acceptanceRate < 0.7) {
    const impact = 0.6;
    churnScore += 20 * impact;
    factors.push({
      factor: 'Moderate shift acceptance',
      impact,
      description: `Accepting ${(acceptanceRate * 100).toFixed(0)}% of offered shifts`
    });
  }

  // Factor 2: No-Show Rate
  const noShowRate = metrics.totalShifts > 0 
    ? (metrics.noShows / metrics.totalShifts) 
    : 0;
  
  if (noShowRate > 0.1) {
    const impact = 0.8;
    churnScore += 25 * impact;
    factors.push({
      factor: 'High no-show rate',
      impact,
      description: `${metrics.noShows} no-shows in last 30 days (${(noShowRate * 100).toFixed(0)}%)`
    });
  } else if (noShowRate > 0.05) {
    const impact = 0.5;
    churnScore += 15 * impact;
    factors.push({
      factor: 'Moderate no-show rate',
      impact,
      description: `${metrics.noShows} no-shows in last 30 days`
    });
  }

  // Factor 3: Activity Level
  if (metrics.totalShifts < 4) {
    const impact = 0.7;
    churnScore += 20 * impact;
    factors.push({
      factor: 'Low activity',
      impact,
      description: `Only ${metrics.totalShifts} shifts worked in last 30 days`
    });
  }

  // Factor 4: Rating (if available)
  if (metrics.rating && metrics.rating < 3.5) {
    const impact = 0.6;
    churnScore += 15 * impact;
    factors.push({
      factor: 'Low rating',
      impact,
      description: `Current rating: ${metrics.rating.toFixed(1)}/5.0`
    });
  }

  // Factor 5: Days Since Last Shift
  if (metrics.daysSinceLastShift > 14) {
    const impact = 0.8;
    churnScore += 20 * impact;
    factors.push({
      factor: 'Inactive period',
      impact,
      description: `${metrics.daysSinceLastShift} days since last shift`
    });
  }

  // Cap churn score at 100
  churnScore = Math.min(100, churnScore);

  // Determine risk level
  let riskLevel = 'low';
  if (churnScore >= 70) riskLevel = 'high';
  else if (churnScore >= 40) riskLevel = 'medium';

  // Generate recommendations
  const recommendations = [];
  
  if (acceptanceRate < 0.7) {
    recommendations.push('Schedule 1-on-1 meeting to discuss shift preferences');
    recommendations.push('Offer more flexible shift times');
  }
  
  if (noShowRate > 0.05) {
    recommendations.push('Review workload and potential burnout risk');
    recommendations.push('Discuss any barriers to shift attendance');
  }
  
  if (metrics.totalShifts < 4) {
    recommendations.push('Reach out to understand availability concerns');
    recommendations.push('Consider offering training or mentorship');
  }
  
  if (metrics.rating && metrics.rating < 3.5) {
    recommendations.push('Provide additional training and support');
    recommendations.push('Pair with experienced mentor');
  }
  
  if (metrics.daysSinceLastShift > 14) {
    recommendations.push('Contact immediately to check engagement status');
    recommendations.push('Offer re-engagement incentives');
  }

  // If no specific recommendations, add general ones
  if (recommendations.length === 0) {
    recommendations.push('Continue monitoring engagement metrics');
    recommendations.push('Maintain regular check-ins');
  }

  // Calculate predicted churn date (if high risk)
  let predictedDate = null;
  if (churnScore >= 70) {
    predictedDate = new Date();
    predictedDate.setDate(predictedDate.getDate() + 30);
  } else if (churnScore >= 40) {
    predictedDate = new Date();
    predictedDate.setDate(predictedDate.getDate() + 60);
  }

  // Calculate confidence based on data availability
  let confidence = 0.5;
  if (metrics.totalShifts > 10) confidence += 0.2;
  if (metrics.offeredShifts > 10) confidence += 0.2;
  if (metrics.rating) confidence += 0.1;
  confidence = Math.min(1.0, confidence);

  return {
    workerId: worker._id.toString(),
    workerName: `${worker.firstName} ${worker.lastName}`,
    workerEmail: worker.email,
    churnScore: parseFloat(churnScore.toFixed(2)),
    riskLevel,
    factors,
    recommendations,
    predictedDate: predictedDate ? predictedDate.toISOString() : null,
    confidence: parseFloat(confidence.toFixed(2))
  };
};

/**
 * Forecast Demand
 * Predicts future service demand based on historical data
 * 
 * @param {Array} historicalData - Historical appointment data
 * @param {Number} daysAhead - Number of days to forecast
 * @returns {Array} Demand forecast for each day
 */
exports.forecastDemand = (historicalData, daysAhead) => {
  if (!historicalData || historicalData.length === 0) {
    // Return default forecast if no historical data
    const forecast = [];
    for (let i = 1; i <= daysAhead; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);
      
      forecast.push({
        date: date.toISOString(),
        serviceType: 'All',
        predictedAppointments: 20,
        confidence: 0.3,
        peakHours: [9, 10, 14, 15],
        capacityRecommendation: 'Insufficient historical data for accurate prediction'
      });
    }
    return forecast;
  }

  // Calculate average daily appointments
  const totalAppointments = historicalData.reduce((sum, day) => sum + day.totalCount, 0);
  const avgDailyAppointments = totalAppointments / historicalData.length;

  // Calculate day-of-week patterns
  const dayOfWeekCounts = new Array(7).fill(0);
  const dayOfWeekTotals = new Array(7).fill(0);
  
  historicalData.forEach(day => {
    const date = new Date(day._id);
    const dayOfWeek = date.getDay();
    dayOfWeekCounts[dayOfWeek]++;
    dayOfWeekTotals[dayOfWeek] += day.totalCount;
  });

  const dayOfWeekAvg = dayOfWeekCounts.map((count, idx) => 
    count > 0 ? dayOfWeekTotals[idx] / count : avgDailyAppointments
  );

  // Calculate trend (simple linear regression)
  let trend = 0;
  if (historicalData.length >= 7) {
    const recentAvg = historicalData.slice(-7).reduce((sum, day) => sum + day.totalCount, 0) / 7;
    const olderAvg = historicalData.slice(0, 7).reduce((sum, day) => sum + day.totalCount, 0) / 7;
    trend = (recentAvg - olderAvg) / historicalData.length;
  }

  // Extract peak hours from historical data
  const allHours = [];
  historicalData.forEach(day => {
    if (day.allHours) {
      day.allHours.forEach(hourArray => {
        if (Array.isArray(hourArray)) {
          allHours.push(...hourArray);
        }
      });
    }
  });

  // Find most common hours
  const hourCounts = {};
  allHours.forEach(hour => {
    if (hour >= 0 && hour <= 23) {
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    }
  });

  const peakHours = Object.entries(hourCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([hour]) => parseInt(hour))
    .sort((a, b) => a - b);

  // Default peak hours if none found
  const defaultPeakHours = peakHours.length > 0 ? peakHours : [9, 10, 14, 15];

  // Get service type distribution
  const serviceTypeCounts = {};
  historicalData.forEach(day => {
    if (day.serviceTypes) {
      day.serviceTypes.forEach(st => {
        serviceTypeCounts[st.type] = (serviceTypeCounts[st.type] || 0) + st.count;
      });
    }
  });

  const topServiceType = Object.entries(serviceTypeCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'General';

  // Generate forecast
  const forecast = [];
  
  for (let i = 1; i <= daysAhead; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);
    const dayOfWeek = date.getDay();

    // Base prediction on day-of-week average
    let predicted = dayOfWeekAvg[dayOfWeek];

    // Apply trend
    predicted += trend * i;

    // Add some randomness (±10%)
    const variance = predicted * 0.1;
    predicted += (Math.random() - 0.5) * variance;

    // Ensure positive
    predicted = Math.max(1, predicted);

    // Calculate confidence (decreases with distance)
    const confidence = Math.max(0.5, 0.9 - (i / daysAhead) * 0.3);

    // Generate capacity recommendation
    let capacityRecommendation = '';
    if (predicted > avgDailyAppointments * 1.2) {
      const extraWorkers = Math.ceil((predicted - avgDailyAppointments) / 5);
      capacityRecommendation = `High demand expected. Schedule ${extraWorkers} additional workers for peak hours.`;
    } else if (predicted < avgDailyAppointments * 0.8) {
      capacityRecommendation = 'Lower demand expected. Standard staffing should be sufficient.';
    } else {
      capacityRecommendation = 'Normal demand expected. Maintain standard staffing levels.';
    }

    forecast.push({
      date: date.toISOString(),
      serviceType: topServiceType,
      predictedAppointments: parseFloat(predicted.toFixed(1)),
      confidence: parseFloat(confidence.toFixed(2)),
      peakHours: defaultPeakHours,
      capacityRecommendation
    });
  }

  return forecast;
};

/**
 * Assess Compliance Risk
 * Evaluates organization compliance status
 * 
 * @param {Object} complianceData - Organization and worker compliance data
 * @returns {Object} Compliance risk assessment
 */
exports.assessComplianceRisk = (complianceData) => {
  const issues = [];
  const workerRisks = [];
  let totalComplianceScore = 0;
  let workerCount = 0;

  const { workers, organizationSettings } = complianceData;

  // Check each worker's compliance
  workers.forEach(worker => {
    let workerScore = 100;
    const missingItems = [];
    let expiringCount = 0;

    // Check certifications
    const requiredCerts = organizationSettings.requiredCertifications || [];
    requiredCerts.forEach(reqCert => {
      const hasCert = worker.certifications.some(cert => 
        cert.name === reqCert && cert.status === 'valid'
      );
      
      if (!hasCert) {
        workerScore -= 15;
        missingItems.push(reqCert);
      } else {
        // Check if expiring soon (within 30 days)
        const cert = worker.certifications.find(c => c.name === reqCert);
        if (cert && cert.expiryDate) {
          const expiryDate = new Date(cert.expiryDate);
          const daysUntilExpiry = (expiryDate - new Date()) / (1000 * 60 * 60 * 24);
          
          if (daysUntilExpiry < 30 && daysUntilExpiry > 0) {
            expiringCount++;
            workerScore -= 5;
          } else if (daysUntilExpiry <= 0) {
            workerScore -= 15;
            missingItems.push(`${reqCert} (expired)`);
          }
        }
      }
    });

    // Check documents
    const requiredDocs = organizationSettings.requiredDocuments || [];
    requiredDocs.forEach(reqDoc => {
      const hasDoc = worker.documents.some(doc => 
        doc.type === reqDoc && doc.status === 'approved'
      );
      
      if (!hasDoc) {
        workerScore -= 10;
        missingItems.push(reqDoc);
      }
    });

    // Check trainings
    const requiredTrainings = organizationSettings.requiredTrainings || [];
    requiredTrainings.forEach(reqTraining => {
      const hasTraining = worker.trainings.some(training => 
        training.name === reqTraining && training.status === 'completed'
      );
      
      if (!hasTraining) {
        workerScore -= 10;
        missingItems.push(reqTraining);
      }
    });

    // Ensure score doesn't go below 0
    workerScore = Math.max(0, workerScore);

    totalComplianceScore += workerScore;
    workerCount++;

    // Add to at-risk list if score is low
    if (workerScore < 80) {
      workerRisks.push({
        workerId: worker.id,
        workerName: worker.name,
        complianceScore: parseFloat(workerScore.toFixed(2)),
        missingItems,
        expiringCount
      });
    }
  });

  // Calculate overall score
  const overallScore = workerCount > 0 
    ? totalComplianceScore / workerCount 
    : 100;

  // Aggregate issues by type
  const certIssues = [];
  const docIssues = [];
  const trainingIssues = [];

  workerRisks.forEach(worker => {
    worker.missingItems.forEach(item => {
      if (organizationSettings.requiredCertifications.includes(item.replace(' (expired)', ''))) {
        certIssues.push(item);
      } else if (organizationSettings.requiredDocuments.includes(item)) {
        docIssues.push(item);
      } else if (organizationSettings.requiredTrainings.includes(item)) {
        trainingIssues.push(item);
      }
    });
  });

  // Create issue summaries
  if (certIssues.length > 0) {
    const expiringCerts = certIssues.filter(c => c.includes('expired')).length;
    const missingCerts = certIssues.length - expiringCerts;
    
    if (expiringCerts > 0) {
      issues.push({
        type: 'certification',
        description: 'Certifications expired or expiring soon',
        severity: 'high',
        count: expiringCerts,
        dueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString()
      });
    }
    
    if (missingCerts > 0) {
      issues.push({
        type: 'certification',
        description: 'Workers missing required certifications',
        severity: 'critical',
        count: missingCerts,
        dueDate: null
      });
    }
  }

  if (docIssues.length > 0) {
    issues.push({
      type: 'document',
      description: 'Workers missing required documents',
      severity: 'high',
      count: docIssues.length,
      dueDate: null
    });
  }

  if (trainingIssues.length > 0) {
    issues.push({
      type: 'training',
      description: 'Workers missing required training',
      severity: 'medium',
      count: trainingIssues.length,
      dueDate: null
    });
  }

  // Determine risk level
  let riskLevel = 'low';
  if (overallScore < 70) riskLevel = 'high';
  else if (overallScore < 85) riskLevel = 'medium';

  // Calculate audit dates
  const lastAudit = new Date();
  lastAudit.setDate(lastAudit.getDate() - 90); // Assume last audit was 90 days ago
  
  const nextAudit = new Date();
  nextAudit.setDate(nextAudit.getDate() + 90); // Next audit in 90 days

  return {
    organizationId: complianceData.organizationId,
    overallScore: parseFloat(overallScore.toFixed(2)),
    riskLevel,
    issues,
    workerRisks: workerRisks.sort((a, b) => a.complianceScore - b.complianceScore),
    lastAudit: lastAudit.toISOString(),
    nextAudit: nextAudit.toISOString()
  };
};

/**
 * Predict Client Risk
 * Analyzes client metrics to calculate churn/cancellation risk
 * 
 * @param {Object} clientData - Client details and history
 * @param {Object} metrics - Client metrics (payments, cancellations, etc.)
 * @returns {Object} Client risk prediction with score, factors, and recommendations
 */
exports.predictClientRisk = (clientData, metrics) => {
  const factors = [];
  let riskScore = 0;

  // Factor 1: Payment History
  const latePaymentRate = metrics.totalInvoices > 0 
    ? (metrics.latePayments / metrics.totalInvoices) 
    : 0;
  
  if (latePaymentRate > 0.3) {
    const impact = 0.9;
    riskScore += 35 * impact;
    factors.push({
      factor: 'Frequent late payments',
      impact,
      description: `${(latePaymentRate * 100).toFixed(0)}% of invoices paid late`
    });
  } else if (latePaymentRate > 0.15) {
    const impact = 0.6;
    riskScore += 20 * impact;
    factors.push({
      factor: 'Occasional late payments',
      impact,
      description: `${(latePaymentRate * 100).toFixed(0)}% of invoices paid late`
    });
  }

  // Factor 2: Cancellation Rate
  const cancellationRate = metrics.totalAppointments > 0 
    ? (metrics.cancellations / metrics.totalAppointments) 
    : 0;
  
  if (cancellationRate > 0.2) {
    const impact = 0.8;
    riskScore += 30 * impact;
    factors.push({
      factor: 'High cancellation rate',
      impact,
      description: `${(cancellationRate * 100).toFixed(0)}% of appointments cancelled`
    });
  } else if (cancellationRate > 0.1) {
    const impact = 0.5;
    riskScore += 15 * impact;
    factors.push({
      factor: 'Moderate cancellation rate',
      impact,
      description: `${(cancellationRate * 100).toFixed(0)}% of appointments cancelled`
    });
  }

  // Factor 3: Complaint Frequency
  if (metrics.complaints > 2) {
    const impact = 0.7;
    riskScore += 25 * impact;
    factors.push({
      factor: 'Multiple complaints',
      impact,
      description: `${metrics.complaints} complaints in last 90 days`
    });
  } else if (metrics.complaints > 0) {
    const impact = 0.4;
    riskScore += 10 * impact;
    factors.push({
      factor: 'Recent complaints',
      impact,
      description: `${metrics.complaints} complaint(s) in last 90 days`
    });
  }

  // Factor 4: Service Escalation
  if (metrics.escalations > 1) {
    const impact = 0.6;
    riskScore += 20 * impact;
    factors.push({
      factor: 'Service escalations',
      impact,
      description: `${metrics.escalations} escalations in last 90 days`
    });
  }

  // Factor 5: Communication Responsiveness
  if (metrics.avgResponseTime > 48) {
    const impact = 0.5;
    riskScore += 15 * impact;
    factors.push({
      factor: 'Slow communication',
      impact,
      description: `Average response time: ${metrics.avgResponseTime} hours`
    });
  }

  // Factor 6: Service Reduction
  if (metrics.recentAppointments < metrics.historicalAverage * 0.7) {
    const impact = 0.7;
    riskScore += 20 * impact;
    factors.push({
      factor: 'Reduced service usage',
      impact,
      description: `30% decrease in appointments compared to average`
    });
  }

  // Cap risk score at 100
  riskScore = Math.min(100, riskScore);

  // Determine risk level
  let riskLevel = 'low';
  if (riskScore >= 70) riskLevel = 'high';
  else if (riskScore >= 40) riskLevel = 'medium';

  // Generate recommendations
  const recommendations = [];
  
  if (latePaymentRate > 0.15) {
    recommendations.push('Schedule payment plan discussion');
    recommendations.push('Review billing arrangements and payment terms');
  }
  
  if (cancellationRate > 0.1) {
    recommendations.push('Discuss scheduling preferences and barriers');
    recommendations.push('Consider more flexible appointment times');
  }
  
  if (metrics.complaints > 0) {
    recommendations.push('Assign dedicated account manager');
    recommendations.push('Schedule service quality review meeting');
  }
  
  if (metrics.escalations > 0) {
    recommendations.push('Review care plan and service delivery');
    recommendations.push('Ensure worker-client compatibility');
  }
  
  if (metrics.avgResponseTime > 48) {
    recommendations.push('Improve communication channels');
    recommendations.push('Set up regular check-in schedule');
  }
  
  if (metrics.recentAppointments < metrics.historicalAverage * 0.7) {
    recommendations.push('Reach out to understand changing needs');
    recommendations.push('Offer service review and adjustment');
  }

  // If no specific recommendations, add general ones
  if (recommendations.length === 0) {
    recommendations.push('Continue monitoring client satisfaction');
    recommendations.push('Maintain regular communication');
  }

  // Calculate predicted churn date (if high risk)
  let predictedChurnDate = null;
  if (riskScore >= 70) {
    predictedChurnDate = new Date();
    predictedChurnDate.setDate(predictedChurnDate.getDate() + 45);
  } else if (riskScore >= 40) {
    predictedChurnDate = new Date();
    predictedChurnDate.setDate(predictedChurnDate.getDate() + 90);
  }

  // Calculate confidence based on data availability
  let confidence = 0.5;
  if (metrics.totalAppointments > 20) confidence += 0.2;
  if (metrics.totalInvoices > 10) confidence += 0.2;
  if (metrics.monthsAsClient > 6) confidence += 0.1;
  confidence = Math.min(1.0, confidence);

  return {
    clientId: clientData._id.toString(),
    clientName: clientData.name,
    riskScore: parseFloat(riskScore.toFixed(2)),
    riskLevel,
    factors,
    recommendations,
    predictedChurnDate: predictedChurnDate ? predictedChurnDate.toISOString() : null,
    confidence: parseFloat(confidence.toFixed(2)),
    monthsAsClient: metrics.monthsAsClient || 0
  };
};

/**
 * Predict Service Demand by Type
 * Forecasts demand for different service types
 * 
 * @param {Array} historicalData - Historical appointment data by service type
 * @param {Number} daysAhead - Number of days to forecast
 * @returns {Object} Service demand predictions with recommendations
 */
exports.predictServiceDemand = (historicalData, daysAhead) => {
  const predictions = [];
  const serviceTypes = {};

  // Aggregate data by service type
  historicalData.forEach(day => {
    if (day.serviceTypes) {
      day.serviceTypes.forEach(st => {
        if (!serviceTypes[st.type]) {
          serviceTypes[st.type] = {
            total: 0,
            days: 0,
            recent: 0,
            recentDays: 0
          };
        }
        serviceTypes[st.type].total += st.count;
        serviceTypes[st.type].days++;
        
        // Track recent data (last 7 days)
        const dayDate = new Date(day._id);
        const daysSince = (new Date() - dayDate) / (1000 * 60 * 60 * 24);
        if (daysSince <= 7) {
          serviceTypes[st.type].recent += st.count;
          serviceTypes[st.type].recentDays++;
        }
      });
    }
  });

  // Calculate predictions for each service type
  Object.entries(serviceTypes).forEach(([type, data]) => {
    const currentDemand = data.days > 0 ? data.total / data.days : 0;
    const recentDemand = data.recentDays > 0 ? data.recent / data.recentDays : currentDemand;

    // Calculate growth rate
    const growthRate = currentDemand > 0 
      ? (recentDemand - currentDemand) / currentDemand 
      : 0;

    // Project future demand
    const predictedDemand = recentDemand * (1 + growthRate * (daysAhead / 30));

    // Calculate confidence (more data = higher confidence)
    const confidence = Math.min(0.95, 0.5 + (data.days / 60) * 0.45);

    predictions.push({
      serviceType: type,
      currentDemand: parseFloat(currentDemand.toFixed(1)),
      predictedDemand: parseFloat(predictedDemand.toFixed(1)),
      growthRate: parseFloat(growthRate.toFixed(3)),
      confidence: parseFloat(confidence.toFixed(2)),
      trend: growthRate > 0.05 ? 'increasing' : growthRate < -0.05 ? 'decreasing' : 'stable'
    });
  });

  // Sort by predicted demand (highest first)
  predictions.sort((a, b) => b.predictedDemand - a.predictedDemand);

  // Generate recommendations
  const recommendations = [];
  
  predictions.forEach(pred => {
    if (pred.growthRate > 0.15) {
      const workersNeeded = Math.ceil((pred.predictedDemand - pred.currentDemand) / 5);
      recommendations.push(
        `${pred.serviceType}: Growing rapidly (+${(pred.growthRate * 100).toFixed(0)}%). Recruit ${workersNeeded} additional workers.`
      );
    } else if (pred.growthRate < -0.15) {
      recommendations.push(
        `${pred.serviceType}: Declining (${(pred.growthRate * 100).toFixed(0)}%). Consider reallocating capacity.`
      );
    }
  });

  // Add capacity planning recommendation
  const totalCurrent = predictions.reduce((sum, p) => sum + p.currentDemand, 0);
  const totalPredicted = predictions.reduce((sum, p) => sum + p.predictedDemand, 0);
  const overallGrowth = totalCurrent > 0 ? (totalPredicted - totalCurrent) / totalCurrent : 0;

  if (overallGrowth > 0.1) {
    recommendations.push(
      `Overall demand increasing by ${(overallGrowth * 100).toFixed(0)}%. Plan for capacity expansion.`
    );
  } else if (overallGrowth < -0.1) {
    recommendations.push(
      `Overall demand decreasing by ${(Math.abs(overallGrowth) * 100).toFixed(0)}%. Review service offerings.`
    );
  } else {
    recommendations.push('Demand stable. Maintain current capacity levels.');
  }

  return {
    predictions,
    recommendations,
    overallGrowth: parseFloat(overallGrowth.toFixed(3)),
    forecastPeriod: daysAhead
  };
};

/**
 * Generate AI Recommendations
 * Provides actionable recommendations based on all analytics
 * 
 * @param {Object} analyticsData - Combined analytics data
 * @returns {Array} Prioritized recommendations
 */
exports.generateRecommendations = (analyticsData) => {
  const recommendations = [];

  // Worker churn recommendations
  if (analyticsData.churnPredictions && analyticsData.churnPredictions.length > 0) {
    const highRiskWorkers = analyticsData.churnPredictions.filter(p => p.riskLevel === 'high');
    if (highRiskWorkers.length > 0) {
      recommendations.push({
        category: 'Worker Retention',
        priority: 'high',
        title: `${highRiskWorkers.length} workers at high risk of leaving`,
        description: 'Immediate intervention needed to prevent worker churn',
        actions: [
          'Schedule 1-on-1 meetings with at-risk workers',
          'Review compensation and benefits',
          'Address workload and scheduling concerns'
        ],
        expectedImpact: 'Prevent loss of experienced workers, maintain service quality',
        difficulty: 'medium',
        timeframe: '1-2 weeks'
      });
    }
  }

  // Client risk recommendations
  if (analyticsData.clientRisks && analyticsData.clientRisks.length > 0) {
    const highRiskClients = analyticsData.clientRisks.filter(c => c.riskLevel === 'high');
    if (highRiskClients.length > 0) {
      recommendations.push({
        category: 'Client Retention',
        priority: 'high',
        title: `${highRiskClients.length} clients at risk of cancellation`,
        description: 'Proactive engagement needed to retain clients',
        actions: [
          'Assign dedicated account managers',
          'Schedule service review meetings',
          'Address payment and scheduling issues'
        ],
        expectedImpact: 'Retain revenue, improve client satisfaction',
        difficulty: 'medium',
        timeframe: '1-2 weeks'
      });
    }
  }

  // Demand forecast recommendations
  if (analyticsData.serviceDemand) {
    const growingServices = analyticsData.serviceDemand.predictions.filter(p => p.growthRate > 0.15);
    if (growingServices.length > 0) {
      recommendations.push({
        category: 'Capacity Planning',
        priority: 'medium',
        title: `${growingServices.length} service types showing strong growth`,
        description: 'Expand capacity to meet increasing demand',
        actions: [
          `Recruit workers for: ${growingServices.map(s => s.serviceType).join(', ')}`,
          'Increase marketing for high-demand services',
          'Review pricing for growing services'
        ],
        expectedImpact: 'Capture growth opportunities, increase revenue',
        difficulty: 'high',
        timeframe: '4-6 weeks'
      });
    }
  }

  // Compliance recommendations
  if (analyticsData.complianceRisk) {
    if (analyticsData.complianceRisk.riskLevel === 'high') {
      recommendations.push({
        category: 'Compliance',
        priority: 'critical',
        title: 'Compliance score below acceptable threshold',
        description: `Overall compliance score: ${analyticsData.complianceRisk.overallScore}%`,
        actions: [
          'Address critical compliance issues immediately',
          'Schedule worker training sessions',
          'Update expired certifications and documents'
        ],
        expectedImpact: 'Avoid regulatory penalties, maintain service quality',
        difficulty: 'high',
        timeframe: '1-2 weeks'
      });
    }
  }

  // Revenue optimization recommendations
  if (analyticsData.revenueForecast) {
    const forecast = analyticsData.revenueForecast;
    if (forecast.length > 0) {
      const lastForecast = forecast[forecast.length - 1];
      const firstForecast = forecast[0];
      const growthRate = firstForecast.predictedRevenue > 0
        ? (lastForecast.predictedRevenue - firstForecast.predictedRevenue) / firstForecast.predictedRevenue
        : 0;

      if (growthRate < 0) {
        recommendations.push({
          category: 'Revenue Growth',
          priority: 'high',
          title: 'Revenue forecast shows declining trend',
          description: `Projected ${(Math.abs(growthRate) * 100).toFixed(0)}% decrease over forecast period`,
          actions: [
            'Review pricing strategy',
            'Increase client acquisition efforts',
            'Improve service utilization rates'
          ],
          expectedImpact: 'Reverse revenue decline, improve profitability',
          difficulty: 'high',
          timeframe: '4-8 weeks'
        });
      }
    }
  }

  // Sort by priority
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  // Limit to top 5 recommendations
  return recommendations.slice(0, 5);
};

/**
 * Run Scenario Model
 * Simulates different scenarios and their impact
 * 
 * @param {Object} baselineData - Current state data
 * @param {Object} scenario - Scenario parameters
 * @returns {Object} Scenario results
 */
exports.runScenarioModel = (baselineData, scenario) => {
  const results = {
    scenarioName: scenario.name || 'Custom Scenario',
    baseline: {},
    projected: {},
    changes: {},
    recommendations: []
  };

  // Calculate baseline metrics
  results.baseline = {
    monthlyRevenue: baselineData.currentRevenue || 50000,
    monthlyExpenses: baselineData.currentExpenses || 35000,
    monthlyProfit: (baselineData.currentRevenue || 50000) - (baselineData.currentExpenses || 35000),
    workerCount: baselineData.workerCount || 20,
    clientCount: baselineData.clientCount || 50,
    utilizationRate: baselineData.utilizationRate || 0.75,
    avgRevenuePerClient: baselineData.currentRevenue / baselineData.clientCount || 1000
  };

  // Apply scenario changes
  let projectedRevenue = results.baseline.monthlyRevenue;
  let projectedExpenses = results.baseline.monthlyExpenses;
  let projectedWorkers = results.baseline.workerCount;
  let projectedClients = results.baseline.clientCount;
  let projectedUtilization = results.baseline.utilizationRate;

  // Worker count change
  if (scenario.workerCountChange) {
    projectedWorkers += scenario.workerCountChange;
    // More workers = more capacity = potential revenue increase
    const capacityIncrease = scenario.workerCountChange / results.baseline.workerCount;
    projectedRevenue *= (1 + capacityIncrease * 0.8); // 80% efficiency
    // More workers = more expenses
    projectedExpenses += scenario.workerCountChange * 3000; // $3k per worker
  }

  // Rate change
  if (scenario.rateChange) {
    projectedRevenue *= (1 + scenario.rateChange);
    // Rate increase might reduce demand slightly
    if (scenario.rateChange > 0.1) {
      projectedClients *= 0.95; // 5% client loss
    }
  }

  // Client acquisition
  if (scenario.newClients) {
    projectedClients += scenario.newClients;
    projectedRevenue += scenario.newClients * results.baseline.avgRevenuePerClient;
    // New clients require marketing spend
    projectedExpenses += scenario.newClients * 200; // $200 acquisition cost
  }

  // Utilization improvement
  if (scenario.utilizationImprovement) {
    projectedUtilization += scenario.utilizationImprovement;
    projectedUtilization = Math.min(0.95, projectedUtilization); // Cap at 95%
    const utilizationGain = scenario.utilizationImprovement / results.baseline.utilizationRate;
    projectedRevenue *= (1 + utilizationGain);
  }

  // Calculate projected metrics
  results.projected = {
    monthlyRevenue: parseFloat(projectedRevenue.toFixed(2)),
    monthlyExpenses: parseFloat(projectedExpenses.toFixed(2)),
    monthlyProfit: parseFloat((projectedRevenue - projectedExpenses).toFixed(2)),
    workerCount: projectedWorkers,
    clientCount: projectedClients,
    utilizationRate: parseFloat(projectedUtilization.toFixed(2)),
    avgRevenuePerClient: parseFloat((projectedRevenue / projectedClients).toFixed(2))
  };

  // Calculate changes
  results.changes = {
    revenueChange: parseFloat((results.projected.monthlyRevenue - results.baseline.monthlyRevenue).toFixed(2)),
    revenueChangePercent: parseFloat(((results.projected.monthlyRevenue / results.baseline.monthlyRevenue - 1) * 100).toFixed(1)),
    profitChange: parseFloat((results.projected.monthlyProfit - results.baseline.monthlyProfit).toFixed(2)),
    profitChangePercent: parseFloat(((results.projected.monthlyProfit / results.baseline.monthlyProfit - 1) * 100).toFixed(1)),
    workerChange: projectedWorkers - results.baseline.workerCount,
    clientChange: projectedClients - results.baseline.clientCount
  };

  // Generate recommendations
  if (results.changes.profitChange > 0) {
    results.recommendations.push('This scenario shows positive profit impact. Consider implementation.');
  } else {
    results.recommendations.push('This scenario may reduce profitability. Review carefully before proceeding.');
  }

  if (projectedUtilization > 0.9) {
    results.recommendations.push('High utilization rate. Consider hiring additional workers to maintain service quality.');
  }

  if (results.changes.clientChange > 10) {
    results.recommendations.push('Significant client growth. Ensure adequate worker capacity and onboarding processes.');
  }

  return results;
};
