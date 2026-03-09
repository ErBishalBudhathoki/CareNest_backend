/**
 * Real-Time Tracking Service
 * Handles live worker tracking, geofencing, and ETA calculations.
 * Uses MongoDB-backed sessions so tracking works across Cloud Run instances.
 */

const RealtimeTrackingSession = require('../models/RealtimeTrackingSession');

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

const buildLiveTrackingFromSession = (session, appointmentIdOverride = null) => {
  if (!session) return null;

  const normalizedAppointmentId = (
    appointmentIdOverride || session.appointmentId || ''
  )
    .toString()
    .trim();

  const locations = Array.isArray(session.locations) ? session.locations : [];
  const lastLocation = locations[locations.length - 1];
  if (!lastLocation) {
    return {
      appointmentId: normalizedAppointmentId,
      status: session.status,
      tracking: false,
    };
  }

  let distance = NaN;
  if (
    session.clientLocation &&
    Number.isFinite(session.clientLocation.lat) &&
    Number.isFinite(session.clientLocation.lng)
  ) {
    distance = calculateDistance(
      { lat: lastLocation.latitude, lng: lastLocation.longitude },
      session.clientLocation
    );
  }

  const eta = Number.isFinite(distance) ? calculateETA(distance, locations) : null;

  return {
    appointmentId: normalizedAppointmentId,
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
 * Start tracking session
 * @param {Object} params - Tracking parameters
 * @returns {Object} Tracking session
 */
exports.startTrackingSession = async (params) => {
  const { appointmentId, workerId, clientLocation } = params;
  const normalizedClientLocation = normalizeCoordinatePoint(clientLocation);

  const now = new Date();
  await RealtimeTrackingSession.findOneAndUpdate(
    { appointmentId: appointmentId.toString().trim() },
    {
      $set: {
        appointmentId: appointmentId.toString().trim(),
        workerId: workerId.toString().trim(),
        clientLocation: normalizedClientLocation || null,
        startTime: now,
        endTime: null,
        status: 'active',
        locations: [],
        geofenceRadius: 100,
        insideGeofence: false,
        arrivalTime: null,
        departureTime: null,
        lastUpdate: null,
        progress: 0,
        notes: '',
        statusHistory: [],
      },
    },
    {
      upsert: true,
      returnDocument: 'after',
      setDefaultsOnInsert: true,
    }
  );

  return {
    sessionId: appointmentId,
    status: 'started',
    startTime: now,
  };
};

/**
 * Update worker location
 * @param {Object} params - Location parameters
 * @returns {Object} Location data with ETA
 */
exports.updateWorkerLocation = async (params) => {
  const { appointmentId, workerId, latitude, longitude, accuracy, timestamp } = params;
  const parsedLatitude = toNumberOrNull(latitude);
  const parsedLongitude = toNumberOrNull(longitude);
  const parsedAccuracy = toNumberOrNull(accuracy) ?? 10;

  if (parsedLatitude == null || parsedLongitude == null) {
    throw new Error('Invalid latitude/longitude values');
  }

  const normalizedAppointmentId = appointmentId.toString().trim();
  const updateTime = timestamp ? new Date(timestamp) : new Date();

  let session = await RealtimeTrackingSession.findOne({
    appointmentId: normalizedAppointmentId,
    status: 'active',
  });

  if (!session) {
    session = await RealtimeTrackingSession.create({
      appointmentId: normalizedAppointmentId,
      workerId: (workerId || '').toString().trim() || 'unknown-worker',
      clientLocation: null,
      startTime: updateTime,
      status: 'active',
      locations: [],
      geofenceRadius: 100,
      insideGeofence: false,
    });
  }

  const locationUpdate = {
    latitude: parsedLatitude,
    longitude: parsedLongitude,
    accuracy: parsedAccuracy,
    timestamp: updateTime,
  };

  session.locations = [...(session.locations || []), locationUpdate];
  session.lastUpdate = updateTime;

  let distance = NaN;
  if (
    session.clientLocation &&
    Number.isFinite(session.clientLocation.lat) &&
    Number.isFinite(session.clientLocation.lng)
  ) {
    distance = calculateDistance(
      { lat: parsedLatitude, lng: parsedLongitude },
      session.clientLocation
    );
  }

  const eta = Number.isFinite(distance)
    ? calculateETA(distance, session.locations || [])
    : null;

  await session.save();

  return {
    appointmentId: normalizedAppointmentId,
    workerId: session.workerId,
    latitude: parsedLatitude,
    longitude: parsedLongitude,
    accuracy: parsedAccuracy,
    timestamp: updateTime,
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

  const normalizedAppointmentId = appointmentId.toString().trim();
  const session = await RealtimeTrackingSession.findOne({
    appointmentId: normalizedAppointmentId,
    status: 'active',
  });

  if (!session) {
    return { triggered: false };
  }

  if (
    !session.clientLocation ||
    !Number.isFinite(session.clientLocation.lat) ||
    !Number.isFinite(session.clientLocation.lng)
  ) {
    return {
      triggered: false,
      distance: null,
      insideGeofence: Boolean(session.insideGeofence),
      approaching: false,
    };
  }

  const distance = calculateDistance(
    { lat: latitude, lng: longitude },
    session.clientLocation
  );
  const previousState = geofenceStates.get(normalizedAppointmentId) || {
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

  geofenceStates.set(normalizedAppointmentId, previousState);
  await session.save();

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

  const normalizedAppointmentId = appointmentId.toString().trim();
  const session = await RealtimeTrackingSession.findOne({
    appointmentId: normalizedAppointmentId,
    status: 'active',
  });

  if (!session) {
    throw new Error('No active tracking session found');
  }

  session.status = status;
  session.progress = progress || 0;
  session.notes = notes || '';
  session.lastStatusUpdate = timestamp ? new Date(timestamp) : new Date();

  // Track status history
  if (!session.statusHistory) {
    session.statusHistory = [];
  }
  session.statusHistory.push({
    status,
    progress,
    notes,
    timestamp: timestamp ? new Date(timestamp) : new Date(),
  });

  await session.save();

  return {
    appointmentId: normalizedAppointmentId,
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

  const normalizedAppointmentId = appointmentId.toString().trim();
  const session = await RealtimeTrackingSession.findOne({
    appointmentId: normalizedAppointmentId,
    status: 'active',
  });

  if (!session) {
    throw new Error('No active tracking session found');
  }

  session.endTime = new Date();
  session.status = 'completed';

  // Calculate session statistics
  const duration = session.endTime - session.startTime;
  const totalDistance = calculateTotalDistance(session.locations);

  const summary = {
    appointmentId: normalizedAppointmentId,
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

  await session.save();
  geofenceStates.delete(normalizedAppointmentId);

  return summary;
};

/**
 * Get live tracking data
 * @param {String} appointmentId - Appointment ID
 * @returns {Object} Live tracking data
 */
exports.getLiveTrackingData = async (appointmentId) => {
  const normalizedAppointmentId = appointmentId.toString().trim();
  const session = await RealtimeTrackingSession.findOne({
    appointmentId: normalizedAppointmentId,
    status: 'active',
  });

  if (!session) {
    return null;
  }
  return buildLiveTrackingFromSession(session, normalizedAppointmentId);
};

/**
 * Get the freshest active live tracking for any appointment in the provided list.
 * @param {String[]} appointmentIds - Candidate appointment IDs.
 * @returns {Object|null} Live tracking payload or null when unavailable.
 */
exports.getLatestLiveTrackingDataForAppointments = async (appointmentIds = []) => {
  const normalizedIds = [...new Set(
    (Array.isArray(appointmentIds) ? appointmentIds : [])
      .map((value) => (value || '').toString().trim())
      .filter(Boolean)
  )];

  if (!normalizedIds.length) {
    return null;
  }

  const sessions = await RealtimeTrackingSession.find({
    appointmentId: { $in: normalizedIds },
    status: 'active',
  })
    .sort({ lastUpdate: -1, updatedAt: -1, createdAt: -1 })
    .lean();

  for (const session of sessions) {
    const livePayload = buildLiveTrackingFromSession(session, session.appointmentId);
    if (livePayload?.tracking === true && livePayload.currentLocation) {
      return livePayload;
    }
  }

  // Return the freshest active session even if the first GPS point is not yet available.
  const firstSession = sessions[0];
  return firstSession
    ? buildLiveTrackingFromSession(firstSession, firstSession.appointmentId)
    : null;
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
