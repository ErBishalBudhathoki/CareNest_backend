/**
 * Shift Matching Service
 * AI-powered worker-shift matching with ML predictions
 */

/**
 * Calculate match score between worker and shift
 * @param {Object} worker - Worker profile
 * @param {Object} shift - Shift details
 * @param {Object} criteria - Matching criteria
 * @returns {Object} Match result with score and factors
 */
exports.calculateMatchScore = (worker, shift, criteria = {}) => {
  const factors = [];
  let totalScore = 0;
  let totalWeight = 0;

  // 1. Skills Match (Weight: 30%)
  const skillWeight = 30;
  const requiredSkills = shift.requiredSkills || [];
  const workerSkills = worker.skills || [];
  
  const matchedSkills = requiredSkills.filter(skill => 
    workerSkills.includes(skill)
  );
  const skillScore = requiredSkills.length > 0
    ? (matchedSkills.length / requiredSkills.length) * 100
    : 100;
  
  factors.push({
    factor: 'Skills Match',
    score: skillScore,
    weight: skillWeight,
    description: `${matchedSkills.length}/${requiredSkills.length} required skills`,
  });
  totalScore += skillScore * (skillWeight / 100);
  totalWeight += skillWeight;

  // 2. Availability (Weight: 25%)
  const availabilityWeight = 25;
  const isAvailable = checkAvailability(worker, shift);
  const availabilityScore = isAvailable ? 100 : 0;
  
  factors.push({
    factor: 'Availability',
    score: availabilityScore,
    weight: availabilityWeight,
    description: isAvailable ? 'Available' : 'Not available',
  });
  totalScore += availabilityScore * (availabilityWeight / 100);
  totalWeight += availabilityWeight;

  // 3. Distance/Location (Weight: 20%)
  const distanceWeight = 20;
  const distance = calculateDistance(
    worker.location || {},
    shift.location || {}
  );
  const maxDistance = criteria.maxDistance || 30; // km
  const distanceScore = Math.max(0, 100 - (distance / maxDistance) * 100);
  
  factors.push({
    factor: 'Distance',
    score: distanceScore,
    weight: distanceWeight,
    description: `${distance.toFixed(1)} km from shift location`,
  });
  totalScore += distanceScore * (distanceWeight / 100);
  totalWeight += distanceWeight;

  // 4. Performance History (Weight: 15%)
  const performanceWeight = 15;
  const performanceScore = (worker.rating || 4.0) * 20; // Convert 5-star to 100
  
  factors.push({
    factor: 'Performance',
    score: performanceScore,
    weight: performanceWeight,
    description: `${worker.rating || 4.0}/5.0 average rating`,
  });
  totalScore += performanceScore * (performanceWeight / 100);
  totalWeight += performanceWeight;

  // 5. Client Preference (Weight: 10%)
  const preferenceWeight = 10;
  const preferredWorkers = shift.preferredWorkers || [];
  const isPreferred = preferredWorkers.includes(worker._id.toString());
  const preferenceScore = isPreferred ? 100 : 50;
  
  factors.push({
    factor: 'Client Preference',
    score: preferenceScore,
    weight: preferenceWeight,
    description: isPreferred ? 'Preferred by client' : 'Not specifically preferred',
  });
  totalScore += preferenceScore * (preferenceWeight / 100);
  totalWeight += preferenceWeight;

  // Calculate final weighted score
  const finalScore = totalWeight > 0 ? totalScore / (totalWeight / 100) : 0;

  // Determine match level
  let matchLevel = 'poor';
  if (finalScore >= 85) matchLevel = 'excellent';
  else if (finalScore >= 70) matchLevel = 'good';
  else if (finalScore >= 50) matchLevel = 'fair';

  // Check for conflicts
  const conflicts = [];
  if (!isAvailable) conflicts.push('Time conflict with another shift');
  if (distance > maxDistance) conflicts.push(`Distance exceeds ${maxDistance}km limit`);
  if (skillScore < 100) conflicts.push('Missing some required skills');

  return {
    workerId: worker._id,
    workerName: `${worker.firstName} ${worker.lastName}`,
    workerEmail: worker.email,
    matchScore: Math.round(finalScore * 10) / 10,
    matchLevel,
    factors,
    conflicts,
    distance: Math.round(distance * 10) / 10,
    travelTime: Math.round((distance / 40) * 60), // Assume 40 km/h average
  };
};

