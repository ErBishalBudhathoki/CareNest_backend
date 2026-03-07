const mongoose = require('mongoose');
const ClientAssignment = require('../models/ClientAssignment');
const Client = require('../models/Client');
const User = require('../models/User');
const WorkedTime = require('../models/WorkedTime');
const GeofenceLocation = require('../models/GeofenceLocation');
const ServiceFeedback = require('../models/ServiceFeedback');
const { Invoice } = require('../models/Invoice');
const realtimeTrackingService = require('./realtimeTrackingService');
const messagingService = require('./messagingService');
const {
  buildChatWindow,
  getChatWindowClosedMessage,
  toShiftDateTime,
} = require('./chatWindowPolicy');

const DEFAULT_GEOFENCE_VISIBILITY_RADIUS_METERS = 800;
const DAY_MS = 24 * 60 * 60 * 1000;

const normalizeEmail = (value) => (value || '').toString().trim().toLowerCase();

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const toObjectId = (value) => {
  if (!value || !isValidObjectId(value)) return null;
  return new mongoose.Types.ObjectId(value);
};

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const buildShiftBounds = (dateValue, startTimeValue, endTimeValue) => {
  const startAt = toShiftDateTime(dateValue, startTimeValue);
  const endCandidate = toShiftDateTime(dateValue, endTimeValue);

  if (!startAt || !endCandidate) {
    return {
      startAt,
      endAt: endCandidate,
    };
  }

  const endAt =
    endCandidate.getTime() <= startAt.getTime()
      ? new Date(endCandidate.getTime() + DAY_MS)
      : endCandidate;

  return {
    startAt,
    endAt,
  };
};

const isSameCalendarDate = (dateA, dateB) => {
  if (!dateA || !dateB) return false;
  return (
    dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate()
  );
};

const deriveShiftStatus = (startAt, endAt, now = new Date()) => {
  if (!startAt || !endAt) return 'scheduled';
  if (now < startAt) return 'scheduled';
  if (now > endAt) return 'completed';
  return 'in_progress';
};

const buildWorkerName = (workerDoc, fallbackEmail) => {
  if (!workerDoc) return fallbackEmail || 'Assigned Worker';
  const first = (workerDoc.firstName || '').toString().trim();
  const last = (workerDoc.lastName || '').toString().trim();
  const full = `${first} ${last}`.trim();
  return full || workerDoc.email || fallbackEmail || 'Assigned Worker';
};

const extractServiceName = (assignment, scheduleItem) => {
  const item = scheduleItem?.ndisItem;

  if (typeof item === 'string' && item.trim().length > 0) {
    return item.trim();
  }

  if (item && typeof item === 'object') {
    return (
      item.itemName ||
      item.name ||
      item.serviceName ||
      item.description ||
      item.itemNumber ||
      assignment?.assignedNdisItemNumber ||
      'Support Service'
    );
  }

  return assignment?.assignedNdisItemNumber || 'Support Service';
};

const safeIso = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const buildClientName = (clientDoc, fallbackEmail) => {
  if (!clientDoc) return fallbackEmail || 'Client';
  const first = (clientDoc.clientFirstName || '').toString().trim();
  const last = (clientDoc.clientLastName || '').toString().trim();
  const full = `${first} ${last}`.trim();
  return full || clientDoc.clientEmail || fallbackEmail || 'Client';
};

class ClientPortalService {
  async resolveClientContext({ authUser, requestedClientId = null }) {
    const authEmail = normalizeEmail(authUser?.email);

    if (!authEmail) {
      throw createHttpError(401, 'Authentication required');
    }

    const roles = Array.isArray(authUser?.roles)
      ? authUser.roles.map((role) => role.toString().toLowerCase())
      : [];
    const isAdmin = roles.includes('admin') || roles.includes('superadmin');

    const userDoc = await User.findOne({ email: authEmail }).lean();

    let clientDoc = null;

    if (requestedClientId && isValidObjectId(requestedClientId)) {
      clientDoc = await Client.findOne({
        _id: toObjectId(requestedClientId),
        isActive: true,
      }).lean();
    }

    if (!clientDoc && userDoc?.clientId) {
      clientDoc = await Client.findOne({
        _id: userDoc.clientId,
        isActive: true,
      }).lean();
    }

    if (!clientDoc) {
      clientDoc = await Client.findOne({
        clientEmail: authEmail,
        isActive: true,
      }).lean();
    }

    if (!clientDoc) {
      throw createHttpError(404, 'Client profile not found');
    }

    if (!isAdmin && requestedClientId && requestedClientId !== clientDoc._id.toString()) {
      throw createHttpError(403, 'You can only access your own client data');
    }

    return {
      authEmail,
      roles,
      isAdmin,
      user: userDoc,
      client: clientDoc,
    };
  }

