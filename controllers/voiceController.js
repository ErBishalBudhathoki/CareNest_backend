const VoiceService = require('../services/voiceService');
const catchAsync = require('../utils/catchAsync');
const logger = require('../utils/logger');

class VoiceController {
  /**
   * Process a voice command (audio or text)
   * @route POST /api/voice/command
   */
  processCommand = catchAsync(async (req, res) => {
    const userId = req.user?.id || req.user?.userId || req.user?._id;
    const { audioData, commandText, language, context } = req.body;

    // Log request
    logger.info(`Voice command received from user ${userId}`, { language, hasAudio: !!audioData, hasText: !!commandText });

    let result;
    if (audioData) {
      result = await VoiceService.processAudio(req.user, audioData, language);
    } else if (commandText) {
      result = await VoiceService.processText(
        req.user,
        commandText,
        language,
        context
      );
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
    const userId = req.user?.id || req.user?.userId || req.user?._id;
    const { limit = 20, page = 1 } = req.query;
    const history = await VoiceService.getHistory(req.user, {
      limit,
      page,
    });

    res.status(200).json({
      success: true,
      code: 'HISTORY_FETCHED',
      data: history
    });
  });
}

module.exports = new VoiceController();
