const { getDatabase } = require('../config/database');
const { ObjectId } = require('mongodb');
const OnboardingRecordSchema = require('../models/OnboardingRecord');
const EmployeeDocumentSchema = require('../models/EmployeeDocument');
const logger = require('../config/logger');
const emailService = require('./emailService');

class OnboardingService {
    
    /**
     * Get or create onboarding status for a user
     */
    static async getOnboardingStatus(userId, organizationId) {
        const db = getDatabase();
        const collection = db.collection('onboarding_records');
        
        let record = await collection.findOne({ userId: new ObjectId(userId) });
        
        if (!record) {
            // Create initial record if it doesn't exist
            const initialRecord = OnboardingRecordSchema.createInitialRecord(
                new ObjectId(userId), 
                new ObjectId(organizationId)
            );
            await collection.insertOne(initialRecord);
            record = initialRecord;
        }
        
        return record;
    }

    /**
     * Update a specific onboarding step
     */
    static async updateStep(userId, stepName, data, currentStep) {
        const db = getDatabase();
        const collection = db.collection('onboarding_records');
        
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

        const result = await collection.findOneAndUpdate(
            { userId: new ObjectId(userId) },
            { $set: updateData },
            { returnDocument: 'after' }
        );
        
        return result.value || result; // handle different mongodb driver versions
    }

    /**
     * Save a document record
     */
    static async saveDocument(docData) {
        const db = getDatabase();
        const docCollection = db.collection('employee_documents');
        const onboardingCollection = db.collection('onboarding_records');
        
        const document = EmployeeDocumentSchema.create({
            ...docData,
            userId: new ObjectId(docData.userId),
            organizationId: new ObjectId(docData.organizationId)
        });
        
        await docCollection.insertOne(document);
        
        // Update document count in onboarding record
        const count = await docCollection.countDocuments({ userId: new ObjectId(docData.userId) });
        
        await onboardingCollection.updateOne(
            { userId: new ObjectId(docData.userId) },
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
        const db = getDatabase();
        return await db.collection('employee_documents')
            .find({ userId: new ObjectId(userId) })
            .toArray();
    }

    /**
     * Delete a document
     */
    static async deleteDocument(docId, userId) {
        const db = getDatabase();
        const docCollection = db.collection('employee_documents');
        const onboardingCollection = db.collection('onboarding_records');
        
        // Ensure the document belongs to the user
        const result = await docCollection.deleteOne({ 
            _id: new ObjectId(docId),
            userId: new ObjectId(userId)
        });
        
        if (result.deletedCount === 0) {
            throw new Error('Document not found or unauthorized');
        }

        // Update document count
        const count = await docCollection.countDocuments({ userId: new ObjectId(userId) });
        
        await onboardingCollection.updateOne(
            { userId: new ObjectId(userId) },
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
        const db = getDatabase();
        const result = await db.collection('onboarding_records').findOneAndUpdate(
            { userId: new ObjectId(userId) },
            { 
                $set: { 
                    status: 'submitted',
                    updatedAt: new Date()
                } 
            },
            { returnDocument: 'after' }
        );

        // Optionally send email to admin (logic to find admin needed)
        // For now we skip admin email to avoid complexity of finding org admins
        
        return result.value || result;
    }

    // --- Admin Methods ---

    /**
     * Get all pending onboardings for an organization
     */
    static async getPendingOnboardings(organizationId) {
        const db = getDatabase();
        // Join with login collection to get names
        return await db.collection('onboarding_records').aggregate([
            { $match: { organizationId: new ObjectId(organizationId) } },
            {
                $lookup: {
                    from: 'login',
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
        ]).toArray();
    }

    /**
     * Verify a document
     */
    static async verifyDocument(docId, status, reason, adminId) {
        const db = getDatabase();
        const updateData = {
            status,
            verifiedAt: new Date(),
            verifiedBy: new ObjectId(adminId)
        };
        
        if (reason) updateData.rejectionReason = reason;

        return await db.collection('employee_documents').findOneAndUpdate(
            { _id: new ObjectId(docId) },
            { $set: updateData },
            { returnDocument: 'after' }
        );
    }

    /**
     * Finalize onboarding
     */
    static async finalizeOnboarding(userId, _adminId) {
        const db = getDatabase();
        
        // Calculate probation end date (e.g., 3 months from now)
        const startDate = new Date();
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 3);

        const result = await db.collection('onboarding_records').findOneAndUpdate(
            { userId: new ObjectId(userId) },
            { 
                $set: { 
                    status: 'completed',
                    updatedAt: new Date(),
                    'probation.startDate': startDate,
                    'probation.endDate': endDate,
                    'probation.status': 'active'
                } 
            },
            { returnDocument: 'after' }
        );

        // Send welcome email
        try {
            const user = await db.collection('login').findOne({ _id: new ObjectId(userId) });
            if (user && user.email) {
                const name = user.firstName ? `${user.firstName} ${user.lastName || ''}` : 'Employee';
                await emailService.sendOnboardingWelcomeEmail(user.email, name);
            }
        } catch (error) {
            logger.error('Failed to send welcome email', error);
        }
        
        return result.value || result;
    }

    /**
     * Check for probation periods ending soon
     * Should be called by a scheduler
     */
    static async checkProbationPeriods() {
        const db = getDatabase();
        const today = new Date();
        const sevenDaysFromNow = new Date();
        sevenDaysFromNow.setDate(today.getDate() + 7);
        
        // Find active probations ending within next 7 days
        const records = await db.collection('onboarding_records').aggregate([
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
        ]).toArray();

        for (const record of records) {
            const daysRemaining = Math.ceil((new Date(record.probation.endDate) - today) / (1000 * 60 * 60 * 24));
            const employeeName = `${record.user.firstName} ${record.user.lastName || ''}`;
            
            // In a real app, we'd find the manager/admin for this organization
            // For now, we'll log it or mock sending to a generic admin email if available
            // notifications.push({ employeeName, daysRemaining, organizationId: record.organizationId });
            
            logger.info(`Probation Reminder: ${employeeName}'s probation ends in ${daysRemaining} days.`);
            
            // Mock email to organization admin (skipping actual lookup for brevity)
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
