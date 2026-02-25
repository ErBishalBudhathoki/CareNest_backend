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
      --bg-a: #f0f7ff;
      --bg-b: #e9fff5;
      --card: #ffffff;
      --text: #0f172a;
      --muted: #475569;
      --primary: #1d4ed8;
      --primary-2: #0f766e;
      --border: #dbe5f5;
      --danger: #b91c1c;
      --danger-bg: #fee2e2;
      --success: #166534;
      --success-bg: #dcfce7;
      --warning: #854d0e;
      --warning-bg: #fef9c3;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: var(--text);
      background:
        radial-gradient(1200px 700px at 0% -10%, var(--bg-a), transparent 60%),
        radial-gradient(900px 500px at 100% 0%, var(--bg-b), transparent 55%),
        #f8fafc;
      display: grid;
      place-items: center;
      padding: 24px;
    }

    .card {
      width: 100%;
      max-width: 520px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 20px;
      box-shadow: 0 24px 64px rgba(2, 6, 23, 0.12);
      overflow: hidden;
    }

    .header {
      padding: 24px;
      background: linear-gradient(135deg, var(--primary), var(--primary-2));
      color: #fff;
    }

    .header h1 {
      margin: 0 0 6px;
      font-size: 24px;
      line-height: 1.2;
    }

    .header p {
      margin: 0;
      font-size: 14px;
      opacity: 0.95;
    }

    .content {
      padding: 22px;
    }

    .email-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 14px;
      padding: 8px 12px;
      border-radius: 999px;
      border: 1px solid #cfe0ff;
      background: #f1f6ff;
      color: #1e3a8a;
      font-size: 13px;
      font-weight: 600;
    }

    .alert {
      margin-bottom: 14px;
      padding: 10px 12px;
      border-radius: 10px;
      font-size: 14px;
      line-height: 1.4;
      display: none;
    }

    .alert.error {
      display: block;
      background: var(--danger-bg);
      color: var(--danger);
      border: 1px solid #fecaca;
    }

    .alert.success {
      display: block;
      background: var(--success-bg);
      color: var(--success);
      border: 1px solid #bbf7d0;
    }

    .alert.warning {
      display: block;
      background: var(--warning-bg);
      color: var(--warning);
      border: 1px solid #fde68a;
    }

    .field {
      margin-bottom: 12px;
    }

    label {
      display: block;
      margin-bottom: 6px;
      font-size: 13px;
      font-weight: 700;
      color: #1e293b;
      text-transform: uppercase;
      letter-spacing: .04em;
    }

    input {
      width: 100%;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      padding: 12px;
      font-size: 14px;
      outline: none;
      transition: border-color .18s, box-shadow .18s;
    }

    input:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.16);
    }

    .rules {
      margin: 12px 0 16px;
      padding: 12px;
      border-radius: 12px;
      background: #f8fafc;
      border: 1px dashed #cbd5e1;
      font-size: 13px;
      color: var(--muted);
    }

    .rules ul {
      margin: 8px 0 0;
      padding-left: 18px;
    }

    .rules li {
      margin: 4px 0;
    }

    .rules li.ok {
      color: var(--success);
      font-weight: 600;
    }

    .button {
      width: 100%;
      border: 0;
      border-radius: 12px;
      padding: 13px 14px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      color: #fff;
      background: linear-gradient(135deg, var(--primary), var(--primary-2));
      transition: transform .08s ease, opacity .18s ease;
    }

    .button:hover {
      transform: translateY(-1px);
    }

    .button:disabled {
      cursor: not-allowed;
      opacity: 0.7;
      transform: none;
    }

    .footer {
      margin-top: 14px;
      font-size: 12px;
      color: #64748b;
    }

    .hidden {
      display: none !important;
    }
  </style>
</head>
<body>
  <main class="card">
    <section class="header">
      <h1>Set Your Password</h1>
      <p>Securely complete account setup for ${safeBrandName}</p>
    </section>

    <section class="content">
      <div id="email-pill" class="email-pill hidden"></div>
      <div id="alert" class="alert"></div>

      <form id="reset-form" novalidate>
        <div class="field">
          <label for="new-password">New Password</label>
          <input id="new-password" name="new-password" type="password" autocomplete="new-password" required />
        </div>

        <div class="field">
          <label for="confirm-password">Confirm Password</label>
          <input id="confirm-password" name="confirm-password" type="password" autocomplete="new-password" required />
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
        If this link has expired, ask your organization admin to resend your activation email.
      </p>
    </section>
  </main>

  <script>
    (function () {
      const firebaseApiKey = ${apiKeyLiteral};
      const params = new URLSearchParams(window.location.search);
      const oobCode = (params.get('code') || params.get('oobCode') || '').trim();
      const endpoint =
        'https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=' +
        encodeURIComponent(firebaseApiKey || '');

      const alertEl = document.getElementById('alert');
      const emailPill = document.getElementById('email-pill');
      const formEl = document.getElementById('reset-form');
      const successPanel = document.getElementById('success-panel');
      const submitBtn = document.getElementById('submit-btn');
      const newPasswordEl = document.getElementById('new-password');
      const confirmPasswordEl = document.getElementById('confirm-password');

      const rules = {
        len: document.getElementById('rule-len'),
        upper: document.getElementById('rule-upper'),
        num: document.getElementById('rule-num'),
        special: document.getElementById('rule-special')
      };

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

      async function initialize() {
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
          if (email) {
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
          formEl.classList.add('hidden');
          successPanel.classList.remove('hidden');
          showAlert('success', 'Password updated. Return to the app and sign in.');
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

