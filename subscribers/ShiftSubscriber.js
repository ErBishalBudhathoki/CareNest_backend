const EventBus = require('../core/EventBus');
const QueueManager = require('../core/QueueManager');
const { getDatabase } = require('../config/database');
const logger = require('../config/logger');

class ShiftSubscriber {
  constructor() {
    this.subscribe();
  }

  subscribe() {
    EventBus.subscribe('shift.completed', this.handleShiftCompleted.bind(this));
    EventBus.subscribe('shift.cancelled', this.handleShiftCancelled.bind(this));
  }

  /**
   * Handle Shift Completed Event
   * 1. Create WorkedTime record
   * 2. Trigger Invoice Generation
   */
  async handleShiftCompleted(shift) {
    try {
      logger.info(`Processing Shift Completed: ${shift.id || shift._id}`);
      
      const db = await getDatabase();

      // 1. Create/Update WorkedTime record
      // This mimics the "Timesheet Update" requirement
      const workedTimeEntry = {
        shiftId: shift.id || shift._id,
        userEmail: shift.employeeEmail,
        clientEmail: shift.clientEmail,
        date: new Date(shift.startTime),
        startTime: new Date(shift.startTime),
        endTime: new Date(shift.endTime),
        timeWorked: this.calculateHours(shift.startTime, shift.endTime, shift.breakDuration),
        providerType: 'standard', // default, logic can be enhanced
        organizationId: shift.organizationId,
        createdAt: new Date(),
        status: 'verified'
      };

      await db.collection('workedTime').updateOne(
        { shiftId: workedTimeEntry.shiftId },
        { $set: workedTimeEntry },
        { upsert: true }
      );

      logger.info(`WorkedTime record created/updated for shift ${shift.id || shift._id}`);

      // 2. Queue Invoice Generation
      await QueueManager.addJob('invoice-generation', 'generate-preview', {
        shiftId: shift.id || shift._id,
        clientEmail: shift.clientEmail,
        organizationId: shift.organizationId
      });

      logger.info(`Invoice generation job queued for shift ${shift.id || shift._id}`);

    } catch (error) {
      logger.error('Error handling shift.completed event', { error: error.message, shift });
    }
  }

  async handleShiftCancelled(payload) {
    // Logic to remove workedTime or update invoice status
    logger.info(`Shift Cancelled: ${payload.shiftId}`);
  }

  calculateHours(start, end, breakMins = 0) {
    const s = new Date(start);
    const e = new Date(end);
    const diff = (e - s) / (1000 * 60 * 60);
    const breakHours = breakMins / 60;
    return Math.max(0, diff - breakHours);
  }
}

module.exports = new ShiftSubscriber();
