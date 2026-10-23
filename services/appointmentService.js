const ClientAssignment = require('../models/ClientAssignment');
const WorkedTime = require('../models/WorkedTime');
const logger = require('../config/logger');
const { parseFlexibleDate, normalizeToIsoDate, getZonedDateParts, zonedWallClockToUtc } = require('../utils/dateHelpers');

// SIL roster shifts are stored in UTC; the mobile app renders card and detail
// dates/times in the organisation's local zone (Australia/Sydney by default).
const SIL_TIMEZONE = 'Australia/Sydney';
const pad2 = (n) => String(n).padStart(2, '0');

const zonedYMD = (date) => {
  const p = getZonedDateParts(date, SIL_TIMEZONE);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
};

const zonedHHMM = (date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SIL_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (t) => parts.find((x) => x.type === t)?.value || '00';
  let h = parseInt(get('hour'), 10);
  if (h === 24) h = 0; // en-US can emit 24 at exactly midnight
  return `${pad2(h)}:${get('minute')}`;
};

/**
 * Service for handling appointment-related database operations
 */
class AppointmentService {
  /**
   * Load appointments for a user
   * @param {string} email - User email
   * @returns {Promise<Array>} Array of appointments
   */
  static async loadAppointments(email) {
    try {
      const { toSafeString } = require('../utils/security');
      const safeEmail = toSafeString(email);
      // Get appointments (client assignments) with client details
      const appointments = await ClientAssignment.aggregate([
        {
          $match: {
            userEmail: safeEmail,
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
          $unwind: {
            path: "$clientDetails",
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $project: {
            _id: 1,
            userEmail: 1,
            clientEmail: 1,
            clientId: 1,
            organizationId: 1,
            schedule: 1,
            createdAt: 1,
            isActive: 1,
            // Legacy format for compatibility with existing frontend
            dateList: {
              $ifNull: [
                {
                  $map: {
                    input: "$schedule",
                    as: "item",
                    in: "$item.date"
                  }
                },
                "$dateList"
              ]
            },
            startTimeList: {
              $ifNull: [
                {
                  $map: {
                    input: "$schedule",
                    as: "item",
                    in: "$item.startTime"
                  }
                },
                "$startTimeList"
              ]
            },
            endTimeList: {
              $ifNull: [
                {
                  $map: {
                    input: "$schedule",
                    as: "item",
                    in: "$item.endTime"
                  }
                },
                "$endTimeList"
              ]
            },
            breakList: {
              $ifNull: [
                {
                  $map: {
                    input: "$schedule",
                    as: "item",
                    in: "$item.break"
                  }
                },
                "$breakList"
              ]
            },
            clientDetails: 1
          }
        },
        {
          $sort: {
            createdAt: -1
          }
        }
      ]);

      // SIL roster shifts (Phase 2) are not ClientAssignments — augment so
      // support workers whose bookings are SIL shifts still get home cards.
      const silAppointments = await this.buildSilShiftAppointments(safeEmail);

      return [...appointments, ...silAppointments];
    } catch (error) {
      logger.error('Appointments load failed', {
        error: error.message,
        stack: error.stack,
        email
      });
      throw new Error('Failed to load appointments');
    }
  }

  /**
   * Employee home "Upcoming shifts" cards are fed from ClientAssignment
   * documents, but SIL roster shifts (SIL_MANAGEMENT_SPEC Phase 2) live in the
   * Shift collection carrying `silRosterOfCareId` — without this augmentation
   * a support worker whose only bookings are SIL roster shifts sees
   * "No upcoming appointments" on home even though their week was published.
   *
   * Synthesises assignment-shaped entries from the employee's SIL shifts,
   * grouped per client, with schedule items in the roster property timezone
   * (date 'YYYY-MM-DD', times 'HH:mm' — the shape the mobile dashboard parses).
   * @param {string} email - employee email (already sanitized)
   * @returns {Promise<Array<Object>>}
   */
  static async buildSilShiftAppointments(email) {
    try {
      const Shift = require('../models/Shift');
      const mongoose = require('mongoose');

      // Yesterday onward: the dashboard also shows today's shift as
      // in-progress/overdue after its end time when the timer is running.
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const shifts = await Shift.find({
        employeeEmail: email,
        silRosterOfCareId: { $ne: null },
        status: { $ne: 'cancelled' },
        endTime: { $gte: cutoff }
      })
        .sort({ startTime: 1 })
        .limit(60)
        .lean();
      if (shifts.length === 0) return [];

      // One card per client; schedule = all that client's SIL shifts.
      const byClientId = new Map();
      for (const shift of shifts) {
        const key = String(shift.clientId || 'unknown');
        if (!byClientId.has(key)) byClientId.set(key, []);
        byClientId.get(key).push(shift);
      }

      const objectIdKeys = [...byClientId.keys()].filter(
        (k) => k !== 'unknown' && mongoose.Types.ObjectId.isValid(k)
      );
      const Client = require('../models/Client');
      const clients = objectIdKeys.length
        ? await Client.find({ _id: { $in: objectIdKeys.map((k) => new mongoose.Types.ObjectId(k)) } })
            .select('clientFirstName clientLastName clientEmail')
            .lean()
        : [];
      const detailsByClientId = new Map(clients.map((c) => [String(c._id), c]));

      return [...byClientId.entries()].map(([clientIdKey, clientShifts]) => {
        const clientDetails = detailsByClientId.get(clientIdKey) || null;
        const first = clientShifts[0];
        return {
          // Synthetic id — not a real ClientAssignment row.
          _id: `sil-shift-${String(first._id)}`,
          userEmail: first.employeeEmail || email,
          clientEmail: (clientDetails && clientDetails.clientEmail) || '',
          clientId: clientIdKey !== 'unknown' ? clientIdKey : null,
          organizationId: first.organizationId
            ? String(first.organizationId)
            : undefined,
          isActive: true,
          clientDetails,
          schedule: clientShifts.map((shift) => ({
            shiftId: String(shift._id),
            date: zonedYMD(shift.startTime),
            startTime: zonedHHMM(shift.startTime),
            endTime: zonedHHMM(shift.endTime),
            shiftType: shift.shiftType,
            status: shift.status,
            silRosterOfCareId: shift.silRosterOfCareId
              ? String(shift.silRosterOfCareId)
              : null
          })),
          isSilRosterShift: true
        };
      });
    } catch (error) {
      // SIL augmentation must never break regular appointment loading.
      logger.warn('SIL shift appointment augmentation failed', {
        error: error.message,
        email
      });
      return [];
    }
  }

  /**
   * Build appointment details for a SIL roster shift.
   *
   * SIL shifts are rostered through `silRostersOfCare`/`shifts`; they are not
   * `ClientAssignment` rows. Without this fallback the details screen (opened
   * from a SIL shift card) finds nothing and shows an endless loading state.
   *
   * @param {string} userEmail - Support worker email
   * @param {string} clientEmail - Participant email
   * @returns {Promise<Object|null>} Appointment-shaped details, or null.
   */
  static async buildSilAppointmentDetails(userEmail, clientEmail) {
    const Shift = require('../models/Shift');
    const Client = require('../models/Client');

    const client = await Client.findOne({ clientEmail }).lean();
    if (!client) return null;

    const shifts = await Shift.find({
      employeeEmail: userEmail,
      clientId: client._id,
      silRosterOfCareId: { $ne: null },
      status: { $ne: 'cancelled' }
    })
      .sort({ startTime: 1 })
      .limit(60)
      .lean();
    if (shifts.length === 0) return null;

    const schedule = shifts.map((shift) => ({
      shiftId: String(shift._id),
      date: zonedYMD(shift.startTime),
      startTime: zonedHHMM(shift.startTime),
      endTime: zonedHHMM(shift.endTime),
      break: shift.break ?? null,
      shiftType: shift.shiftType,
      status: shift.status,
      silRosterOfCareId: shift.silRosterOfCareId
        ? String(shift.silRosterOfCareId)
        : null
    }));

    return {
      // Synthetic id — mirrors buildSilShiftAppointments so the home card and
      // the details screen identify the same record.
      _id: `sil-shift-${String(shifts[0]._id)}`,
      userEmail,
      clientEmail,
      clientId: String(client._id),
      organizationId: shifts[0].organizationId
        ? String(shifts[0].organizationId)
        : undefined,
      isActive: true,
      isSilRosterShift: true,
      schedule,
      // Legacy arrays keep the older table renderer working.
      dateList: schedule.map((s) => s.date),
      startTimeList: schedule.map((s) => s.startTime),
      endTimeList: schedule.map((s) => s.endTime),
      breakList: schedule.map((s) => s.break),
      clientDetails: client
    };
  }

  /**
   * Get appointment details for a specific user and client
   * @param {string} userEmail - User email
   * @param {string} clientEmail - Client email
   * @returns {Promise<Object>} Appointment details
   */
  static async loadAppointmentDetails(userEmail, clientEmail) {
    try {
      const { toSafeString } = require('../utils/security');
      const safeUserEmail = toSafeString(userEmail);
      const safeClientEmail = toSafeString(clientEmail);

      // Get the specific appointment assignment with client details
      const appointmentDetails = await ClientAssignment.aggregate([
        {
          $match: {
            userEmail: safeUserEmail,
            clientEmail: safeClientEmail,
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
          $unwind: {
            path: "$clientDetails",
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $project: {
            _id: 1,
            userEmail: 1,
            clientEmail: 1,
            clientId: 1,
            organizationId: 1,
            schedule: 1,
            createdAt: 1,
            isActive: 1,
            // Legacy format for compatibility with existing frontend
            dateList: {
              $ifNull: [
                {
                  $map: {
                    input: "$schedule",
                    as: "item",
                    in: "$item.date"
                  }
                },
                "$dateList"
              ]
            },
            startTimeList: {
              $ifNull: [
                {
                  $map: {
                    input: "$schedule",
                    as: "item",
                    in: "$item.startTime"
                  }
                },
                "$startTimeList"
              ]
            },
            endTimeList: {
              $ifNull: [
                {
                  $map: {
                    input: "$schedule",
                    as: "item",
                    in: "$item.endTime"
                  }
                },
                "$endTimeList"
              ]
            },
            breakList: {
              $ifNull: [
                {
                  $map: {
                    input: "$schedule",
                    as: "item",
                    in: "$item.break"
                  }
                },
                "$breakList"
              ]
            },
            clientDetails: 1
          }
        }
      ]);

      // SIL roster shifts are NOT ClientAssignment rows: fall back to the
      // Shift collection so SIL shift cards open with client details instead
      // of failing as "not found".
      const appointment =
        appointmentDetails.length > 0
          ? appointmentDetails[0]
          : await this.buildSilAppointmentDetails(safeUserEmail, safeClientEmail);

      if (!appointment) {
        throw new Error('No appointment found for this user-client combination');
      }

      // Get all worked time records for this user and client to populate history correctly
      const timeRecords = await WorkedTime.find({
        userEmail: safeUserEmail,
        clientEmail: safeClientEmail,
        isActive: true
      }).lean();

      // Map to fields expected by the frontend (using shiftDate/shiftStartTime)
      appointment.timeRecords = timeRecords.map(record => ({
        ...record,
        id: record._id ? record._id.toString() : null,
        date: record.shiftDate || (record.workDate ? record.workDate.toISOString().split('T')[0] : null),
        startTime: record.shiftStartTime || null,
        endTime: record.shiftEndTime || null
      }));

      return {
        assignedClient: appointment,
        clientDetails: [appointment.clientDetails]
      };
    } catch (error) {
      logger.error('Appointment details load failed', {
        error: error.message,
        stack: error.stack,
        userEmail,
        clientEmail
      });
      throw error;
    }
  }

  /**
   * Get all assignments for an organization
   * @param {string} organizationId - Organization ID
   * @returns {Promise<Array>} Array of assignments
   */
  static async getOrganizationAssignments(organizationId) {
    try {
      const { toSafeString } = require('../utils/security');
      const safeOrgId = toSafeString(organizationId);

      // Get assignments with client details for the organization
      const assignments = await ClientAssignment.aggregate([
        {
          $match: {
            organizationId: safeOrgId,
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
            from: "users", // Assuming 'login' collection is mapped to users via User model, but lookups use collection name. User model maps to 'login'.
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
          $project: {
            _id: 1,
            userEmail: 1,
            clientEmail: 1,
            clientId: 1,
            organizationId: 1,
            schedule: 1,
            createdAt: 1,
            isActive: 1,
            // Legacy format for compatibility
            dateList: {
              $map: {
                input: "$schedule",
                as: "item",
                in: "$item.date"
              }
            },
            startTimeList: {
              $map: {
                input: "$schedule",
                as: "item",
                in: "$item.startTime"
              }
            },
            endTimeList: {
              $map: {
                input: "$schedule",
                as: "item",
                in: "$item.endTime"
              }
            },
            breakList: {
              $map: {
                input: "$schedule",
                as: "item",
                in: "$item.break"
              }
            },
            clientDetails: 1,
            userDetails: 1
          }
        },
        {
          $sort: {
            createdAt: -1
          }
        }
      ]);

      // Note: If 'users' lookup fails because collection is 'login', we might need to adjust.
      // But based on previous files, 'login' is the collection name for User model.
      // So I should change 'from: "users"' to 'from: "login"'.
      
      return assignments;
    } catch (error) {
      logger.error('Organization assignments fetch failed', {
        error: error.message,
        stack: error.stack,
        organizationId
      });
      throw new Error('Failed to get organization assignments');
    }
  }

  /**
   * Remove client assignment (soft delete)
   * @param {string} userEmail - User email
   * @param {string} clientEmail - Client email
   * @returns {Promise<Object>} Result of the operation
   */
  static async removeClientAssignment(userEmail, clientEmail) {
    try {
      const { toSafeString } = require('../utils/security');
      const safeUserEmail = toSafeString(userEmail);
      const safeClientEmail = toSafeString(clientEmail);

      // Soft delete assignment
      const result = await ClientAssignment.updateOne(
        {
          userEmail: safeUserEmail,
          clientEmail: safeClientEmail,
          isActive: true
        },
        {
          $set: {
            isActive: false,
            deletedAt: new Date()
          }
        }
      );

      if (result.matchedCount === 0) {
        throw new Error('Assignment not found');
      }

      return { success: true, message: 'Assignment removed successfully' };
    } catch (error) {
      logger.error('Client assignment removal failed', {
        error: error.message,
        stack: error.stack,
        userEmail,
        clientEmail
      });
      throw error;
    }
  }

  /**
   * Set worked time for a client
   * @param {Object} workedTimeData - Worked time data
   * @returns {Promise<Object>} Result of the operation
   */
  static async setWorkedTime(workedTimeData) {
    try {
      const { toSafeString } = require('../utils/security');
      const {
        userEmail,
        clientEmail,
        timeList,
        shiftIndex,
        shiftDate: _shiftDateFromRequest,
        shiftStartTime: _shiftStartTimeFromRequest,
        shiftEndTime: _shiftEndTimeFromRequest,
        shiftBreak: _shiftBreakFromRequest
      } = workedTimeData;

      const safeUserEmail = toSafeString(userEmail);
      const safeClientEmail = toSafeString(clientEmail);

      // Validate required fields
      if (!safeUserEmail || !safeClientEmail || !timeList) {
        throw new Error('Missing required fields: userEmail, clientEmail, timeList');
      }

      // Find the assigned client record. SIL roster shifts have no
      // ClientAssignment row, so fall back to the worker's SIL shifts for the
      // participant (same source the details screen reads).
      let assignedClient = await ClientAssignment.findOne({
        userEmail: safeUserEmail,
        clientEmail: safeClientEmail,
        isActive: true
      });

      // buildSilAppointmentDetails returns the assignment-shaped object
      // (schedule + clientDetails) for the worker's SIL shifts.
      let silAssignment = null;
      if (!assignedClient) {
        silAssignment = await this.buildSilAppointmentDetails(
          safeUserEmail,
          safeClientEmail
        );
        if (!silAssignment) {
          throw new Error('Assigned client not found');
        }
        assignedClient = silAssignment;
      }

      // Get shift details from the assigned client record
      let shiftDate = null;
      let shiftStartTime = null;
      let shiftEndTime = null;
      let shiftBreak = null;
      let shiftNdisItem = null;
      let shiftHighIntensity = false;

      // Extract shift details based on shiftIndex
      let effectiveShiftIndex = shiftIndex || 0;

      // SIL clients: prefer the explicit date/time the caller selected. The
      // details payload is rebuilt from live shifts, so an index captured
      // earlier can drift if another shift was materialised in between.
      if (silAssignment && _shiftDateFromRequest) {
        const requestedDate = normalizeToIsoDate(_shiftDateFromRequest);
        const requestedStart = _shiftStartTimeFromRequest
          ? String(_shiftStartTimeFromRequest).slice(0, 5)
          : null;
        if (requestedDate) {
          const matchIndex = (assignedClient.schedule || []).findIndex(
            (entry) =>
              entry.date === requestedDate &&
              (!requestedStart || entry.startTime === requestedStart)
          );
          if (matchIndex >= 0) effectiveShiftIndex = matchIndex;
        }
      }

      if (assignedClient.schedule && assignedClient.schedule.length > effectiveShiftIndex) {
        // Use new schedule array format
        const shift = assignedClient.schedule[effectiveShiftIndex];
        shiftDate = shift.date;
        shiftStartTime = shift.startTime;
        shiftEndTime = shift.endTime;
        shiftBreak = shift.break;
        shiftNdisItem = shift.ndisItem || null;
        shiftHighIntensity = !!shift.highIntensity;
      } else if (assignedClient.dateList && assignedClient.dateList.length > effectiveShiftIndex) {
        // Fallback to legacy format - though schema might not have these if strict
        // But assuming mixed usage or migration
        shiftDate = assignedClient.dateList[effectiveShiftIndex];
        shiftStartTime = assignedClient.startTimeList ? assignedClient.startTimeList[effectiveShiftIndex] : null;
        shiftEndTime = assignedClient.endTimeList ? assignedClient.endTimeList[effectiveShiftIndex] : null;
        shiftBreak = assignedClient.breakList ? assignedClient.breakList[effectiveShiftIndex] : null;
      }

      // Strict behavior: selected shift index must resolve to an actual shift.
      if (!shiftDate || !shiftStartTime || !shiftEndTime) {
        throw new Error('Selected shift index is invalid or shift details are missing');
      }

      // WorkedTime schema requires workDate. Prefer selected shift date; fallback
      // to current date to prevent validation failure on partial payloads.
      let normalizedWorkDate = new Date();
      if (shiftDate instanceof Date) {
        normalizedWorkDate = shiftDate;
      } else if (typeof shiftDate === 'string' && shiftDate.trim()) {
        // Day-first (DD/MM/YYYY) is read as day-first; ISO passes through.
        const parsedShiftDate = parseFlexibleDate(shiftDate);
        if (parsedShiftDate) {
          normalizedWorkDate = parsedShiftDate;
        } else {
          throw new Error('Selected shift date is invalid');
        }
      } else {
        throw new Error('Selected shift date is missing');
      }

      // `WorkedTime.shiftDate` is a String column that analytics/payroll range
      // query lexicographically, so it must always be stored as ISO
      // (YYYY-MM-DD). Normalise whatever the caller sent (ISO, DD/MM/YYYY, or
      // even a Date) to that single sortable shape.
      const shiftDateKey = normalizeToIsoDate(shiftDate) || null;

      // Parse HH:mm:ss into decimal hours for reporting queries.
      const parseTotalHours = (worked) => {
        if (!worked || typeof worked !== 'string') return 0;
        const parts = worked.split(':').map(Number);
        if (parts.length !== 3 || parts.some((p) => Number.isNaN(p))) return 0;
        const [h, m, s] = parts;
        return h + (m / 60) + (s / 3600);
      };

      const parseTotalSeconds = (worked) => {
        if (!worked || typeof worked !== 'string') return 0;
        const parts = worked.split(':').map(Number);
        if (parts.length !== 3 || parts.some((p) => Number.isNaN(p))) return 0;
        const [h, m, s] = parts;
        return (h * 3600) + (m * 60) + s;
      };

      // Build the shift window in the organisation's local zone. Using
      // `new Date(`${date}T${time}`)` reads the time in the *server's* zone
      // (UTC in production), which shifted every worked-time start/end by the
      // Sydney offset and broke overnight detection.
      const combineDateAndTime = (dateValue, timeValue) => {
        if (!dateValue || !timeValue) return null;
        const datePart = normalizeToIsoDate(dateValue);
        if (!datePart) return null;
        const match = String(timeValue).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
        if (!match) return null;
        const [year, month, day] = datePart.split('-').map(Number);
        if (!year || !month || !day) return null;
        return zonedWallClockToUtc(
          year,
          month,
          day,
          Number(match[1]),
          Number(match[2]),
          SIL_TIMEZONE
        );
      };

      let normalizedStartDateTime = combineDateAndTime(shiftDate, shiftStartTime);
      let normalizedEndDateTime = combineDateAndTime(shiftDate, shiftEndTime);

      // Overnight shifts end on the following day (e.g. 22:00 -> 01:00).
      if (
        normalizedStartDateTime &&
        normalizedEndDateTime &&
        normalizedEndDateTime <= normalizedStartDateTime
      ) {
        normalizedEndDateTime = new Date(
          normalizedEndDateTime.getTime() + 24 * 60 * 60 * 1000
        );
      }
      const totalSeconds = parseTotalSeconds(timeList);

      // SIL shifts are backed by a Shift document, not a ClientAssignment; keep
      // the link so payroll/rostering can trace the saved hours to the shift.
      const mongoose = require('mongoose');
      const selectedSilShiftId = silAssignment
        ? (assignedClient.schedule?.[effectiveShiftIndex]?.shiftId || null)
        : null;
      const silShiftId =
        selectedSilShiftId && mongoose.Types.ObjectId.isValid(selectedSilShiftId)
          ? new mongoose.Types.ObjectId(selectedSilShiftId)
          : undefined;

      // Create worked time record with specific shift details
      const workedTimeRecord = new WorkedTime({
        userEmail: userEmail,
        clientEmail: clientEmail,
        organizationId: assignedClient.organizationId,
        workDate: normalizedWorkDate,
        date: normalizedWorkDate,
        timeWorked: timeList,
        totalSeconds: totalSeconds,
        totalHours: parseTotalHours(timeList),
        shiftIndex: effectiveShiftIndex,
        assignedClientId: silAssignment ? undefined : assignedClient._id,
        silShiftId,
        // Add specific shift details for better linking
        shiftDate: shiftDateKey,
        shiftStartTime: shiftStartTime,
        shiftEndTime: shiftEndTime,
        shiftBreak: shiftBreak,
        ndisItem: shiftNdisItem,
        highIntensity: shiftHighIntensity,
        startTime: normalizedStartDateTime,
        endTime: normalizedEndDateTime,
        // Create a unique shift identifier
        shiftKey: shiftDateKey && shiftStartTime ? `${shiftDateKey}_${shiftStartTime}` : null,
        createdAt: new Date(),
        isActive: true
      });

      // Insert the worked time record
      const result = await workedTimeRecord.save();

      return {
        success: true,
        message: 'Worked time saved successfully',
        data: {
          id: result._id,
          timeWorked: timeList
        }
      };
    } catch (error) {
      logger.error('Worked time setting failed', {
        error: error.message,
        stack: error.stack,
        userEmail: workedTimeData?.userEmail,
        clientEmail: workedTimeData?.clientEmail
      });
      throw error;
    }
  }
  
  /**
   * Reassign a specific shift from one user to another
   * @param {string} organizationId - Organization ID
   * @param {string} oldUserEmail - Current user email
   * @param {string} newUserEmail - New user email
   * @param {string} clientEmail - Client email
   * @param {Object} shiftDetails - Details of the shift to swap { date, startTime, endTime, break }
   * @returns {Promise<Object>} Result
   */
  static async reassignShift(organizationId, oldUserEmail, newUserEmail, clientEmail, shiftDetails) {
    try {
      const { toSafeString } = require('../utils/security');
      const safeOrgId = toSafeString(organizationId);
      const safeOldUserEmail = toSafeString(oldUserEmail);
      const safeNewUserEmail = toSafeString(newUserEmail);
      const safeClientEmail = toSafeString(clientEmail);

      // INTERNAL HELPER: Normalize schedule from legacy fields
      const getNormalizedSchedule = (doc) => {
        if (doc.schedule && doc.schedule.length > 0) return doc.schedule;
        // Accessing legacy fields via .toObject() or direct access if schema allows
        // Assuming schema might be strict, so use .get() if needed or just access
        const docObj = doc.toObject ? doc.toObject() : doc;
        if (!docObj.dateList || !Array.isArray(docObj.dateList)) return [];
        return docObj.dateList.map((date, i) => ({
          date,
          startTime: docObj.startTimeList ? docObj.startTimeList[i] : null,
          endTime: docObj.endTimeList ? docObj.endTimeList[i] : null,
          break: docObj.breakList ? docObj.breakList[i] : null,
        }));
      };

      // 1. Process Old User (Remove Shift)
      const oldAssignment = await ClientAssignment.findOne({
        organizationId: safeOrgId,
        userEmail: safeOldUserEmail,
        clientEmail: safeClientEmail,
        isActive: true
      });

      if (!oldAssignment) {
        throw new Error(`Assignment not found for old user: ${oldUserEmail}`);
      }

      let oldSchedule = getNormalizedSchedule(oldAssignment);

      // Helper for robust comparison
      const normalizeDate = (d) => {
        if (!d) return '';
        if (d instanceof Date) return d.toISOString().split('T')[0];
        return d.toString().split('T')[0];
      };

      const isSameShift = (s, target) => {
        const d1 = normalizeDate(s.date);
        const d2 = normalizeDate(target.date);
        const t1 = (s.startTime || '').toString().trim();
        const t2 = (target.startTime || '').toString().trim();
        return d1 === d2 && t1 === t2;
      };

      // Filter out the shift
      const originalLength = oldSchedule.length;
      oldSchedule = oldSchedule.filter(s => !isSameShift(s, shiftDetails));

      if (oldSchedule.length === originalLength) {
        // Shift not found in schedule
        console.error(`Shift not found in old user's schedule. Looking for: ${JSON.stringify(shiftDetails)}`);
        throw new Error(`Shift not found within old user's schedule: ${shiftDetails.date} ${shiftDetails.startTime}`);
      }

      // Update old user doc (migrating to 'schedule' field)
      await ClientAssignment.updateOne(
        { _id: oldAssignment._id },
        {
          $set: {
            schedule: oldSchedule,
            updatedAt: new Date(),
            // Clear legacy fields to prevent confusion - schema might reject this if fields not in schema
            // but for now keeping logic same as before
            // If schema is strict, these unset/set might be ignored if fields are not in schema
          },
          $unset: {
             dateList: "",
             startTimeList: "",
             endTimeList: "",
             breakList: ""
          }
        }
      );

      // 2. Process New User (Add Shift)
      const newAssignment = await ClientAssignment.findOne({
        organizationId: safeOrgId,
        userEmail: safeNewUserEmail,
        clientEmail: safeClientEmail,
        isActive: true
      });

      if (newAssignment) {
        let newSchedule = getNormalizedSchedule(newAssignment);
        newSchedule.push(shiftDetails);

        await ClientAssignment.updateOne(
          { _id: newAssignment._id },
          {
            $set: {
              schedule: newSchedule,
              updatedAt: new Date()
            },
            $unset: {
               dateList: "",
               startTimeList: "",
               endTimeList: "",
               breakList: ""
            }
          }
        );
      } else {
        // Create new assignment
        await ClientAssignment.create({
          organizationId: safeOrgId,
          userEmail: safeNewUserEmail,
          clientEmail: safeClientEmail,
          clientId: oldAssignment.clientId, // Need clientId
          schedule: [shiftDetails],
          isActive: true,
          createdAt: new Date()
        });
      }

      return { success: true };
    } catch (error) {
      logger.error('Reassign shift failed', {
        error: error.message,
        stack: error.stack,
        organizationId, oldUserEmail, newUserEmail
      });
      // Propagate error so RequestService knows it failed
      throw error;
    }
  }
}
module.exports = AppointmentService;
