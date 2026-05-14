const OnboardingRecord = require('../models/OnboardingRecord');
const EmployeeDocument = require('../models/EmployeeDocument');
const Certification = require('../models/Certification');
const User = require('../models/User'); // Maps to 'login' collection
const bankDetailsService = require('./bankDetailsService');
const logger = require('../config/logger');
const emailService = require('./emailService');

class OnboardingService {

    /**
     * Get or create onboarding status for a user
     */
    static async getOnboardingStatus(userId, organizationId) {
        const { toSafeString } = require('../utils/security');
        let record = await OnboardingRecord.findOne({ userId: toSafeString(userId) });

        if (!record) {
            // Create initial record if it doesn't exist
            record = OnboardingRecord.createInitialRecord(
                userId,
                organizationId
            );
            await record.save();
        }

        return record;
    }

    /**
     * Update a specific onboarding step
     */
    static async updateStep(userId, stepName, data, currentStep) {
        const updateField = `steps.${stepName}`;
        const updateData = {
            [`${updateField}.status`]: 'completed',
            [`${updateField}.updatedAt`]: new Date(),
            ...Object.keys(data).reduce((acc, key) => {
                acc[`${updateField}.${key}`] = data[key];
                return acc;
            }, {})
        };

        if (currentStep) {
            updateData.currentStep = currentStep;
        }

        const { toSafeString } = require('../utils/security');
        const result = await OnboardingRecord.findOneAndUpdate(
            { userId: toSafeString(userId) },
            { $set: updateData },
            { new: true } // returnDocument: 'after' equivalent
        );

        return result;
    }

    /**
     * Save a document record
     */
    static async saveDocument(docData) {
        const document = new EmployeeDocument({
            ...docData,
            userId: docData.userId,
            organizationId: docData.organizationId
        });

        await document.save();

        // Update document count in onboarding record
        const { toSafeString } = require('../utils/security');
        const count = await EmployeeDocument.countDocuments({ userId: toSafeString(docData.userId) });

        await OnboardingRecord.updateOne(
            { userId: toSafeString(docData.userId) },
            {
                $set: {
                    'steps.documents.count': count,
                    'steps.documents.updatedAt': new Date()
                }
            }
        );

        return document;
    }

    /**
     * Get all documents for a user
     */
    static async getUserDocuments(userId) {
        const { toSafeString } = require('../utils/security');
        return await EmployeeDocument.find({ userId: toSafeString(userId) });
    }

    /**
     * Delete a document
     */
    static async deleteDocument(docId, userId) {
        // Ensure the document belongs to the user
        const { toSafeString } = require('../utils/security');
        const result = await EmployeeDocument.deleteOne({
            _id: toSafeString(docId),
            userId: toSafeString(userId)
        });

        if (result.deletedCount === 0) {
            throw new Error('Document not found or unauthorized');
        }

        // Update document count
        const count = await EmployeeDocument.countDocuments({ userId: toSafeString(userId) });

        await OnboardingRecord.updateOne(
            { userId: toSafeString(userId) },
            {
                $set: {
                    'steps.documents.count': count,
                    'steps.documents.updatedAt': new Date()
                }
            }
        );

        return true;
    }

    /**
     * Submit onboarding for review
     */
    static async submitOnboarding(userId) {
        const { toSafeString } = require('../utils/security');
        const result = await OnboardingRecord.findOneAndUpdate(
            { userId: toSafeString(userId) },
            {
                $set: {
                    status: 'submitted',
                    updatedAt: new Date()
                }
            },
            { new: true }
        );

        // Optionally send email to admin
        return result;
    }

    // --- Admin Methods ---

