const VoiceService = require('../services/voiceService');
const catchAsync = require('../utils/catchAsync');
const logger = require('../utils/logger');
const VoiceCommand = require('../models/VoiceCommand');

class VoiceController {
  /**
   * Process a voice command (audio or text)
   * @route POST /api/voice/command
   */
  processCommand = catchAsync(async (req, res) => {
    const userId = req.user.id; // Corrected from req.user.userId (standard middleware sets req.user.id)
    const { audioData, commandText, language } = req.body;

    // Log request
    logger.info(`Voice command received from user ${userId}`, { language, hasAudio: !!audioData, hasText: !!commandText });

    let result;
    if (audioData) {
      result = await VoiceService.processAudio(userId, audioData, language);
    } else if (commandText) {
      result = await VoiceService.processText(userId, commandText, language);
    } else {
      return res.status(400).json({
        success: false,
        code: 'MISSING_INPUT',
        message: 'Either audioData or commandText is required'
      });
    }

    res.status(200).json({
      success: true,
      code: 'COMMAND_PROCESSED',
      data: result
    });
  });

  /**
   * Get voice command history
   * @route GET /api/voice/history
   */
  getHistory = catchAsync(async (req, res) => {
    const userId = req.user.id;
    const { limit = 20, page = 1 } = req.query;

    const skip = (page - 1) * limit;

    const history = await VoiceCommand.find({ userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean(); // Use lean for performance

    res.status(200).json({
      success: true,
      code: 'HISTORY_FETCHED',
      data: history // Mongoose lean docs might need manual ID transform if not using global plugin
      // But our schema toJSON handles it for instances. For lean queries, we might need manual transform or rely on frontend handling both _id and id.
      // Ideally, avoid lean() if relying on schema toJSON, or manually map.
      // Let's rely on schema toJSON for consistency and remove lean() or map manually.
      // Removing lean() to ensure virtuals/transforms run.
    });
  });
}

module.exports = new VoiceController();
