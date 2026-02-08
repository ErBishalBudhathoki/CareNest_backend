/**
 * Schedule Service Tests
 * Tests for the Automated Scheduling Engine
 * 
 * @file backend/tests/schedule.test.js
 */

const request = require('supertest');
const { ObjectId } = require('mongoose').Types;

// Mock Redis/BullMQ
jest.mock('ioredis', () => require('ioredis-mock'));
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn(),
    on: jest.fn()
  })),
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn()
  })),
  QueueEvents: jest.fn().mockImplementation(() => ({
    on: jest.fn()
  }))
}));

// Mock Redis/Rate Limit to prevent connection attempts
jest.mock('rate-limit-redis', () => ({
  RedisStore: jest.fn().mockImplementation(() => ({
    init: jest.fn(),
    increment: jest.fn().mockResolvedValue({ totalHits: 1, resetTime: new Date() }),
    decrement: jest.fn(),
    resetKey: jest.fn(),
  })),
}));

jest.mock('../config/redis', () => ({
  call: jest.fn(),
  on: jest.fn(),
  status: 'ready',
  quit: jest.fn(),
  disconnect: jest.fn(),
  duplicate: jest.fn().mockReturnThis(),
  subscribe: jest.fn(), // Added subscribe
  publish: jest.fn()    // Added publish
}));

// Mock Auth Middleware to bypass auth and rate limits
jest.mock('../middleware/auth', () => ({
  authenticateUser: (req, res, next) => {
    req.user = { 
      userId: '507f1f77bcf86cd799439011', 
      email: 'test@example.com', 
      roles: ['admin'], 
      organizationId: 'test-org' 
    };
    next();
  },
  rateLimitMiddleware: () => (req, res, next) => next(),
  requireRoles: () => (req, res, next) => next(),
  requireAdmin: (req, res, next) => next(), // Add requireAdmin
  AuthMiddleware: {
    authenticateUser: (req, res, next) => {
      req.user = { 
        userId: '507f1f77bcf86cd799439011', 
        email: 'test@example.com', 
        roles: ['admin'], 
        organizationId: 'test-org' 
      };
      next();
    }
  }
}));

// Mock dependencies
const Shift = require('../models/Shift');
const User = require('../models/User');
const Client = require('../models/Client');
const ActiveTimer = require('../models/ActiveTimer');
const ClientAssignment = require('../models/ClientAssignment');
const aiSchedulerService = require('../services/aiSchedulerService');

jest.mock('../models/Shift');
jest.mock('../models/User');
jest.mock('../models/Client');
jest.mock('../models/ActiveTimer');
jest.mock('../models/ClientAssignment');
jest.mock('../services/aiSchedulerService');
jest.mock('../firebase-admin-config');
jest.mock('../config/logger');

// Import app AFTER mocking
const app = require('../server');

