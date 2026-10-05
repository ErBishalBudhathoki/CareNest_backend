const logger = require('../../config/logger');

const LeaveRequest = require('../../models/LeaveRequest');
const UserOrganization = require('../../models/UserOrganization');
const Organization = require('../../models/Organization');
const User = require('../../models/User');
const NotificationHistory = require('../../models/NotificationHistory');
const emailService = require('../../services/emailService');

/**
 * Find every admin/owner of the organization and resolve their emails.
 */
async function resolveEscalationRecipients(organizationId) {
  const memberships = await UserOrganization.find({
    organizationId: String(organizationId),
    role: { $in: ['owner', 'admin'] },
    isActive: true,
  }).lean();

  const userIds = memberships.map((m) => m.userId).filter(Boolean);
  const users = userIds.length ? await User.find({ _id: { $in: userIds } }).lean() : [];
  const emails = users.map((u) => u.email).filter(Boolean);

  const org = await Organization.findOne({ _id: organizationId }).lean();
  if (org && org.ownerEmail) emails.push(org.ownerEmail);

  return { users, uniqueEmails: [...new Set(emails)] };
}

async function notifyUser(userId, notification) {
  try {
    const TemporalManager = require('../../core/TemporalManager');
    const temporalClient = await TemporalManager.getClient();
    const history = await NotificationHistory.create({
      userId,
      type: 'leave_escalation',
      title: notification.title,
      body: notification.body,
      data: notification.data,
      status: 'scheduled',
      scheduledAt: new Date(),
    });

    await temporalClient.workflow.start('NotificationWorkflow', {
      taskQueue: require('../../core/TemporalManager').getTaskQueue(),
      workflowId: `notification-${history._id}`,
      args: [{ userId: userId.toString(), notification, historyId: history._id.toString() }],
    });
  } catch (error) {
    logger.error('Failed to dispatch leave escalation notification', { error: error.message });
  }
}

/**
 * Activity: one step of the leave approval escalation.
 *
 * Polled by LeaveApprovalEscalationWorkflow after each sleep stage. If the
 * request is no longer Pending, the workflow stops (no further stages).
 * At the final stage the request is marked 'Escalated' (still approvable) and
 * the org owner + admins are notified via app notification AND email.
 */
async function leaveApprovalEscalationStepActivity({ requestId, stage, final }) {
  logger.info(`[Temporal Activity] Leave escalation check: request=${requestId} stage=${stage} final=${final}`);
  try {
    const request = await LeaveRequest.findById(requestId);
    if (!request) return { stopped: true, reason: 'request_deleted' };
    if (request.status !== 'Pending') return { stopped: true, reason: 'no_longer_pending', status: request.status };

    const { users, uniqueEmails } = await resolveEscalationRecipients(request.organizationId);

    if (final) {
      request.status = 'Escalated';
      request.escalatedAt = new Date();
      request.history = request.history || [];
      request.history.push({
        action: 'escalated',
        performedBy: 'system',
        timestamp: new Date(),
        status: 'Escalated',
      });
      await request.save();

      for (const adminUser of users) {
        await notifyUser(adminUser._id, {
          type: 'leave_escalation',
          title: 'Leave request escalated',
          body: `A leave request from ${request.createdBy} is still awaiting approval and has been escalated.`,
          data: { requestId: String(request._id) },
        });
      }

      const subject = `Escalated leave request requires owner decision`;
      const html = `<p>A leave request (${request.leaveType}, ${request.totalHours}h) from <b>${request.createdBy}</b> is still Pending and has been escalated.</p><p>Please review it in the app.</p>`;
      for (const email of uniqueEmails) {
        try {
          await emailService.sendEmail(email, subject, html);
        } catch (err) {
          logger.error(`Failed to send escalation email to ${email}`, { error: err.message });
        }
      }
      logger.info('[Temporal Activity] Leave request escalated', { requestId });
      return { stopped: false, escalated: true };
    }

    // Intermediate stage: notify approvers via app, no UI emails yet.
    for (const adminUser of users) {
      await notifyUser(adminUser._id, {
        type: 'leave_escalation',
        title: 'Leave request awaiting your approval',
        body: `A ${request.leaveType} leave request from ${request.createdBy} (${request.totalHours}h) has been waiting for approval.`,
        data: { requestId: String(request._id), stage },
      });
    }
    return { stopped: false, escalated: false };
  } catch (error) {
    logger.error('[Temporal Activity] Leave escalation step failed', error);
    throw error;
  }
}

module.exports = { leaveApprovalEscalationStepActivity };
