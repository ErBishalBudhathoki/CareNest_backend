const OnboardingService = require('../services/onboardingService');
const logger = require('../config/logger');

class OnboardingController {

    static async getStatus(req, res) {
        try {
            const { userId, organizationId } = req.user;
            const status = await OnboardingService.getOnboardingStatus(userId, organizationId);
            res.json({ success: true, data: status });
        } catch (error) {
            logger.error('Error getting onboarding status', error);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    }

    static async updateStep(req, res) {
        try {
            const { userId } = req.user;
            const { stepName } = req.params;
            const stepData = req.body;

            const allowedSteps = ['personalDetails', 'bankDetails', 'taxDetails', 'superannuation'];
            if (!allowedSteps.includes(stepName)) {
                return res.status(400).json({ success: false, message: 'Invalid step name' });
            }

            // Extract currentStep if provided to update progress
            const { currentStep, ...data } = stepData;

            const updatedRecord = await OnboardingService.updateStep(userId, stepName, data, currentStep);
            res.json({ success: true, data: updatedRecord });
        } catch (error) {
            logger.error('Error updating onboarding step', error);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    }

    static async handleFileUpload(req, res) {
        try {
            if (!req.file) {
                return res.status(400).json({ success: false, message: 'No file uploaded' });
            }

            // Construct file URL based on storage type (local vs R2)
            let fileUrl;
            if (req.file.location) {
                // S3/R2 upload
                fileUrl = req.file.location;
            } else {
                // Local upload
                const protocol = req.secure ? 'https' : 'http';
                const host = req.get('host');
                fileUrl = `${protocol}://${host}/uploads/${req.file.filename}`;
            }

            res.json({ 
                success: true, 
                data: { 
                    url: fileUrl,
                    filename: req.file.originalname,
                    mimetype: req.file.mimetype
                } 
            });
        } catch (error) {
            logger.error('Error handling file upload', error);
            res.status(500).json({ success: false, message: 'Server error during upload' });
        }
    }

    static async uploadDocument(req, res) {
        try {
            const { userId, organizationId } = req.user;
            const { type, fileUrl, expiryDate, documentNumber } = req.body;

            if (!type || !fileUrl) {
                return res.status(400).json({ success: false, message: 'Type and File URL are required' });
            }

            const doc = await OnboardingService.saveDocument({
                userId,
                organizationId,
                type,
                fileUrl,
                expiryDate,
                documentNumber
            });

            res.json({ success: true, data: doc });
        } catch (error) {
            logger.error('Error uploading document', error);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    }

    static async getDocuments(req, res) {
        try {
            const { userId } = req.user;
            const docs = await OnboardingService.getUserDocuments(userId);
            res.json({ success: true, data: docs });
        } catch (error) {
            logger.error('Error fetching documents', error);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    }

    static async deleteDocument(req, res) {
        try {
            const { userId } = req.user;
            const { docId } = req.params;

            await OnboardingService.deleteDocument(docId, userId);
            res.json({ success: true, message: 'Document deleted successfully' });
        } catch (error) {
            logger.error('Error deleting document', error);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    }

    static async submitOnboarding(req, res) {
        try {
            const { userId } = req.user;
            const result = await OnboardingService.submitOnboarding(userId);
            res.json({ success: true, data: result });
        } catch (error) {
            logger.error('Error submitting onboarding', error);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    }

    // --- Admin Endpoints ---

    static async getPendingOnboardings(req, res) {
        try {
            const { organizationId } = req.user;
            
            if (!organizationId) {
                return res.status(400).json({ success: false, message: 'Organization ID not found for user' });
            }

            // Ensure user is admin (this check should also be in middleware/RBAC)
            
            const records = await OnboardingService.getPendingOnboardings(organizationId);
            res.json({ success: true, data: records });
        } catch (error) {
            logger.error('Error fetching pending onboardings', error);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    }

    static async getAdminDocuments(req, res) {
        try {
            const { userId } = req.params;
            const docs = await OnboardingService.getUserDocuments(userId);
            res.json({ success: true, data: docs });
        } catch (error) {
            logger.error('Error fetching user documents for admin', error);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    }

    static async verifyDocument(req, res) {
        try {
            const { userId: adminId } = req.user;
            const { docId } = req.params;
            const { status, reason } = req.body; // status: 'verified' | 'rejected'

            if (!['verified', 'rejected'].includes(status)) {
                return res.status(400).json({ success: false, message: 'Invalid status' });
            }

            const doc = await OnboardingService.verifyDocument(docId, status, reason, adminId);
            res.json({ success: true, data: doc });
        } catch (error) {
            logger.error('Error verifying document', error);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    }

    static async finalizeOnboarding(req, res) {
        try {
            const { userId: adminId } = req.user;
            const { userId } = req.params;

            const result = await OnboardingService.finalizeOnboarding(userId, adminId);
            
            res.json({ success: true, data: result });
        } catch (error) {
            logger.error('Error finalizing onboarding', error);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    }

    static async checkProbationStatus(req, res) {
        try {
            // This endpoint might be protected or internal only
            const result = await OnboardingService.checkProbationPeriods();
            res.json({ success: true, data: result });
        } catch (error) {
            logger.error('Error checking probation status', error);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    }
}

module.exports = OnboardingController;