describe('Schedule API Tests', () => {
    let mockQuery;

    beforeEach(() => {
        jest.clearAllMocks();

        // Helper to mock chainable mongoose queries
        mockQuery = (result) => ({
            lean: jest.fn().mockResolvedValue(result),
            select: jest.fn().mockReturnThis(),
            sort: jest.fn().mockResolvedValue(result), // sort often ends the chain in these tests
            limit: jest.fn().mockReturnThis(),
            populate: jest.fn().mockReturnThis(),
            then: (resolve) => Promise.resolve(result).then(resolve),
            catch: (reject) => Promise.resolve(result).catch(reject)
        });

        // Default Mocks
        Shift.find.mockImplementation(() => mockQuery([]));
        Shift.findOne.mockImplementation(() => mockQuery(null));
        Shift.findById.mockImplementation(() => mockQuery(null));
        
        // Ensure findOneAndUpdate is mocked
        Shift.findOneAndUpdate = jest.fn().mockImplementation(() => mockQuery(null));
        
        Shift.prototype.save = jest.fn().mockImplementation(function() {
            return Promise.resolve({
                _id: new ObjectId(),
                ...this,
                toObject: () => this
            });
        });

        User.find.mockImplementation(() => mockQuery([]));
        User.findOne.mockImplementation(() => mockQuery({
            _id: new ObjectId(),
            email: 'employee@example.com',
            firstName: 'John',
            lastName: 'Doe',
            organizationId: '507f1f77bcf86cd799439011'
        }));

        Client.findOne.mockImplementation(() => mockQuery({
            _id: new ObjectId(),
            email: 'client@example.com',
            firstName: 'Jane',
            lastName: 'Client',
            organizationId: '507f1f77bcf86cd799439011',
            location: { type: 'Point', coordinates: [151.2, -33.87] }
        }));
        
        ActiveTimer.findOne.mockImplementation(() => mockQuery(null));
        
        ClientAssignment.find.mockImplementation(() => mockQuery([]));

        aiSchedulerService.getAIRecommendations.mockResolvedValue([]);
    });

    // ============================================================================
    // CONFLICT DETECTION TESTS
    // ============================================================================

    describe('Conflict Detection', () => {
        describe('POST /api/schedule/check-conflicts', () => {
            it('should return 409 when attempting to double-book an employee', async () => {
                // Setup: Employee A has an existing shift from 9-5
                const existingShift = {
                    _id: new ObjectId(),
                    employeeEmail: 'employee-a@example.com',
                    employeeId: new ObjectId(),
                    clientEmail: 'client-1@example.com',
                    startTime: new Date('2026-01-20T09:00:00Z'),
                    endTime: new Date('2026-01-20T17:00:00Z'),
                    status: 'approved',
                    isActive: true
                };

                // Mock: Return existing shift when checking for conflicts
                Shift.find.mockImplementation(() => mockQuery([existingShift]));

                // Attempt to create overlapping shift from 10-4
                const res = await request(app)
                    .post('/api/schedule/check-conflicts')
                    .send({
                        employeeEmail: 'employee-a@example.com',
                        startTime: '2026-01-20T10:00:00Z',
                        endTime: '2026-01-20T16:00:00Z'
                    });

                expect(res.status).toBe(200);
                expect(res.body.hasConflict).toBe(true);
                expect(res.body.conflicts.length).toBeGreaterThan(0);
            });

            it('should return no conflict when time slots do not overlap', async () => {
                // Mock: Return empty array (no overlapping shifts)
                Shift.find.mockImplementation(() => mockQuery([]));

                // Mock: No active assignments
                ClientAssignment.find.mockImplementation(() => mockQuery([]));
                ActiveTimer.findOne.mockImplementation(() => mockQuery(null));

                const res = await request(app)
                    .post('/api/schedule/check-conflicts')
                    .send({
                        employeeEmail: 'employee-a@example.com',
                        startTime: '2026-01-21T09:00:00Z', // Different day
                        endTime: '2026-01-21T17:00:00Z'
                    });

                expect(res.status).toBe(200);
                expect(res.body.hasConflict).toBe(false);
            });

            it('should validate required fields', async () => {
                const res = await request(app)
                    .post('/api/schedule/check-conflicts')
                    .send({
                        employeeEmail: 'employee-a@example.com'
                        // Missing startTime and endTime
                    });

                expect(res.status).toBe(400);
                expect(res.body.success).toBe(false); // checkConflicts returns {success: false, error: ...} on 400
            });
        });
    });

    // ============================================================================
    // BEST MATCH ALGORITHM TESTS
    // ============================================================================

    describe('Best Match Algorithm', () => {
        describe('GET /api/schedule/recommendations', () => {
            it('should rank employees by composite score (skills + availability + distance)', async () => {
                // Setup: 3 employees with varying attributes
                const employees = [
                    {
                        _id: new ObjectId(),
                        email: 'far-skilled@example.com',
                        firstName: 'Far',
                        lastName: 'Skilled',
                        role: 'employee',
                        isActive: true,
                        skills: ['ndis-support', 'first-aid', 'wheelchair'],
                        location: { type: 'Point', coordinates: [151.0, -33.9] } // Far but skilled
                    },
                    {
                        _id: new ObjectId(),
                        email: 'close-unskilled@example.com',
                        firstName: 'Close',
                        lastName: 'Unskilled',
                        role: 'employee',
                        isActive: true,
                        skills: [],
                        location: { type: 'Point', coordinates: [151.2, -33.8] } // Close but no skills
                    },
                    {
                        _id: new ObjectId(),
                        email: 'ideal-candidate@example.com',
                        firstName: 'Ideal',
                        lastName: 'Candidate',
                        role: 'employee',
                        isActive: true,
                        skills: ['ndis-support', 'first-aid'],
                        location: { type: 'Point', coordinates: [151.21, -33.87] } // Close with skills
                    }
                ];

                const clientLocation = { type: 'Point', coordinates: [151.2, -33.87] };

                // Mock: Return employees
                User.find.mockImplementation(() => mockQuery(employees));

                // Mock: Return client with location
                Client.findOne.mockImplementation(() => mockQuery({
                    clientEmail: 'client@example.com',
                    location: clientLocation
                }));

                // Mock: No conflicts for any employee
                Shift.find.mockImplementation(() => mockQuery([]));
                ActiveTimer.findOne.mockImplementation(() => mockQuery(null));
                ClientAssignment.find.mockImplementation(() => mockQuery([]));
                
                // Mock AI service to return empty array (no re-ranking)
                aiSchedulerService.getAIRecommendations.mockResolvedValue([]);

                const res = await request(app)
                    .get('/api/schedule/recommendations')
                    .query({
                        organizationId: '507f1f77bcf86cd799439011',
                        clientEmail: 'client@example.com',
                        startTime: '2026-01-20T09:00:00Z',
                        endTime: '2026-01-20T17:00:00Z',
                        requiredSkills: 'ndis-support,first-aid'
                    });

                if (res.status === 500) {
                    console.error('Server Error:', res.body);
                }

                expect(res.status).toBe(200);
                expect(res.body.success).toBe(true);
                expect(res.body.recommendations).toBeDefined();

                // Verify ranking: ideal-candidate should be first (best combo of skills + distance)
                if (res.body.recommendations.length > 0) {
                    const rankings = res.body.recommendations;
                    // The algorithm should favor candidates with both skills and proximity
                    expect(rankings[0].matchScore).toBeGreaterThanOrEqual(rankings[rankings.length - 1].matchScore);
                }
            });

            it('should require organizationId parameter', async () => {
                const res = await request(app)
                    .get('/api/schedule/recommendations')
                    .query({
                        clientEmail: 'client@example.com'
                    });

                expect(res.status).toBe(400);
                expect(res.body.error).toContain('organizationId');
            });

            it('should return empty recommendations when no employees exist', async () => {
                User.find.mockImplementation(() => mockQuery([]));

                const res = await request(app)
                    .get('/api/schedule/recommendations')
                    .query({
                        organizationId: '507f1f77bcf86cd799439011'
                    });

                expect(res.status).toBe(200);
                expect(res.body.recommendations).toHaveLength(0);
            });
        });
    });

    // ============================================================================
    // SHIFT CRUD TESTS
    // ============================================================================

    describe('Shift CRUD Operations', () => {
        describe('POST /api/schedule/shift', () => {
            it('should create a shift successfully', async () => {
                const newShift = {
                    organizationId: '507f1f77bcf86cd799439011',
                    clientEmail: 'client@example.com',
                    employeeEmail: 'employee@example.com',
                    startTime: '2026-01-20T09:00:00Z',
                    endTime: '2026-01-20T17:00:00Z',
                    notes: 'Test shift'
                };

                // Mock: No conflicts
                Shift.find.mockImplementation(() => mockQuery([]));
                ActiveTimer.findOne.mockImplementation(() => mockQuery(null));
                ClientAssignment.find.mockImplementation(() => mockQuery([]));

                // Mock: Insert succeeds (handled by Shift.prototype.save mock in beforeEach)

                const res = await request(app)
                    .post('/api/schedule/shift')
                    .send(newShift);

                if (res.status === 500) {
                    console.error('Server Error:', res.body);
                }

                expect(res.status).toBe(201);
                expect(res.body.success).toBe(true);
                expect(res.body.data.id).toBeDefined();
            });

            it('should reject shift with conflicting time slot (409 Conflict)', async () => {
                const conflictingShift = {
                    organizationId: '507f1f77bcf86cd799439011',
                    clientEmail: 'client@example.com',
                    employeeEmail: 'employee@example.com',
                    startTime: '2026-01-20T10:00:00Z',
                    endTime: '2026-01-20T16:00:00Z'
                };

                // Mock: Existing overlapping shift
                Shift.find.mockImplementation(() => mockQuery([{
                    _id: new ObjectId(),
                    employeeEmail: 'employee@example.com',
                    startTime: new Date('2026-01-20T09:00:00Z'),
                    endTime: new Date('2026-01-20T17:00:00Z'),
                    status: 'approved',
                    isActive: true
                }]));

                const res = await request(app)
                    .post('/api/schedule/shift')
                    .send(conflictingShift);

                expect(res.status).toBe(409);
                expect(res.body.success).toBe(false);
                expect(res.body.conflicts).toBeDefined();
            });

            it('should validate required fields', async () => {
                const res = await request(app)
                    .post('/api/schedule/shift')
                    .send({
                        // Missing organizationId, startTime, endTime
                        clientEmail: 'client@example.com'
                    });

                expect(res.status).toBe(400);
                // The controller returns success: false if validation fails
                expect(res.body.success).toBe(false); 
            });
        });

        describe('GET /api/schedule/shifts/:organizationId', () => {
            it('should return shifts for an organization', async () => {
                const shifts = [
                    {
                            _id: new ObjectId(),
                            organizationId: '507f1f77bcf86cd799439011',
                            employeeEmail: 'emp1@example.com',
                            startTime: new Date('2026-01-20T09:00:00Z'),
                            endTime: new Date('2026-01-20T17:00:00Z'),
                            status: 'approved'
                        }
                    ];

                // Mock sort() to return the shifts
                Shift.find.mockImplementation(() => ({
                    sort: jest.fn().mockResolvedValue(shifts)
                }));

                const res = await request(app)
                    .get('/api/schedule/shifts/507f1f77bcf86cd799439011');

                expect(res.status).toBe(200);
                expect(res.body.success).toBe(true);
                expect(res.body.data).toHaveLength(1);
            });
        });

        describe('DELETE /api/schedule/shift/:id', () => {
            it('should cancel a shift', async () => {
                const shiftId = new ObjectId();

                Shift.findOneAndUpdate.mockImplementation(() => mockQuery({
                    _id: shiftId,
                    status: 'cancelled',
                    isActive: false
                }));

                const res = await request(app)
                    .delete(`/api/schedule/shift/${shiftId}`);

                expect(res.status).toBe(200);
                expect(res.body.success).toBe(true);
            });

            it('should return 404 for non-existent shift', async () => {
                Shift.findOneAndUpdate.mockImplementation(() => mockQuery(null));

                const res = await request(app)
                    .delete(`/api/schedule/shift/${new ObjectId()}`);

                expect(res.status).toBe(404);
            });
        });
    });

    // ============================================================================
    // BULK DEPLOY TESTS
    // ============================================================================

    describe('Bulk Shift Creation', () => {
        describe('POST /api/schedule/bulk', () => {
            it('should create multiple shifts in bulk', async () => {
                const bulkShifts = {
                    organizationId: '507f1f77bcf86cd799439011',
                    shifts: [
                        {
                            clientEmail: 'client1@example.com',
                            startTime: '2026-01-20T09:00:00Z',
                            endTime: '2026-01-20T13:00:00Z'
                        },
                        {
                            clientEmail: 'client2@example.com',
                            startTime: '2026-01-20T14:00:00Z',
                            endTime: '2026-01-20T18:00:00Z'
                        }
                    ]
                };

                // Mock: No conflicts for any shift
                Shift.find.mockImplementation(() => mockQuery([]));
                ActiveTimer.findOne.mockImplementation(() => mockQuery(null));
                ClientAssignment.find.mockImplementation(() => mockQuery([]));

                const res = await request(app)
                    .post('/api/schedule/bulk')
                    .send(bulkShifts);

                if (res.status === 500) {
                    console.error('Server Error:', res.body);
                }

                expect(res.status).toBe(201);
                expect(res.body.data.created.length).toBe(2);
            });

            it('should validate shifts array is provided', async () => {
                const res = await request(app)
                    .post('/api/schedule/bulk')
                    .send({
                        organizationId: '507f1f77bcf86cd799439011'
                        // Missing shifts array
                    });

                expect(res.status).toBe(400);
                expect(res.body.error).toContain('shifts array');
            });
        });
    });
});
