const VoiceCommand = require('../models/VoiceCommand');

class VoiceService {
  async processCommand(userId, audioData, language) {
    // Mock Speech-to-Text and NLP
    // In a real app, this would call Google Speech API or OpenAI Whisper
    
    const mockTranscriptions = {
      'en-US': "Snooze all notifications for 2 hours",
      'es-ES': "Silenciar notificaciones por 2 horas"
    };

    const commandText = mockTranscriptions[language] || "Unknown command";
    
    // Intent Recognition (Regex/Heuristic for now)
    let intent = 'unknown';
    let parameters = {};
    let success = false;

    if (commandText.toLowerCase().includes('snooze')) {
      intent = 'snooze_all';
      parameters = { duration: 120 }; // extracted "2 hours"
      success = true;
    } else if (commandText.toLowerCase().includes('urgent')) {
      intent = 'read_urgent';
      success = true;
    }

    // Save history
    await VoiceCommand.create({
      userId,
      commandText,
      language,
      nlpEntities: { intent, parameters },
      success
    });

    return {
      text: commandText,
      intent,
      parameters,
      success
    };
  }
}

module.exports = new VoiceService();
