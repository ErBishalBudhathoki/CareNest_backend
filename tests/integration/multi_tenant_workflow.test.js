/**
 * Multi-Tenant Workflow Integration Tests
 * Tests the complete workflow from organization creation to client assignment
 */

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

  beforeAll(async () => {
    // Connect to test database
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI_TEST || process.env.MONGODB_URI);
    }
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
          organizationName: 'Test Organization'
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('userId');
      expect(response.body).toHaveProperty('organizationId');
      expect(response.body).toHaveProperty('organizationCode');

      userId = response.body.userId;
      organizationId = response.body.organizationId;
      organizationCode = response.body.organizationCode;

      // Verify UserOrganization was created
      const userOrg = await UserOrganization.findOne({
        userId,
        organizationId
      });

      expect(userOrg).toBeTruthy();
      expect(userOrg.role).toBe('admin');
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
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('organization');
      expect(response.body.organization.id).toBe(organizationId);

      authToken = response.body.token;
    });
  });

  describe('Phase 3: Organization Setup', () => {
    it('should complete organization setup', async () => {
      const response = await request(app)
        .post(`/api/organization/${organizationId}/complete-setup`)
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-organization-id', organizationId)
        .send({
          logoUrl: 'https://example.com/logo.png',
          abn: '12345678901',
          address: {
            street: '123 Test St',
            city: 'Test City',
            state: 'TS',
            postcode: '1234',
            country: 'Australia'
          },
          contactDetails: {
            phone: '+61400000000',
            email: 'contact@test.com'
          },
          ndisRegistration: {
            isRegistered: true,
            registrationNumber: 'TEST123'
          }
        });

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
          firstName: 'Test',
          lastName: 'Employee',
          role: 'user',
          organizationCode: organizationCode
        });

      expect(response.status).toBe(201);
      expect(response.body.organizationId).toBe(organizationId);

      // Verify UserOrganization was auto-created
      const userOrg = await UserOrganization.findOne({
        userId: response.body.userId,
        organizationId
      });

      expect(userOrg).toBeTruthy();
      expect(userOrg.role).toBe('user');
    });
  });

  describe('Phase 5: Client Creation with Validation', () => {
    it('should create client with organization validation', async () => {
      const response = await request(app)
        .post('/api/clients')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-organization-id', organizationId)
        .send({
          clientFirstName: 'Test',
          clientLastName: 'Client',
          clientEmail: `client-${Date.now()}@example.com`,
          clientPhone: '+61400000001',
          clientAddress: '123 Client St',
          clientCity: 'Test City',
          clientState: 'TS',
          clientZip: '1234',
          organizationId: organizationId,
          userEmail: testEmail
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('clientId');

      clientId = response.body.clientId;
    });

    it('should prevent duplicate client email within organization', async () => {
      const duplicateEmail = `duplicate-${Date.now()}@example.com`;
      
      // Create first client
      await request(app)
        .post('/api/clients')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-organization-id', organizationId)
        .send({
          clientFirstName: 'First',
          clientLastName: 'Client',
          clientEmail: duplicateEmail,
          organizationId: organizationId,
          userEmail: testEmail
        });

      // Attempt to create duplicate
      const response = await request(app)
        .post('/api/clients')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-organization-id', organizationId)
        .send({
          clientFirstName: 'Second',
          clientLastName: 'Client',
          clientEmail: duplicateEmail,
          organizationId: organizationId,
          userEmail: testEmail
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('already exists');
    });

    it('should require organization ID for client creation', async () => {
      const response = await request(app)
        .post('/api/clients')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          clientFirstName: 'Test',
          clientLastName: 'Client',
          clientEmail: `no-org-${Date.now()}@example.com`,
          userEmail: testEmail
          // Missing organizationId
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Organization ID is required');
    });
  });

  describe('Phase 6: Multi-Org Isolation', () => {
    let org2Id;
    let org2Token;

    it('should isolate data between organizations', async () => {
      // Create second organization
      const org2Email = `org2-admin-${Date.now()}@example.com`;
      const org2Response = await request(app)
        .post('/api/auth/register')
        .send({
          email: org2Email,
          password: testPassword,
          firstName: 'Org2',
          lastName: 'Admin',
          role: 'admin',
          organizationName: 'Second Organization'
        });

      org2Id = org2Response.body.organizationId;

      // Login to org2
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: org2Email,
          password: testPassword
        });

      org2Token = loginResponse.body.token;

      // Try to access org1's clients from org2
      const response = await request(app)
        .get('/api/clients')
        .set('Authorization', `Bearer ${org2Token}`)
        .set('x-organization-id', org2Id)
        .query({ organizationId: org2Id });

      expect(response.status).toBe(200);
      // Should not see org1's clients
      const org1Clients = response.body.clients?.filter(c => 
        c.clientId === clientId
      );
      expect(org1Clients?.length || 0).toBe(0);
    });

    it('should prevent cross-organization access', async () => {
      // Try to access org1's client using org2's token
      const response = await request(app)
        .get(`/api/clients/${clientId}`)
        .set('Authorization', `Bearer ${org2Token}`)
        .set('x-organization-id', org1Id); // Wrong org context

      expect(response.status).toBe(403);
    });

    afterAll(async () => {
      // Cleanup org2 data
      if (org2Id) {
        await Organization.deleteMany({ _id: org2Id });
        await UserOrganization.deleteMany({ organizationId: org2Id });
        await Client.deleteMany({ organizationId: org2Id });
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
          organizationCode: organizationCode
        });

      // Create client for assignment
      const clientResponse = await request(app)
        .post('/api/clients')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-organization-id', organizationId)
        .send({
          clientFirstName: 'Assignment',
          clientLastName: 'Client',
          clientEmail: `assign-client-${Date.now()}@example.com`,
          organizationId: organizationId,
          userEmail: testEmail
        });

      const assignClientEmail = clientResponse.body.clientEmail || 
        `assign-client-${Date.now()}@example.com`;

      // Create assignment
      const response = await request(app)
        .post('/api/assignments')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-organization-id', organizationId)
        .send({
          userEmail: employeeEmail,
          clientEmail: assignClientEmail,
          organizationId: organizationId,
          dateList: ['2024-12-01'],
          startTimeList: ['09:00'],
          endTimeList: ['17:00'],
          breakList: [30],
          highIntensityList: [false]
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});
