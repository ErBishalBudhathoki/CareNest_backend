const ocrService = require('../services/ocrService');
const logger = require('../config/logger');
const catchAsync = require('../utils/catchAsync');

class OcrController {
    /**
     * Parse receipt raw text
     * POST /api/ocr/parse
     */
    parseReceipt = catchAsync(async (req, res) => {
        const { rawText, source } = req.body;
        const userId = req.user?.id;

        if (!rawText) {
            return res.status(400).json({
                success: false,
                code: 'VALIDATION_ERROR',
                message: 'rawText is required'
            });
        }

        logger.business('OCR Receipt Parse Request', {
            event: 'ocr_parse_request',
            userId,
            source: source || 'unknown',
            textLength: rawText.length,
            timestamp: new Date().toISOString()
        });
        
        const parsedData = ocrService.parseReceiptText(rawText);

        logger.business('OCR Receipt Parse Success', {
            event: 'ocr_parse_success',
            userId,
            merchant: parsedData.merchant,
            totalAmount: parsedData.totalAmount,
            timestamp: new Date().toISOString()
        });

        res.status(200).json({
            success: true,
            code: 'OCR_PARSE_SUCCESS',
            data: parsedData
        });
    });
}

module.exports = new OcrController();