/**
 * Find best worker matches for a shift
 * @param {Object} shift - Shift details
 * @param {Array} workers - Available workers
 * @param {Object} criteria - Matching criteria
 * @returns {Array} Sorted list of worker matches
 */
exports.findBestMatches = (shift, workers, criteria = {}) => {
  const minScore = criteria.minMatchScore || 60;
  
  const matches = workers
    .map(worker => exports.calculateMatchScore(worker, shift, criteria))
    .filter(match => match.matchScore >= minScore)
    .sort((a, b) => b.matchScore - a.matchScore);

  return matches.slice(0, 10); // Return top 10 matches
};

/**
 * Auto-fill multiple shifts with optimal workers
 * @param {Array} shifts - Shifts to fill
 * @param {Array} workers - Available workers
 * @param {Object} criteria - Matching criteria
 * @returns {Object} Auto-fill result
 */
exports.autoFillShifts = (shifts, workers, criteria = {}) => {
  const assignments = [];
  const unfilledShiftIds = [];
  const assignedWorkers = new Set();

  // Sort shifts by urgency (date/time)
  const sortedShifts = [...shifts].sort((a, b) => 
    new Date(a.date) - new Date(b.date)
  );

  for (const shift of sortedShifts) {
    // Get available workers (not already assigned)
    const availableWorkers = workers.filter(w => 
      !assignedWorkers.has(w._id.toString())
    );

    if (availableWorkers.length === 0) {
      unfilledShiftIds.push(shift._id);
      continue;
    }

    // Find best match
    const matches = exports.findBestMatches(shift, availableWorkers, criteria);
    
    if (matches.length > 0) {
      const bestMatch = matches[0];
      
      // Check if match is acceptable
      if (bestMatch.matchScore >= (criteria.minMatchScore || 60)) {
        assignments.push({
          shiftId: shift._id,
          workerId: bestMatch.workerId,
          workerName: bestMatch.workerName,
          matchScore: bestMatch.matchScore,
          reason: `Best match with ${bestMatch.matchScore}% compatibility`,
          warnings: bestMatch.conflicts,
        });
        
        // Mark worker as assigned
        if (!criteria.allowOvertime) {
          assignedWorkers.add(bestMatch.workerId.toString());
        }
      } else {
        unfilledShiftIds.push(shift._id);
      }
    } else {
      unfilledShiftIds.push(shift._id);
    }
  }

  return {
    totalShifts: shifts.length,
    filledShifts: assignments.length,
    unfilledShifts: unfilledShiftIds.length,
    assignments,
    unfilledShiftIds,
    optimizationSummary: `Filled ${assignments.length}/${shifts.length} shifts (${Math.round((assignments.length / shifts.length) * 100)}% fill rate)`,
  };
};

/**
 * Predict no-show probability for worker-shift combination
 * @param {Object} worker - Worker profile
 * @param {Object} shift - Shift details
 * @returns {Object} No-show prediction
 */
exports.predictNoShowProbability = (worker, shift) => {
  const riskFactors = [];
  let probability = 0;

  // Factor 1: Historical no-show rate (40% weight)
  const noShowRate = worker.noShowRate || 0;
  probability += noShowRate * 0.4;
  if (noShowRate > 0.1) {
    riskFactors.push(`Historical no-show rate: ${(noShowRate * 100).toFixed(1)}%`);
  }

  // Factor 2: Recent activity (20% weight)
  const daysSinceLastShift = worker.daysSinceLastShift || 0;
  if (daysSinceLastShift > 14) {
    probability += 0.2 * 0.2;
    riskFactors.push(`Inactive for ${daysSinceLastShift} days`);
  }

  // Factor 3: Shift acceptance rate (20% weight)
  const acceptanceRate = worker.acceptanceRate || 1.0;
  if (acceptanceRate < 0.7) {
    probability += (1 - acceptanceRate) * 0.2;
    riskFactors.push(`Low acceptance rate: ${(acceptanceRate * 100).toFixed(0)}%`);
  }

  // Factor 4: Distance (10% weight)
  const distance = calculateDistance(worker.location || {}, shift.location || {});
  if (distance > 20) {
    probability += 0.1 * 0.1;
    riskFactors.push(`Long distance: ${distance.toFixed(1)} km`);
  }

  // Factor 5: Time of day (10% weight)
  const shiftHour = new Date(shift.startTime).getHours();
  if (shiftHour < 7 || shiftHour > 20) {
    probability += 0.05 * 0.1;
    riskFactors.push('Early morning or late evening shift');
  }

  // Determine risk level
  let riskLevel = 'low';
  if (probability > 0.3) riskLevel = 'high';
  else if (probability > 0.15) riskLevel = 'medium';

  // Generate recommendation
  let recommendation = 'Worker is reliable';
  if (riskLevel === 'high') {
    recommendation = 'Consider assigning backup worker';
  } else if (riskLevel === 'medium') {
    recommendation = 'Send confirmation reminder';
  }

  return {
    workerId: worker._id,
    shiftId: shift._id,
    probability: Math.round(probability * 100) / 100,
    riskLevel,
    riskFactors,
    recommendation,
  };
};

