const VoiceService = require('../services/voiceService');

class VoiceController {
  async processCommand(req, res) {
    try {
      const userId = req.user.userId;
      const { audioData, language } = req.body;
      
      const result = await VoiceService.processCommand(userId, audioData, language);
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new VoiceController();