  async getClientAssignments(clientContext) {
    const clientId = clientContext.client._id;
    const clientEmail = normalizeEmail(clientContext.client.clientEmail);

    const assignments = await ClientAssignment.find({
      isActive: true,
      $or: [
        { clientId: clientId },
        { clientEmail: clientEmail },
      ],
    })
      .sort({ createdAt: -1 })
      .lean();

    if (!assignments.length) {
      return {
        assignments: [],
        workerByEmail: new Map(),
      };
    }

    const workerEmails = [
      ...new Set(
        assignments
          .map((assignment) => normalizeEmail(assignment.userEmail))
          .filter(Boolean)
      ),
    ];

    const workers = await User.find({
      email: { $in: workerEmails },
    }).lean();

    const workerByEmail = new Map(
      workers.map((worker) => [normalizeEmail(worker.email), worker])
    );

    return {
      assignments,
      workerByEmail,
    };
  }

  flattenAppointments(assignments, workerByEmail) {
    const appointments = [];

    assignments.forEach((assignment) => {
      const schedules = Array.isArray(assignment.schedule) ? assignment.schedule : [];
      const workerEmail = normalizeEmail(assignment.userEmail);
      const workerDoc = workerByEmail.get(workerEmail);
      const workerName = buildWorkerName(workerDoc, assignment.userEmail);

      schedules.forEach((item, index) => {
        const appointmentId = item?._id
          ? item._id.toString()
          : `${assignment._id.toString()}_${index}`;

        const { startAt, endAt } = buildShiftBounds(
          item?.date,
          item?.startTime,
          item?.endTime
        );

        appointments.push({
          appointmentId,
          scheduleId: appointmentId,
          assignmentId: assignment._id.toString(),
          assignment,
          scheduleItem: item,
          date: item?.date || '',
          startTime: item?.startTime || '',
          endTime: item?.endTime || '',
          startAt,
          endAt,
          userEmail: assignment.userEmail,
          workerEmail,
          workerId: workerDoc?._id?.toString() || assignment.userEmail,
          workerName,
          workerDoc,
          serviceName: extractServiceName(assignment, item),
        });
      });
    });

    appointments.sort((a, b) => {
      const left = a.startAt ? a.startAt.getTime() : Number.MAX_SAFE_INTEGER;
      const right = b.startAt ? b.startAt.getTime() : Number.MAX_SAFE_INTEGER;
      return left - right;
    });

    return appointments;
  }

  async findAppointmentContext(clientContext, appointmentId) {
    const { assignments, workerByEmail } = await this.getClientAssignments(clientContext);
    const appointments = this.flattenAppointments(assignments, workerByEmail);

    const appointment = appointments.find((item) => item.appointmentId === appointmentId);

    if (!appointment) {
      throw createHttpError(404, 'Appointment not found for this client');
    }

    return {
      appointment,
      appointments,
      assignments,
      workerByEmail,
    };
  }