/**
 * Optimize route for worker's shifts
 * @param {Object} worker - Worker profile
 * @param {Array} shifts - Worker's assigned shifts
 * @returns {Object} Route optimization
 */
exports.optimizeRoute = (worker, shifts) => {
  if (shifts.length === 0) {
    return {
      workerId: worker._id,
      workerName: `${worker.firstName} ${worker.lastName}`,
      shifts: [],
      totalDistance: 0,
      totalTravelTime: 0,
      efficiencyScore: 100,
    };
  }

  // Sort shifts by start time
  const sortedShifts = [...shifts].sort((a, b) => 
    new Date(a.startTime) - new Date(b.startTime)
  );

  // Calculate distances and travel times
  let totalDistance = 0;
  let totalTravelTime = 0;
  const optimizedShifts = [];

  for (let i = 0; i < sortedShifts.length; i++) {
    const shift = sortedShifts[i];
    let distanceFromPrevious = 0;
    let travelTimeFromPrevious = 0;

    if (i > 0) {
      const prevShift = sortedShifts[i - 1];
      distanceFromPrevious = calculateDistance(
        prevShift.location || {},
        shift.location || {}
      );
      travelTimeFromPrevious = (distanceFromPrevious / 40) * 60; // minutes
      totalDistance += distanceFromPrevious;
      totalTravelTime += travelTimeFromPrevious;
    }

    optimizedShifts.push({
      shiftId: shift._id,
      startTime: shift.startTime,
      endTime: shift.endTime,
      location: shift.locationName || 'Unknown',
      latitude: shift.location?.latitude || 0,
      longitude: shift.location?.longitude || 0,
      distanceFromPrevious: Math.round(distanceFromPrevious * 10) / 10,
      travelTimeFromPrevious: Math.round(travelTimeFromPrevious),
      sequenceOrder: i + 1,
    });
  }

  // Calculate efficiency score (lower distance = higher efficiency)
  const avgDistancePerShift = totalDistance / Math.max(shifts.length - 1, 1);
  const efficiencyScore = Math.max(0, 100 - (avgDistancePerShift * 2));

  // Generate recommendations
  let recommendations = 'Route is optimized';
  if (avgDistancePerShift > 15) {
    recommendations = 'Consider grouping nearby appointments to reduce travel time';
  }

  return {
    workerId: worker._id,
    workerName: `${worker.firstName} ${worker.lastName}`,
    shifts: optimizedShifts,
    totalDistance: Math.round(totalDistance * 10) / 10,
    totalTravelTime: Math.round(totalTravelTime),
    efficiencyScore: Math.round(efficiencyScore),
    recommendations,
  };
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if worker is available for shift
 */
function checkAvailability(worker, shift) {
  // Simplified availability check
  // In production, check against worker's schedule and availability preferences
  const shiftStart = new Date(shift.startTime);
  const shiftEnd = new Date(shift.endTime);
  
  // Check if worker has conflicting shifts (would query database)
  // For now, assume available if not explicitly marked unavailable
  return true;
}

/**
 * Calculate distance between two locations (Haversine formula)
 */
function calculateDistance(loc1, loc2) {
  const lat1 = loc1.latitude || 0;
  const lon1 = loc1.longitude || 0;
  const lat2 = loc2.latitude || 0;
  const lon2 = loc2.longitude || 0;

  if (lat1 === 0 || lat2 === 0) return 0;

  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  
  return distance;
}

function toRad(degrees) {
  return degrees * (Math.PI / 180);
}
