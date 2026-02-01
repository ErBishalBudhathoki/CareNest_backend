const AuthService = require('../services/authService_v2');
const { z } = require('zod');
const { createLogger } = require('../utils/logger');
const SecureErrorHandler = require('../utils/errorHandler');

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

    async register(req, res) {
        try {
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

            const result = await AuthService.register(validation.data);

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
            logger.error('Register Error', { error: error.message });
            return SecureErrorHandler.handleError(error, res);
        }
    }

    async login(req, res) {
        try {
            const validation = loginSchema.safeParse(req.body);
            if (!validation.success) {
                return res.status(400).json(SecureErrorHandler.createErrorResponse('Invalid credentials format', 400, 'VALIDATION_ERROR'));
            }

            const ipAddress = req.ip || req.connection.remoteAddress;
            const result = await AuthService.login(validation.data.email, validation.data.password, ipAddress);

            // Check for weak password on login
            if (!isStrongPassword(validation.data.password)) {
                result.requiresPasswordChange = true;
                // We still return key data, but frontend should redirect to change password
                // Alternatively, we could withhold tokens, but that prevents the 'change password' authenticated request.
                // So we return tokens but flag it.
            }

            return res.status(200).json(
                SecureErrorHandler.createSuccessResponse(result, 'Login successful')
            );

        } catch (error) {
            logger.error('Login Error', { error: error.message, email: req.body?.email });
            if (error.message === 'Invalid credentials' || error.message === 'Account disabled') {
                return res.status(401).json(SecureErrorHandler.createErrorResponse(error.message, 401, 'AUTH_FAILED'));
            }
            return SecureErrorHandler.handleError(error, res);
        }
    }

    async refreshToken(req, res) {
        try {
            const validation = refreshTokenSchema.safeParse(req.body);
            if (!validation.success) {
                return res.status(400).json(SecureErrorHandler.createErrorResponse('Missing refresh token', 400, 'VALIDATION_ERROR'));
            }

            const ipAddress = req.ip || req.connection.remoteAddress;
            const result = await AuthService.refreshToken(validation.data.refreshToken, ipAddress);

            return res.status(200).json(
                SecureErrorHandler.createSuccessResponse(result, 'Token refreshed')
            );

        } catch (error) {
            logger.error('Refresh Token Error', { error: error.message });
            if (error.message.includes('Security Alert')) {
                return res.status(403).json(SecureErrorHandler.createErrorResponse(error.message, 403, 'SECURITY_ALERT'));
            }
            if (error.message.includes('Invalid') || error.message.includes('Expired')) {
                return res.status(401).json(SecureErrorHandler.createErrorResponse(error.message, 401, 'INVALID_TOKEN'));
            }
            return SecureErrorHandler.handleError(error, res);
        }
    }

    async logout(req, res) {
        try {
            const { refreshToken } = req.body;
            if (refreshToken) {
                const ipAddress = req.ip || req.connection.remoteAddress;
                await AuthService.logout(refreshToken, ipAddress);
            }
            return res.status(200).json(SecureErrorHandler.createSuccessResponse(null, 'Logged out'));
        } catch (error) {
            return SecureErrorHandler.handleError(error, res);
        }
    }

    async changePassword(req, res) {
        try {
            const validation = changePasswordSchema.safeParse(req.body);
            if (!validation.success) {
                return res.status(400).json(SecureErrorHandler.createErrorResponse('Weak or invalid password', 400, 'VALIDATION_ERROR', validation.error.issues));
            }

            const userId = req.user.id; // From authenticateUser middleware
            const ipAddress = req.ip || req.connection.remoteAddress;

            await AuthService.changePassword(userId, validation.data.currentPassword, validation.data.newPassword, ipAddress);

            return res.status(200).json(SecureErrorHandler.createSuccessResponse(null, 'Password changed successfully'));

        } catch (error) {
            logger.error('Change Password Error', { error: error.message });
            if (error.message === 'Invalid credentials') {
                return res.status(401).json(SecureErrorHandler.createErrorResponse('Incorrect current password', 401, 'AUTH_FAILED'));
            }
            if (error.message.includes('Reuse')) {
                return res.status(403).json(SecureErrorHandler.createErrorResponse(error.message, 403, 'SECURITY_ALERT'));
            }
            return SecureErrorHandler.handleError(error, res);
        }
    }
}

module.exports = new AuthControllerV2();
