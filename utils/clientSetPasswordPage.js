function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderClientSetPasswordPage({ apiKey, brandName = 'CareNest' } = {}) {
  const safeBrandName = escapeHtml(brandName);
  const apiKeyLiteral = JSON.stringify(String(apiKey || ''));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeBrandName} - Set Password</title>
  <style>
    :root {
      --red: #cf2f22;
      --blue: #1b3fa6;
      --yellow: #f1ba19;
      --black: #121212;
      --cream: #f5f1e6;
      --white: #ffffff;
      --green: #0da85e;
      --danger: #d32f2f;
      --muted: #4f4f4f;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: 'Futura PT', 'Futura', 'Avenir Next', 'Century Gothic', sans-serif;
      color: var(--black);
      background: var(--cream);
      display: grid;
      place-items: center;
      padding: 28px;
      position: relative;
      overflow-x: hidden;
    }

    .card {
      width: 100%;
      max-width: 600px;
      background: var(--white);
      border: 4px solid var(--black);
      border-radius: 0;
      box-shadow: 8px 8px 0 var(--black);
      overflow: hidden;
      position: relative;
      z-index: 2;
    }

    .header {
      padding: 24px 24px 18px;
      border-bottom: 4px solid var(--black);
      background: var(--white);
    }

    .bars {
      display: grid;
      grid-template-columns: 1fr 1fr 72px;
      gap: 8px;
      margin-bottom: 16px;
    }

    .bar {
      height: 20px;
      border: 2px solid var(--black);
      border-radius: 0;
    }

    .bar.red {
      background: var(--red);
    }

    .bar.blue {
      background: var(--blue);
    }

    .bar.yellow {
      background: var(--yellow);
    }

    .header h1 {
      margin: 0 0 4px;
      font-size: 34px;
      font-weight: 700;
      letter-spacing: 0.05em;
      line-height: 1.1;
      text-transform: uppercase;
    }

    .header p {
      margin: 0;
      font-size: 14px;
      color: var(--muted);
      font-weight: 500;
      letter-spacing: 0.01em;
    }

    .content {
      padding: 22px;
    }

    .email-pill {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      margin-bottom: 16px;
      padding: 8px 12px;
      border-radius: 0;
      border: 2px solid var(--black);
      background: var(--yellow);
      color: var(--black);
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }

    .identity-panel {
      display: grid;
      gap: 10px;
      margin-bottom: 16px;
      padding: 14px;
      border: 2px solid var(--black);
      background: #eef2ff;
    }

    .identity-row {
      display: grid;
      grid-template-columns: 110px 1fr;
      gap: 10px;
      align-items: start;
    }

    .identity-label {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }

    .identity-value {
      font-size: 16px;
      font-weight: 700;
      line-height: 1.2;
      color: var(--black);
      word-break: break-word;
    }

    .alert {
      margin-bottom: 15px;
      padding: 11px 12px;
      border-radius: 0;
      font-size: 14px;
      line-height: 1.4;
      display: none;
      border: 2px solid var(--black);
      font-weight: 600;
    }

    .alert.error {
      display: block;
      background: #ffe8e6;
      color: var(--danger);
    }

    .alert.success {
      display: block;
      background: #e5f9ef;
      color: var(--green);
    }

    .alert.warning {
      display: block;
      background: #fff7da;
      color: #6f4e00;
    }

    .field {
      margin-bottom: 14px;
    }

    label {
      display: block;
      margin-bottom: 7px;
      font-size: 13px;
      font-weight: 700;
      color: var(--black);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    input {
      width: 100%;
      border: 2px solid var(--black);
      border-radius: 0;
      background: var(--white);
      padding: 12px 13px;
      font-size: 15px;
      font-weight: 600;
      outline: none;
      transition: transform .08s ease;
    }

    input:focus {
      border-color: var(--blue);
      box-shadow: 3px 3px 0 var(--blue);
      transform: translate(-1px, -1px);
    }

    .rules {
      margin: 14px 0 17px;
      padding: 13px;
      border-radius: 0;
      background: #fff8dc;
      border: 2px solid var(--black);
      font-size: 13px;
      color: var(--muted);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .rules ul {
      margin: 8px 0 0;
      padding-left: 18px;
      text-transform: none;
      letter-spacing: 0;
    }

    .rules li {
      margin: 4px 0;
    }

    .rules li.ok {
      color: var(--green);
      font-weight: 700;
    }

    .button {
      width: 100%;
      border: 2px solid var(--black);
      border-radius: 0;
      padding: 14px 16px;
      font-size: 16px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      cursor: pointer;
      color: var(--white);
      background: var(--red);
      box-shadow: 4px 4px 0 var(--black);
      transition: transform .08s ease, box-shadow .08s ease, opacity .18s ease;
    }

    .button:hover {
      transform: translate(-1px, -1px);
      box-shadow: 5px 5px 0 var(--black);
    }

    .button:active {
      transform: translate(1px, 1px);
      box-shadow: 2px 2px 0 var(--black);
    }

    .button:disabled {
      cursor: not-allowed;
      opacity: 0.68;
      transform: none;
      box-shadow: 0 0 0 transparent;
    }

    .footer {
      margin-top: 15px;
      font-size: 12px;
      color: var(--muted);
      font-weight: 600;
      border-top: 2px solid #d7d2c5;
      padding-top: 12px;
      letter-spacing: 0.01em;
    }

    .hidden {
      display: none !important;
    }

    @media (max-width: 560px) {
      body {
        padding: 14px;
      }

      .card {
        border-width: 3px;
        box-shadow: 5px 5px 0 var(--black);
      }

      .header h1 {
        font-size: 28px;
      }

      .identity-row {
        grid-template-columns: 1fr;
        gap: 4px;
      }
    }
  </style>
</head>
<body>
  <main class="card">
    <section class="header">
      <div class="bars" aria-hidden="true">
        <div class="bar red"></div>
        <div class="bar blue"></div>
        <div class="bar yellow"></div>
      </div>
      <h1 id="page-title">Set Your Password</h1>
      <p id="page-subtitle">Securely complete account setup for ${safeBrandName}</p>
    </section>

    <section class="content">
      <div id="identity-panel" class="identity-panel hidden">
        <div id="identity-name-row" class="identity-row hidden">
          <div class="identity-label">Family Member</div>
          <div id="identity-name" class="identity-value"></div>
        </div>
        <div id="identity-email-row" class="identity-row hidden">
          <div class="identity-label">Email</div>
          <div id="identity-email" class="identity-value"></div>
        </div>
      </div>
      <div id="email-pill" class="email-pill hidden"></div>
      <div id="alert" class="alert"></div>

      <form id="reset-form" novalidate>
        <div class="field">
          <label for="new-password">New Password</label>
          <input
            id="new-password"
            name="new-password"
            type="password"
            autocomplete="new-password"
            required
          />
        </div>

        <div class="field">
          <label for="confirm-password">Confirm Password</label>
          <input
            id="confirm-password"
            name="confirm-password"
            type="password"
            autocomplete="new-password"
            required
          />
        </div>

        <div class="rules">
          Password requirements:
          <ul>
            <li id="rule-len">At least 8 characters</li>
            <li id="rule-upper">At least 1 uppercase letter</li>
            <li id="rule-num">At least 1 number</li>
            <li id="rule-special">At least 1 special character</li>
          </ul>
        </div>

        <button id="submit-btn" class="button" type="submit">Save New Password</button>
      </form>

      <div id="success-panel" class="hidden">
        <div class="alert success">
          Password updated successfully. You can now return to the app and sign in.
        </div>
      </div>

      <p class="footer">
        If this link has expired, ask the client or care team member who invited you to resend your activation email.
      </p>
    </section>
  </main>

  <script>
    (function () {
      const firebaseApiKey = ${apiKeyLiteral};
      const params = new URLSearchParams(window.location.search);
      const oobCode = (params.get('code') || params.get('oobCode') || '').trim();
      const requestedAccountType = String(params.get('accountType') || '').trim().toLowerCase();
      const requestedName = String(params.get('name') || '').trim();
      const requestedEmail = String(params.get('email') || '').trim().toLowerCase();
      const endpoint =
        'https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=' +
        encodeURIComponent(firebaseApiKey || '');
      const signInEndpoint =
        'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' +
        encodeURIComponent(firebaseApiKey || '');
      const completeActivationEndpoint =
        '/api/firebase-auth/complete-client-activation';

      const alertEl = document.getElementById('alert');
      const pageTitle = document.getElementById('page-title');
      const pageSubtitle = document.getElementById('page-subtitle');
      const identityPanel = document.getElementById('identity-panel');
      const identityNameRow = document.getElementById('identity-name-row');
      const identityName = document.getElementById('identity-name');
      const identityEmailRow = document.getElementById('identity-email-row');
      const identityEmail = document.getElementById('identity-email');
      const emailPill = document.getElementById('email-pill');
      const formEl = document.getElementById('reset-form');
      const successPanel = document.getElementById('success-panel');
      const submitBtn = document.getElementById('submit-btn');
      const newPasswordEl = document.getElementById('new-password');
      const confirmPasswordEl = document.getElementById('confirm-password');
      let resolvedEmail = '';

      const rules = {
        len: document.getElementById('rule-len'),
        upper: document.getElementById('rule-upper'),
        num: document.getElementById('rule-num'),
        special: document.getElementById('rule-special')
      };

      function configureIdentityPanel(email) {
        const normalizedEmail = String(email || requestedEmail || '').trim().toLowerCase();
        const isFamily = requestedAccountType === 'family';

        pageTitle.textContent = isFamily ? 'Set Family Password' : 'Set Your Password';
        pageSubtitle.textContent = isFamily
          ? 'Activate family access for ${safeBrandName}'
          : 'Securely complete account setup for ${safeBrandName}';

        if (!requestedName && !normalizedEmail) {
          identityPanel.classList.add('hidden');
          identityNameRow.classList.add('hidden');
          identityEmailRow.classList.add('hidden');
          return;
        }

        identityPanel.classList.remove('hidden');

        if (requestedName) {
          identityName.textContent = requestedName;
          identityNameRow.classList.remove('hidden');
        } else {
          identityName.textContent = '';
          identityNameRow.classList.add('hidden');
        }

        if (normalizedEmail) {
          identityEmail.textContent = normalizedEmail;
          identityEmailRow.classList.remove('hidden');
        } else {
          identityEmail.textContent = '';
          identityEmailRow.classList.add('hidden');
        }
      }

      function showAlert(type, message) {
        alertEl.className = 'alert ' + type;
        alertEl.textContent = message;
      }

      function clearAlert() {
        alertEl.className = 'alert';
        alertEl.textContent = '';
      }

      function normalizeErrorCode(raw) {
        const text = String(raw || '');
        if (!text) return '';
        const beforeColon = text.split(':')[0];
        return beforeColon.trim().split(' ')[0].trim();
      }

      function toFriendlyError(code) {
        if (code === 'INVALID_OOB_CODE') {
          return 'This reset link is invalid or already used.';
        }
        if (code === 'EXPIRED_OOB_CODE') {
          return 'This reset link has expired. Ask your admin to resend activation.';
        }
        if (code === 'WEAK_PASSWORD') {
          return 'Your password is too weak. Use a stronger password.';
        }
        if (code === 'MISSING_OOB_CODE') {
          return 'Reset link is missing required information.';
        }
        if (code === 'MISSING_API_KEY') {
          return 'Reset page is not configured correctly.';
        }
        return 'Unable to reset password right now. Please try again.';
      }

      function passwordRuleState(password) {
        const value = String(password || '').trim();
        return {
          len: value.length >= 8,
          upper: /[A-Z]/.test(value),
          num: /[0-9]/.test(value),
          special: /[^A-Za-z0-9]/.test(value)
        };
      }

      function refreshRuleUI(password) {
        const state = passwordRuleState(password);
        Object.keys(rules).forEach((key) => {
          if (state[key]) {
            rules[key].classList.add('ok');
          } else {
            rules[key].classList.remove('ok');
          }
        });
        return state;
      }

      function meetsAllRules(state) {
        return state.len && state.upper && state.num && state.special;
      }

      async function callResetApi(payload) {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const code = normalizeErrorCode(data?.error?.message);
          const error = new Error(toFriendlyError(code));
          error.code = code;
          throw error;
        }
        return data;
      }

      async function signInWithNewPassword(email, password) {
        const response = await fetch(signInEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: String(email || '').trim(),
            password: String(password || ''),
            returnSecureToken: true
          })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const code = normalizeErrorCode(data?.error?.message);
          const error = new Error(
            code ? ('Sign-in verification failed: ' + code) : 'Sign-in verification failed.'
          );
          error.code = code || 'SIGN_IN_FAILED';
          throw error;
        }
        return data;
      }

      async function completeClientActivation(idToken) {
        const token = String(idToken || '').trim();
        if (!token) {
          return false;
        }
        const response = await fetch(completeActivationEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token
          },
          body: '{}'
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data?.success === false) {
          const error = new Error(
            data?.message
              ? String(data.message)
              : 'Activation status update failed.'
          );
          error.code = 'ACTIVATION_SYNC_FAILED';
          throw error;
        }
        return true;
      }

      async function initialize() {
        configureIdentityPanel('');
        if (!firebaseApiKey) {
          showAlert('error', toFriendlyError('MISSING_API_KEY'));
          formEl.classList.add('hidden');
          return;
        }
        if (!oobCode) {
          showAlert('error', toFriendlyError('MISSING_OOB_CODE'));
          formEl.classList.add('hidden');
          return;
        }

        try {
          const data = await callResetApi({ oobCode: oobCode });
          const email = data?.email ? String(data.email) : '';
          configureIdentityPanel(email);
          if (email) {
            resolvedEmail = email.trim().toLowerCase();
            emailPill.textContent = 'Resetting password for ' + email;
            emailPill.classList.remove('hidden');
          }
        } catch (error) {
          showAlert('error', error.message || 'Invalid reset link.');
          formEl.classList.add('hidden');
        }
      }

      newPasswordEl.addEventListener('input', function () {
        refreshRuleUI(newPasswordEl.value);
      });

      formEl.addEventListener('submit', async function (event) {
        event.preventDefault();
        clearAlert();

        const newPassword = newPasswordEl.value.trim();
        const confirmPassword = confirmPasswordEl.value.trim();
        const state = refreshRuleUI(newPassword);

        if (!meetsAllRules(state)) {
          showAlert('warning', 'Please satisfy all password requirements.');
          return;
        }

        if (!confirmPassword) {
          showAlert('warning', 'Please confirm your new password.');
          return;
        }

        if (newPassword !== confirmPassword) {
          showAlert('warning', 'Passwords do not match.');
          return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';

        try {
          await callResetApi({ oobCode: oobCode, newPassword: newPassword });
          let activationSynced = false;
          if (resolvedEmail) {
            try {
              const signInResult = await signInWithNewPassword(
                resolvedEmail,
                newPassword
              );
              activationSynced = await completeClientActivation(
                signInResult?.idToken
              );
            } catch (syncError) {
              console.warn(
                'Activation sync skipped:',
                syncError?.message || syncError
              );
            }
          }
          formEl.classList.add('hidden');
          successPanel.classList.remove('hidden');
          showAlert(
            'success',
            activationSynced
              ? 'Password updated and account activated. You can now sign in.'
              : 'Password updated. If status still shows pending, sign in once in the app.'
          );
        } catch (error) {
          showAlert('error', error.message || 'Unable to save password.');
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Save New Password';
        }
      });

      initialize();
    })();
  </script>
</body>
</html>`;
}

module.exports = {
  renderClientSetPasswordPage
};