  async getClientDashboard(clientId, authUser) {
    const clientContext = await this.resolveClientContext({
      authUser,
      requestedClientId: clientId,
    });

    const { assignments, workerByEmail } = await this.getClientAssignments(clientContext);
    const appointments = this.flattenAppointments(assignments, workerByEmail);

    const now = new Date();

    const todayAppointments = appointments
      .filter((appt) => appt.startAt && isSameCalendarDate(appt.startAt, now))
      .map((appt) => {
        const chatWindow = buildChatWindow({
          startAt: appt.startAt,
          endAt: appt.endAt,
          now,
        });

        return {
          appointmentId: appt.appointmentId,
          workerName: appt.workerName,
          serviceName: appt.serviceName,
          startTime: appt.startTime,
          endTime: appt.endTime,
          status: deriveShiftStatus(appt.startAt, appt.endAt, now),
          eta: null,
          workerPhoto: appt.workerDoc?.profilePic || appt.workerDoc?.photoURL || null,
          canMessage: chatWindow.isOpen,
          chatWindowStatus: chatWindow.status,
          chatStartAt: safeIso(chatWindow.chatStartAt),
          chatEndAt: safeIso(chatWindow.chatEndAt),
        };
      });

    const upcomingAppointments = appointments
      .filter((appt) => appt.startAt && appt.startAt > now)
      .slice(0, 20)
      .map((appt) => ({
        appointmentId: appt.appointmentId,
        workerName: appt.workerName,
        serviceName: appt.serviceName,
        date: appt.date,
        startTime: appt.startTime,
        endTime: appt.endTime,
        status: 'scheduled',
      }));

    const recentActivity = appointments
      .filter((appt) => appt.endAt && appt.endAt < now)
      .sort((a, b) => (b.endAt?.getTime() || 0) - (a.endAt?.getTime() || 0))
      .slice(0, 10)
      .map((appt) => ({
        type: 'service_completed',
        message: `${appt.serviceName} completed with ${appt.workerName}`,
        timestamp: safeIso(appt.endAt) || new Date().toISOString(),
      }));

    const notifications = [];

    const nextAppointment = upcomingAppointments[0];
    if (nextAppointment) {
      notifications.push({
        id: `notif-next-${nextAppointment.appointmentId}`,
        type: 'upcoming_appointment',
        message: `Upcoming ${nextAppointment.serviceName} with ${nextAppointment.workerName} at ${nextAppointment.startTime}`,
        timestamp: new Date().toISOString(),
        read: false,
      });
    }

    const dashboard = {
      clientId: clientContext.client._id.toString(),
      clientName: `${clientContext.client.clientFirstName || ''} ${clientContext.client.clientLastName || ''}`.trim(),
      todayAppointments,
      upcomingAppointments,
      recentActivity,
      notifications,
    };

    return {
      success: true,
      data: dashboard,
    };
  }

  async getAppointments(authUser) {
    const clientContext = await this.resolveClientContext({ authUser });
    const { assignments, workerByEmail } = await this.getClientAssignments(clientContext);
    const appointments = this.flattenAppointments(assignments, workerByEmail);

    const list = appointments.map((appt) => ({
      id: appt.scheduleId,
      date: appt.date,
      startTime: appt.startTime,
      endTime: appt.endTime,
      userEmail: appt.userEmail,
      assignmentId: appt.assignmentId,
      scheduleId: appt.scheduleId,
    }));

    return {
      success: true,
      data: list,
    };
  }

  async getAppointmentDetail(assignmentId, scheduleId, authUser) {
    const clientContext = await this.resolveClientContext({ authUser });

    const assignment = await ClientAssignment.findOne({
      _id: toObjectId(assignmentId),
      isActive: true,
      $or: [
        { clientId: clientContext.client._id },
        { clientEmail: normalizeEmail(clientContext.client.clientEmail) },
      ],
    }).lean();

    if (!assignment) {
      throw createHttpError(404, 'Assignment not found');
    }

    const scheduleItems = Array.isArray(assignment.schedule) ? assignment.schedule : [];
    const scheduleItem = scheduleItems.find((item) => item?._id?.toString() === scheduleId);

    if (!scheduleItem) {
      throw createHttpError(404, 'Schedule item not found');
    }

    const worker = await User.findOne({
      email: normalizeEmail(assignment.userEmail),
    }).lean();

    const now = new Date();
    const { startAt, endAt } = buildShiftBounds(
      scheduleItem.date,
      scheduleItem.startTime,
      scheduleItem.endTime
    );

    const detail = {
      id: scheduleId,
      date: scheduleItem.date || '',
      startTime: scheduleItem.startTime || '',
      endTime: scheduleItem.endTime || '',
      status: deriveShiftStatus(startAt, endAt, now),
      notes: null,
      employee: worker
        ? {
            email: worker.email,
            firstName: worker.firstName || '',
            lastName: worker.lastName || '',
            phone: worker.phone || null,
            photo: worker.profilePic || worker.photoURL || null,
          }
        : null,
      services: [extractServiceName(assignment, scheduleItem)],
      serviceName: extractServiceName(assignment, scheduleItem),
      location: [
        clientContext.client.clientAddress,
        clientContext.client.clientCity,
        clientContext.client.clientState,
        clientContext.client.clientZip,
      ]
        .filter(Boolean)
        .join(', '),
      assignmentId,
      scheduleId,
    };

    return {
      success: true,
      data: detail,
    };
  }

