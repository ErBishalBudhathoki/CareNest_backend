'use strict';

/**
 * EmployeeOnboardingWorkflow
 *
 * A long-running Temporal workflow that manages the full employee lifecycle
 * from registration → email verification → profile onboarding → activation.
 *
 * Signals (from API routes):
 *   - accountVerifiedSignal   : fired when /api/firebase-auth/verify-email succeeds
 *   - resendVerificationSignal: fired when user requests a new verification email
 *   - onboardingCompletedSignal: fired when onboardingController.submitOnboarding() completes
 *   - onboardingFinalizedSignal: fired when admin finalizes the onboarding record
 *
 * Queries:
 *   - getOnboardingStatus: returns the current phase and timestamps
 */

const {
  proxyActivities,
  setHandler,
  condition,
  defineSignal,
  defineQuery,
  log,
  sleep,
} = require('@temporalio/workflow');

// Activity proxy — these resolve to the actual Node.js activity functions
const {
  generateAndSendVerificationEmail,
  sendVerificationReminderEmail,
  sendOnboardingReminderEmail,
  activateUserAccount,
} = proxyActivities({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 5,
    initialInterval: '30s',
    backoffCoefficient: 2,
  },
});

// ---------------------------------------------------------------------------
// Signal & Query definitions
// ---------------------------------------------------------------------------
const accountVerifiedSignal = defineSignal('accountVerifiedSignal');
const resendVerificationSignal = defineSignal('resendVerificationSignal');
const onboardingCompletedSignal = defineSignal('onboardingCompletedSignal');
const onboardingFinalizedSignal = defineSignal('onboardingFinalizedSignal');
const getOnboardingStatus = defineQuery('getOnboardingStatus');

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

/**
 * @param {object} params
 * @param {string} params.userId       - MongoDB _id of the user
 * @param {string} params.email        - User's email address
 * @param {string} params.firstName    - User's first name
 * @param {string} params.organizationId - Organization the user belongs to
 */
async function EmployeeOnboardingWorkflow({ userId, email, firstName, organizationId }) {
  // Mutable state visible via Query
  const state = {
    phase: 'AWAITING_VERIFICATION',
    verifiedAt: null,
    onboardingCompletedAt: null,
    onboardingFinalizedAt: null,
    verificationResendCount: 0,
  };

  // Expose state to REST API via Temporal Query
  setHandler(getOnboardingStatus, () => ({ ...state }));

  // -------------------------------------------------------------------------
  // PHASE 1 — Email Verification
  // -------------------------------------------------------------------------
  log.info('Onboarding Phase 1 started', { userId, email });

  // Send the initial welcome + verification email
  await generateAndSendVerificationEmail({ userId, email, firstName });

  // Track whether a resend was requested while we are sleeping
  let resendRequested = false;
  setHandler(resendVerificationSignal, () => {
    resendRequested = true;
  });

  let accountVerified = false;
  setHandler(accountVerifiedSignal, () => {
    accountVerified = true;
    state.verifiedAt = new Date().toISOString();
  });

  // Inner loop: wait for verification, re-sending the email periodically
  // Each iteration waits up to 48 hours. If still unverified, sends a reminder
  // and waits another 48 hours. Maximum 7 days total (3 reminders + initial).
  const maxCycles = 3; // after initial send → 3 more reminders
  let cycle = 0;

  while (!accountVerified && cycle < maxCycles) {
    // Wait up to 48 hours — exits early if either signal fires
    const verifiedWithinWindow = await condition(
      () => accountVerified || resendRequested,
      '48 hours'
    );

    if (accountVerified) break;

    if (resendRequested) {
      resendRequested = false;
      state.verificationResendCount += 1;
      log.info('Resend requested', { userId, resendCount: state.verificationResendCount });
    } else {
      // 48 hours elapsed without action — send automatic reminder
      log.info('Sending automatic verification reminder', { userId, cycle });
    }

    await sendVerificationReminderEmail({ userId, email, firstName });
    cycle += 1;
  }

  // If the account is still not verified after all cycles, end gracefully.
  // The user can still verify later; the account is not deleted.
  if (!accountVerified) {
    log.info('Onboarding workflow ending: email not verified within 7 days', { userId });
    state.phase = 'VERIFICATION_EXPIRED';
    return { outcome: 'VERIFICATION_EXPIRED' };
  }

  // -------------------------------------------------------------------------
  // PHASE 2 — Profile Onboarding
  // -------------------------------------------------------------------------
  state.phase = 'AWAITING_ONBOARDING';
  log.info('Onboarding Phase 2 started', { userId });

  let onboardingCompleted = false;
  setHandler(onboardingCompletedSignal, () => {
    onboardingCompleted = true;
    state.onboardingCompletedAt = new Date().toISOString();
  });

  // First reminder after 24 hours if no completion
  const completedIn24h = await condition(() => onboardingCompleted, '24 hours');

  if (!completedIn24h && !onboardingCompleted) {
    log.info('Sending onboarding reminder (24h)', { userId });
    await sendOnboardingReminderEmail({ userId, email, firstName });

    // Wait another 48 hours
    const completedIn48h = await condition(() => onboardingCompleted, '48 hours');

    if (!completedIn48h && !onboardingCompleted) {
      // Second reminder
      log.info('Sending onboarding reminder (72h)', { userId });
      await sendOnboardingReminderEmail({ userId, email, firstName });

      // Wait final 7 days — user can still complete at any time by signalling
      await condition(() => onboardingCompleted, '7 days');
    }
  }

  if (!onboardingCompleted) {
    log.info('Onboarding workflow ending: profile not completed', { userId });
    state.phase = 'ONBOARDING_ABANDONED';
    return { outcome: 'ONBOARDING_ABANDONED' };
  }

  // -------------------------------------------------------------------------
  // PHASE 3 — Admin Review & Activation
  // -------------------------------------------------------------------------
  state.phase = 'AWAITING_ADMIN_FINALIZATION';
  log.info('Onboarding Phase 3 started', { userId });

  let onboardingFinalized = false;
  setHandler(onboardingFinalizedSignal, () => {
    onboardingFinalized = true;
    state.onboardingFinalizedAt = new Date().toISOString();
  });

  // Wait up to 14 days for admin to finalize
  await condition(() => onboardingFinalized, '14 days');

  if (onboardingFinalized) {
    log.info('Onboarding finalized by admin — activating account', { userId });
    await activateUserAccount({ userId });
    state.phase = 'COMPLETED';
    return { outcome: 'COMPLETED' };
  }

  log.info('Onboarding workflow ending: admin finalization not done in 14 days', { userId });
  state.phase = 'FINALIZATION_PENDING';
  return { outcome: 'FINALIZATION_PENDING' };
}

module.exports = { EmployeeOnboardingWorkflow };
