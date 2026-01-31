const ocrService = require('../services/ocrService');
const logger = require('../config/logger');

class OcrController {
    /**
     * Parse receipt raw text
     * POST /api/ocr/parse
     */
    async parseReceipt(req, res) {
        try {
            const { rawText, source } = req.body;

            if (!rawText) {
                return res.status(400).json({
                    success: false,
                    message: 'rawText is required'
                });
            }

            logger.info(`Processing OCR parse request from source: ${source || 'unknown'}`);
            
            const parsedData = ocrService.parseReceiptText(rawText);

            return res.status(200).json({
                success: true,
                data: parsedData
            });
        } catch (error) {
            logger.error('OCR parsing controller error', {
                error: error.message,
                stack: error.stack
            });
            return res.status(500).json({
                success: false,
                message: 'Internal server error during OCR parsing'
            });
        }
    }
}

module.exports = new OcrController();