  async getWorkerLocation(appointmentId, authUser) {
    const clientContext = await this.resolveClientContext({ authUser });
    const { appointment } = await this.findAppointmentContext(clientContext, appointmentId);

    const liveTracking = await realtimeTrackingService.getLiveTrackingData(appointmentId);

    if (!liveTracking || !liveTracking.tracking || !liveTracking.currentLocation) {
      return {
        success: false,
        message: 'Worker location is unavailable until tracking is started by the worker.',
      };
    }

    const geofence = await GeofenceLocation.findOne({
      clientId: clientContext.client._id,
      isActive: true,
    })
      .sort({ updatedAt: -1 })
      .lean();

    const visibilityRadius = Math.max(
      geofence?.radius || DEFAULT_GEOFENCE_VISIBILITY_RADIUS_METERS,
      100
    );

    const isInsideVisibilityRegion =
      liveTracking.insideGeofence === true ||
      (typeof liveTracking.distance === 'number' && liveTracking.distance <= visibilityRadius);

    if (!isInsideVisibilityRegion) {
      return {
        success: false,
        message:
          'Location is hidden until your worker enters your service area geofence.',
        data: {
          appointmentId,
          trackingAvailable: false,
          distanceRemaining: liveTracking.distance,
        },
      };
    }

    const location = {
      appointmentId,
      workerName: appointment.workerName,
      latitude: liveTracking.currentLocation.latitude,
      longitude: liveTracking.currentLocation.longitude,
      accuracy: liveTracking.currentLocation.accuracy || 10,
      timestamp:
        safeIso(liveTracking.currentLocation.timestamp) || new Date().toISOString(),
      isEnRoute: !liveTracking.insideGeofence,
      eta:
        typeof liveTracking.eta === 'number'
          ? `${liveTracking.eta} minutes`
          : null,
      distanceRemaining:
        typeof liveTracking.distance === 'number'
          ? Number((liveTracking.distance / 1000).toFixed(2))
          : null,
      lastUpdated:
        safeIso(liveTracking.lastUpdate) || new Date().toISOString(),
    };

    return {
      success: true,
      data: location,
    };
  }

  async getAppointmentStatus(appointmentId, authUser) {
    const clientContext = await this.resolveClientContext({ authUser });
    const { appointment } = await this.findAppointmentContext(clientContext, appointmentId);

    const liveTracking = await realtimeTrackingService.getLiveTrackingData(appointmentId);
    const now = new Date();

    const status = {
      appointmentId,
      status: liveTracking?.status || deriveShiftStatus(appointment.startAt, appointment.endAt, now),
      workerName: appointment.workerName,
      serviceName: appointment.serviceName,
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      actualStartTime:
        appointment.startAt && now > appointment.startAt
          ? safeIso(appointment.startAt)
          : null,
      actualEndTime:
        appointment.endAt && now > appointment.endAt
          ? safeIso(appointment.endAt)
          : null,
      eta:
        typeof liveTracking?.eta === 'number'
          ? `${liveTracking.eta} minutes`
          : null,
      notes: [],
      photos: [],
      checklistItems: [
        { item: 'Worker arrived at service location', completed: liveTracking?.insideGeofence === true },
        {
          item: 'Service within scheduled shift window',
          completed: now >= (appointment.startAt || now) && now <= (appointment.endAt || now),
        },
      ],
      lastUpdated: new Date().toISOString(),
    };

    return {
      success: true,
      data: status,
    };
  }

