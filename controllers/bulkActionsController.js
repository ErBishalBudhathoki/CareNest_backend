const WorkedTime = require('../models/WorkedTime');
const ClientAssignment = require('../models/ClientAssignment');
const Invoice = require('../models/Invoice');
const InvoiceLineItem = require('../models/InvoiceLineItem');
const User = require('../models/User');
const Notification = require('../models/Notification');
const catchAsync = require('../utils/catchAsync');
const logger = require('../utils/logger');

/**
 * Bulk approve timesheets
 * POST /api/bulk/approve-timesheets
 */
exports.approveTimesheets = catchAsync(async (req, res) => {
  const { timesheetIds, organizationId, approvedBy } = req.body;

  if (!timesheetIds || !Array.isArray(timesheetIds) || timesheetIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Timesheet IDs array is required',
    });
  }

  // Update all timesheets
  const result = await WorkedTime.updateMany(
    {
      _id: { $in: timesheetIds },
      organizationId,
      status: 'pending',
    },
    {
      $set: {
        status: 'approved',
        approvedBy,
        approvedAt: new Date(),
      },
    }
  );

  // Get updated timesheets for notifications
  const timesheets = await WorkedTime.find({
    _id: { $in: timesheetIds },
  }).populate('userId', 'email firstName lastName');

  // Send notifications to workers
  const notifications = timesheets.map((timesheet) => ({
    userId: timesheet.userId._id,
    organizationId,
    type: 'timesheet_approved',
    title: 'Timesheet Approved',
    message: `Your timesheet for ${timesheet.date.toLocaleDateString()} has been approved`,
    data: {
      timesheetId: timesheet._id,
      date: timesheet.date,
      hours: timesheet.totalHours,
    },
    createdAt: new Date(),
  }));

  await Notification.insertMany(notifications);

  logger.info(`Bulk approved ${result.modifiedCount} timesheets`, {
    organizationId,
    approvedBy,
    count: result.modifiedCount,
  });

  res.json({
    success: true,
    data: {
      approvedCount: result.modifiedCount,
      totalRequested: timesheetIds.length,
    },
  });
});

/**
 * Bulk reject timesheets
 * POST /api/bulk/reject-timesheets
 */
exports.rejectTimesheets = catchAsync(async (req, res) => {
  const { timesheetIds, organizationId, rejectedBy, reason } = req.body;

  if (!timesheetIds || !Array.isArray(timesheetIds) || timesheetIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Timesheet IDs array is required',
    });
  }

  if (!reason) {
    return res.status(400).json({
      success: false,
      message: 'Rejection reason is required',
    });
  }

  // Update all timesheets
  const result = await WorkedTime.updateMany(
    {
      _id: { $in: timesheetIds },
      organizationId,
      status: 'pending',
    },
    {
      $set: {
        status: 'rejected',
        rejectedBy,
        rejectedAt: new Date(),
        rejectionReason: reason,
      },
    }
  );

  // Get updated timesheets for notifications
  const timesheets = await WorkedTime.find({
    _id: { $in: timesheetIds },
  }).populate('userId', 'email firstName lastName');

  // Send notifications to workers
  const notifications = timesheets.map((timesheet) => ({
    userId: timesheet.userId._id,
    organizationId,
    type: 'timesheet_rejected',
    title: 'Timesheet Rejected',
    message: `Your timesheet for ${timesheet.date.toLocaleDateString()} was rejected: ${reason}`,
    data: {
      timesheetId: timesheet._id,
      date: timesheet.date,
      reason,
    },
    priority: 'high',
    createdAt: new Date(),
  }));

  await Notification.insertMany(notifications);

  logger.info(`Bulk rejected ${result.modifiedCount} timesheets`, {
    organizationId,
    rejectedBy,
    reason,
    count: result.modifiedCount,
  });

  res.json({
    success: true,
    data: {
      rejectedCount: result.modifiedCount,
      totalRequested: timesheetIds.length,
    },
  });
});

/**
 * Preview invoices before generation
 * POST /api/bulk/preview-invoices
 */
