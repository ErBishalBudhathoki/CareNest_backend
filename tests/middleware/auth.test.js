const jwt = require('jsonwebtoken');

// Mock dependencies BEFORE requiring the middleware
const mockVerifyIdToken = jest.fn();
jest.mock('../../firebase-admin-config', () => ({
    auth: () => ({
        verifyIdToken: mockVerifyIdToken
    })
}));

const mockFindOne = jest.fn();
jest.mock('../../models/User', () => ({
    findOne: mockFindOne
}));

const mockGetValidKeys = jest.fn();
jest.mock('../../services/jwtKeyRotationService', () => ({
    getValidKeys: mockGetValidKeys
}));

jest.mock('../../utils/logger', () => ({
    createLogger: () => ({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        security: jest.fn()
    })
}));

// Import AuthMiddleware and dependencies
const { AuthMiddleware } = require('../../middleware/auth');
const admin = require('../../firebase-admin-config');
const User = require('../../models/User');
const keyRotationService = require('../../services/jwtKeyRotationService');

describe('AuthMiddleware.authenticateUser', () => {
    let req, res, next;

    beforeEach(() => {
        req = {
            headers: {},
            ip: '127.0.0.1',
            path: '/api/test',
            originalUrl: '/api/test',
            get: jest.fn()
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis()
        };
        next = jest.fn();
        process.env.JWT_SECRET = 'test-secret';
        process.env.NODE_ENV = 'test';
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test('should allow public endpoints', async () => {
        req.originalUrl = '/api/auth/login';
        await AuthMiddleware.authenticateUser(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('should reject if authorization header is missing', async () => {
        await AuthMiddleware.authenticateUser(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'MISSING_TOKEN' }));
    });

    test('should authenticate via valid Firebase ID token', async () => {
        const mockFirebaseToken = 'valid-firebase-token';
        const mockDecodedToken = { email: 'test@example.com', iat: 12345678, exp: 12345679 };
        const mockUser = {
            _id: { toString: () => '507f1f77bcf86cd799439011' },
            email: 'test@example.com',
            role: 'user',
            roles: ['user'],
            organizationId: 'org-123'
        };

        req.headers.authorization = `Bearer ${mockFirebaseToken}`;
        mockVerifyIdToken.mockResolvedValue(mockDecodedToken);
        mockFindOne.mockResolvedValue(mockUser);

        await AuthMiddleware.authenticateUser(req, res, next);

        expect(mockVerifyIdToken).toHaveBeenCalledWith(mockFirebaseToken);
        expect(mockFindOne).toHaveBeenCalledWith({ email: 'test@example.com' });
        expect(req.user).toBeDefined();
        expect(req.user.email).toBe('test@example.com');
        expect(req.user.provider).toBe('firebase');
        expect(next).toHaveBeenCalled();
    });

    test('should fall back to custom JWT if Firebase verification fails', async () => {
        const userPayload = { userId: '507f1f77bcf86cd799439011', email: 'test@example.com', roles: ['user'] };
        const token = jwt.sign(userPayload, process.env.JWT_SECRET, {
            issuer: 'invoice-app',
            audience: 'invoice-app-users'
        });

        req.headers.authorization = `Bearer ${token}`;
        // Firebase verification fails
        mockVerifyIdToken.mockRejectedValue({ code: 'auth/invalid-id-token' });
        // Key rotation returns valid keys
        mockGetValidKeys.mockResolvedValue([{ keyId: '1', secret: process.env.JWT_SECRET }]);

        await AuthMiddleware.authenticateUser(req, res, next);

        expect(req.user).toBeDefined();
        expect(req.user.email).toBe('test@example.com');
        expect(req.user.provider).toBeUndefined(); // Should not be 'firebase' (custom JWT logic doesn't set provider)
        expect(next).toHaveBeenCalled();
    });

    test('should reject invalid tokens', async () => {
        req.headers.authorization = 'Bearer invalid-token';
        mockVerifyIdToken.mockRejectedValue({ code: 'auth/invalid-id-token' });
        mockGetValidKeys.mockResolvedValue([{ keyId: '1', secret: process.env.JWT_SECRET }]);

        await AuthMiddleware.authenticateUser(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_TOKEN' }));
    });
});
