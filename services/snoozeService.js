const SnoozeRule = require('../models/SnoozeRule');

class SnoozeService {
  async createRule(userId, ruleData) {
    return await SnoozeRule.create({
      userId,
      ...ruleData
    });
  }

  async getRules(userId) {
    return await SnoozeRule.find({ userId, isActive: true });
  }

  async evaluateSnooze(userId, notification) {
    const rules = await this.getRules(userId);
    
    for (const rule of rules) {
      if (this._matchesCondition(rule.conditions, notification)) {
        // Increment metrics
        await SnoozeRule.findByIdAndUpdate(rule._id, {
          $inc: { 'performanceMetrics.timesTriggered': 1 },
          'performanceMetrics.lastTriggered': new Date()
        });

        return {
          shouldSnooze: true,
          duration: rule.actions.snoozeDuration,
          ruleName: rule.name
        };
      }
    }

    // AI Suggestion if no rule matches
    if (notification.type === 'expense' && notification.content.includes('receipt')) {
      return {
        shouldSnooze: false, // Don't auto snooze, but suggest it
        suggestion: {
          duration: 120, // 2 hours
          reason: 'Users typically snooze receipt reminders until evening'
        }
      };
    }

    return { shouldSnooze: false };
  }

  _matchesCondition(conditions, notification) {
    // Simple matching logic
    if (conditions.get('type') && conditions.get('type') !== notification.type) return false;
    if (conditions.get('sender') && !notification.sender.includes(conditions.get('sender'))) return false;
    // Add more complex matching here
    return true;
  }
}

module.exports = new SnoozeService();