  async sendClientMessage(messageData, authUser) {
    const clientContext = await this.resolveClientContext({ authUser });

    const appointmentId = (messageData.appointmentId || '').toString();
    const text = (messageData.message || '').toString().trim();

    if (!appointmentId || !text) {
      throw createHttpError(400, 'appointmentId and message are required');
    }

    const { appointment } = await this.findAppointmentContext(clientContext, appointmentId);

    if (!appointment.startAt || !appointment.endAt) {
      throw createHttpError(400, 'Invalid appointment shift window');
    }

    const chatWindow = buildChatWindow({
      startAt: appointment.startAt,
      endAt: appointment.endAt,
      now: new Date(),
    });
    if (!chatWindow.isOpen) {
      throw createHttpError(403, getChatWindowClosedMessage());
    }

    const requestedWorkerId = (messageData.workerId || '').toString().trim();
    const expectedWorkerId = appointment.workerId;
    const expectedWorkerEmail = appointment.workerEmail;

    if (
      requestedWorkerId &&
      requestedWorkerId !== expectedWorkerId &&
      requestedWorkerId.toLowerCase() !== expectedWorkerEmail
    ) {
      throw createHttpError(403, 'Message can only be sent to the assigned worker.');
    }

    const conversation = await messagingService.createConversation({
      appointmentId,
      assignmentId: appointment.assignmentId,
      scheduleId: appointment.scheduleId,
      clientId: clientContext.client._id.toString(),
      clientEmail: normalizeEmail(clientContext.client.clientEmail),
      workerId: expectedWorkerId,
      workerEmail: expectedWorkerEmail,
      organizationId: clientContext.client.organizationId,
      shiftStartAt: appointment.startAt,
      shiftEndAt: appointment.endAt,
    });

    const sentMessage = await messagingService.sendMessage({
      conversationId: conversation._id,
      senderId: clientContext.client._id.toString(),
      senderType: 'client',
      senderName: buildClientName(clientContext.client, clientContext.authEmail),
      recipientId: expectedWorkerId,
      message: text,
      attachments: Array.isArray(messageData.attachments) ? messageData.attachments : [],
      timestamp: new Date(),
      authUser,
    });

    return {
      success: true,
      data: {
        ...sentMessage,
        conversationId: conversation._id,
        appointmentId,
        workerId: expectedWorkerId,
      },
    };
  }

  async submitServiceFeedback(feedbackData, authUser) {
    const clientContext = await this.resolveClientContext({ authUser });

    const appointmentId = (feedbackData.appointmentId || '').toString().trim();
    const rating = Number(feedbackData.rating);
    const comments = (feedbackData.comments || feedbackData.feedback || '').toString().trim();

    if (!appointmentId || Number.isNaN(rating)) {
      throw createHttpError(400, 'appointmentId and rating are required');
    }

    if (rating < 1 || rating > 5) {
      throw createHttpError(400, 'Rating must be between 1 and 5');
    }

    const { appointment } = await this.findAppointmentContext(clientContext, appointmentId);

    if (!appointment.endAt || new Date() < appointment.endAt) {
      throw createHttpError(
        403,
        'Feedback can only be submitted after the service has finished.'
      );
    }

    const payload = {
      appointmentId,
      assignmentId: appointment.assignmentId,
      scheduleId: appointment.scheduleId,
      clientId: clientContext.client._id,
      clientEmail: normalizeEmail(clientContext.client.clientEmail),
      workerId: appointment.workerId,
      workerEmail: appointment.workerEmail,
      organizationId: clientContext.client.organizationId,
      serviceName: appointment.serviceName,
      rating,
      comments,
      categories: Array.isArray(feedbackData.categories)
        ? feedbackData.categories
        : [],
      submittedAt: new Date(),
    };

    const feedback = await ServiceFeedback.findOneAndUpdate(
      {
        appointmentId,
        clientId: clientContext.client._id,
      },
      { $set: payload },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    ).lean();

    return {
      success: true,
      data: feedback,
    };
  }

