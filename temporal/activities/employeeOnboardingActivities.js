'use strict';

const { admin } = require('../../firebase-admin-config');
const emailService = require('../../services/emailService');
const User = require('../../models/User');
const logger = require('../../config/logger');

// ---------------------------------------------------------------------------
// HTML email templates
// ---------------------------------------------------------------------------

/**
 * Professional Welcome + Verify Email template.
 * @param {string} firstName
 * @param {string} verificationLink
 */
function buildWelcomeVerifyEmailHtml(firstName, verificationLink) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to CareNest</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f4f6f9; font-family: 'Segoe UI', Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); padding: 40px 48px; text-align: center; }
    .header h1 { color: #ffffff; font-size: 28px; font-weight: 700; margin: 0 0 8px; letter-spacing: -0.5px; }
    .header p { color: #a8c0ff; font-size: 14px; margin: 0; }
    .logo { font-size: 36px; margin-bottom: 16px; }
    .body { padding: 40px 48px; }
    .greeting { font-size: 22px; font-weight: 700; color: #1a1a2e; margin: 0 0 16px; }
    .text { font-size: 15px; color: #555; line-height: 1.7; margin: 0 0 24px; }
    .btn-wrapper { text-align: center; margin: 32px 0; }
    .btn { display: inline-block; background: linear-gradient(135deg, #e94560, #c23152); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; padding: 16px 40px; border-radius: 50px; letter-spacing: 0.5px; }
    .divider { border: none; border-top: 1px solid #e8ecf1; margin: 32px 0; }
    .fallback { font-size: 13px; color: #888; word-break: break-all; }
    .fallback a { color: #e94560; }
    .feature-grid { display: flex; gap: 16px; margin: 24px 0; }
    .feature-item { flex: 1; background: #f8fafc; border-radius: 8px; padding: 16px; text-align: center; }
    .feature-icon { font-size: 24px; margin-bottom: 8px; }
    .feature-title { font-size: 13px; font-weight: 600; color: #1a1a2e; margin: 0; }
    .footer { background: #f8fafc; padding: 24px 48px; text-align: center; }
    .footer p { font-size: 12px; color: #aaa; margin: 0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="logo">🏥</div>
      <h1>Welcome to CareNest</h1>
      <p>Your smart care workforce platform</p>
    </div>
    <div class="body">
      <p class="greeting">Hi ${firstName || 'there'} 👋</p>
      <p class="text">
        We're thrilled to have you on board! Your account has been successfully created.
        To get started, please verify your email address by clicking the button below.
        This helps us keep your account secure.
      </p>
      <div class="btn-wrapper">
        <a href="${verificationLink}" class="btn">✅ Verify My Email Address</a>
      </div>
      <div class="feature-grid">
        <div class="feature-item">
          <div class="feature-icon">📅</div>
          <p class="feature-title">Smart Scheduling</p>
        </div>
        <div class="feature-item">
          <div class="feature-icon">📊</div>
          <p class="feature-title">Timesheets & Expenses</p>
        </div>
        <div class="feature-item">
          <div class="feature-icon">🚨</div>
          <p class="feature-title">Emergency Alerts</p>
        </div>
      </div>
      <hr class="divider" />
      <p class="fallback">
        If the button doesn't work, copy and paste this link into your browser:<br />
        <a href="${verificationLink}">${verificationLink}</a>
      </p>
      <p class="fallback" style="margin-top:16px;">This link will expire in 24 hours for security reasons.</p>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} CareNest. All rights reserved.</p>
      <p style="margin-top:4px;">You're receiving this because you signed up at carenest.app</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Verification reminder email for users who haven't verified yet.
 * @param {string} firstName
 * @param {string} verificationLink
 */
function buildVerificationReminderHtml(firstName, verificationLink) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Reminder: Verify your CareNest email</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f4f6f9; font-family: 'Segoe UI', Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #f7971e, #ffd200); padding: 32px 48px; text-align: center; }
    .header h1 { color: #1a1a2e; font-size: 24px; font-weight: 700; margin: 0; }
    .body { padding: 40px 48px; }
    .greeting { font-size: 20px; font-weight: 700; color: #1a1a2e; margin: 0 0 16px; }
    .text { font-size: 15px; color: #555; line-height: 1.7; margin: 0 0 24px; }
    .btn-wrapper { text-align: center; margin: 32px 0; }
    .btn { display: inline-block; background: linear-gradient(135deg, #f7971e, #ffd200); color: #1a1a2e; text-decoration: none; font-size: 16px; font-weight: 700; padding: 16px 40px; border-radius: 50px; }
    .footer { background: #f8fafc; padding: 24px 48px; text-align: center; }
    .footer p { font-size: 12px; color: #aaa; margin: 0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header"><h1>⏰ Don't forget to verify your email</h1></div>
    <div class="body">
      <p class="greeting">Hi ${firstName || 'there'},</p>
      <p class="text">
        We noticed you haven't verified your CareNest email address yet.
        Verifying your email takes just one click and unlocks full access to your account!
      </p>
      <div class="btn-wrapper">
        <a href="${verificationLink}" class="btn">Verify My Email Now</a>
      </div>
      <p class="text" style="font-size:13px; color:#888;">
        If you didn't create an account, you can safely ignore this email.
      </p>
    </div>
    <div class="footer"><p>© ${new Date().getFullYear()} CareNest. All rights reserved.</p></div>
  </div>
</body>
</html>`;
}

/**
 * Onboarding incomplete reminder.
 * @param {string} firstName
 */
function buildOnboardingReminderHtml(firstName) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Complete your CareNest profile</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f4f6f9; font-family: 'Segoe UI', Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #1a1a2e, #0f3460); padding: 32px 48px; text-align: center; }
    .header h1 { color: #ffffff; font-size: 24px; font-weight: 700; margin: 0; }
    .progress-bar-outer { background: #e8ecf1; border-radius: 100px; height: 10px; margin: 24px 0; }
    .progress-bar-inner { background: linear-gradient(90deg, #e94560, #f7971e); height: 10px; border-radius: 100px; width: 40%; }
    .body { padding: 40px 48px; }
    .greeting { font-size: 20px; font-weight: 700; color: #1a1a2e; margin: 0 0 16px; }
    .text { font-size: 15px; color: #555; line-height: 1.7; margin: 0 0 24px; }
    .steps { list-style: none; padding: 0; margin: 0 0 24px; }
    .steps li { padding: 8px 0; font-size: 14px; color: #555; display: flex; align-items: center; gap: 10px; }
    .step-icon { font-size: 18px; }
    .btn-wrapper { text-align: center; margin: 32px 0; }
    .btn { display: inline-block; background: linear-gradient(135deg, #e94560, #c23152); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; padding: 16px 40px; border-radius: 50px; }
    .footer { background: #f8fafc; padding: 24px 48px; text-align: center; }
    .footer p { font-size: 12px; color: #aaa; margin: 0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header"><h1>📋 Your profile is incomplete</h1></div>
    <div class="body">
      <p class="greeting">Hi ${firstName || 'there'},</p>
      <p class="text">
        You're almost there! Complete your CareNest onboarding so your manager can assign
        you shifts and you can start getting paid. It only takes a few minutes.
      </p>
      <div class="progress-bar-outer"><div class="progress-bar-inner"></div></div>
      <p style="font-size: 12px; color: #888; margin: -12px 0 24px;">Profile completion in progress...</p>
      <ul class="steps">
        <li><span class="step-icon">👤</span> Personal details</li>
        <li><span class="step-icon">🏦</span> Bank & payment details</li>
        <li><span class="step-icon">📄</span> Tax & superannuation</li>
        <li><span class="step-icon">📑</span> Required documents</li>
      </ul>
      <div class="btn-wrapper">
        <a href="#" class="btn">Open CareNest App to Continue</a>
      </div>
      <p class="text" style="font-size:13px; color:#888;">
        Open the CareNest mobile app and tap "Continue Onboarding" from your home screen.
      </p>
    </div>
    <div class="footer"><p>© ${new Date().getFullYear()} CareNest. All rights reserved.</p></div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

/**
 * Generates a Firebase email action verification link via Admin SDK
 * and sends a professional welcome email via SMTP2GO.
 */
async function generateAndSendVerificationEmail({ userId, email, firstName }) {
  logger.info('[Onboarding] Generating Firebase verification link', { userId, email });

  let verificationLink;
  try {
    verificationLink = await admin.auth().generateEmailVerificationLink(email, {
      url: `${process.env.APP_URL || 'https://carenest.app'}/?verified=true`,
      handleCodeInApp: true,
    });
  } catch (err) {
    // If Firebase user doesn't exist yet (orphaned state), log and rethrow so Temporal retries.
    logger.error('[Onboarding] Failed to generate Firebase verification link', {
      userId, email, error: err.message,
    });
    throw err;
  }

  const html = buildWelcomeVerifyEmailHtml(firstName, verificationLink);
  await emailService.sendEmail(
    email,
    '✅ Welcome to CareNest — Please Verify Your Email',
    html
  );

  logger.info('[Onboarding] Welcome + verification email sent', { userId, email });
  return { sent: true };
}

/**
 * Sends a "don't forget to verify" reminder email with a fresh verification link.
 */
async function sendVerificationReminderEmail({ userId, email, firstName }) {
  logger.info('[Onboarding] Sending verification reminder', { userId, email });

  let verificationLink;
  try {
    verificationLink = await admin.auth().generateEmailVerificationLink(email, {
      url: `${process.env.APP_URL || 'https://carenest.app'}/?verified=true`,
      handleCodeInApp: true,
    });
  } catch (err) {
    logger.warn('[Onboarding] Could not regenerate verification link for reminder', {
      userId, email, error: err.message,
    });
    // Don't fail the workflow — send reminder without a fresh link
    verificationLink = '#';
  }

  const html = buildVerificationReminderHtml(firstName, verificationLink);
  await emailService.sendEmail(
    email,
    '⏰ Reminder: Verify your CareNest email address',
    html
  );

  logger.info('[Onboarding] Verification reminder sent', { userId, email });
  return { sent: true };
}

/**
 * Sends an "incomplete profile" reminder email for users who haven't
 * finished the onboarding flow.
 */
async function sendOnboardingReminderEmail({ userId, email, firstName }) {
  logger.info('[Onboarding] Sending onboarding reminder', { userId, email });

  const html = buildOnboardingReminderHtml(firstName);
  await emailService.sendEmail(
    email,
    '📋 Reminder: Complete your CareNest profile to start working',
    html
  );

  logger.info('[Onboarding] Onboarding reminder sent', { userId, email });
  return { sent: true };
}

/**
 * Activates the user account in MongoDB once onboarding is fully finalized.
 */
async function activateUserAccount({ userId }) {
  logger.info('[Onboarding] Activating user account', { userId });

  const result = await User.findByIdAndUpdate(
    userId,
    { $set: { isActive: true, onboardingComplete: true, updatedAt: new Date() } },
    { new: true }
  );

  if (!result) {
    throw new Error(`User not found for activation: ${userId}`);
  }

  logger.info('[Onboarding] User account activated', { userId, email: result.email });
  return { activated: true };
}

module.exports = {
  generateAndSendVerificationEmail,
  sendVerificationReminderEmail,
  sendOnboardingReminderEmail,
  activateUserAccount,
};
