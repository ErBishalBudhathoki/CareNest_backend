/**
 * API Endpoint Registry
 * 
 * Comprehensive registry of all backend API endpoints categorized by feature phase.
 * Used for tracking test coverage and identifying untested endpoints.
 */

const endpointRegistry = {
  // Phase 1: Financial Intelligence
  'financial-intelligence': [
    { method: 'POST', path: '/invoices', critical: true },
    { method: 'GET', path: '/invoices', critical: true },
    { method: 'GET', path: '/invoices/:id', critical: true },
    { method: 'PUT', path: '/invoices/:id', critical: true },
    { method: 'DELETE', path: '/invoices/:id', critical: false },
    { method: 'POST', path: '/invoices/:id/send', critical: true },
    { method: 'POST', path: '/invoices/:id/payment', critical: true },
    { method: 'GET', path: '/invoices/:id/pdf', critical: true },
    { method: 'POST', path: '/payments', critical: true },
    { method: 'GET', path: '/payments', critical: true },
    { method: 'GET', path: '/payments/:id', critical: true },
    { method: 'POST', path: '/budgets', critical: true },
    { method: 'GET', path: '/budgets', critical: true },
    { method: 'GET', path: '/budgets/:id', critical: true },
    { method: 'PUT', path: '/budgets/:id', critical: true },
    { method: 'GET', path: '/financial-reports', critical: true },
    { method: 'POST', path: '/financial-reports/generate', critical: true },
    { method: 'GET', path: '/revenue-forecasts', critical: true },
    { method: 'POST', path: '/revenue-forecasts/generate', critical: true },
    { method: 'GET', path: '/financial-analytics', critical: true },
    { method: 'GET', path: '/cash-flow-predictions', critical: true }
  ],

  // Phase 2: Care Intelligence
  'care-intelligence': [
    { method: 'POST', path: '/care-plans', critical: true },
    { method: 'GET', path: '/care-plans', critical: true },
    { method: 'GET', path: '/care-plans/:id', critical: true },
    { method: 'PUT', path: '/care-plans/:id', critical: true },
    { method: 'DELETE', path: '/care-plans/:id', critical: false },
    { method: 'POST', path: '/care-plans/:id/goals', critical: true },
    { method: 'PUT', path: '/care-plans/:id/goals/:goalId', critical: true },
    { method: 'POST', path: '/medications', critical: true },
    { method: 'GET', path: '/medications', critical: true },
    { method: 'GET', path: '/medications/:id', critical: true },
    { method: 'PUT', path: '/medications/:id', critical: true },
    { method: 'POST', path: '/medications/:id/log', critical: true },
    { method: 'POST', path: '/incidents', critical: true },
    { method: 'GET', path: '/incidents', critical: true },
    { method: 'GET', path: '/incidents/:id', critical: true },
    { method: 'PUT', path: '/incidents/:id', critical: true },
    { method: 'POST', path: '/risk-assessments', critical: true },
    { method: 'GET', path: '/risk-assessments', critical: true },
    { method: 'GET', path: '/risk-assessments/:id', critical: true },
    { method: 'POST', path: '/behavior-supports', critical: true },
    { method: 'GET', path: '/behavior-supports', critical: true },
    { method: 'GET', path: '/care-reports', critical: true },
    { method: 'POST', path: '/care-reports/generate', critical: true }
  ],

  // Phase 3: Workforce Optimization
  'workforce-optimization': [
    { method: 'POST', path: '/workforce/schedules', critical: true },
    { method: 'GET', path: '/workforce/schedules', critical: true },
    { method: 'GET', path: '/workforce/schedules/:id', critical: true },
    { method: 'PUT', path: '/workforce/schedules/:id', critical: true },
    { method: 'POST', path: '/workforce/performance', critical: true },
    { method: 'GET', path: '/workforce/performance', critical: true },
    { method: 'GET', path: '/workforce/performance/:workerId', critical: true },
    { method: 'POST', path: '/workforce/resource-allocation', critical: true },
    { method: 'GET', path: '/workforce/resource-allocation', critical: true },
    { method: 'POST', path: '/workforce/optimize-schedule', critical: true },
    { method: 'GET', path: '/workforce/analytics', critical: true },
    { method: 'GET', path: '/workforce/planning', critical: true },
    { method: 'POST', path: '/workforce/planning/generate', critical: true },
    { method: 'GET', path: '/workforce/quality-assurance', critical: true },
    { method: 'POST', path: '/workforce/quality-assurance/audit', critical: true },
    { method: 'GET', path: '/workforce/business-intelligence', critical: true }
  ],

  // Phase 4: Real-Time Portal
  'realtime-portal': [
    { method: 'POST', path: '/realtime/tracking/start', critical: true },
    { method: 'POST', path: '/realtime/tracking/stop', critical: true },
    { method: 'GET', path: '/realtime/tracking/:workerId', critical: true },
    { method: 'GET', path: '/realtime/tracking/active', critical: true },
    { method: 'POST', path: '/realtime/messages', critical: true },
    { method: 'GET', path: '/realtime/messages', critical: true },
    { method: 'GET', path: '/realtime/messages/:id', critical: true },
    { method: 'PUT', path: '/realtime/messages/:id/read', critical: true },
    { method: 'POST', path: '/realtime/service-confirmations', critical: true },
    { method: 'GET', path: '/realtime/service-confirmations', critical: true },
    { method: 'GET', path: '/realtime/service-confirmations/:id', critical: true },
    { method: 'POST', path: '/realtime/family-access', critical: true },
    { method: 'GET', path: '/realtime/family-access', critical: true },
    { method: 'PUT', path: '/realtime/family-access/:id', critical: true },
    { method: 'POST', path: '/realtime/geofence', critical: true },
    { method: 'GET', path: '/realtime/geofence', critical: true }
  ],

  // Phase 5: Client Portal
  'client-portal': [
    { method: 'POST', path: '/client-portal/login', critical: true },
    { method: 'GET', path: '/client-portal/profile', critical: true },
    { method: 'PUT', path: '/client-portal/profile', critical: true },
    { method: 'GET', path: '/client-portal/appointments', critical: true },
    { method: 'GET', path: '/client-portal/appointments/:id', critical: true },
    { method: 'POST', path: '/client-portal/appointments/:id/reschedule', critical: true },
    { method: 'GET', path: '/client-portal/invoices', critical: true },
    { method: 'GET', path: '/client-portal/invoices/:id', critical: true },
    { method: 'GET', path: '/client-portal/care-plan', critical: true },
    { method: 'POST', path: '/client-portal/feedback', critical: true },
    { method: 'GET', path: '/client-portal/messages', critical: true },
    { method: 'POST', path: '/client-portal/messages', critical: true },
    { method: 'GET', path: '/client-portal/documents', critical: true },
    { method: 'GET', path: '/client-portal/documents/:id', critical: true }
  ],

  // Phase 6: Payroll
  'payroll': [
    { method: 'POST', path: '/timesheets', critical: true },
    { method: 'GET', path: '/timesheets', critical: true },
    { method: 'GET', path: '/timesheets/:id', critical: true },
    { method: 'PUT', path: '/timesheets/:id', critical: true },
    { method: 'POST', path: '/timesheets/:id/approve', critical: true },
    { method: 'POST', path: '/timesheets/:id/reject', critical: true },
    { method: 'POST', path: '/payroll/process', critical: true },
    { method: 'GET', path: '/payroll/periods', critical: true },
    { method: 'GET', path: '/payroll/periods/:id', critical: true },
    { method: 'GET', path: '/payroll/pay-stubs', critical: true },
    { method: 'GET', path: '/payroll/pay-stubs/:id', critical: true },
    { method: 'POST', path: '/payroll/deductions', critical: true },
    { method: 'GET', path: '/payroll/deductions', critical: true },
    { method: 'GET', path: '/payroll/reports', critical: true },
    { method: 'POST', path: '/payroll/reports/generate', critical: true }
  ],

  // Phase 7: Offline Sync
  'offline-sync': [
    { method: 'POST', path: '/sync/queue', critical: true },
    { method: 'GET', path: '/sync/queue', critical: true },
    { method: 'POST', path: '/sync/process', critical: true },
    { method: 'GET', path: '/sync/status', critical: true },
    { method: 'POST', path: '/sync/conflicts', critical: true },
    { method: 'GET', path: '/sync/conflicts', critical: true },
    { method: 'POST', path: '/sync/conflicts/:id/resolve', critical: true },
    { method: 'GET', path: '/sync/history', critical: true },
    { method: 'POST', path: '/sync/validate', critical: true }
  ],

  // Phase 8: Compliance
  'compliance': [
    { method: 'POST', path: '/compliance/certifications', critical: true },
    { method: 'GET', path: '/compliance/certifications', critical: true },
    { method: 'GET', path: '/compliance/certifications/:id', critical: true },
    { method: 'PUT', path: '/compliance/certifications/:id', critical: true },
    { method: 'GET', path: '/compliance/expiring', critical: true },
    { method: 'POST', path: '/compliance/audit-logs', critical: true },
    { method: 'GET', path: '/compliance/audit-logs', critical: true },
    { method: 'GET', path: '/compliance/audit-logs/:id', critical: true },
    { method: 'POST', path: '/compliance/checks', critical: true },
    { method: 'GET', path: '/compliance/checks', critical: true },
    { method: 'GET', path: '/compliance/reports', critical: true },
    { method: 'POST', path: '/compliance/reports/generate', critical: true },
    { method: 'GET', path: '/compliance/workers/:workerId', critical: true }
  ],

  // Phase 9: Expenses
  'expenses': [
    { method: 'POST', path: '/expenses', critical: true },
    { method: 'GET', path: '/expenses', critical: true },
    { method: 'GET', path: '/expenses/:id', critical: true },
    { method: 'PUT', path: '/expenses/:id', critical: true },
    { method: 'DELETE', path: '/expenses/:id', critical: false },
    { method: 'POST', path: '/expenses/:id/receipt', critical: true },
    { method: 'GET', path: '/expenses/:id/receipt', critical: true },
    { method: 'POST', path: '/expenses/:id/approve', critical: true },
    { method: 'POST', path: '/expenses/:id/reject', critical: true },
    { method: 'POST', path: '/expenses/:id/reimburse', critical: true },
    { method: 'GET', path: '/expenses/reports', critical: true },
    { method: 'POST', path: '/expenses/reports/generate', critical: true },
    { method: 'GET', path: '/expenses/categories', critical: true }
  ],

  // Phase 10: Scheduling
  'scheduling': [
    { method: 'POST', path: '/shifts', critical: true },
    { method: 'GET', path: '/shifts', critical: true },
    { method: 'GET', path: '/shifts/:id', critical: true },
    { method: 'PUT', path: '/shifts/:id', critical: true },
    { method: 'DELETE', path: '/shifts/:id', critical: false },
    { method: 'POST', path: '/shifts/:id/assign', critical: true },
    { method: 'POST', path: '/shifts/:id/unassign', critical: true },
    { method: 'POST', path: '/shifts/match-worker', critical: true },
    { method: 'POST', path: '/shifts/recurring', critical: true },
    { method: 'GET', path: '/shifts/recurring', critical: true },
    { method: 'POST', path: '/shifts/optimize', critical: true },
    { method: 'GET', path: '/shifts/availability', critical: true },
    { method: 'POST', path: '/shifts/availability', critical: true },
    { method: 'GET', path: '/shifts/calendar', critical: true }
  ],

  // Phase 11: Analytics
  'analytics': [
    { method: 'GET', path: '/analytics/dashboard', critical: true },
    { method: 'GET', path: '/analytics/metrics', critical: true },
    { method: 'POST', path: '/analytics/metrics/custom', critical: true },
    { method: 'GET', path: '/analytics/predictions', critical: true },
    { method: 'POST', path: '/analytics/predictions/generate', critical: true },
    { method: 'GET', path: '/analytics/reports', critical: true },
    { method: 'POST', path: '/analytics/reports/generate', critical: true },
    { method: 'GET', path: '/analytics/insights', critical: true },
    { method: 'POST', path: '/analytics/insights/generate', critical: true },
    { method: 'GET', path: '/analytics/trends', critical: true },
    { method: 'GET', path: '/analytics/kpis', critical: true }
  ],

  // Core/Common endpoints
  'core': [
    { method: 'POST', path: '/auth/login', critical: true },
    { method: 'POST', path: '/auth/logout', critical: true },
    { method: 'POST', path: '/auth/refresh', critical: true },
    { method: 'POST', path: '/auth/register', critical: true },
    { method: 'POST', path: '/auth/forgot-password', critical: true },
    { method: 'POST', path: '/auth/reset-password', critical: true },
    { method: 'GET', path: '/users', critical: true },
    { method: 'GET', path: '/users/:id', critical: true },
    { method: 'POST', path: '/users', critical: true },
    { method: 'PUT', path: '/users/:id', critical: true },
    { method: 'DELETE', path: '/users/:id', critical: false },
    { method: 'GET', path: '/organizations', critical: true },
    { method: 'GET', path: '/organizations/:id', critical: true },
    { method: 'PUT', path: '/organizations/:id', critical: true },
    { method: 'GET', path: '/clients', critical: true },
    { method: 'GET', path: '/clients/:id', critical: true },
    { method: 'POST', path: '/clients', critical: true },
    { method: 'PUT', path: '/clients/:id', critical: true },
    { method: 'DELETE', path: '/clients/:id', critical: false }
  ]
};

