const mongoose = require('mongoose');
const User = require('../models/User');
const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { createLogger } = require('../utils/logger');
const logger = createLogger('AuthServiceV2');

// Constants
const ACCESS_TOKEN_EXPIRE = '15m';
const REFRESH_TOKEN_EXPIRE_DAYS = 7;

class AuthServiceV2 {

    /**
     * Hash password using Argon2
     * @param {string} password 
     * @returns {Promise<string>}
     */
    async hashPassword(password) {
        try {
            return await argon2.hash(password, {
                type: argon2.argon2id, // recommended for password hashing
                memoryCost: 2 ** 16,
                timeCost: 3,
                parallelism: 1
            });
        } catch (err) {
            logger.error('Argon2 hashing failed', { error: err.message });
            throw new Error('Security system error');
        }
    }

    /**
     * Verify password using Argon2
     * @param {string} hash 
     * @param {string} plain 
     * @returns {Promise<boolean>}
     */
    async verifyPassword(hash, plain) {
        try {
            return await argon2.verify(hash, plain);
        } catch (err) {
            logger.warn('Argon2 verification failed', { error: err.message });
            return false;
        }
    }

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
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
            throw new Error('Invalid credentials');
        }

        if (!user.isActive) {
            throw new Error('Account disabled');
        }

        const valid = await this.verifyPassword(user.password, password);
        if (!valid) {
            // Logic for locking account could go here (reusing existing logic from SecureAuth if needed)
            throw new Error('Invalid credentials');
        }

        const { accessToken, refreshToken, refreshTokenExpiry } = this.generateTokens(user);

        // Save refresh token
        const tokenModel = {
            token: refreshToken,
            expires: refreshTokenExpiry,
            created: new Date(),
            createdByIp: ipAddress
        };

        user.refreshTokens.push(tokenModel);

        // Update last login
        user.lastLogin = new Date();
        user.loginAttempts = 0;

        await user.save();

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

        const hashedPassword = await this.hashPassword(userData.password);

        const user = new User({
            ...userData,
            email: userData.email.toLowerCase(),
            password: hashedPassword,
            salt: crypto.randomBytes(16).toString('hex'), // Required by current schema
            refreshTokens: [],
            roles: ['user'],
            isActive: true
        });

        await user.save();
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
            user.refreshTokens = user.refreshTokens.filter(t => t.token !== requestToken);
            await user.save();
            throw new Error('Refresh Token Expired');
        }

        // Valid token. Rotate it.
        const { accessToken, refreshToken, refreshTokenExpiry } = this.generateTokens(user);

        // Revoke the old one
        currentToken.revoked = new Date();
        currentToken.revokedByIp = ipAddress;
        currentToken.replacedByToken = refreshToken;

        // Add new one
        user.refreshTokens.push({
            token: refreshToken,
            expires: refreshTokenExpiry,
            created: new Date(),
            createdByIp: ipAddress
        });

        // Clean up old revoked tokens (older than 30 days)
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        user.refreshTokens = user.refreshTokens.filter(t => !t.revoked || t.revoked > thirtyDaysAgo);

        await user.save();

        return {
            accessToken,
            refreshToken
        };
    }

    async logout(token, ipAddress) {
        const user = await User.findOne({ 'refreshTokens.token': token });
        if (user) {
            const t = user.refreshTokens.find(x => x.token === token);
            if (t) {
                t.revoked = new Date();
                t.revokedByIp = ipAddress;
                await user.save();
            }
        }
        return true;
    }

    async changePassword(userId, currentPassword, newPassword, ipAddress) {
        const user = await User.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }

        const valid = await this.verifyPassword(user.password, currentPassword);
        if (!valid) {
            throw new Error('Invalid credentials'); // Message matched in controller
        }

        const hashedPassword = await this.hashPassword(newPassword);
        user.password = hashedPassword;

        // Revoke all existing sessions on password change for security
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
