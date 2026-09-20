const { proxyActivities, executeChild } = require('@temporalio/workflow');
const { InvoiceProcessingWorkflow } = require('./invoice');

const {
  upsertWorkedTimeActivity,
  voidShiftArtifactsActivity,
} = proxyActivities({
  startToCloseTimeout: '5 minutes',
  retry: {
    initialInterval: '15 seconds',
    backoffCoefficient: 2,
    maximumAttempts: 5,
  },
});

/**
 * Shift completion saga. workflowId: shift-lifecycle-<shiftId> with
 * REJECT_DUPLICATE at start time, so duplicate completion events collapse
 * instead of double-creating records.
 */
async function ShiftLifecycleWorkflow({ shift }) {
  const shiftId = shift.id || shift._id;
  const worked = await upsertWorkedTimeActivity({ shift });
  await executeChild(InvoiceProcessingWorkflow, {
    workflowId: `invoice-generation-${shiftId}`,
    args: [
      {
        shiftId,
        clientEmail: shift.clientEmail,
        organizationId: shift.organizationId,
      },
    ],
  });
  return { shiftId, timeWorked: worked.timeWorked };
}

/**
 * Shift cancellation compensation. workflowId: shift-cancel-<shiftId>.
 */
async function ShiftCancelWorkflow({ shiftId, organizationId }) {
  const result = await voidShiftArtifactsActivity({ shiftId, organizationId });
  return result;
}

module.exports = {
  ShiftLifecycleWorkflow,
  ShiftCancelWorkflow,
};
