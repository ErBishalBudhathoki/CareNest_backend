/**
 * Real-Time Tracking Service
 * Handles live worker tracking, geofencing, and ETA calculations
 */

// In-memory storage for demo (use Redis in production)
const activeTracking = new Map();
const geofenceStates = new Map();

const toNumberOrNull = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeCoordinatePoint = (point) => {
  if (!point || typeof point !== 'object') return null;

  const lat = toNumberOrNull(point.lat ?? point.latitude);
  const lng = toNumberOrNull(point.lng ?? point.longitude);

  if (lat == null || lng == null) return null;

  return { lat, lng };
};

/**
 * Start tracking session
 * @param {Object} params - Tracking parameters
 * @returns {Object} Tracking session
 */
exports.startTrackingSession = async (params) => {
  const { appointmentId, workerId, clientLocation } = params;
  const normalizedClientLocation = normalizeCoordinatePoint(clientLocation);

  if (!normalizedClientLocation) {
    throw new Error('Invalid clientLocation. Expected lat/lng or latitude/longitude.');
  }

  const session = {
    appointmentId,
    workerId,
    clientLocation: normalizedClientLocation,
    startTime: new Date(),
    status: 'active',
    locations: [],
    geofenceRadius: 100, // meters
    insideGeofence: false,
  };

  activeTracking.set(appointmentId, session);

  return {
    sessionId: appointmentId,
    status: 'started',
    startTime: session.startTime,
  };
};

/**
 * Update worker location
 * @param {Object} params - Location parameters
 * @returns {Object} Location data with ETA
 */
exports.updateWorkerLocation = async (params) => {
  const { appointmentId, workerId, latitude, longitude, accuracy, timestamp } = params;

  const session = activeTracking.get(appointmentId);
  if (!session) {
    throw new Error('No active tracking session found');
  }

  const locationUpdate = {
    latitude,
    longitude,
    accuracy,
    timestamp,
  };

  session.locations.push(locationUpdate);
  session.lastUpdate = timestamp;

  // Calculate distance to client
  const distance = calculateDistance(
    { lat: latitude, lng: longitude },
    session.clientLocation
  );

  // Calculate ETA (simple calculation, can be enhanced with traffic data)
  const eta = Number.isFinite(distance) ? calculateETA(distance, session.locations) : null;

  // Update session
  activeTracking.set(appointmentId, session);

  return {
    appointmentId,
    workerId: session.workerId,
    latitude,
    longitude,
    accuracy,
    timestamp,
    distance: Number.isFinite(distance) ? Math.round(distance) : null,
    eta,
    status: session.status,
  };
};

/**
 * Check geofence status
 * @param {Object} params - Geofence parameters
 * @returns {Object} Geofence event
 */
exports.checkGeofence = async (params) => {
  const { appointmentId, latitude, longitude } = params;

  const session = activeTracking.get(appointmentId);
  if (!session) {
    return { triggered: false };
  }

  const distance = calculateDistance(
    { lat: latitude, lng: longitude },
    session.clientLocation
  );
  const previousState = geofenceStates.get(appointmentId) || {
    insideGeofence: false,
    approaching: false,
  };

  if (!Number.isFinite(distance)) {
    return {
      triggered: false,
      distance: null,
      insideGeofence: previousState.insideGeofence,
      approaching: previousState.approaching,
    };
  }

  let event = null;
  let triggered = false;

  // Approaching (within 500m but outside 100m)
  if (distance <= 500 && distance > session.geofenceRadius && !previousState.approaching) {
    event = 'approaching';
    triggered = true;
    previousState.approaching = true;
  }

  // Arrived (entered geofence)
  if (distance <= session.geofenceRadius && !previousState.insideGeofence) {
    event = 'arrived';
    triggered = true;
    previousState.insideGeofence = true;
    session.insideGeofence = true;
    session.arrivalTime = new Date();
  }

  // Departed (left geofence)
  if (distance > session.geofenceRadius && previousState.insideGeofence) {
    event = 'departed';
    triggered = true;
    previousState.insideGeofence = false;
    previousState.approaching = false;
    session.insideGeofence = false;
    session.departureTime = new Date();
  }

  geofenceStates.set(appointmentId, previousState);
  activeTracking.set(appointmentId, session);

  return {
    triggered,
    event,
    distance: Math.round(distance),
    insideGeofence: previousState.insideGeofence,
    approaching: previousState.approaching,
  };
};

/**
 * Update appointment status
 * @param {Object} params - Status parameters
 * @returns {Object} Status data
 */
exports.updateAppointmentStatus = async (params) => {
  const { appointmentId, workerId, status, progress, notes, timestamp } = params;

  const session = activeTracking.get(appointmentId);
  if (!session) {
    throw new Error('No active tracking session found');
  }

  session.status = status;
  session.progress = progress || 0;
  session.notes = notes || '';
  session.lastStatusUpdate = timestamp;

  // Track status history
  if (!session.statusHistory) {
    session.statusHistory = [];
  }
  session.statusHistory.push({
    status,
    progress,
    notes,
    timestamp,
  });

  activeTracking.set(appointmentId, session);

  return {
    appointmentId,
    status,
    progress,
    notes,
    timestamp,
  };
};

/**
 * Stop tracking session
 * @param {Object} params - Stop parameters
 * @returns {Object} Session summary
 */
