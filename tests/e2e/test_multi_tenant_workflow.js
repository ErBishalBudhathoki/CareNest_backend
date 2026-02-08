#!/usr/bin/env node

/**
 * End-to-End Test Script for Multi-Tenant Workflow
 * 
 * This script tests the complete workflow from organization creation
 * to client assignment in a production-like environment.
 * 
 * Usage: node backend/tests/e2e/test_multi_tenant_workflow.js
 */

const axios = require('axios');
const assert = require('assert');

// Configuration
const BASE_URL = process.env.BACKEND_URL || 'http://localhost:8080/api';
const VERBOSE = process.env.VERBOSE === 'true';

// Test data
const timestamp = Date.now();
const testData = {
  admin: {
    email: `e2e-admin-${timestamp}@test.com`,
    password: 'E2ETestPass123!',
    firstName: 'E2E',
    lastName: 'Admin'
  },
  employee: {
    email: `e2e-employee-${timestamp}@test.com`,
    password: 'E2ETestPass123!',
    firstName: 'E2E',
    lastName: 'Employee'
  },
  client: {
    firstName: 'E2E',
    lastName: 'Client',
    email: `e2e-client-${timestamp}@test.com`,
    phone: '+61400000000',
    address: '123 E2E Test St',
    city: 'Melbourne',
    state: 'VIC',
    zip: '3000'
  },
  organization: {
    name: `E2E Test Org ${timestamp}`
  }
};

// Results tracking
const results = {
  passed: 0,
  failed: 0,
  tests: []
};

// Utilities
function log(message, data = null) {
  if (VERBOSE || !data) {
    console.log(message);
    if (data) console.log(JSON.stringify(data, null, 2));
  }
}

function logError(message, error) {
  console.error(`❌ ${message}`);
  if (error.response) {
    console.error('Status:', error.response.status);
    console.error('Data:', error.response.data);
  } else {
    console.error(error.message);
  }
}

