const mongoose = require('mongoose');
const User = require('../models/User');
const UserOrganization = require('../models/UserOrganization');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { createLogger } = require('../utils/logger');
const logger = createLogger('AuthServiceV2');

// Constants
const ACCESS_TOKEN_EXPIRE = process.env.JWT_EXPIRES_IN || '24h'; // Align with .env
const REFRESH_TOKEN_EXPIRE_DAYS = 7;

class AuthServiceV2 {

    // Removed manual hash/verify methods in favor of User model methods

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

        // Use User model instance method (Bcrypt)
        const valid = await user.comparePassword(password);
        if (!valid) {
            // Lockout logic should be centralized, duplicating basic increment here
            await User.updateOne({ _id: user._id }, { $inc: { loginAttempts: 1 } });
            throw new Error('Invalid credentials');
        }

        // Reset attempts
        if (user.loginAttempts > 0) {
            await User.updateOne({ _id: user._id }, { $set: { loginAttempts: 0 } });
        }

        const { accessToken, refreshToken, refreshTokenExpiry } = this.generateTokens(user);

        // Save refresh token
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

        // Pass plain password. Pre-save hook will hash it.
        const user = new User({
            ...userData,
            email: userData.email.toLowerCase(),
            password: userData.password,
            refreshTokens: [],
            roles: ['user'],
            isActive: true
        });

        await user.save();

        // Create UserOrganization record (Zero-Trust requirement)
        if (userData.organizationId) {
            try {
                await UserOrganization.create({
                    userId: user._id.toString(),
                    organizationId: userData.organizationId,
                    role: 'user',
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

        // Reuse Detection
        if (currentToken.revoked) {
            logger.security('Refresh Token Reuse Detected! Revoking all tokens.', {
                userId: user._id,
                attemptedToken: requestToken,
                ip: ipAddress
            });

            user.refreshTokens = []; // Clear all sessions
            await user.save();

            throw new Error('Security Alert: Token Reuse Detected. Please login again.');
        }

        // Check expiry
        if (Date.now() >= currentToken.expires) {
            // Remove expired token
            await User.updateOne(
                { _id: user._id },
                { $pull: { refreshTokens: { token: requestToken } } }
            );
            throw new Error('Refresh Token Expired');
        }

        // Valid token. Rotate it.
        const { accessToken, refreshToken, refreshTokenExpiry } = this.generateTokens(user);

        // Mark old as revoked
        // Note: Using updateOne with positional operator $ to update specific element array
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

        // Clean up logic (optional, keep it simple for now)

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
        const user = await User.findById(userId).select('+password');
        if (!user) {
            throw new Error('User not found');
        }

        const valid = await user.comparePassword(currentPassword);
        if (!valid) {
            throw new Error('Invalid credentials');
        }

        user.password = newPassword; // Pre-save will hash

        // Revoke all existing sessions
        user.refreshTokens.forEach(t => {
            if (!t.revoked) {
                t.revoked = new Date();
                t.revokedByIp = ipAddress;
                t.replacedByToken = 'PASSWORD_CHANGE';
            }
        });

        await user.save();

        return true;
    }
}

module.exports = new AuthServiceV2();