exports.stopTrackingSession = async (params) => {
  const { appointmentId } = params;

  const session = activeTracking.get(appointmentId);
  if (!session) {
    throw new Error('No active tracking session found');
  }

  session.endTime = new Date();
  session.status = 'completed';

  // Calculate session statistics
  const duration = session.endTime - session.startTime;
  const totalDistance = calculateTotalDistance(session.locations);

  const summary = {
    appointmentId,
    workerId: session.workerId,
    startTime: session.startTime,
    endTime: session.endTime,
    duration: Math.round(duration / 1000 / 60), // minutes
    totalDistance: Math.round(totalDistance),
    locationUpdates: session.locations.length,
    statusHistory: session.statusHistory || [],
    arrivalTime: session.arrivalTime,
    departureTime: session.departureTime,
  };

  // Remove from active tracking
  activeTracking.delete(appointmentId);
  geofenceStates.delete(appointmentId);

  return summary;
};

/**
 * Get live tracking data
 * @param {String} appointmentId - Appointment ID
 * @returns {Object} Live tracking data
 */
exports.getLiveTrackingData = async (appointmentId) => {
  const session = activeTracking.get(appointmentId);
  if (!session) {
    return null;
  }

  const lastLocation = session.locations[session.locations.length - 1];
  if (!lastLocation) {
    return {
      appointmentId,
      status: session.status,
      tracking: false,
    };
  }

  const distance = calculateDistance(
    { lat: lastLocation.latitude, lng: lastLocation.longitude },
    session.clientLocation
  );

  const eta = Number.isFinite(distance) ? calculateETA(distance, session.locations) : null;

  return {
    appointmentId,
    workerId: session.workerId,
    status: session.status,
    progress: session.progress || 0,
    tracking: true,
    currentLocation: {
      latitude: lastLocation.latitude,
      longitude: lastLocation.longitude,
      accuracy: lastLocation.accuracy,
      timestamp: lastLocation.timestamp,
    },
    clientLocation: session.clientLocation,
    distance: Number.isFinite(distance) ? Math.round(distance) : null,
    eta,
    insideGeofence: session.insideGeofence,
    lastUpdate: session.lastUpdate,
  };
};

/**
 * Create emergency alert
 * @param {Object} params - Alert parameters
 * @returns {Object} Alert data
 */
exports.createEmergencyAlert = async (params) => {
  const { appointmentId, userId, userType, location, message, timestamp } = params;

  const alert = {
    _id: `alert-${Date.now()}`,
    appointmentId,
    userId,
    userType,
    location,
    message,
    timestamp,
    status: 'active',
    priority: 'critical',
  };

  // In production, save to database and trigger notifications
  console.log('EMERGENCY ALERT:', alert);

  return alert;
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate distance between two points (Haversine formula)
 * @param {Object} point1 - {lat, lng}
 * @param {Object} point2 - {lat, lng}
 * @returns {Number} Distance in meters
 */
function calculateDistance(point1, point2) {
  if (
    !point1 ||
    !point2 ||
    !Number.isFinite(point1.lat) ||
    !Number.isFinite(point1.lng) ||
    !Number.isFinite(point2.lat) ||
    !Number.isFinite(point2.lng)
  ) {
    return NaN;
  }

  const R = 6371e3; // Earth's radius in meters
  const φ1 = (point1.lat * Math.PI) / 180;
  const φ2 = (point2.lat * Math.PI) / 180;
  const Δφ = ((point2.lat - point1.lat) * Math.PI) / 180;
  const Δλ = ((point2.lng - point1.lng) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Calculate ETA based on distance and speed
 * @param {Number} distance - Distance in meters
 * @param {Array} locations - Location history
 * @returns {Number} ETA in minutes
 */
function calculateETA(distance, locations) {
  if (distance === 0) return 0;

  // Calculate average speed from recent locations
  let avgSpeed = 40; // Default 40 km/h

  if (locations.length >= 2) {
    const recentLocations = locations.slice(-5); // Last 5 locations
    let totalSpeed = 0;
    let speedCount = 0;

    for (let i = 1; i < recentLocations.length; i++) {
      const prev = recentLocations[i - 1];
      const curr = recentLocations[i];

      const dist = calculateDistance(
        { lat: prev.latitude, lng: prev.longitude },
        { lat: curr.latitude, lng: curr.longitude }
      );

      const timeDiff = (new Date(curr.timestamp) - new Date(prev.timestamp)) / 1000; // seconds

      if (timeDiff > 0) {
        const speed = (dist / timeDiff) * 3.6; // Convert m/s to km/h
        if (speed > 0 && speed < 120) {
          // Reasonable speed range
          totalSpeed += speed;
          speedCount++;
        }
      }
    }

    if (speedCount > 0) {
      avgSpeed = totalSpeed / speedCount;
    }
  }

  // Calculate ETA
  const distanceKm = distance / 1000;
  const etaHours = distanceKm / avgSpeed;
  const etaMinutes = Math.round(etaHours * 60);

  return Math.max(1, etaMinutes); // At least 1 minute
}

/**
 * Calculate total distance traveled
 * @param {Array} locations - Location history
 * @returns {Number} Total distance in meters
 */
function calculateTotalDistance(locations) {
  if (locations.length < 2) return 0;

  let totalDistance = 0;

  for (let i = 1; i < locations.length; i++) {
    const prev = locations[i - 1];
    const curr = locations[i];

    const dist = calculateDistance(
      { lat: prev.latitude, lng: prev.longitude },
      { lat: curr.latitude, lng: curr.longitude }
    );

    totalDistance += dist;
  }

  return totalDistance;
}
