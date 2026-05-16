// Restore console for debugging
global.console = require('console');

// Mocks must be at the top
jest.unmock('mongoose');
jest.unmock('mongodb');

// Mock firebase-admin BEFORE anything else
jest.mock('../../firebase-admin-config', () => {
  const mockAuth = {
    getUserByEmail: jest.fn().mockImplementation((email) => {
      if (email.includes('duplicate')) {
        return Promise.resolve({ uid: 'existing-uid', email });
      }
      return Promise.reject({ code: 'auth/user-not-found' });
    }),
    createUser: jest.fn().mockImplementation((userData) => {
      if (userData.email.includes('duplicate')) {
        return Promise.reject({ code: 'auth/email-already-exists' });
      }
      return Promise.resolve({
        uid: `test-firebase-uid-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        email: userData.email
      });
    }),
    deleteUser: jest.fn().mockResolvedValue(),
    verifyIdToken: jest.fn().mockImplementation((token) => {
      // Reject real JWT tokens (which start with 'ey') so the auth middleware falls back to custom JWT validation
      if (token && token.startsWith('ey')) {
        return Promise.reject({ code: 'auth/argument-error', message: 'Not a Firebase token' });
      }
      return Promise.resolve({
        uid: 'test-firebase-uid',
        email: 'test@example.com'
      });
    }),
    createCustomToken: jest.fn().mockResolvedValue('test-custom-token'),
    setCustomUserClaims: jest.fn().mockResolvedValue({})
  };

  const mockAdmin = {
    auth: jest.fn().mockReturnValue(mockAuth),
    initializeApp: jest.fn(),
    credential: {
      cert: jest.fn()
    },
    apps: []
  };

  const mockMessaging = {
    send: jest.fn().mockResolvedValue('msg-id'),
    sendEachForMulticast: jest.fn().mockResolvedValue({ successCount: 1, failureCount: 0, responses: [] })
  };

  return {
    admin: mockAdmin,
    messaging: mockMessaging
  };
});

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../app');
const User = require('../../models/User');
const Organization = require('../../models/Organization');
const UserOrganization = require('../../models/UserOrganization');
const Client = require('../../models/Client');
const ClientAssignment = require('../../models/ClientAssignment');

describe('Multi-Tenant Workflow Integration Tests', () => {
  let authToken;
  let userId;
  let organizationId;
  let organizationCode;
  let clientId;
  
  const testEmail = `test-${Date.now()}@example.com`;
  const testPassword = 'TestPassword123!';
  const testConfirmPassword = testPassword;

  // Mock email service
  jest.mock('../../services/emailService', () => ({
    sendEmail: jest.fn().mockResolvedValue({ success: true }),
    addSubscriber: jest.fn().mockResolvedValue({ success: true }),
    getReceiptTemplate: jest.fn().mockReturnValue('<html><body>Mock Template</body></html>')
  }));

  beforeAll(async () => {
    // Connect to test database
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI_TEST || process.env.MONGODB_URI);
    }
    // Clear relevant collections
    await User.deleteMany({});
    await Organization.deleteMany({});
    await UserOrganization.deleteMany({});
    await Client.deleteMany({});
    await ClientAssignment.deleteMany({});
    await mongoose.connection.collection('login').deleteMany({});
  });

  afterAll(async () => {
    // Cleanup test data
    await User.deleteMany({ email: testEmail });
    if (organizationId) {
      await Organization.deleteMany({ _id: organizationId });
      await UserOrganization.deleteMany({ organizationId });
      await Client.deleteMany({ organizationId });
      await ClientAssignment.deleteMany({ organizationId });
    }
    await mongoose.connection.close();
  });

  describe('Phase 1: Organization Creation', () => {
    it('should create a new organization and auto-create UserOrganization', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: testEmail,
          password: testPassword,
          firstName: 'Test',
          lastName: 'Admin',
          role: 'admin',
          organizationName: 'Test Organization',
          confirmPassword: testConfirmPassword
        });

      expect(response.status).toBe(201);
      expect(response.body.data).toHaveProperty('userId');
      expect(response.body.data).toHaveProperty('organizationId');
      
      userId = response.body.data.userId;
      // If we provided organizationName, the organizationId should be returned
      organizationId = response.body.data.organizationId;
      organizationCode = response.body.data.organizationCode;
      
      // Fallback for organizationId if it's in the organization object
      if (!organizationId && response.body.data.organization) {
        organizationId = response.body.data.organization.id;
        organizationCode = response.body.data.organization.code;
      }
      console.log('DEBUG Phase 1 variables:', { userId, organizationId, data: response.body.data });

      // Verify UserOrganization was created
      const userOrg = await UserOrganization.findOne({
        userId,
        organizationId
      });

      expect(userOrg).toBeTruthy();
      expect(userOrg).toBeTruthy();
      expect(userOrg.role).toBe('owner'); // Backend auto-assigns 'owner' to the creator of an organization
      expect(userOrg.isActive).toBe(true);
    });
  });

  describe('Phase 2: User Authentication', () => {
    it('should login and receive organization context', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: testPassword
        });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('token');
      // The login response now returns organizationId inside user profile
      expect(response.body.data.user).toHaveProperty('organizationId');
      expect(response.body.data.user.organizationId).toBe(organizationId);

      authToken = response.body.data.token;
    });
  });

  describe('Phase 3: Organization Setup', () => {
    it('should complete organization setup', async () => {
      const response = await request(app)
        .put(`/api/organization/${organizationId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          organizationName: 'Test Business',
          address: {
            street: '123 Test St',
            city: 'Testville',
            state: 'NSW',
            postcode: '2000'
          }
        });

      if (response.status !== 200) {
        console.log('DEBUG Phase 3 Error:', response.body);
      }

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('Phase 4: Employee Creation', () => {
    it('should create employee with auto UserOrganization', async () => {
      const employeeEmail = `employee-${Date.now()}@example.com`;
      
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: employeeEmail,
          password: testPassword,
          firstName: 'Employee',
          lastName: 'User',
          role: 'user',
          organizationCode: organizationCode,
          confirmPassword: testConfirmPassword
        });

      if (response.status !== 201 && response.status !== 200) {
        console.log('DEBUG Phase 4 Error:', response.body);
      }

      expect(response.status).toBe(201);
      expect(response.body.data.organizationId).toBe(organizationId);
      
      // Verify UserOrganization was auto-created
      const userOrg = await UserOrganization.findOne({
        userId: response.body.data.userId,
        organizationId: organizationId
      });

      expect(userOrg).toBeTruthy();
      expect(userOrg.isActive).toBe(true);
    });
  });

  describe('Phase 5: Client Creation with Validation', () => {
    const testClientEmail = `client-${Date.now()}@example.com`;

    it('should create client with organization validation', async () => {
      const response = await request(app)
        .post('/api/addClient')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-organization-id', organizationId)
        .send({
          clientFirstName: 'Test',
          clientLastName: 'Client',
          clientEmail: testClientEmail,
          organizationId: organizationId,
          userEmail: testEmail,
          clientPhone: '+1234567890',
          clientAddress: '123 Main St',
          clientCity: 'Testville',
          clientState: 'TS',
          clientZip: '12345'
        });

      if (response.status !== 201 && response.status !== 200) {
        console.log('DEBUG Phase 5 (1) Error:', response.body);
      }

      expect([200, 201]).toContain(response.status);
      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('clientId');
      clientId = response.body.clientId;
    });

    it('should prevent duplicate client email within organization', async () => {
      const response = await request(app)
        .post('/api/addClient')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-organization-id', organizationId)
        .send({
          clientFirstName: 'Duplicate',
          clientLastName: 'Client',
          clientEmail: testClientEmail,
          organizationId: organizationId,
          userEmail: testEmail,
          clientPhone: '+1234567890',
          clientAddress: '123 Main St',
          clientCity: 'Testville',
          clientState: 'TS',
          clientZip: '12345'
        });

      if (response.status !== 409) {
        console.log('DEBUG Phase 5 (2) Error:', response.body);
      }

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('already exists');
    });

    it('should require organization ID for client creation', async () => {
      const response = await request(app)
        .post('/api/addClient')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          clientFirstName: 'NoOrg',
          clientLastName: 'Client',
          clientEmail: `noorg-${Date.now()}@example.com`,
          userEmail: testEmail
        });

      if (response.status !== 400) {
        console.log('DEBUG Phase 5 (3) Error:', response.body);
      }

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Organization ID is required');
    });
  });

  describe('Phase 6: Multi-Org Isolation', () => {
    let otherOrgId;
    let otherAuthToken;

    beforeAll(async () => {
      // Create a second organization and user for isolation testing
      const otherEmail = `other-${Date.now()}@example.com`;
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: otherEmail,
          password: testPassword,
          firstName: 'Other',
          lastName: 'Admin',
          role: 'admin',
          organizationName: 'Other Organization',
          confirmPassword: testConfirmPassword
        });

      // Login to get the token, since register may not return it
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: otherEmail,
          password: testPassword
        });

      otherOrgId = loginResponse.body.data.organizationId || response.body.data.organizationId;
      otherAuthToken = loginResponse.body.data.token || response.body.data.token;
    });

    it('should isolate data between organizations', async () => {
      // Try to fetch clients for the first org using the second org's token
      const response = await request(app)
        .get(`/api/clients/${organizationId}`)
        .set('Authorization', `Bearer ${otherAuthToken}`)
        .set('x-organization-id', otherOrgId);

      expect(response.status).toBe(403);
    });

    it('should prevent cross-organization access', async () => {
      // Try to update the first org using the second org's token
      const response = await request(app)
        .put(`/api/organization/${organizationId}`)
        .set('Authorization', `Bearer ${otherAuthToken}`)
        .set('x-organization-id', organizationId); // Wrong org context

      expect(response.status).toBe(403);
    });

    afterAll(async () => {
      // Cleanup second org data
      if (otherOrgId) {
        await Organization.findByIdAndDelete(otherOrgId);
        await UserOrganization.deleteMany({ organizationId: otherOrgId });
      }
    });
  });

  describe('Phase 7: Assignment Creation', () => {
    it('should create client assignment with organization context', async () => {
      const employeeEmail = `employee-assign-${Date.now()}@example.com`;
      
      // Create employee first
      await request(app)
        .post('/api/auth/register')
        .send({
          email: employeeEmail,
          password: testPassword,
          firstName: 'Assignment',
          lastName: 'Employee',
          role: 'user',
          organizationCode: organizationCode,
          confirmPassword: testConfirmPassword
        });

      const uniqueTimestamp = Date.now();
      const assignmentClientEmail = `assign-client-${uniqueTimestamp}@example.com`;

      // Create client for assignment
      const clientResponse = await request(app)
        .post('/api/addClient')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-organization-id', organizationId)
        .send({
          clientFirstName: 'Assignment',
          clientLastName: 'Client',
          clientEmail: assignmentClientEmail,
          organizationId: organizationId,
          userEmail: testEmail,
          clientPhone: '+1234567890',
          clientAddress: '123 Main St',
          clientCity: 'Testville',
          clientState: 'TS',
          clientZip: '12345'
        });

      const assignClientEmail = clientResponse.body.clientId ? 
        assignmentClientEmail : 'failed@example.com';

      // Create assignment
      const response = await request(app)
        .post('/api/assignments')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-organization-id', organizationId)
        .send({
          userEmail: employeeEmail,
          clientEmail: assignClientEmail,
          organizationId: organizationId,
          dateList: ['2026-05-16'],
          startTimeList: ['09:00'],
          endTimeList: ['17:00'],
          breakList: [30],
          highIntensityList: [false]
        });

      if (response.status !== 200 && response.status !== 201) {
        console.log('DEBUG Phase 7 Error:', response.body);
      }

      expect([200, 201]).toContain(response.status);
      expect(response.body.success).toBe(true);
    });
  });
});
