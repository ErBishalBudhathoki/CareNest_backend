const mongoose = require('mongoose');
const User = require('../models/User');
const UserOrganization = require('../models/UserOrganization');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { createLogger } = require('../utils/logger');
const { admin } = require('../firebase-admin-config');
const { verifyFirebaseCredentials } = require('../utils/firebasePasswordVerifier');
const TemporalManager = require('../core/TemporalManager');
const logger = createLogger('AuthServiceV2');

// Constants
const ACCESS_TOKEN_EXPIRE = process.env.JWT_EXPIRES_IN || '24h';
const REFRESH_TOKEN_EXPIRE_DAYS = 7;

/**
 * Task queue helper
 */
function getTaskQueue() {
    const projectId = process.env.FIREBASE_PROJECT_ID || 'invoice-660f3';
    const isProd = projectId === 'carenest-prods' || process.env.NODE_ENV === 'production';
    return `default-${isProd ? 'prod' : 'dev'}`;
}

class AuthServiceV2 {

    /**
     * Generate Access and Refresh tokens
     * @param {Object} user 
     * @returns {Object} { accessToken, refreshToken, refreshTokenExpiry }
     */
    generateTokens(user) {
        const payload = {
            userId: user._id,
            email: user.email,
            roles: user.roles,
            organizationId: user.organizationId
        };

        const accessToken = jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: ACCESS_TOKEN_EXPIRE, issuer: 'carenest-api', audience: 'carenest-web' }
        );

        const refreshToken = crypto.randomBytes(40).toString('hex');
        const refreshTokenExpiry = new Date(Date.now() + REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60 * 1000);

        return { accessToken, refreshToken, refreshTokenExpiry };
    }

    /**
     * Generate and send verification OTP for new registration
     * @param {string} email 
     * @param {string} firstName 
     */
    async sendVerificationOTP(email, firstName) {
        try {
            const otp = crypto.randomInt(100000, 1000000).toString();
            const otpExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

            await User.updateOne(
                { email: email.toLowerCase() },
                {
                    $set: {
                        otp: otp,
                        otpExpiry: otpExpiry,
                        otpUsed: false
                    }
                }
            );

            // Trigger Temporal Workflow
            await TemporalManager.startWorkflow('authNotificationWorkflow', {
                workflowId: `auth-verify-${email.toLowerCase().replace(/[@.]/g, '-')}-${Date.now()}`,
                taskQueue: getTaskQueue(),
                args: [{
                    type: 'VERIFICATION',
                    data: { email, firstName, otp }
                }]
            });

            return otp;
        } catch (error) {
            logger.error('Error sending verification OTP via Temporal', { email, error: error.message });
        }
    }

    /**
     * Authenticate user
     * @param {string} email 
     * @param {string} password 
     * @param {string} ipAddress 
     */
    async login(email, password, ipAddress) {
        const user = await User.findOne({ email: email.toLowerCase() }).select('+password +loginAttempts +lockUntil');
        if (!user) {
            throw new Error('Invalid credentials');
        }

        if (!user.isActive) {
            throw new Error('Account disabled');
        }

        const valid = await user.comparePassword(password);
        if (!valid) {
            await User.updateOne({ _id: user._id }, { $inc: { loginAttempts: 1 } });
            throw new Error('Invalid credentials');
        }

        if (user.loginAttempts > 0) {
            await User.updateOne({ _id: user._id }, { $set: { loginAttempts: 0 } });
        }

        const { accessToken, refreshToken, refreshTokenExpiry } = this.generateTokens(user);

        const tokenModel = {
            token: refreshToken,
            expires: refreshTokenExpiry,
            created: new Date(),
            createdByIp: ipAddress
        };

        await User.updateOne(
            { _id: user._id },
            {
                $push: { refreshTokens: tokenModel },
                $set: { lastLogin: new Date() }
            }
        );

        return {
            user: {
                id: user._id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                roles: user.roles,
                organizationId: user.organizationId
            },
            accessToken,
            refreshToken
        };
    }

    /**
     * Register new user
     * @param {Object} userData 
     */
    async register(userData) {
        const existing = await User.findOne({ email: userData.email.toLowerCase() });
        if (existing) {
            throw new Error('Email already registered');
        }

        const user = new User({
            ...userData,
            email: userData.email.toLowerCase(),
            password: userData.password,
            refreshTokens: [],
            roles: [userData.role || 'employee'],
            isActive: true
        });

        await user.save();

        // Add to Listmonk and trigger verification workflow
        const emailService = require('./emailService');
        await emailService.addSubscriber(user.email, `${user.firstName} ${user.lastName}`);
        await this.sendVerificationOTP(user.email, user.firstName);

        if (userData.organizationId) {
            try {
                await UserOrganization.create({
                    userId: user._id.toString(),
                    organizationId: userData.organizationId,
                    role: 'employee',
                    permissions: ['read', 'write'],
                    isActive: true,
                    joinedAt: new Date(),
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
            } catch (orgError) {
                logger.error('Failed to create UserOrganization record', {
                    userId: user._id.toString(),
                    error: orgError.message
                });
            }
        }

        return user;
    }

    /**
     * Rotate Refresh Token
     * @param {string} requestToken 
     * @param {string} ipAddress 
     */
    async refreshToken(requestToken, ipAddress) {
        const user = await User.findOne({ 'refreshTokens.token': requestToken });

        if (!user) {
            throw new Error('Invalid Refresh Token');
        }

        const currentToken = user.refreshTokens.find(t => t.token === requestToken);

        if (!currentToken) {
            throw new Error('Invalid Refresh Token');
        }

        if (currentToken.revoked) {
            logger.security('Refresh Token Reuse Detected! Revoking all tokens.', {
                userId: user._id,
                attemptedToken: requestToken,
                ip: ipAddress
            });

            user.refreshTokens = []; 
            await user.save();

            throw new Error('Security Alert: Token Reuse Detected. Please login again.');
        }

        if (Date.now() >= currentToken.expires) {
            await User.updateOne(
                { _id: user._id },
                { $pull: { refreshTokens: { token: requestToken } } }
            );
            throw new Error('Refresh Token Expired');
        }

        const { accessToken, refreshToken, refreshTokenExpiry } = this.generateTokens(user);

        await User.updateOne(
            { _id: user._id, 'refreshTokens.token': requestToken },
            {
                $set: {
                    'refreshTokens.$.revoked': new Date(),
                    'refreshTokens.$.revokedByIp': ipAddress,
                    'refreshTokens.$.replacedByToken': refreshToken
                },
                $push: {
                    refreshTokens: {
                        token: refreshToken,
                        expires: refreshTokenExpiry,
                        created: new Date(),
                        createdByIp: ipAddress
                    }
                }
            }
        );

        return {
            accessToken,
            refreshToken
        };
    }

    async logout(token, ipAddress) {
        await User.updateOne(
            { 'refreshTokens.token': token },
            {
                $set: {
                    'refreshTokens.$.revoked': new Date(),
                    'refreshTokens.$.revokedByIp': ipAddress
                }
            }
        );
        return true;
    }

    async changePassword(userId, currentPassword, newPassword, ipAddress) {
        const user = await User.findById(userId).select(
            'email firstName firebaseUid refreshTokens'
        );
        if (!user) {
            throw new Error('User not found');
        }

        const email = String(user.email || '').trim().toLowerCase();
        if (!email) {
            throw new Error('User email missing');
        }

        const isCurrentPasswordValid = await verifyFirebaseCredentials(
            email,
            currentPassword
        );
        if (!isCurrentPasswordValid) {
            throw new Error('Invalid credentials');
        }

        let firebaseUid = user.firebaseUid;
        if (!firebaseUid) {
            const firebaseUser = await admin.auth().getUserByEmail(email);
            firebaseUid = firebaseUser.uid;
            user.firebaseUid = firebaseUid;
        }

        await admin.auth().updateUser(firebaseUid, { password: newPassword });
        await admin.auth().revokeRefreshTokens(firebaseUid);

        // Trigger Temporal Workflow for Notification
        await TemporalManager.startWorkflow('authNotificationWorkflow', {
            workflowId: `auth-changed-${email.replace(/[@.]/g, '-')}-${Date.now()}`,
            taskQueue: getTaskQueue(),
            args: [{
                type: 'PASSWORD_CHANGED',
                data: { email, firstName: user.firstName }
            }]
        });

        user.refreshTokens.forEach(t => {
            if (!t.revoked) {
                t.revoked = new Date();
                t.revokedByIp = ipAddress;
                t.replacedByToken = 'PASSWORD_CHANGE';
            }
        });

        user.passwordUpdatedAt = new Date();
        user.firebaseSyncedAt = new Date();
        user.markModified('refreshTokens');
        await user.save();

        return true;
    }
}

module.exports = new AuthServiceV2();