/**
 * Get all endpoints for a specific phase
 * @param {string} phase - Feature phase name
 * @returns {Array} Array of endpoints
 */
export function getEndpointsForPhase(phase) {
  return endpointRegistry[phase] || [];
}

/**
 * Get all endpoints across all phases
 * @returns {Array} Array of all endpoints with phase information
 */
export function getAllEndpoints() {
  const allEndpoints = [];
  
  for (const [phase, endpoints] of Object.entries(endpointRegistry)) {
    for (const endpoint of endpoints) {
      allEndpoints.push({
        ...endpoint,
        phase
      });
    }
  }
  
  return allEndpoints;
}

/**
 * Get critical endpoints only
 * @returns {Array} Array of critical endpoints
 */
export function getCriticalEndpoints() {
  return getAllEndpoints().filter(endpoint => endpoint.critical);
}

/**
 * Get total endpoint count
 * @returns {number} Total number of endpoints
 */
export function getTotalEndpointCount() {
  return getAllEndpoints().length;
}

/**
 * Get endpoint count by phase
 * @returns {Object} Object with phase names as keys and counts as values
 */
export function getEndpointCountByPhase() {
  const counts = {};
  
  for (const [phase, endpoints] of Object.entries(endpointRegistry)) {
    counts[phase] = endpoints.length;
  }
  
  return counts;
}

export default endpointRegistry;