    /**
     * Get all pending onboardings for an organization
     */
    static async getPendingOnboardings(organizationId) {
        // Join with login collection (User model) to get names
        // Using aggregation to mimic original behavior
        const { toSafeString } = require('../utils/security');
        return await OnboardingRecord.aggregate([
            { $match: { organizationId: toSafeString(organizationId) } }, // Ensure organizationId is string as per model
            {
                $lookup: {
                    from: 'login', // User collection name
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            { $unwind: '$user' },
            {
                $project: {
                    _id: 1,
                    userId: 1,
                    organizationId: 1,
                    status: 1,
                    steps: 1,
                    'user.firstName': 1,
                    'user.lastName': 1,
                    'user.email': 1,
                    createdAt: 1,
                    updatedAt: 1
                }
            }
        ]);
    }

    /**
     * Verify a document
     */
    static async verifyDocument(docId, status, reason, adminId) {
        const { toSafeString } = require('../utils/security');
        const updateData = {
            status,
            verifiedAt: new Date(),
            verifiedBy: toSafeString(adminId)
        };

        if (reason) updateData.rejectionReason = reason;

        return await EmployeeDocument.findOneAndUpdate(
            { _id: toSafeString(docId) },
            { $set: updateData },
            { new: true }
        );
    }

    /**
     * Finalize onboarding
     */
    static async finalizeOnboarding(userId, _adminId) {
        // Calculate probation end date (e.g., 3 months from now)
        const { toSafeString } = require('../utils/security');
        const startDate = new Date();
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 3);

        const result = await OnboardingRecord.findOneAndUpdate(
            { userId: toSafeString(userId) },
            {
                $set: {
                    status: 'completed',
                    updatedAt: new Date(),
                    'probation.startDate': startDate,
                    'probation.endDate': endDate,
                    'probation.status': 'active'
                }
            },
            { new: true }
        );

        // ----- Sync onboarding data to authoritative collections -----
        // Each sync is wrapped independently so a partial failure doesn't
        // block the finalize response or email delivery.

        // 1. Sync bank details → bankDetails collection
        await OnboardingService._syncBankDetails(userId, result).catch(err =>
            logger.error('[OnboardingService] _syncBankDetails failed', { userId, err: err.message })
        );

        // 2. Promote EmployeeDocuments → certifications collection
        await OnboardingService._syncDocumentsToCertifications(userId).catch(err =>
            logger.error('[OnboardingService] _syncDocumentsToCertifications failed', { userId, err: err.message })
        );

        // 3. Patch User model with personal details
        await OnboardingService._syncPersonalDetails(userId, result).catch(err =>
            logger.error('[OnboardingService] _syncPersonalDetails failed', { userId, err: err.message })
        );

        logger.business('Onboarding data synced to authoritative collections', {
            event: 'onboarding_data_synced',
            userId,
            timestamp: new Date().toISOString()
        });
        // ----------------------------------------------------------

        // Send welcome email
        try {
            const user = await User.findById(toSafeString(userId));
            if (user && user.email) {
                const name = user.firstName ? `${user.firstName} ${user.lastName || ''}` : 'Employee';
                await emailService.sendOnboardingWelcomeEmail(user.email, name);
            }
        } catch (error) {
            logger.error('Failed to send welcome email', error);
        }

        return result;
    }

    /**
     * @private
     * Sync bank details entered during onboarding into the authoritative bankDetails collection.
     * Uses bankDetailsService.saveBankDetails() which upserts by (userEmail, organizationId).
     */
    static async _syncBankDetails(userId, onboardingRecord) {
        const bankStep = onboardingRecord?.steps?.bankDetails;
        if (!bankStep || !bankStep.accountName || !bankStep.bsb || !bankStep.accountNumber) {
            logger.info('[OnboardingService] Skipping bank sync — bankDetails step incomplete', { userId });
            return;
        }

        const { toSafeString } = require('../utils/security');
        const user = await User.findById(toSafeString(userId)).lean();
        if (!user || !user.email) {
            throw new Error('User email not found — cannot sync bank details');
        }

        const orgId = String(onboardingRecord.organizationId || '');
        await bankDetailsService.saveBankDetails(
            user.email,  // actorEmail (system acting on behalf of the employee)
            user.email,  // targetEmail (same person)
            orgId,
            {
                bankName:      bankStep.bankName      || '',
                accountName:   bankStep.accountName,
                bsb:           String(bankStep.bsb).replace(/\D/g, ''),
                accountNumber: String(bankStep.accountNumber)
            }
        );

        logger.info('[OnboardingService] Bank details synced', { userId, email: user.email });
    }

    /**
     * @private
     * Promote EmployeeDocument records into the Certifications collection.
     * Idempotent: uses upsert keyed on (userId, source:'onboarding', name).
     *
     * Document type → human-readable cert name mapping:
     *   passport        → "Passport / ID"
     *   police_check    → "Police Check"
     *   visa            → "Visa Grant"
     *   drivers_license → "Driver's Licence"
     *   first_aid       → "First Aid Certificate"
     *   ndis_screening  → "NDIS Worker Screening"
     *   other           → "Other Document"
     */
    static async _syncDocumentsToCertifications(userId) {
        const TYPE_LABELS = {
            passport:        'Passport / ID',
            police_check:    'Police Check',
            visa:            'Visa Grant',
            drivers_license: "Driver's Licence",
            first_aid:       'First Aid Certificate',
            ndis_screening:  'NDIS Worker Screening',
            other:           'Other Document'
        };

        const { toSafeString } = require('../utils/security');
        const docs = await EmployeeDocument.find({ userId: toSafeString(userId) }).lean();
        if (!docs.length) {
            logger.info('[OnboardingService] No documents to promote for user', { userId });
            return;
        }

        for (const doc of docs) {
            const certName = TYPE_LABELS[doc.type] || 'Other Document';
            // Upsert keyed on userId + source + name to be idempotent across re-finalizes.
            await Certification.updateOne(
                { userId: toSafeString(userId), source: 'onboarding', name: certName },
                {
                    $setOnInsert: {
                        userId: toSafeString(userId),
                        name:       certName,
                        fileUrl:    doc.fileUrl,
                        expiryDate: doc.expiryDate || null,
                        status:     'pending_approval',
                        source:     'onboarding',
                        notes:      'Imported from onboarding',
                        issueDate:  doc.uploadedAt || new Date()
                    }
                },
                { upsert: true }
            );
        }

        logger.info('[OnboardingService] Documents promoted to certifications', {
            userId,
            count: docs.length
        });
    }

    /**
     * @private
     * Patch the User document with personal details collected during onboarding.
     * Only overwrites fields that are present in the onboarding step.
     */
    static async _syncPersonalDetails(userId, onboardingRecord) {
        const step = onboardingRecord?.steps?.personalDetails;
        if (!step) return;

        const patch = {};
        if (step.firstName)   patch.firstName   = step.firstName;
        if (step.lastName)    patch.lastName    = step.lastName;
        if (step.phone)       patch.phone       = step.phone;
        if (step.dateOfBirth) patch.dateOfBirth = step.dateOfBirth;
        if (step.address)     patch.address     = step.address;

        if (!Object.keys(patch).length) return;

        const { toSafeString } = require('../utils/security');
        await User.updateOne({ _id: toSafeString(userId) }, { $set: patch });
        logger.info('[OnboardingService] Personal details synced to User document', { userId });
    }

    /**
     * Check for probation periods ending soon
     * Should be called by a scheduler
     */
    static async checkProbationPeriods() {
        const today = new Date();
        const sevenDaysFromNow = new Date();
        sevenDaysFromNow.setDate(today.getDate() + 7);

        // Find active probations ending within next 7 days
        const records = await OnboardingRecord.aggregate([
            {
                $match: {
                    'probation.status': 'active',
                    'probation.endDate': {
                        $gte: today,
                        $lte: sevenDaysFromNow
                    }
                }
            },
            {
                $lookup: {
                    from: 'login',
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            { $unwind: '$user' }
        ]);

        for (const record of records) {
            const daysRemaining = Math.ceil((new Date(record.probation.endDate) - today) / (1000 * 60 * 60 * 24));
            const employeeName = `${record.user.firstName} ${record.user.lastName || ''}`;

            logger.info(`Probation Reminder: ${employeeName}'s probation ends in ${daysRemaining} days.`);
            
            // Mock email to organization admin
            // await emailService.sendProbationReminder('admin@example.com', employeeName, daysRemaining);
        }

        return {
            processed: records.length,
            records: records.map(r => ({
                userId: r.userId,
                endDate: r.probation.endDate,
                employeeName: `${r.user.firstName} ${r.user.lastName}`
            }))
        };
    }
}

module.exports = OnboardingService;