function assert_test(condition, message) {
  if (condition) {
    results.passed++;
    results.tests.push({ name: message, status: 'PASS' });
    console.log(`✅ ${message}`);
  } else {
    results.failed++;
    results.tests.push({ name: message, status: 'FAIL' });
    console.error(`❌ ${message}`);
    throw new Error(`Test failed: ${message}`);
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Test Steps
async function testOrganizationCreation() {
  console.log('\n📋 Phase 1: Testing Organization Creation...\n');
  
  try {
    const response = await axios.post(`${BASE_URL}/auth/register`, {
      email: testData.admin.email,
      password: testData.admin.password,
      confirmPassword: testData.admin.password,
      firstName: testData.admin.firstName,
      lastName: testData.admin.lastName,
      role: 'admin',
      organizationName: testData.organization.name
    });

    assert_test(response.status === 201 || response.status === 200, 
      'Admin registration should succeed');
    assert_test(response.data.userId, 'Should return userId');
    assert_test(response.data.organizationId, 'Should return organizationId');
    assert_test(response.data.organizationCode, 'Should return organizationCode');

    // Store for later use
    testData.userId = response.data.userId;
    testData.organizationId = response.data.organizationId;
    testData.organizationCode = response.data.organizationCode;

    log('Organization created:', {
      organizationId: testData.organizationId,
      organizationCode: testData.organizationCode
    });

    return true;
  } catch (error) {
    logError('Organization creation failed', error);
    return false;
  }
}

async function testAdminLogin() {
  console.log('\n📋 Phase 2: Testing Admin Login...\n');
  
  try {
    const response = await axios.post(`${BASE_URL}/auth/login`, {
      email: testData.admin.email,
      password: testData.admin.password
    });

    assert_test(response.status === 200, 'Login should succeed');
    assert_test(response.data.token, 'Should return auth token');
    assert_test(response.data.organization, 'Should return organization context');
    assert_test(response.data.organization.id === testData.organizationId, 
      'Organization ID should match');

    testData.authToken = response.data.token;
    
    log('Login successful, token received');
    return true;
  } catch (error) {
    logError('Admin login failed', error);
    return false;
  }
}

async function testOrganizationSetup() {
  console.log('\n📋 Phase 3: Testing Organization Setup...\n');
  
  try {
    const response = await axios.post(
      `${BASE_URL}/organization/${testData.organizationId}/complete-setup`,
      {
        logoUrl: 'https://example.com/logo.png',
        abn: '12345678901',
        address: {
          street: '123 Test St',
          city: 'Melbourne',
          state: 'VIC',
          postcode: '3000',
          country: 'Australia'
        },
        contactDetails: {
          phone: '+61400000000',
          email: 'contact@e2etest.com'
        },
        ndisRegistration: {
          isRegistered: true,
          registrationNumber: 'E2ETEST123'
        },
        timesheetReminders: {
          enabled: true,
          reminderTime: '18:00',
          reminderDays: [1, 2, 3, 4, 5]
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${testData.authToken}`,
          'x-organization-id': testData.organizationId
        }
      }
    );

    assert_test(response.status === 200, 'Organization setup should succeed');
    assert_test(response.data.success, 'Should return success status');

    log('Organization setup completed');
    return true;
  } catch (error) {
    logError('Organization setup failed', error);
    return false;
  }
}

async function testEmployeeCreation() {
  console.log('\n📋 Phase 4: Testing Employee Creation with Auto UserOrganization...\n');
  
  try {
    const response = await axios.post(`${BASE_URL}/auth/register`, {
      email: testData.employee.email,
      password: testData.employee.password,
      confirmPassword: testData.employee.password,
      firstName: testData.employee.firstName,
      lastName: testData.employee.lastName,
      role: 'user',
      organizationCode: testData.organizationCode
    });

    assert_test(response.status === 201 || response.status === 200, 
      'Employee registration should succeed');
    assert_test(response.data.organizationId === testData.organizationId, 
      'Employee should be in same organization');

    testData.employeeId = response.data.userId;
    
    log('Employee created:', { employeeId: testData.employeeId });
    return true;
  } catch (error) {
    logError('Employee creation failed', error);
    return false;
  }
}

async function testClientCreationWithValidation() {
  console.log('\n📋 Phase 5: Testing Client Creation with Validation...\n');
  
  try {
    // Test 1: Create client with proper validation
    const response = await axios.post(
      `${BASE_URL}/clients`,
      {
        clientFirstName: testData.client.firstName,
        clientLastName: testData.client.lastName,
        clientEmail: testData.client.email,
        clientPhone: testData.client.phone,
        clientAddress: testData.client.address,
        clientCity: testData.client.city,
        clientState: testData.client.state,
        clientZip: testData.client.zip,
        organizationId: testData.organizationId,
        userEmail: testData.admin.email
      },
      {
        headers: {
          'Authorization': `Bearer ${testData.authToken}`,
          'x-organization-id': testData.organizationId
        }
      }
    );

    assert_test(response.status === 201 || response.status === 200, 
      'Client creation should succeed');
    assert_test(response.data.clientId, 'Should return clientId');

    testData.clientId = response.data.clientId;
    
    log('Client created:', { clientId: testData.clientId });

    // Test 2: Attempt to create duplicate client (should fail)
    try {
      await axios.post(
        `${BASE_URL}/clients`,
        {
          clientFirstName: 'Duplicate',
          clientLastName: 'Client',
          clientEmail: testData.client.email, // Same email
          organizationId: testData.organizationId,
          userEmail: testData.admin.email
        },
        {
          headers: {
            'Authorization': `Bearer ${testData.authToken}`,
            'x-organization-id': testData.organizationId
          }
        }
      );
      
      assert_test(false, 'Duplicate client creation should fail');
    } catch (error) {
      assert_test(error.response.status === 400, 
        'Duplicate client should return 400 error');
      log('Duplicate client validation working correctly');
    }

    // Test 3: Attempt to create client without organizationId (should fail)
    try {
      await axios.post(
        `${BASE_URL}/clients`,
        {
          clientFirstName: 'No',
          clientLastName: 'Org',
          clientEmail: `no-org-${timestamp}@test.com`,
          userEmail: testData.admin.email
          // Missing organizationId
        },
        {
          headers: {
            'Authorization': `Bearer ${testData.authToken}`
          }
        }
      );
      
      assert_test(false, 'Client creation without org should fail');
    } catch (error) {
      assert_test(error.response.status === 400, 
        'Missing organization should return 400 error');
      log('Organization requirement validation working correctly');
    }

    return true;
  } catch (error) {
    logError('Client creation tests failed', error);
    return false;
  }
}

async function testMultiOrgIsolation() {
  console.log('\n📋 Phase 6: Testing Multi-Org Isolation...\n');
  
  try {
    // Create second organization
    const org2Response = await axios.post(`${BASE_URL}/auth/register`, {
      email: `e2e-org2-${timestamp}@test.com`,
      password: 'E2ETestPass123!',
      confirmPassword: 'E2ETestPass123!',
      firstName: 'Org2',
      lastName: 'Admin',
      role: 'admin',
      organizationName: `E2E Test Org 2 ${timestamp}`
    });

    const org2Id = org2Response.data.organizationId;
    
    // Login to org2
    const org2LoginResponse = await axios.post(`${BASE_URL}/auth/login`, {
      email: `e2e-org2-${timestamp}@test.com`,
      password: 'E2ETestPass123!'
    });

    const org2Token = org2LoginResponse.data.token;

    // Try to access org1's clients from org2 (should see none)
    const clientsResponse = await axios.get(`${BASE_URL}/clients`, {
      headers: {
        'Authorization': `Bearer ${org2Token}`,
        'x-organization-id': org2Id
      },
      params: {
        organizationId: org2Id
      }
    });

    const org1ClientFound = clientsResponse.data.clients?.some(c => 
      c._id === testData.clientId || c.clientEmail === testData.client.email
    );
    
    assert_test(!org1ClientFound, 
      'Org2 should not see Org1 clients');

    // Try to access org1's client directly using org2's token (should fail)
    try {
      await axios.get(`${BASE_URL}/clients/${testData.clientId}`, {
        headers: {
          'Authorization': `Bearer ${org2Token}`,
          'x-organization-id': org2Id
        }
      });
      
      assert_test(false, 'Cross-org access should be denied');
    } catch (error) {
      assert_test(error.response.status === 403 || error.response.status === 404, 
        'Cross-org access should return 403/404');
      log('Cross-organization isolation working correctly');
    }

    log('Multi-org isolation verified');
    return true;
  } catch (error) {
    logError('Multi-org isolation test failed', error);
    return false;
  }
}

async function testAssignmentController() {
  console.log('\n📋 Phase 7: Testing Assignment Controller...\n');
  
  try {
    const response = await axios.post(
      `${BASE_URL}/assignments`,
      {
        userEmail: testData.employee.email,
        clientEmail: testData.client.email,
        organizationId: testData.organizationId,
        dateList: ['2024-12-01'],
        startTimeList: ['09:00'],
        endTimeList: ['17:00'],
        breakList: [30],
        highIntensityList: [false],
        notes: 'E2E test assignment'
      },
      {
        headers: {
          'Authorization': `Bearer ${testData.authToken}`,
          'x-organization-id': testData.organizationId
        }
      }
    );

    assert_test(response.status === 200 || response.status === 201, 
      'Assignment creation should succeed');
    assert_test(response.data.success, 'Should return success status');

    log('Assignment created successfully');
    return true;
  } catch (error) {
    logError('Assignment creation failed', error);
    return false;
  }
}

// Main test execution
async function runTests() {
  console.log('\n🚀 Starting Multi-Tenant E2E Tests\n');
  console.log(`Testing against: ${BASE_URL}\n`);
  console.log('='.repeat(60));

  const tests = [
    testOrganizationCreation,
    testAdminLogin,
    testOrganizationSetup,
    testEmployeeCreation,
    testClientCreationWithValidation,
    testMultiOrgIsolation,
    testAssignmentController
  ];

  for (const test of tests) {
    try {
      const success = await test();
      if (!success) {
        console.error('\n❌ Test suite failed early\n');
        break;
      }
      await sleep(500); // Brief pause between tests
    } catch (error) {
      console.error('\n❌ Test error:', error.message);
      break;
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('\n📊 Test Summary:\n');
  console.log(`Total Tests: ${results.passed + results.failed}`);
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`Success Rate: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);
  
  console.log('\n📋 Test Details:\n');
  results.tests.forEach(test => {
    const icon = test.status === 'PASS' ? '✅' : '❌';
    console.log(`${icon} ${test.name}`);
  });

  console.log('\n' + '='.repeat(60) + '\n');

  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
}

// Run tests if executed directly
if (require.main === module) {
  runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { runTests };
