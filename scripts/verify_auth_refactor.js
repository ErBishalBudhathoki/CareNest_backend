const mongoose = require('mongoose');
const authService = require('../services/authService');
const User = require('../models/User');
const SecureAuthController = require('../controllers/secureAuthController');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const TEST_EMAIL = 'test@refactor.com';
const TEST_PASS = 'TestPass123!';

async function verifyAuthRefactor() {
    console.log('--- Verifying Auth Refactor ---');

    // Connect DB
    if (!process.env.MONGODB_URI) {
        console.error('MONGODB_URI missing');
        process.exit(1);
    }
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('DB Connected');

    try {
        // 1. Cleanup
        await User.deleteOne({ email: TEST_EMAIL });
        console.log('Cleanup done');

        // 2. Create User via AuthService
        console.log(`Creating user ${TEST_EMAIL}...`);
        const user = await authService.createUser({
            email: TEST_EMAIL,
            password: TEST_PASS,
            firstName: 'Auth',
            lastName: 'Refactor',
            organizationId: 'ORG123',
            role: 'user'
        });
        console.log('User created:', user._id);

        // 3. Verify DB Storage
        const dbUser = await User.findById(user._id).select('+password +salt');
        console.log('Stored Password Hash:', dbUser.password);

        if (!dbUser.password.startsWith('$2')) {
            throw new Error('Password does not look like Bcrypt hash!');
        }
        if (dbUser.salt) {
            console.warn('WARNING: Salt field exists! It should be removed/unused.');
            // It might exist if schema defines it, but we removed it from schema in Step 103?
            // Step 103 showed `// Removed 'salt' field`.
            // So it should be undefined in doc unless `strict: false`.
        } else {
            console.log('Salt field is absent (Correct).');
        }

        // 4. Verify Instance Method
        const isMatch = await dbUser.comparePassword(TEST_PASS);
        console.log(`Password Match (Correct): ${isMatch}`);
        if (!isMatch) throw new Error('Password verification failed!');

        const isMatchWrong = await dbUser.comparePassword('WrongPass');
        console.log(`Password Match (Wrong): ${isMatchWrong}`);
        if (isMatchWrong) throw new Error('Wrong password matched!');

        // 5. Verify Controller Login
        console.log('Testing SecureAuthController.login...');
        const req = {
            body: { email: TEST_EMAIL, password: TEST_PASS },
            ip: '127.0.0.1',
            connection: { remoteAddress: '127.0.0.1' }
        };
        const res = {
            status: function (code) {
                this.statusCode = code;
                return this;
            },
            json: function (data) {
                this.data = data;
                return this;
            }
        };

        // Note: SecureAuthController.login expects express-validator to have run?
        // My rewrite uses `validationResult(req)`.
        // If I don't run validator middleware, `validationResult` returns empty errors or errors?
        // `validationResult` extracts from `req`. If validation didn't run, it might be empty (success) or throw?
        // Actually `validationResult` looks up `req` properties set by validator middleware.
        // If middleware didn't run, it might return empty array (Pass).
        // Let's assume it passes or we need to mock it.
        // But `req` doesn't have validation errors attached.

        // Mock `validationResult`
        const expressValidator = require('express-validator');
        // We can't easily mock require inside the controller.
        // But since we are running in same process, maybe validationResult(req) returns empty object if no errors found?
        // It reads from `req._validationErrors`?

        await SecureAuthController.login(req, res);

        console.log(`Login Response Status: ${res.statusCode}`);
        console.log('Login Response Data:', res.data);

        if (res.statusCode !== 200) {
            throw new Error(`Login failed with status ${res.statusCode}`);
        }
        if (!res.data.data.token) {
            throw new Error('No token returned!');
        }

        console.log('--- Verification SUCCESS ---');

    } catch (e) {
        console.error('VERIFICATION FAILED:', e);
    } finally {
        await User.deleteOne({ email: TEST_EMAIL });
        await mongoose.disconnect();
    }
}

verifyAuthRefactor();
