/**
 * Resource Allocation Service
 * Intelligent resource allocation with multi-objective optimization
 */

const Appointment = require('../models/Appointment');
const Employee = require('../models/Employee');

/**
 * Optimize resource allocation
 * @param {Object} params - Allocation parameters
 * @returns {Object} Optimized allocation
 */
exports.optimizeAllocation = async (params) => {
  const { organizationId, date, appointments, constraints } = params;

  try {
    // Get available workers
    const workers = await Employee.find({
      organizationId,
      status: 'active',
      [`availability.${new Date(date).getDay()}`]: true
    }).select('name skills location hourlyRate performanceScore');

    // Get appointments for the date
    const appointmentsData = appointments || await Appointment.find({
      organizationId,
      date: new Date(date),
      status: { $in: ['pending', 'scheduled'] }
    }).populate('client');

    // Calculate allocation scores
    const allocationMatrix = calculateAllocationMatrix(workers, appointmentsData);

    // Optimize using Hungarian algorithm (simplified)
    const optimization = hungarianOptimization(allocationMatrix, constraints);

    // Calculate metrics
    const metrics = calculateAllocationMetrics(optimization, workers, appointmentsData);

    return {
      success: true,
      data: {
        allocations: optimization.allocations,
        metrics,
        unassigned: optimization.unassigned,
        conflicts: optimization.conflicts,
        recommendations: generateAllocationRecommendations(optimization, metrics)
      }
    };
  } catch (error) {
    console.error('Error optimizing allocation:', error);
    throw error;
  }
};

/**
 * Reallocate resources dynamically
 * @param {Object} params - Reallocation parameters
 * @returns {Object} Reallocation result
 */
exports.reallocateResources = async (params) => {
  const { organizationId, triggerId, reason } = params;

  try {
    // Get current allocations
    const currentAllocations = await Appointment.find({
      organizationId,
      date: { $gte: new Date() },
      status: 'scheduled'
    }).populate('assignedTo client');

    // Identify affected appointments
    const affected = identifyAffectedAppointments(currentAllocations, triggerId, reason);

    // Find alternative workers
    const alternatives = await findAlternativeWorkers(affected, organizationId);

    // Reallocate
    const reallocation = performReallocation(affected, alternatives);

    return {
      success: true,
      data: {
        affected: affected.length,
        reallocated: reallocation.success.length,
        failed: reallocation.failed.length,
        details: reallocation.details
      }
    };
  } catch (error) {
    console.error('Error reallocating resources:', error);
    throw error;
  }
};

/**
 * Get allocation recommendations
 * @param {Object} params - Recommendation parameters
 * @returns {Object} Recommendations
 */
exports.getAllocationRecommendations = async (params) => {
  const { organizationId, appointmentId } = params;

  try {
    const appointment = await Appointment.findById(appointmentId).populate('client');
    
    // Get all available workers
    const workers = await Employee.find({
      organizationId,
      status: 'active'
    }).select('name skills location hourlyRate performanceScore availability');

    // Score each worker
    const scores = workers.map(worker => ({
      workerId: worker._id,
      workerName: worker.name,
      score: calculateWorkerScore(worker, appointment),
      factors: getScoreFactors(worker, appointment),
      availability: checkAvailability(worker, appointment.date)
    }));

    // Sort by score
    scores.sort((a, b) => b.score - a.score);

    return {
      success: true,
      data: {
        recommendations: scores.slice(0, 5),
        appointment: {
          id: appointment._id,
          client: appointment.client.name,
          date: appointment.date,
          requiredSkills: appointment.requiredSkills
        }
      }
    };
  } catch (error) {
    console.error('Error getting recommendations:', error);
    throw error;
  }
};

/**
 * Analyze workload balance
 * @param {Object} params - Analysis parameters
 * @returns {Object} Workload analysis
 */
