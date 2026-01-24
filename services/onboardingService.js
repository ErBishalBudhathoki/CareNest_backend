const mongoose = require('mongoose');
const OnboardingRecord = require('../models/OnboardingRecord');
const EmployeeDocument = require('../models/EmployeeDocument');
const User = require('../models/User'); // Maps to 'login' collection
const logger = require('../config/logger');
const emailService = require('./emailService');

class OnboardingService {

    /**
     * Get or create onboarding status for a user
     */
    static async getOnboardingStatus(userId, organizationId) {
        let record = await OnboardingRecord.findOne({ userId });

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

        const result = await OnboardingRecord.findOneAndUpdate(
            { userId },
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
        const count = await EmployeeDocument.countDocuments({ userId: docData.userId });

        await OnboardingRecord.updateOne(
            { userId: docData.userId },
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
        return await EmployeeDocument.find({ userId });
    }

    /**
     * Delete a document
     */
    static async deleteDocument(docId, userId) {
        // Ensure the document belongs to the user
        const result = await EmployeeDocument.deleteOne({
            _id: docId,
            userId: userId
        });

        if (result.deletedCount === 0) {
            throw new Error('Document not found or unauthorized');
        }

        // Update document count
        const count = await EmployeeDocument.countDocuments({ userId });

        await OnboardingRecord.updateOne(
            { userId },
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
        const result = await OnboardingRecord.findOneAndUpdate(
            { userId },
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
        return await OnboardingRecord.aggregate([
            { $match: { organizationId: organizationId } }, // Ensure organizationId is string as per model
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
        const updateData = {
            status,
            verifiedAt: new Date(),
            verifiedBy: adminId
        };

        if (reason) updateData.rejectionReason = reason;

        return await EmployeeDocument.findOneAndUpdate(
            { _id: docId },
            { $set: updateData },
            { new: true }
        );
    }

    /**
     * Finalize onboarding
     */
    static async finalizeOnboarding(userId, _adminId) {
        // Calculate probation end date (e.g., 3 months from now)
        const startDate = new Date();
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 3);

        const result = await OnboardingRecord.findOneAndUpdate(
            { userId },
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

        // Send welcome email
        try {
            const user = await User.findById(userId);
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
