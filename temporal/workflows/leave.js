const { proxyActivities, sleep } = require('@temporalio/workflow');

const { leaveApprovalEscalationStepActivity } = proxyActivities({
  startToCloseTimeout: '5 minutes',
  retry: {
    initialInterval: '30 seconds',
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

/**
 * Per-request escalation timer.
 *
 * Cadence by leave type (hours):
 *   sick:     3, 6, 9, 12  (4 stages)
 *   normal:  24, 48, 72    (3 stages)
 *
 * Each stage only notifies if the request is still Pending; the activity
 * returns { stopped: true } after any approval/rejection/cancellation, which
 * ends the workflow. The final stage marks the request Escalated (still
 * approvable) and alerts the owner + admins by app notification and email.
 *
 * workflowId: leave-escalation-<requestId>, REJECT_DUPLICATE at start.
 */
async function LeaveApprovalEscalationWorkflow({ requestId, leaveType }) {
  const isSick = String(leaveType || '').toLowerCase() === 'sick';
  const stagesHours = isSick ? [3, 6, 9, 12] : [24, 48, 72];
  const msPerHour = 60 * 60 * 1000;

  let elapsedHours = 0;
  for (let i = 0; i < stagesHours.length; i++) {
    // stagesHours are cumulative offsets (24, 48, 72h); sleep only the delta
    // since the previous stage.
    const deltaHours = stagesHours[i] - elapsedHours;
    await sleep(deltaHours * msPerHour);
    elapsedHours = stagesHours[i];
    const result = await leaveApprovalEscalationStepActivity({
      requestId,
      stage: i + 1,
      final: i === stagesHours.length - 1,
    });
    if (result && result.stopped) {
      return { requestId, finished: true, reason: result.reason || 'done' };
    }
  }
  return { requestId, finished: true, reason: 'escalated' };
}

module.exports = { LeaveApprovalEscalationWorkflow };
