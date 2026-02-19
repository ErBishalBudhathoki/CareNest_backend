const axios = require('axios');
const https = require('https');

const BASE_URL = process.env.BACKEND_URL || 'http://localhost:8080';

// Ignore self-signed certs if testing HTTPS locally
const agent = new https.Agent({  
  rejectUnauthorized: false
});

const client = axios.create({
  baseURL: BASE_URL,
  validateStatus: () => true, // Don't throw on error status
  httpsAgent: agent
});

async function runVerification() {
  console.log('Starting System Verification...');
  console.log(`Target: ${BASE_URL}`);

  let results = {
    cors: false,
    securityHeaders: false,
    inputValidation: false,
    authProtection: false,
    https: false
  };

  try {
    // 1. Check Health & Protocol
    console.log('\n1. Checking Health & Protocol...');
    const healthRes = await client.get('/health');
    console.log(`Health Check: ${healthRes.status}`);
    if (healthRes.status === 200) {
        console.log('Health check passed.');
    }
    
    if (BASE_URL.startsWith('https')) {
        results.https = true;
        console.log('HTTPS is enabled.');
    } else {
        console.log('WARNING: HTTP is used (expected for local dev, but ensure HTTPS in prod).');
    }

    // 2. Check CORS
    console.log('\n2. Checking CORS Policy...');
    const corsRes = await client.options('/health', {
      headers: {
        'Origin': 'http://evil-site.com',
        'Access-Control-Request-Method': 'GET'
      }
    });
    console.log(`CORS Status: ${corsRes.status}`);
    console.log(`Access-Control-Allow-Origin: ${corsRes.headers['access-control-allow-origin']}`);
    
    if (corsRes.headers['access-control-allow-origin'] === '*' || corsRes.headers['access-control-allow-origin'] === 'http://evil-site.com') {
      console.log('FAIL: CORS allows arbitrary origin.');
      results.cors = false;
    } else {
      console.log('PASS: CORS is restricted.');
      results.cors = true;
    }

    // 3. Check Security Headers (Helmet)
    console.log('\n3. Checking Security Headers...');
    const headers = healthRes.headers;
    if (headers['x-dns-prefetch-control'] && headers['x-frame-options']) {
       console.log('PASS: Security headers present.');
       results.securityHeaders = true;
    } else {
       console.log('FAIL: Missing some security headers.');
    }

    // 4. Check Input Validation (Auth)
    console.log('\n4. Checking Input Validation (Signup)...');
    const weakPasswordRes = await client.post('/api/auth/signup', {
      email: 'invalid-email',
      password: '123',
      firstName: 'Test',
      lastName: 'User',
      organizationCode: 'TESTORG'
    });
    console.log(`Signup Response: ${weakPasswordRes.status} - ${JSON.stringify(weakPasswordRes.data)}`);

    // We expect 400 Bad Request with validation error
    if (weakPasswordRes.status === 400 && (weakPasswordRes.data.error || weakPasswordRes.data.message)) {
      console.log('PASS: Input validation rejected invalid data.');
      results.inputValidation = true;
    } else {
      console.log('FAIL: Input validation failed to reject invalid data or returned unexpected status.');
    }

    // 5. Check Auth Protection
    console.log('\n5. Checking Auth Protection...');
    const protectedRes = await client.get('/api/users/profile'); // Assuming this exists and is protected
    console.log(`Protected Endpoint Status: ${protectedRes.status}`);
    
    if (protectedRes.status === 401 || protectedRes.status === 403) {
      console.log('PASS: Protected endpoint rejected unauthenticated request.');
      results.authProtection = true;
    } else {
      console.log('FAIL: Protected endpoint allowed access or returned unexpected status.');
    }

  } catch (error) {
    console.error('Verification failed with error:', error.message);
  }

  console.log('\n=== Verification Summary ===');
  console.table(results);
}

runVerification();
