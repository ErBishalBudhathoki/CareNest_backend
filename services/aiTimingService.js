const TimingPrediction = require('../models/TimingPrediction');
const NotificationHistory = require('../models/NotificationHistory');

class AiTimingService {
  /**
   * Predict the optimal delivery time for a notification
   * Simulates XGBoost regression logic
   */
  async predictOptimalTime(notificationData, userContext) {
    // 1. Feature Extraction (Simplified)
    const urgencyScore = this._calculateUrgency(notificationData.content);
    const userStress = userContext.stressLevel === 'high' ? 1.0 : 0.5;
    const isFocusTime = userContext.currentActivity === 'focus_work';
    
    // 2. Heuristic Logic (Simulating Model Inference)
    let delayMinutes = 0;

    if (urgencyScore > 0.8) {
      // Urgent: Deliver immediately
      delayMinutes = 0;
    } else if (isFocusTime) {
      // Focus time: Delay until break (e.g., 50 mins from now or next free slot)
      delayMinutes = 60; 
    } else if (userStress > 0.8) {
      // High stress: Delay non-urgent messages
      delayMinutes = 30;
    } else {
      // Normal: Immediate or slight optimization
      delayMinutes = 5;
    }

    const predictedTime = new Date(Date.now() + delayMinutes * 60000);
    const confidenceScore = 0.85 + (Math.random() * 0.1); // Mock confidence 0.85-0.95

    // 3. Save Prediction
    // We assume notificationId is passed or we create a placeholder if it's a pre-check
    // For this service, we just return the calculation, saving happens in controller if needed
    
    return {
      predictedTime,
      confidenceScore,
      reasoning: {
        urgencyScore,
        isFocusTime,
        userStress
      },
      alternativeTimes: [
        { time: new Date(Date.now() + (delayMinutes + 30) * 60000), score: confidenceScore - 0.1 }
      ]
    };
  }

  _calculateUrgency(content) {
    const keywords = ['urgent', 'asap', 'deadline', 'emergency', 'critical'];
    const text = (content.title + ' ' + content.body).toLowerCase();
    let score = 0.1;

    keywords.forEach(word => {
      if (text.includes(word)) score += 0.2;
    });

    return Math.min(score, 1.0);
  }

  async recordFeedback(notificationId, engaged, engagementType) {
    // In a real system, this feeds back into the model training pipeline
    console.log(`[AI Model] Received feedback for ${notificationId}: ${engaged ? 'Engaged' : 'Ignored'} (${engagementType})`);
    return true;
  }
}

module.exports = new AiTimingService();
