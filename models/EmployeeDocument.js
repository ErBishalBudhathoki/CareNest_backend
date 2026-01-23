/**
 * Employee Document Model Schema
 * Represents a document uploaded by an employee during onboarding or compliance checks
 */

class EmployeeDocumentSchema {
    /**
     * Validate document data
     * @param {Object} data 
     * @returns {Object} { isValid: boolean, errors: string[] }
     */
    static validate(data) {
        const errors = [];

        if (!data.userId) errors.push('userId is required');
        if (!data.organizationId) errors.push('organizationId is required');
        if (!data.type) errors.push('Document type is required');
        if (!data.fileUrl) errors.push('File URL is required');

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Create a new document record structure
     */
    static create(data) {
        return {
            userId: data.userId, // ObjectId
            organizationId: data.organizationId, // ObjectId
            type: data.type, // passport, drivers_license, first_aid, ndis_screening, other
            documentNumber: data.documentNumber || null,
            fileUrl: data.fileUrl,
            expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
            status: 'pending', // pending, verified, rejected
            rejectionReason: null,
            uploadedAt: new Date(),
            verifiedAt: null,
            verifiedBy: null
        };
    }
}

module.exports = EmployeeDocumentSchema;
