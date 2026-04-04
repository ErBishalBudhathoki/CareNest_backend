const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const logger = require('../config/logger');
const uri = process.env.MONGODB_URI;

const LIVE_ZONE_PRE_MINUTES = Number(process.env.LIVE_ZONE_PRE_MINUTES || 60);
const LIVE_ZONE_POST_MINUTES = Number(process.env.LIVE_ZONE_POST_MINUTES || 30);
const LIVE_ZONE_STALE_MINUTES = Number(process.env.LIVE_ZONE_STALE_MINUTES || 15);

const parseTimeTo24Hour = (value) => {
  if (!value) return null;
  let raw = value.toString().trim().toLowerCase();
  if (!raw) return null;

  const isPM = raw.includes('pm');
  const isAM = raw.includes('am');
  raw = raw.replace(/am|pm/g, '').trim();

  const parts = raw.split(':').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  let hour = Number.parseInt(parts[0], 10);
  const minute = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  if (isPM && hour < 12) hour += 12;
  if (isAM && hour === 12) hour = 0;

  return `${hour.toString().padStart(2, '0')}:${minute
    .toString()
    .padStart(2, '0')}`;
};

const buildShiftWindow = (scheduleItem) => {
  if (!scheduleItem || !scheduleItem.date) return null;
  const startTime = parseTimeTo24Hour(scheduleItem.startTime) || scheduleItem.startTime;
  const endTime = parseTimeTo24Hour(scheduleItem.endTime) || scheduleItem.endTime;
  if (!startTime || !endTime) return null;

  let start = new Date(`${scheduleItem.date}T${startTime}:00`);
  let end = new Date(`${scheduleItem.date}T${endTime}:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  if (end < start) {
    end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  }

  return { start, end };
};

const isWithinShiftWindow = (scheduleItem, now) => {
  const window = buildShiftWindow(scheduleItem);
  if (!window) return false;

  const startWindow = new Date(
    window.start.getTime() - LIVE_ZONE_PRE_MINUTES * 60 * 1000
  );
  const endWindow = new Date(
    window.end.getTime() + LIVE_ZONE_POST_MINUTES * 60 * 1000
  );

  return now >= startWindow && now <= endWindow;
};

const calculateDistanceMeters = (pointA, pointB) => {
  if (
    !pointA ||
    !pointB ||
    !Number.isFinite(pointA.lat) ||
    !Number.isFinite(pointA.lng) ||
    !Number.isFinite(pointB.lat) ||
    !Number.isFinite(pointB.lng)
  ) {
    return NaN;
  }

  const R = 6371e3;
  const φ1 = (pointA.lat * Math.PI) / 180;
  const φ2 = (pointB.lat * Math.PI) / 180;
  const Δφ = ((pointB.lat - pointA.lat) * Math.PI) / 180;
  const Δλ = ((pointB.lng - pointA.lng) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
};

const parseCoordinatesFromText = (value) => {
  if (!value) return null;
  const raw = value.toString();
  const match = raw.match(
    /(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/i
  );
  if (!match) return null;
  const lat = Number.parseFloat(match[1]);
  const lng = Number.parseFloat(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
};

const extractClientCoordinates = (clientDetails, fallbackAddress) => {
  if (clientDetails && typeof clientDetails === 'object') {
    const candidates = [
      { lat: clientDetails.clientLatitude, lng: clientDetails.clientLongitude },
      { lat: clientDetails.latitude, lng: clientDetails.longitude },
      { lat: clientDetails.lat, lng: clientDetails.lng },
      {
        lat: clientDetails.location?.lat ?? clientDetails.location?.latitude,
        lng: clientDetails.location?.lng ?? clientDetails.location?.longitude,
      },
      {
        lat: clientDetails.coordinates?.lat ?? clientDetails.coordinates?.latitude,
        lng: clientDetails.coordinates?.lng ?? clientDetails.coordinates?.longitude,
      },
    ];

    for (const candidate of candidates) {
      const lat = Number.parseFloat(candidate.lat);
      const lng = Number.parseFloat(candidate.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng };
      }
    }

    const fromAddress = parseCoordinatesFromText(
      clientDetails.clientAddress || fallbackAddress
    );
    if (fromAddress) return fromAddress;
  }

  return parseCoordinatesFromText(fallbackAddress);
};

class EmployeeTrackingService {
  /**
   * Get comprehensive employee tracking data for an organization
   * @param {string} organizationId - The organization ID
   * @returns {Object} Employee tracking data
   */
  static async getEmployeeTrackingData(organizationId) {
    let client;
    
    try {
      if (!organizationId) {
        throw new Error('Organization ID is required');
      }
      
      // Connect to MongoDB
      client = await MongoClient.connect(uri, {
        serverApi: ServerApiVersion.v1
      });
      
      const db = client.db("Invoice");
      
      // Get all active assignments for the organization
      const assignments = await db.collection("clientAssignments").aggregate([
        {
          $match: {
            organizationId: organizationId,
            isActive: true
          }
        },
        {
          $lookup: {
            from: "clients",
            localField: "clientEmail",
            foreignField: "clientEmail",
            as: "clientDetails"
          }
        },
        {
          $unwind: "$clientDetails"
        },
        {
          $lookup: {
            from: "login",
            localField: "userEmail",
            foreignField: "email",
            as: "userDetails"
          }
        },
        {
          $unwind: "$userDetails"
        }
      ]).toArray();
      
      // If no assignments found, get employees directly from login collection
      let employeesFromLogin = [];
      if (assignments.length === 0) {
        const organizationObjectId =
          typeof organizationId === 'string' &&
          organizationId.length === 24 &&
          /^[a-f0-9]{24}$/i.test(organizationId)
            ? new ObjectId(organizationId)
            : null;

        const loginQuery = organizationObjectId
          ? {
              isActive: true,
              $or: [
                { organizationId: organizationId },
                { organizationId: organizationObjectId },
                { organizationId: organizationId.toString() },
              ],
            }
          : { organizationId: organizationId, isActive: true };

        employeesFromLogin = await db.collection("users").find(loginQuery).toArray();
        if (employeesFromLogin.length > 0) {
          employeesFromLogin = employeesFromLogin.filter((user) => {
            const role = (user.role || '').toString().toLowerCase();
            const roles = Array.isArray(user.roles)
              ? user.roles.map((r) => r.toString().toLowerCase())
              : [];
            return !['client', 'family'].includes(role) &&
              !roles.includes('client') &&
              !roles.includes('family');
          });
        }
        if (employeesFromLogin.length === 0) {
          employeesFromLogin = await db.collection("login").find(loginQuery).toArray();
        }
        
        // Transform login collection data to match assignment structure
        employeesFromLogin.forEach(employee => {
          assignments.push({
            assignmentId: employee._id.toString(),
            userEmail: employee.email,
            userName: `${employee.firstName} ${employee.lastName}`,
            organizationId: employee.organizationId,
            clientEmail: null,
            clientAddress: null,
            isActive: true,
            createdAt: employee.createdAt,
            userDetails: {
              name: `${employee.firstName} ${employee.lastName}`,
              firstName: employee.firstName,
              lastName: employee.lastName,
              email: employee.email,
              profileImage: employee.photoData || employee.profileImage
            },
            clientDetails: null
          });
        });
      }
      
      // Get worked time records for the organization
      const workedTimeRecords = await db.collection("workedTime").aggregate([
        {
          $lookup: {
            from: "clientAssignments",
            localField: "assignedClientId",
            foreignField: "_id",
            as: "assignmentDetails"
          }
        },
        {
          $unwind: {
            path: "$assignmentDetails",
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $match: {
            $or: [
              { "assignmentDetails.organizationId": organizationId },
              { organizationId: organizationId }
            ]
          }
        },
        {
          $lookup: {
            from: "login",
            localField: "userEmail",
            foreignField: "email",
            as: "userDetails"
          }
        },
        {
          $unwind: {
            path: "$userDetails",
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $lookup: {
            from: "clients",
            localField: "clientEmail",
            foreignField: "clientEmail",
            as: "clientDetails"
          }
        },
        {
          $unwind: {
            path: "$clientDetails",
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $sort: { startTime: -1 }
        }
      ]).toArray();
      
      // Get active timers for the organization
      const activeTimers = await db.collection("activeTimers").aggregate([
        {
          $match: {
            organizationId: organizationId
          }
        },
        {
          $lookup: {
            from: "login",
            localField: "userEmail",
            foreignField: "email",
            as: "userDetails"
          }
        },
        {
          $unwind: {
            path: "$userDetails",
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $lookup: {
            from: "clients",
            localField: "clientEmail",
            foreignField: "clientEmail",
            as: "clientDetails"
          }
        },
        {
          $unwind: {
            path: "$clientDetails",
            preserveNullAndEmptyArrays: true
          }
        }
      ]).toArray();
      
      // Calculate current working time for active timers
      const currentTime = new Date();
      const activeTimersWithDuration = activeTimers.map(timer => {
        const startTime = new Date(timer.startTime);
        const durationMs = currentTime - startTime;
        const hours = Math.floor(durationMs / (1000 * 60 * 60));
        const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
        
        return {
          ...timer,
          currentWorkingTime: `${hours}h ${minutes}m`,
          durationMs: durationMs
        };
      });
      
      // Group employees by their current status
      const employeeMap = new Map();
      
      // Add all employees from assignments
      assignments.forEach(assignment => {
        const userEmail = assignment.userEmail;
        if (!employeeMap.has(userEmail)) {
          employeeMap.set(userEmail, {
            userEmail: userEmail,
            userName: assignment.userDetails?.name || assignment.userName || 'Unknown',
            profileImage: assignment.userDetails?.profileImage || assignment.userDetails?.photoData,
            isCurrentlyWorking: false,
            currentTimer: null,
            assignments: [],
            recentShifts: []
          });
        }
        
        const employee = employeeMap.get(userEmail);
        employee.assignments.push(assignment);
      });
      
      // Add active timer information
      activeTimersWithDuration.forEach(timer => {
        const userEmail = timer.userEmail;
        if (!employeeMap.has(userEmail)) {
          employeeMap.set(userEmail, {
            userEmail: userEmail,
            userName: timer.userDetails?.name || `${timer.userDetails?.firstName} ${timer.userDetails?.lastName}` || 'Unknown',
            profileImage: timer.userDetails?.profileImage || timer.userDetails?.photoData,
            isCurrentlyWorking: true,
            currentTimer: timer,
            assignments: [],
            recentShifts: []
          });
        } else {
          const employee = employeeMap.get(userEmail);
          employee.isCurrentlyWorking = true;
          employee.currentTimer = timer;
        }
      });
      
      // Add recent shifts information
      workedTimeRecords.forEach(record => {
        const userEmail = record.userEmail;
        if (employeeMap.has(userEmail)) {
          const employee = employeeMap.get(userEmail);
          employee.recentShifts.push(record);
        }
      });
      
      // Convert map to array
      const employees = Array.from(employeeMap.values());
      
      // Separate currently working and not working employees
      const currentlyWorking = employees.filter(emp => emp.isCurrentlyWorking);
      const notCurrentlyWorking = employees.filter(emp => !emp.isCurrentlyWorking);

      let liveZoneEmployees = [];
      try {
        const now = new Date();
        const appointmentMeta = new Map();
        const appointmentIds = new Set();

        const addAppointmentMeta = (appointmentId, meta) => {
          if (!appointmentId) return;
          const normalized = appointmentId.toString().trim();
          if (!normalized) return;
          if (!appointmentIds.has(normalized)) {
            appointmentIds.add(normalized);
          }
          if (!appointmentMeta.has(normalized)) {
            appointmentMeta.set(normalized, meta);
          }
        };

        for (const assignment of assignments) {
          const scheduleItems = Array.isArray(assignment.schedule)
            ? assignment.schedule
            : [];
          if (!scheduleItems.length) continue;

          const assignmentId = assignment._id?.toString?.() || assignment.assignmentId;
          const userEmail = assignment.userEmail || assignment.userDetails?.email;
          const userName =
            assignment.userDetails?.name ||
            assignment.userName ||
            `${assignment.userDetails?.firstName || ''} ${assignment.userDetails?.lastName || ''}`.trim() ||
            'Unknown';
          const clientName =
            assignment.clientDetails?.clientName ||
            assignment.clientDetails?.name ||
            assignment.clientEmail ||
            'Client';

          const clientAddress =
            assignment.clientDetails?.clientAddress ||
            assignment.clientAddress ||
            null;

          const clientCoordinates = extractClientCoordinates(
            assignment.clientDetails,
            clientAddress
          );

          scheduleItems.forEach((scheduleItem, index) => {
            const window = buildShiftWindow(scheduleItem);
            if (!window) return;

            const startWindow = new Date(
              window.start.getTime() - LIVE_ZONE_PRE_MINUTES * 60 * 1000
            );
            const endWindow = new Date(
              window.end.getTime() + LIVE_ZONE_POST_MINUTES * 60 * 1000
            );

            if (now < startWindow || now > endWindow) return;

            const meta = {
              assignmentId,
              scheduleId: scheduleItem._id?.toString?.() || null,
              scheduleIndex: index,
              userEmail,
              userName,
              clientName,
              clientEmail: assignment.clientEmail || null,
              clientAddress,
              clientCoordinates,
              shiftStart: window.start,
              shiftEnd: window.end,
            };

            if (meta.scheduleId) {
              addAppointmentMeta(meta.scheduleId, meta);
            }
            if (assignmentId) {
              addAppointmentMeta(`${assignmentId}_${index}`, meta);
              addAppointmentMeta(assignmentId, meta);
            }
          });
        }

        if (appointmentIds.size > 0) {
          const appointmentIdList = Array.from(appointmentIds);
          const sessions = await db
            .collection('realtimeTrackingSessions')
            .find({
              appointmentId: { $in: appointmentIdList },
              status: 'active',
            })
            .toArray();

          const userEmails = [
            ...new Set(
              assignments
                .map((assignment) => assignment.userEmail?.toString().toLowerCase())
                .filter(Boolean)
            ),
          ];

          const preferenceDocs = userEmails.length
            ? await db
                .collection('notification_preferences')
                .find({ userEmail: { $in: userEmails } })
                .toArray()
            : [];

          const geofenceRadiusByEmail = new Map();
          preferenceDocs.forEach((pref) => {
            const email = pref.userEmail?.toString().toLowerCase();
            const radiusKm = Number.parseFloat(pref.geofenceRadiusKm);
            if (email && Number.isFinite(radiusKm)) {
              geofenceRadiusByEmail.set(email, radiusKm * 1000);
            }
          });

          const staleCutoff = new Date(
            now.getTime() - LIVE_ZONE_STALE_MINUTES * 60 * 1000
          );

          liveZoneEmployees = sessions
            .map((session) => {
              const meta = appointmentMeta.get(
                session.appointmentId?.toString?.() || session.appointmentId
              );
              if (!meta) return null;

              const locations = Array.isArray(session.locations)
                ? session.locations
                : [];
              const lastLocation = locations[locations.length - 1];
              if (!lastLocation) return null;

              const parsedLat = Number.parseFloat(lastLocation.latitude);
              const parsedLng = Number.parseFloat(lastLocation.longitude);
              if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
                return null;
              }

              const lastUpdate =
                session.lastUpdate ||
                lastLocation.timestamp ||
                session.updatedAt ||
                session.createdAt ||
                null;

              if (lastUpdate && new Date(lastUpdate) < staleCutoff) {
                return null;
              }

              const workerEmailRaw =
                session.workerId || meta.userEmail || '';
              const workerEmail = workerEmailRaw.toString().toLowerCase();
              const radiusMeters =
                geofenceRadiusByEmail.get(workerEmail) ||
                Number.parseFloat(session.geofenceRadius) ||
                100;

              const clientLocation =
                session.clientLocation &&
                Number.isFinite(session.clientLocation.lat) &&
                Number.isFinite(session.clientLocation.lng)
                  ? {
                      lat: session.clientLocation.lat,
                      lng: session.clientLocation.lng,
                    }
                  : meta.clientCoordinates;

              const distance = clientLocation
                ? calculateDistanceMeters(
                    {
                      lat: parsedLat,
                      lng: parsedLng,
                    },
                    clientLocation
                  )
                : NaN;

              const insideGeofence = Number.isFinite(distance)
                ? distance <= radiusMeters
                : Boolean(session.insideGeofence);

              if (!insideGeofence) return null;

              return {
                appointmentId: session.appointmentId,
                assignmentId: meta.assignmentId,
                userEmail: meta.userEmail || workerEmail || null,
                userName: meta.userName,
                clientName: meta.clientName,
                clientEmail: meta.clientEmail,
                clientAddress: meta.clientAddress,
                latitude: parsedLat,
                longitude: parsedLng,
                accuracy: Number.parseFloat(lastLocation.accuracy) || 0,
                lastUpdate: lastUpdate ? new Date(lastUpdate) : null,
                distanceMeters: Number.isFinite(distance)
                  ? Math.round(distance)
                  : null,
                geofenceRadiusMeters: Math.round(radiusMeters),
                insideGeofence,
                shiftStart: meta.shiftStart,
                shiftEnd: meta.shiftEnd,
              };
            })
            .filter(Boolean);
        }
      } catch (liveZoneError) {
        logger.warn('Live zone computation failed', {
          organizationId,
          error: liveZoneError.message,
        });
        liveZoneEmployees = [];
      }
      
      return {
        organizationId: organizationId,
        totalEmployees: employees.length,
        currentlyWorking: currentlyWorking,
        notCurrentlyWorking: notCurrentlyWorking,
        allEmployees: employees,
        activeTimers: activeTimersWithDuration,
        recentShifts: workedTimeRecords.slice(0, 50), // Limit to 50 most recent
        assignments: assignments, // ADDED THIS to fix missing field in response
        liveZone: liveZoneEmployees,
        summary: {
          totalActiveTimers: activeTimers.length,
          totalRecentShifts: workedTimeRecords.length,
          totalAssignments: assignments.length,
          totalLiveZoneEmployees: liveZoneEmployees.length,
          liveZoneWindowMinutes: {
            pre: LIVE_ZONE_PRE_MINUTES,
            post: LIVE_ZONE_POST_MINUTES
          },
          liveZoneStaleMinutes: LIVE_ZONE_STALE_MINUTES
        }
      };
      
    } catch (error) {
      logger.error('Error in EmployeeTrackingService.getEmployeeTrackingData', {
        error: error.message,
        stack: error.stack,
        organizationId
      });
      throw error;
    } finally {
      if (client) {
        await client.close();
      }
    }
  }
}

module.exports = EmployeeTrackingService;