exports.previewInvoices = catchAsync(async (req, res) => {
  const { appointmentIds, organizationId, groupByClient } = req.body;

  if (!appointmentIds || !Array.isArray(appointmentIds) || appointmentIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Appointment IDs array is required',
    });
  }

  // Get appointments with client and service details
  const appointments = await ClientAssignment.find({
    _id: { $in: appointmentIds },
    organizationId,
    status: 'completed',
    invoiced: { $ne: true },
  })
    .populate('clientId', 'firstName lastName email')
    .populate('serviceId', 'name rate');

  if (appointments.length === 0) {
    return res.status(404).json({
      success: false,
      message: 'No eligible appointments found for invoicing',
    });
  }

  // Group by client if requested
  let invoicePreview;
  if (groupByClient) {
    const clientGroups = {};
    appointments.forEach((apt) => {
      const clientId = apt.clientId._id.toString();
      if (!clientGroups[clientId]) {
        clientGroups[clientId] = {
          clientId,
          clientName: `${apt.clientId.firstName} ${apt.clientId.lastName}`,
          clientEmail: apt.clientId.email,
          appointments: [],
          totalAmount: 0,
        };
      }
      const amount = apt.serviceId.rate * apt.duration;
      clientGroups[clientId].appointments.push({
        appointmentId: apt._id,
        date: apt.date,
        service: apt.serviceId.name,
        duration: apt.duration,
        rate: apt.serviceId.rate,
        amount,
      });
      clientGroups[clientId].totalAmount += amount;
    });
    invoicePreview = Object.values(clientGroups);
  } else {
    // Individual invoices
    invoicePreview = appointments.map((apt) => ({
      clientId: apt.clientId._id,
      clientName: `${apt.clientId.firstName} ${apt.clientId.lastName}`,
      clientEmail: apt.clientId.email,
      appointments: [
        {
          appointmentId: apt._id,
          date: apt.date,
          service: apt.serviceId.name,
          duration: apt.duration,
          rate: apt.serviceId.rate,
          amount: apt.serviceId.rate * apt.duration,
        },
      ],
      totalAmount: apt.serviceId.rate * apt.duration,
    }));
  }

  res.json({
    success: true,
    data: {
      invoiceCount: invoicePreview.length,
      totalAppointments: appointments.length,
      totalAmount: invoicePreview.reduce((sum, inv) => sum + inv.totalAmount, 0),
      invoices: invoicePreview,
    },
  });
});

/**
 * Generate invoices in bulk
 * POST /api/bulk/generate-invoices
 */
exports.generateInvoices = catchAsync(async (req, res) => {
  const { appointmentIds, organizationId, groupByClient, dueDate } = req.body;

  if (!appointmentIds || !Array.isArray(appointmentIds) || appointmentIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Appointment IDs array is required',
    });
  }

  // Get appointments
  const appointments = await ClientAssignment.find({
    _id: { $in: appointmentIds },
    organizationId,
    status: 'completed',
    invoiced: { $ne: true },
  })
    .populate('clientId', 'firstName lastName email')
    .populate('serviceId', 'name rate');

  if (appointments.length === 0) {
    return res.status(404).json({
      success: false,
      message: 'No eligible appointments found for invoicing',
    });
  }

  const invoices = [];
  const lineItems = [];

  // Group by client if requested
  if (groupByClient) {
    const clientGroups = {};
    appointments.forEach((apt) => {
      const clientId = apt.clientId._id.toString();
      if (!clientGroups[clientId]) {
        clientGroups[clientId] = [];
      }
      clientGroups[clientId].push(apt);
    });

    // Create one invoice per client
    for (const [clientId, apts] of Object.entries(clientGroups)) {
      const invoice = new Invoice({
        organizationId,
        clientId,
        invoiceNumber: `INV-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        issueDate: new Date(),
        dueDate: dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        status: 'pending',
        subtotal: 0,
        tax: 0,
        total: 0,
      });

      let subtotal = 0;
      apts.forEach((apt) => {
        const amount = apt.serviceId.rate * apt.duration;
        subtotal += amount;

        lineItems.push({
          invoiceId: invoice._id,
          appointmentId: apt._id,
          description: `${apt.serviceId.name} - ${apt.date.toLocaleDateString()}`,
          quantity: apt.duration,
          unitPrice: apt.serviceId.rate,
          amount,
        });
      });

      invoice.subtotal = subtotal;
      invoice.tax = subtotal * 0.1; // 10% tax
      invoice.total = subtotal + invoice.tax;
      invoices.push(invoice);
    }
  } else {
    // Create individual invoices
    appointments.forEach((apt) => {
      const amount = apt.serviceId.rate * apt.duration;
      const invoice = new Invoice({
        organizationId,
        clientId: apt.clientId._id,
        invoiceNumber: `INV-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        issueDate: new Date(),
        dueDate: dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        status: 'pending',
        subtotal: amount,
        tax: amount * 0.1,
        total: amount * 1.1,
      });

      lineItems.push({
        invoiceId: invoice._id,
        appointmentId: apt._id,
        description: `${apt.serviceId.name} - ${apt.date.toLocaleDateString()}`,
        quantity: apt.duration,
        unitPrice: apt.serviceId.rate,
        amount,
      });

      invoices.push(invoice);
    });
  }

  // Save invoices and line items
  await Invoice.insertMany(invoices);
  await InvoiceLineItem.insertMany(lineItems);

  // Mark appointments as invoiced
  await ClientAssignment.updateMany(
    { _id: { $in: appointmentIds } },
    { $set: { invoiced: true } }
  );

  logger.info(`Bulk generated ${invoices.length} invoices`, {
    organizationId,
    invoiceCount: invoices.length,
    appointmentCount: appointments.length,
    groupByClient,
  });

  res.json({
    success: true,
    data: {
      invoiceCount: invoices.length,
      appointmentCount: appointments.length,
      totalAmount: invoices.reduce((sum, inv) => sum + inv.total, 0),
    },
  });
});