  async getServiceHistory(clientId, limit = 10, authUser) {
    const parsedLimit = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : 10;

    const clientContext = await this.resolveClientContext({
      authUser,
      requestedClientId: clientId,
    });

    const { assignments, workerByEmail } = await this.getClientAssignments(clientContext);
    const appointments = this.flattenAppointments(assignments, workerByEmail);
    const now = new Date();

    const completedAppointments = appointments
      .filter((appt) => appt.endAt && appt.endAt < now)
      .sort((a, b) => (b.endAt?.getTime() || 0) - (a.endAt?.getTime() || 0));

    const appointmentIds = completedAppointments.map((appt) => appt.appointmentId);

    const feedbackDocs = await ServiceFeedback.find({
      clientId: clientContext.client._id,
      appointmentId: { $in: appointmentIds },
    }).lean();

    const feedbackByAppointmentId = new Map(
      feedbackDocs.map((item) => [item.appointmentId, item])
    );

    const history = completedAppointments.slice(0, parsedLimit).map((appt) => {
      const feedback = feedbackByAppointmentId.get(appt.appointmentId);
      return {
        serviceId: `${appt.assignmentId}_${appt.scheduleId}`,
        workerName: appt.workerName,
        serviceName: appt.serviceName,
        date: appt.date,
        startTime: appt.startTime,
        endTime: appt.endTime,
        rating: feedback?.rating || 0,
        feedback: feedback?.comments || null,
      };
    });

    return {
      success: true,
      data: history,
    };
  }

  async getFeedbackFeed({ authUser, limit = 20 }) {
    const authEmail = normalizeEmail(authUser?.email);
    if (!authEmail) {
      throw createHttpError(401, 'Authentication required');
    }

    const roles = Array.isArray(authUser?.roles)
      ? authUser.roles.map((role) => role.toString().toLowerCase())
      : [];
    const isAdmin = roles.includes('admin') || roles.includes('superadmin');

    const userDoc = await User.findOne({ email: authEmail }).lean();
    const parsedLimit = Number.isFinite(Number(limit))
      ? Math.min(Math.max(Number(limit), 1), 100)
      : 20;

    const query = {};

    if (isAdmin) {
      const orgId = (
        authUser?.organizationId ||
        authUser?.organization ||
        userDoc?.organizationId ||
        ''
      )
        .toString()
        .trim();

      if (orgId) {
        query.organizationId = orgId;
      } else {
        query.$or = [
          { workerEmail: authEmail },
          ...(userDoc?._id ? [{ workerId: userDoc._id.toString() }] : []),
        ];
      }
    } else {
      query.$or = [
        { workerEmail: authEmail },
        ...(userDoc?._id ? [{ workerId: userDoc._id.toString() }] : []),
      ];
    }

    const feedbackDocs = await ServiceFeedback.find(query)
      .sort({ submittedAt: -1, createdAt: -1 })
      .limit(parsedLimit)
      .lean();

    if (!feedbackDocs.length) {
      return { success: true, data: [] };
    }

    const clientIds = [
      ...new Set(
        feedbackDocs
          .map((item) => (item.clientId ? item.clientId.toString() : null))
          .filter((value) => value && isValidObjectId(value))
      ),
    ];

    const workerEmails = [
      ...new Set(
        feedbackDocs
          .map((item) => normalizeEmail(item.workerEmail))
          .filter(Boolean)
      ),
    ];

    const [clients, workers] = await Promise.all([
      clientIds.length
        ? Client.find({ _id: { $in: clientIds.map((id) => toObjectId(id)) } }).lean()
        : Promise.resolve([]),
      workerEmails.length
        ? User.find({ email: { $in: workerEmails } }).lean()
        : Promise.resolve([]),
    ]);

    const clientById = new Map(
      clients.map((client) => [client._id.toString(), client])
    );
    const workerByEmail = new Map(
      workers.map((worker) => [normalizeEmail(worker.email), worker])
    );

    const data = feedbackDocs.map((item) => {
      const client = item.clientId ? clientById.get(item.clientId.toString()) : null;
      const worker = workerByEmail.get(normalizeEmail(item.workerEmail));
      return {
        id: item._id.toString(),
        appointmentId: item.appointmentId,
        assignmentId: item.assignmentId,
        scheduleId: item.scheduleId,
        serviceName: item.serviceName || 'Support Service',
        rating: item.rating,
        comments: item.comments || '',
        categories: Array.isArray(item.categories) ? item.categories : [],
        submittedAt:
          safeIso(item.submittedAt) ||
          safeIso(item.createdAt) ||
          new Date().toISOString(),
        organizationId: item.organizationId,
        clientId: item.clientId ? item.clientId.toString() : null,
        clientEmail: item.clientEmail || null,
        clientName: buildClientName(client, item.clientEmail),
        workerId: item.workerId || null,
        workerEmail: item.workerEmail || null,
        workerName: buildWorkerName(worker, item.workerEmail),
      };
    });

    return {
      success: true,
      data,
    };
  }

