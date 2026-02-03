const OnboardingService = require('../services/onboardingService');
const logger = require('../config/logger');
const catchAsync = require('../utils/catchAsync');
const { ObjectId } = require('mongodb');

class OnboardingController {

    static getStatus = catchAsync(async (req, res) => {
        const { userId, organizationId } = req.user;
        const uid = userId || req.user.id;
        const orgId = organizationId || req.user.organizationId;
        
        const status = await OnboardingService.getOnboardingStatus(uid, orgId);
        
        logger.business('Onboarding Status Retrieved', {
            event: 'onboarding_status_retrieved',
            userId: uid,
            organizationId: orgId,
            status: status?.status,
            timestamp: new Date().toISOString()
        });
        
        res.json({ success: true, data: status });
    });

    static updateStep = catchAsync(async (req, res) => {
        const { userId } = req.user;
        const uid = userId || req.user.id;
        const { stepName } = req.params;
        const stepData = req.body;

        const allowedSteps = ['personalDetails', 'bankDetails', 'taxDetails', 'superannuation'];
        if (!allowedSteps.includes(stepName)) {
            return res.status(400).json({ success: false, code: 'INVALID_STEP', message: 'Invalid step name' });
        }

        const { currentStep, ...data } = stepData;

        const updatedRecord = await OnboardingService.updateStep(uid, stepName, data, currentStep);
        
        logger.business('Onboarding Step Updated', {
            event: 'onboarding_step_updated',
            userId: uid,
            stepName,
            currentStep,
            timestamp: new Date().toISOString()
        });
        
        res.json({ success: true, code: 'STEP_UPDATED', data: updatedRecord });
    });

    static handleFileUpload = catchAsync(async (req, res) => {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        let fileUrl;
        if (req.file.location) {
            fileUrl = req.file.location;
        } else {
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
    });

    static uploadDocument = catchAsync(async (req, res) => {
        const { userId, organizationId } = req.user;
        const uid = userId || req.user.id;
        const orgId = organizationId || req.user.organizationId;
        
        const { type, fileUrl, expiryDate, documentNumber } = req.body;

        if (!type || !fileUrl) {
            return res.status(400).json({ success: false, message: 'Type and File URL are required' });
        }

        const doc = await OnboardingService.saveDocument({
            userId: uid,
            organizationId: orgId,
            type,
            fileUrl,
            expiryDate: expiryDate ? new Date(expiryDate) : null,
            documentNumber
        });

        res.json({ success: true, data: doc });
    });

    static getDocuments = catchAsync(async (req, res) => {
        const { userId } = req.user;
        const uid = userId || req.user.id;
        
        const docs = await OnboardingService.getUserDocuments(uid);
        res.json({ success: true, data: docs });
    });

    static deleteDocument = catchAsync(async (req, res) => {
        const { userId } = req.user;
        const uid = userId || req.user.id;
        const { docId } = req.params;

        await OnboardingService.deleteDocument(docId, uid);
        res.json({ success: true, message: 'Document deleted successfully' });
    });

    static submitOnboarding = catchAsync(async (req, res) => {
        const { userId, organizationId } = req.user;
        const uid = userId || req.user.id;
        const orgId = organizationId || req.user.organizationId;
        
        const result = await OnboardingService.submitOnboarding(uid);
        
        logger.business('Onboarding Submitted', {
            event: 'onboarding_submitted',
            userId: uid,
            organizationId: orgId,
            timestamp: new Date().toISOString()
        });
        
        res.json({ success: true, code: 'ONBOARDING_SUBMITTED', data: result });
    });

    // --- Admin Endpoints ---

    static getPendingOnboardings = catchAsync(async (req, res) => {
        const { organizationId } = req.user;
        const orgId = organizationId || req.user.organizationId;
        
        if (!orgId) {
            return res.status(400).json({ success: false, message: 'Organization ID not found for user' });
        }

        // if (!ObjectId.isValid(orgId)) { ... } // Org ID in OnboardingRecord is String in our new schema, so no ObjectId check

        const records = await OnboardingService.getPendingOnboardings(orgId);
        res.json({ success: true, data: records });
    });

    static getAdminDocuments = catchAsync(async (req, res) => {
        const { userId } = req.params;
        const docs = await OnboardingService.getUserDocuments(userId);
        res.json({ success: true, data: docs });
    });

    static verifyDocument = catchAsync(async (req, res) => {
        const adminId = req.user.id;
        const { docId } = req.params;
        const { status, reason } = req.body;

        if (!ObjectId.isValid(docId)) {
            return res.status(400).json({ success: false, message: 'Invalid Document ID format' });
        }

        if (!['verified', 'rejected'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        const doc = await OnboardingService.verifyDocument(docId, status, reason, adminId);
        res.json({ success: true, data: doc });
    });

    static finalizeOnboarding = catchAsync(async (req, res) => {
        const adminId = req.user.id;
        const { userId } = req.params;

        if (!ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, code: 'INVALID_USER_ID', message: 'Invalid User ID format' });
        }

        const result = await OnboardingService.finalizeOnboarding(userId, adminId);
        
        logger.business('Onboarding Finalized', {
            event: 'onboarding_finalized',
            userId,
            adminId,
            timestamp: new Date().toISOString()
        });
        
        res.json({ success: true, code: 'ONBOARDING_FINALIZED', data: result });
    });

    static checkProbationStatus = catchAsync(async (req, res) => {
        const result = await OnboardingService.checkProbationPeriods();
        res.json({ success: true, data: result });
    });
}

module.exports = OnboardingController;
