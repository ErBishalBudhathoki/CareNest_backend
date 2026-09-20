const EventBus = require('../core/EventBus');
const logger = require('../config/logger');
const TemporalManager = require('../core/TemporalManager');

class ShiftSubscriber {
  constructor() {
    this.subscribe();
  }

  subscribe() {
    EventBus.subscribe('shift.completed', this.handleShiftCompleted.bind(this));
    EventBus.subscribe('shift.cancelled', this.handleShiftCancelled.bind(this));
  }

  /**
   * Thin adapter: hand the completed shift to the durable saga workflow.
   * All DB work + retries live in ShiftLifecycleWorkflow activities;
   * workflowId is stable per shift with REJECT_DUPLICATE so duplicate
   * events collapse instead of double-creating records.
   */
  async handleShiftCompleted(shift) {
    const shiftId = shift.id || shift._id;
    try {
      logger.info(`Dispatching shift lifecycle workflow for ${shiftId}`);
      await TemporalManager.startWorkflow('ShiftLifecycleWorkflow', {
        workflowId: `shift-lifecycle-${shiftId}`,
        args: [{ shift }],
        workflowIdReusePolicy: 'WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE',
      });
    } catch (error) {
      if (String(error && error.message).includes('AlreadyStarted')) {
        logger.info(`Shift lifecycle already running for ${shiftId}`);
        return;
      }
      logger.error('Error dispatching shift lifecycle workflow', {
        error: error.message,
        shift,
      });
    }
  }

  /**
   * Thin adapter: cancelled shifts run compensation (void auto-created
   * WorkedTime + audit trail). Previously a no-op stub.
   */
  async handleShiftCancelled(payload) {
    const shiftId = payload.shiftId || (payload.shift && (payload.shift.id || payload.shift._id));
    const organizationId =
      payload.organizationId || (payload.shift && payload.shift.organizationId);
    try {
      logger.info(`Dispatching shift cancel workflow for ${shiftId}`);
      await TemporalManager.startWorkflow('ShiftCancelWorkflow', {
        workflowId: `shift-cancel-${shiftId}`,
        args: [{ shiftId, organizationId }],
        workflowIdReusePolicy: 'WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE',
      });
    } catch (error) {
      if (String(error && error.message).includes('AlreadyStarted')) {
        logger.info(`Shift cancel already running for ${shiftId}`);
        return;
      }
      logger.error('Error dispatching shift cancel workflow', {
        error: error.message,
        payload,
      });
    }
  }
}

module.exports = new ShiftSubscriber();