/**
 * Suggest worker assignments for shifts
 * POST /api/bulk/suggest-assignments
 */
exports.suggestAssignments = catchAsync(async (req, res) => {
  const { shiftIds, organizationId } = req.body;

  if (!shiftIds || !Array.isArray(shiftIds) || shiftIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Shift IDs array is required',
    });
  }

  // Get shifts
  const shifts = await ClientAssignment.find({
    _id: { $in: shiftIds },
    organizationId,
    status: 'unassigned',
  }).populate('serviceId', 'name requiredSkills');

  // Get available workers
  const workers = await User.find({
    organizationId,
    role: 'worker',
    isActive: true,
  });

  const suggestions = [];

  for (const shift of shifts) {
    // Find workers with matching skills
    const matchedWorkers = workers
      .map((worker) => {
        let score = 0;
        let conflicts = [];

        // Check skill match
        const hasRequiredSkills = shift.serviceId.requiredSkills?.every((skill) =>
          worker.skills?.includes(skill)
        );
        if (hasRequiredSkills) score += 50;

        // Check availability (simplified - check if worker has shifts at same time)
        // In production, this would check actual availability calendar
        const hasConflict = false; // Placeholder
        if (hasConflict) {
          conflicts.push('Time conflict with another shift');
          score -= 30;
        }

        // Check distance (simplified - would use actual geolocation)
        // score += distanceScore;

        // Check worker rating
        if (worker.rating >= 4.5) score += 20;
        else if (worker.rating >= 4.0) score += 10;

        // Check recent activity
        const daysSinceLastShift = 7; // Placeholder
        if (daysSinceLastShift < 3) score += 10;

        return {
          workerId: worker._id,
          workerName: `${worker.firstName} ${worker.lastName}`,
          workerEmail: worker.email,
          score: Math.max(0, Math.min(100, score)),
          matchReason: hasRequiredSkills ? 'Has required skills' : 'Missing some skills',
          conflicts,
          rating: worker.rating || 0,
        };
      })
      .filter((w) => w.score > 30) // Only suggest workers with score > 30
      .sort((a, b) => b.score - a.score)
      .slice(0, 5); // Top 5 suggestions

    suggestions.push({
      shiftId: shift._id,
      shiftDate: shift.date,
      shiftTime: shift.startTime,
      service: shift.serviceId.name,
      suggestedWorkers: matchedWorkers,
    });
  }

  res.json({
    success: true,
    data: suggestions,
  });
});

/**
 * Assign workers to shifts in bulk
 * POST /api/bulk/assign-shifts
 */
