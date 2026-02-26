const FIREBASE_SIGN_IN_URL =
  'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';

function getFirebaseApiKey() {
  return (
    process.env.FIREBASE_API_KEY ||
    process.env.FIREBASE_WEB_API_KEY ||
    process.env.GOOGLE_WEB_API_KEY ||
    ''
  ).trim();
}

/**
 * Verify email/password against Firebase Auth via Identity Toolkit REST API.
 * Returns true when credentials are valid, false when credentials are invalid.
 * Throws on configuration/network/server errors.
 */
async function verifyFirebaseCredentials(email, password) {
  const apiKey = getFirebaseApiKey();
  if (!apiKey) {
    throw new Error(
      'Firebase API key is not configured. Set FIREBASE_API_KEY.'
    );
  }

  const response = await fetch(`${FIREBASE_SIGN_IN_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: String(email).trim().toLowerCase(),
      password: String(password),
      returnSecureToken: false
    })
  });

  if (response.ok) {
    return true;
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch (_) {
    payload = {};
  }

  const errorCode = payload?.error?.message;
  if (
    errorCode === 'INVALID_LOGIN_CREDENTIALS' ||
    errorCode === 'INVALID_PASSWORD' ||
    errorCode === 'EMAIL_NOT_FOUND' ||
    errorCode === 'USER_DISABLED'
  ) {
    return false;
  }

  throw new Error(
    `Firebase credential verification failed (${errorCode || response.status})`
  );
}

module.exports = {
  verifyFirebaseCredentials
};