  async getInvoices(authUser) {
    const clientContext = await this.resolveClientContext({ authUser });

    const clientIdAsString = clientContext.client._id.toString();
    const clientEmail = normalizeEmail(clientContext.client.clientEmail);

    const invoices = await Invoice.find({
      'deletion.isDeleted': { $ne: true },
      $or: [
        { clientId: clientIdAsString },
        { clientEmail: clientEmail },
      ],
    })
      .sort({ createdAt: -1 })
      .lean();

    return {
      success: true,
      data: invoices,
    };
  }

  async getInvoiceDetail(invoiceId, authUser) {
    const clientContext = await this.resolveClientContext({ authUser });

    const invoice = await Invoice.findOne({
      _id: toObjectId(invoiceId),
      'deletion.isDeleted': { $ne: true },
      $or: [
        { clientId: clientContext.client._id.toString() },
        { clientEmail: normalizeEmail(clientContext.client.clientEmail) },
      ],
    }).lean();

    if (!invoice) {
      throw createHttpError(404, 'Invoice not found');
    }

    return {
      success: true,
      data: invoice,
    };
  }

  async approveInvoice(invoiceId, authUser) {
    const clientContext = await this.resolveClientContext({ authUser });

    const invoice = await Invoice.findOneAndUpdate(
      {
        _id: toObjectId(invoiceId),
        'deletion.isDeleted': { $ne: true },
        $or: [
          { clientId: clientContext.client._id.toString() },
          { clientEmail: normalizeEmail(clientContext.client.clientEmail) },
        ],
      },
      {
        $set: {
          'workflow.status': 'approved',
          'workflow.approvedBy': clientContext.authEmail,
          'workflow.approvalDate': new Date(),
        },
      },
      { new: true }
    ).lean();

    if (!invoice) {
      throw createHttpError(404, 'Invoice not found');
    }

    return {
      success: true,
      data: invoice,
    };
  }

  async disputeInvoice(invoiceId, reason, authUser) {
    const clientContext = await this.resolveClientContext({ authUser });

    const cleanedReason = (reason || '').toString().trim();
    if (!cleanedReason) {
      throw createHttpError(400, 'Dispute reason is required');
    }

    const invoice = await Invoice.findOneAndUpdate(
      {
        _id: toObjectId(invoiceId),
        'deletion.isDeleted': { $ne: true },
        $or: [
          { clientId: clientContext.client._id.toString() },
          { clientEmail: normalizeEmail(clientContext.client.clientEmail) },
        ],
      },
      {
        $set: {
          'workflow.status': 'disputed',
          'workflow.rejectionReason': cleanedReason,
          'workflow.updatedAt': new Date(),
        },
      },
      { new: true }
    ).lean();

    if (!invoice) {
      throw createHttpError(404, 'Invoice not found');
    }

    return {
      success: true,
      data: invoice,
    };
  }

  async requestAppointment(requestData, authUser) {
    const clientContext = await this.resolveClientContext({ authUser });

    const payload = {
      requestId: `CR-${Date.now()}`,
      clientId: clientContext.client._id.toString(),
      clientEmail: normalizeEmail(clientContext.client.clientEmail),
      organizationId: clientContext.client.organizationId,
      preferredDate: requestData?.preferredDate || null,
      preferredTime: requestData?.preferredTime || null,
      serviceType: requestData?.serviceType || null,
      notes: requestData?.notes || '',
      createdAt: new Date().toISOString(),
      status: 'submitted',
    };

    return {
      success: true,
      message: 'Appointment request submitted successfully',
      data: payload,
    };
  }
}

module.exports = new ClientPortalService();
