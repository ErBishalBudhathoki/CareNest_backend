/**
 * Onboarding Record Model Schema
 * Represents the onboarding state and progress of an employee
 */

class OnboardingRecordSchema {
    /**
     * Validate onboarding record data
     * @param {Object} data 
     * @returns {Object} { isValid: boolean, errors: string[] }
     */
    static validate(data) {
        const errors = [];

        if (!data.userId) {
            errors.push('userId is required');
        }

        if (!data.organizationId) {
            errors.push('organizationId is required');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Create a new onboarding record structure
     * @param {string} userId 
     * @param {string} organizationId 
     * @returns {Object} Initial onboarding record
     */
    static createInitialRecord(userId, organizationId) {
        return {
            userId: userId, // ObjectId
            organizationId: organizationId, // ObjectId
            status: 'pending', // pending, submitted, changes_requested, completed
            currentStep: 1,
            steps: {
                personalDetails: { status: 'pending', updatedAt: null },
                bankDetails: { status: 'pending', updatedAt: null },
                taxDetails: { 
                    status: 'pending',
                    tfn: null, 
                    taxScale: null,
                    updatedAt: null 
                },
                superannuation: { 
                    status: 'pending',
                    fundName: null,
                    memberNumber: null,
                    usi: null,
                    updatedAt: null 
                },
                documents: { status: 'pending', count: 0 }
            },
            probation: {
                startDate: null,
                endDate: null,
                reviewDate: null,
                status: 'active' // active, passed, extended, failed
            },
            createdAt: new Date(),
            updatedAt: new Date()
        };
    }
}

module.exports = OnboardingRecordSchema;