exports.assignShifts = catchAsync(async (req, res) => {
  const { assignments, organizationId } = req.body;

  if (!assignments || !Array.isArray(assignments) || assignments.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Assignments array is required (format: [{shiftId, workerId}])',
    });
  }

  const results = {
    successful: [],
    failed: [],
  };

  for (const { shiftId, workerId } of assignments) {
    try {
      // Check if shift exists and is unassigned
      const shift = await ClientAssignment.findOne({
        _id: shiftId,
        organizationId,
        status: 'unassigned',
      });

      if (!shift) {
        results.failed.push({
          shiftId,
          workerId,
          reason: 'Shift not found or already assigned',
        });
        continue;
      }

      // Check if worker exists
      const worker = await User.findOne({
        _id: workerId,
        organizationId,
        role: 'worker',
        isActive: true,
      });

      if (!worker) {
        results.failed.push({
          shiftId,
          workerId,
          reason: 'Worker not found or inactive',
        });
        continue;
      }

      // Assign shift
      shift.userId = workerId;
      shift.status = 'assigned';
      shift.assignedAt = new Date();
      await shift.save();

      // Send notification to worker
      await Notification.create({
        userId: workerId,
        organizationId,
        type: 'shift_assigned',
        title: 'New Shift Assigned',
        message: `You have been assigned a shift on ${shift.date.toLocaleDateString()} at ${shift.startTime}`,
        data: {
          shiftId: shift._id,
          date: shift.date,
          startTime: shift.startTime,
        },
        priority: 'high',
      });

      results.successful.push({
        shiftId,
        workerId,
        workerName: `${worker.firstName} ${worker.lastName}`,
      });
    } catch (error) {
      results.failed.push({
        shiftId,
        workerId,
        reason: error.message,
      });
    }
  }

  logger.info(`Bulk assigned ${results.successful.length} shifts`, {
    organizationId,
    successful: results.successful.length,
    failed: results.failed.length,
  });

  res.json({
    success: true,
    data: {
      successfulCount: results.successful.length,
      failedCount: results.failed.length,
      results,
    },
  });
});

/**
 * Send messages to multiple recipients
 * POST /api/bulk/send-messages
 */
exports.sendMessages = catchAsync(async (req, res) => {
  const { recipientIds, organizationId, subject, message, channels } = req.body;

  if (!recipientIds || !Array.isArray(recipientIds) || recipientIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Recipient IDs array is required',
    });
  }

  if (!message) {
    return res.status(400).json({
      success: false,
      message: 'Message content is required',
    });
  }

  // Get recipients
  const recipients = await User.find({
    _id: { $in: recipientIds },
    organizationId,
    isActive: true,
  });

  if (recipients.length === 0) {
    return res.status(404).json({
      success: false,
      message: 'No valid recipients found',
    });
  }

  // Create notifications
  const notifications = recipients.map((recipient) => ({
    userId: recipient._id,
    organizationId,
    type: 'message',
    title: subject || 'New Message',
    message,
    channels: channels || ['push', 'email'],
    priority: 'medium',
    createdAt: new Date(),
  }));

  await Notification.insertMany(notifications);

  // TODO: Send via actual channels (push, SMS, email)
  // This would integrate with notification service

  logger.info(`Bulk sent messages to ${recipients.length} recipients`, {
    organizationId,
    recipientCount: recipients.length,
    channels,
  });

  res.json({
    success: true,
    data: {
      sentCount: recipients.length,
      totalRequested: recipientIds.length,
    },
  });
});

/**
 * Schedule messages for later delivery
 * POST /api/bulk/schedule-messages
 */
exports.scheduleMessages = catchAsync(async (req, res) => {
  const { recipientIds, organizationId, subject, message, channels, scheduledFor } = req.body;

  if (!recipientIds || !Array.isArray(recipientIds) || recipientIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Recipient IDs array is required',
    });
  }

  if (!message) {
    return res.status(400).json({
      success: false,
      message: 'Message content is required',
    });
  }

  if (!scheduledFor) {
    return res.status(400).json({
      success: false,
      message: 'Scheduled time is required',
    });
  }

  const scheduledDate = new Date(scheduledFor);
  if (scheduledDate <= new Date()) {
    return res.status(400).json({
      success: false,
      message: 'Scheduled time must be in the future',
    });
  }

  // Get recipients
  const recipients = await User.find({
    _id: { $in: recipientIds },
    organizationId,
    isActive: true,
  });

  if (recipients.length === 0) {
    return res.status(404).json({
      success: false,
      message: 'No valid recipients found',
    });
  }

  // Create scheduled notifications
  const notifications = recipients.map((recipient) => ({
    userId: recipient._id,
    organizationId,
    type: 'message',
    title: subject || 'Scheduled Message',
    message,
    channels: channels || ['push', 'email'],
    priority: 'medium',
    scheduledFor: scheduledDate,
    status: 'scheduled',
    createdAt: new Date(),
  }));

  await Notification.insertMany(notifications);

  logger.info(`Scheduled messages for ${recipients.length} recipients`, {
    organizationId,
    recipientCount: recipients.length,
    scheduledFor: scheduledDate,
  });

  res.json({
    success: true,
    data: {
      scheduledCount: recipients.length,
      totalRequested: recipientIds.length,
      scheduledFor: scheduledDate,
    },
  });
});
