/**
 * NDIS billing rules that are configurable rather than hard-coded in services.
 *
 * Short-notice cancellation windows (hours before the scheduled start):
 *   - NDIA-managed / combination: 2 business days (48h approximation)
 *   - plan-managed / self-managed: 7 days (168h)
 * The exact notice test uses wall-clock hours; a provider can tune these
 * without changing code. Set `cancellationRate` to 0.9 if the organisation's
 * service agreement only charges 90% of the cancelled service.
 */
module.exports = {
  shortNoticeHours: {
    ndia_managed: 48,
    combination: 48,
    plan_managed: 168,
    self_managed: 168,
  },
  cancellationRate: 1.0,
};
