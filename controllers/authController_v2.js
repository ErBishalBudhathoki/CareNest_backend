const AuthService = require('../services/authService_v2');
const { z } = require('zod');
const { createLogger } = require('../utils/logger');
const SecureErrorHandler = require('../utils/errorHandler');
const catchAsync = require('../utils/catchAsync');

const logger = createLogger('AuthControllerV2');

// Validation Schemas
const registerSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters')
        .regex(/[A-Z]/, 'Must contain uppercase letter')
        .regex(/[0-9]/, 'Must contain number')
        .regex(/[^A-Za-z0-9]/, 'Must contain special character'),
    firstName: z.string().min(2, 'First name too short'),
    lastName: z.string().min(2, 'Last name too short'),
    phone: z.string().optional(),
    organizationCode: z.string().optional()
});

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1)
});

const refreshTokenSchema = z.object({
    refreshToken: z.string().min(1)
});

const changePasswordSchema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8, 'Password must be at least 8 characters')
        .regex(/[A-Z]/, 'Must contain uppercase letter')
        .regex(/[0-9]/, 'Must contain number')
        .regex(/[^A-Za-z0-9]/, 'Must contain special character')
});

function isStrongPassword(password) {
    const result = registerSchema.shape.password.safeParse(password);
    return result.success;
}

class AuthControllerV2 {

    register = catchAsync(async (req, res) => {
        // Validate
        const validation = registerSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json(
                SecureErrorHandler.createErrorResponse(
                    'Validation Error',
                    400,
                    'VALIDATION_ERROR',
                    validation.error.issues
                )
            );
        }

        try {
            const result = await AuthService.register(validation.data);

            logger.info('User registered successfully', { userId: result._id, email: result.email });

            return res.status(201).json(
                SecureErrorHandler.createSuccessResponse(
                    { userId: result._id, email: result.email },
                    'Registration successful'
                )
            );
        } catch (error) {
            if (error.message === 'Email already registered') {
                return res.status(409).json(SecureErrorHandler.createErrorResponse(error.message, 409, 'USER_EXISTS'));
            }
            // Let catchAsync handle unexpected errors
            throw error;
        }
    });

    login = catchAsync(async (req, res) => {
        const validation = loginSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json(SecureErrorHandler.createErrorResponse('Invalid credentials format', 400, 'VALIDATION_ERROR'));
        }

        try {
            const ipAddress = req.ip || req.connection.remoteAddress;
            const result = await AuthService.login(validation.data.email, validation.data.password, ipAddress);

            // Check for weak password on login
            if (!isStrongPassword(validation.data.password)) {
                result.requiresPasswordChange = true;
            }

            logger.info('User logged in successfully', { email: validation.data.email });

            return res.status(200).json(
                SecureErrorHandler.createSuccessResponse(result, 'Login successful')
            );
        } catch (error) {
            logger.warn('Login failed', { error: error.message, email: req.body?.email });
            if (error.message === 'Invalid credentials' || error.message === 'Account disabled') {
                return res.status(401).json(SecureErrorHandler.createErrorResponse(error.message, 401, 'AUTH_FAILED'));
            }
            throw error;
        }
    });

    refreshToken = catchAsync(async (req, res) => {
        const validation = refreshTokenSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json(SecureErrorHandler.createErrorResponse('Missing refresh token', 400, 'VALIDATION_ERROR'));
        }

        try {
            const ipAddress = req.ip || req.connection.remoteAddress;
            const result = await AuthService.refreshToken(validation.data.refreshToken, ipAddress);

            return res.status(200).json(
                SecureErrorHandler.createSuccessResponse(result, 'Token refreshed')
            );
        } catch (error) {
            logger.warn('Refresh token failed', { error: error.message });
            if (error.message.includes('Security Alert')) {
                return res.status(403).json(SecureErrorHandler.createErrorResponse(error.message, 403, 'SECURITY_ALERT'));
            }
            if (error.message.includes('Invalid') || error.message.includes('Expired')) {
                return res.status(401).json(SecureErrorHandler.createErrorResponse(error.message, 401, 'INVALID_TOKEN'));
            }
            throw error;
        }
    });

    logout = catchAsync(async (req, res) => {
        const { refreshToken } = req.body;
        if (refreshToken) {
            const ipAddress = req.ip || req.connection.remoteAddress;
            await AuthService.logout(refreshToken, ipAddress);
        }
        return res.status(200).json(SecureErrorHandler.createSuccessResponse(null, 'Logged out'));
    });

    changePassword = catchAsync(async (req, res) => {
        const validation = changePasswordSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json(SecureErrorHandler.createErrorResponse('Weak or invalid password', 400, 'VALIDATION_ERROR', validation.error.issues));
        }

        const userId = req.user.id; // From authenticateUser middleware
        const ipAddress = req.ip || req.connection.remoteAddress;

        try {
            await AuthService.changePassword(userId, validation.data.currentPassword, validation.data.newPassword, ipAddress);
            
            logger.info('Password changed successfully', { userId });

            return res.status(200).json(SecureErrorHandler.createSuccessResponse(null, 'Password changed successfully'));
        } catch (error) {
            logger.warn('Change password failed', { error: error.message, userId });
            if (error.message === 'Invalid credentials') {
                return res.status(401).json(SecureErrorHandler.createErrorResponse('Incorrect current password', 401, 'AUTH_FAILED'));
            }
            if (error.message.includes('Reuse')) {
                return res.status(403).json(SecureErrorHandler.createErrorResponse(error.message, 403, 'SECURITY_ALERT'));
            }
            throw error;
        }
    });
}

module.exports = new AuthControllerV2();