exports.analyzeWorkloadBalance = async (params) => {
  const { organizationId, startDate, endDate } = params;

  try {
    const workers = await Employee.find({ organizationId, status: 'active' });
    
    const workloads = await Promise.all(workers.map(async (worker) => {
      const appointments = await Appointment.countDocuments({
        organizationId,
        assignedTo: worker._id,
        date: { $gte: new Date(startDate), $lte: new Date(endDate) },
        status: { $in: ['scheduled', 'completed'] }
      });

      const hours = await Appointment.aggregate([
        {
          $match: {
            organizationId,
            assignedTo: worker._id,
            date: { $gte: new Date(startDate), $lte: new Date(endDate) }
          }
        },
        {
          $group: {
            _id: null,
            totalHours: { $sum: '$duration' }
          }
        }
      ]);

      return {
        workerId: worker._id,
        workerName: worker.name,
        appointments,
        hours: hours[0]?.totalHours || 0,
        utilization: (hours[0]?.totalHours || 0) / 160 // Assuming 160 hours/month
      };
    }));

    // Calculate balance metrics
    const avgUtilization = average(workloads.map(w => w.utilization));
    const stdDev = standardDeviation(workloads.map(w => w.utilization));
    const balance = 1 - (stdDev / avgUtilization);

    return {
      success: true,
      data: {
        workloads,
        metrics: {
          averageUtilization: avgUtilization,
          standardDeviation: stdDev,
          balanceScore: balance,
          overloaded: workloads.filter(w => w.utilization > 0.9).length,
          underutilized: workloads.filter(w => w.utilization < 0.5).length
        },
        recommendations: generateBalanceRecommendations(workloads, avgUtilization)
      }
    };
  } catch (error) {
    console.error('Error analyzing workload balance:', error);
    throw error;
  }
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate allocation matrix
 */
function calculateAllocationMatrix(workers, appointments) {
  const matrix = [];

  appointments.forEach(appointment => {
    const row = workers.map(worker => {
      const score = calculateWorkerScore(worker, appointment);
      return {
        workerId: worker._id,
        appointmentId: appointment._id,
        score,
        cost: worker.hourlyRate * appointment.duration
      };
    });
    matrix.push(row);
  });

  return matrix;
}

/**
 * Hungarian optimization (simplified greedy approach)
 */
function hungarianOptimization(matrix, constraints) {
  const allocations = [];
  const assigned = new Set();
  const unassigned = [];
  const conflicts = [];

  // Sort appointments by priority
  const sortedMatrix = matrix.sort((a, b) => {
    const maxScoreA = Math.max(...a.map(w => w.score));
    const maxScoreB = Math.max(...b.map(w => w.score));
    return maxScoreB - maxScoreA;
  });

  sortedMatrix.forEach(row => {
    // Find best available worker
    const available = row.filter(w => !assigned.has(w.workerId.toString()));
    
    if (available.length > 0) {
      const best = available.reduce((max, w) => w.score > max.score ? w : max);
      
      allocations.push({
        appointmentId: best.appointmentId,
        workerId: best.workerId,
        score: best.score,
        cost: best.cost
      });
      
      assigned.add(best.workerId.toString());
    } else {
      unassigned.push(row[0].appointmentId);
    }
  });

  return { allocations, unassigned, conflicts };
}

/**
 * Calculate allocation metrics
 */
function calculateAllocationMetrics(optimization, workers, appointments) {
  const totalScore = optimization.allocations.reduce((sum, a) => sum + a.score, 0);
  const avgScore = totalScore / optimization.allocations.length;
  const totalCost = optimization.allocations.reduce((sum, a) => sum + a.cost, 0);

  return {
    totalAllocations: optimization.allocations.length,
    averageScore: avgScore,
    totalCost,
    utilizationRate: optimization.allocations.length / workers.length,
    unassignedCount: optimization.unassigned.length,
    conflictCount: optimization.conflicts.length
  };
}

/**
 * Generate allocation recommendations
 */
function generateAllocationRecommendations(optimization, metrics) {
  const recommendations = [];

  if (metrics.averageScore < 0.7) {
    recommendations.push({
      type: 'quality',
      priority: 'high',
      message: 'Average allocation score is low. Consider hiring more skilled workers.',
      impact: 'quality_improvement'
    });
  }

  if (metrics.unassignedCount > 0) {
    recommendations.push({
      type: 'capacity',
      priority: 'high',
      message: `${metrics.unassignedCount} appointments unassigned. Increase workforce capacity.`,
      impact: 'capacity_increase'
    });
  }

  if (metrics.utilizationRate < 0.6) {
    recommendations.push({
      type: 'efficiency',
      priority: 'medium',
      message: 'Low utilization rate. Optimize scheduling to reduce idle time.',
      impact: 'cost_reduction'
    });
  }

  return recommendations;
}

/**
 * Calculate worker score for appointment
 */
function calculateWorkerScore(worker, appointment) {
  let score = 0;

  // Skill match (40%)
  const skillMatch = calculateSkillMatch(worker.skills, appointment.requiredSkills || []);
  score += skillMatch * 0.4;

  // Distance (30%)
  const distance = calculateDistance(worker.location, appointment.client?.location);
  const distanceScore = Math.max(0, 1 - (distance / 50)); // 50km max
  score += distanceScore * 0.3;

  // Performance (20%)
  score += (worker.performanceScore || 3) / 5 * 0.2;

  // Availability (10%)
  const availabilityScore = checkAvailability(worker, appointment.date) ? 1 : 0;
  score += availabilityScore * 0.1;

  return Math.min(1, score);
}

/**
 * Calculate skill match
 */
function calculateSkillMatch(workerSkills, requiredSkills) {
  if (!requiredSkills || requiredSkills.length === 0) return 1;
  
  const matches = requiredSkills.filter(skill => 
    workerSkills?.some(ws => ws.name === skill)
  );
  
  return matches.length / requiredSkills.length;
}

/**
 * Calculate distance (simplified)
 */
function calculateDistance(loc1, loc2) {
  if (!loc1 || !loc2) return 25; // Default 25km
  
  // Haversine formula
  const R = 6371; // Earth radius in km
  const dLat = toRad(loc2.lat - loc1.lat);
  const dLon = toRad(loc2.lng - loc1.lng);
  
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(toRad(loc1.lat)) * Math.cos(toRad(loc2.lat)) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

/**
 * Check availability
 */
function checkAvailability(worker, date) {
  const dayOfWeek = new Date(date).getDay();
  return worker.availability?.[dayOfWeek] !== false;
}

/**
 * Get score factors
 */
function getScoreFactors(worker, appointment) {
  return {
    skillMatch: calculateSkillMatch(worker.skills, appointment.requiredSkills || []),
    distance: calculateDistance(worker.location, appointment.client?.location),
    performance: worker.performanceScore || 3,
    availability: checkAvailability(worker, appointment.date)
  };
}

/**
 * Identify affected appointments
 */
function identifyAffectedAppointments(allocations, triggerId, reason) {
  if (reason === 'worker_unavailable') {
    return allocations.filter(a => a.assignedTo._id.toString() === triggerId);
  }
  return [];
}

/**
 * Find alternative workers
 */
async function findAlternativeWorkers(affected, organizationId) {
  const alternatives = {};
  
  for (const appointment of affected) {
    const workers = await Employee.find({
      organizationId,
      status: 'active',
      _id: { $ne: appointment.assignedTo._id }
    }).limit(5);
    
    alternatives[appointment._id] = workers;
  }
  
  return alternatives;
}

/**
 * Perform reallocation
 */
function performReallocation(affected, alternatives) {
  const success = [];
  const failed = [];
  
  affected.forEach(appointment => {
    const workers = alternatives[appointment._id];
    if (workers && workers.length > 0) {
      success.push({
        appointmentId: appointment._id,
        oldWorker: appointment.assignedTo._id,
        newWorker: workers[0]._id
      });
    } else {
      failed.push(appointment._id);
    }
  });
  
  return { success, failed, details: { success, failed } };
}

/**
 * Generate balance recommendations
 */
function generateBalanceRecommendations(workloads, avgUtilization) {
  const recommendations = [];
  
  const overloaded = workloads.filter(w => w.utilization > avgUtilization * 1.2);
  const underutilized = workloads.filter(w => w.utilization < avgUtilization * 0.8);
  
  if (overloaded.length > 0) {
    recommendations.push({
      type: 'rebalance',
      priority: 'high',
      message: `${overloaded.length} workers are overloaded. Redistribute appointments.`,
      workers: overloaded.map(w => w.workerName)
    });
  }
  
  if (underutilized.length > 0) {
    recommendations.push({
      type: 'optimize',
      priority: 'medium',
      message: `${underutilized.length} workers are underutilized. Increase their assignments.`,
      workers: underutilized.map(w => w.workerName)
    });
  }
  
  return recommendations;
}

// Utility functions
function average(arr) {
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}

function standardDeviation(arr) {
  const avg = average(arr);
  const squareDiffs = arr.map(val => Math.pow(val - avg, 2));
  return Math.sqrt(average(squareDiffs));
}

function toRad(degrees) {
  return degrees * Math.PI / 180;
}

module.exports = exports;
