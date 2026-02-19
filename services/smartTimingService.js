/**
 * Smart Timing Service
 * ML-optimized notification delivery timing based on user engagement patterns
 */

const logger = require('../config/logger');

class SmartTimingService {
  constructor() {
    // In-memory cache for engagement patterns
    // In production, use Redis or similar
    this.engagementPatterns = new Map();
  }

  /**
   * Get optimal send time for a notification
   * @param {Object} params - Parameters
   * @param {string} params.userId - User ID
   * @param {string} params.category - Notification category
   * @param {string} params.priority - Priority level (low, medium, high, urgent)
   * @param {Object} params.quietHours - Quiet hours configuration
   * @returns {Promise<Object>} Optimal timing recommendation
   */
  async getOptimalSendTime({ userId, category, priority, quietHours }) {
    // Urgent notifications send immediately
    if (priority === 'urgent') {
      return {
        recommendedTime: new Date(),
        confidence: 1.0,
        reason: 'Urgent priority - send immediately',
        delayMinutes: 0
      };
    }

    // Get user engagement pattern
    const pattern = await this.getUserEngagementPattern(userId);

    // Calculate optimal time
    const now = new Date();
    const optimalTime = this.calculateOptimalTime({
      now,
      pattern,
      category,
      priority,
      quietHours
    });

    return {
      recommendedTime: optimalTime.time,
      confidence: optimalTime.confidence,
      reason: optimalTime.reason,
      delayMinutes: Math.round((optimalTime.time - now) / 1000 / 60),
      metadata: {
        currentHour: now.getHours(),
        optimalHour: optimalTime.time.getHours(),
        userEngagementScore: pattern.engagementScore
      }
    };
  }

  /**
   * Record user engagement with a notification
   * @param {Object} params - Engagement data
   * @param {string} params.userId - User ID
   * @param {string} params.category - Notification category
   * @param {Date} params.sentAt - When notification was sent
   * @param {Date} params.readAt - When notification was read (optional)
   * @param {Date} params.actionedAt - When user took action (optional)
   */
  async recordEngagement({ userId, category, sentAt, readAt, actionedAt }) {
    const pattern = await this.getUserEngagementPattern(userId);

    // Update statistics
    pattern.totalNotifications++;

    if (readAt) {
      pattern.readNotifications++;
      const responseTimeMinutes = Math.round((readAt - sentAt) / 1000 / 60);
      
      // Update average response time
      pattern.averageResponseTimeMinutes =
        (pattern.averageResponseTimeMinutes * (pattern.readNotifications - 1) +
          responseTimeMinutes) /
        pattern.readNotifications;

      // Track hourly engagement
      const hour = sentAt.getHours();
      pattern.hourlyEngagement[hour] = (pattern.hourlyEngagement[hour] || 0) + 1;
    }

    if (actionedAt) {
      pattern.actionedNotifications++;
    }

    // Track category-specific engagement
    pattern.categoryEngagement[category] =
      (pattern.categoryEngagement[category] || 0) + 1;

    // Calculate engagement score
    pattern.engagementScore = this.calculateEngagementScore(pattern);

    // Save pattern
    this.engagementPatterns.set(userId, pattern);

    // In production, persist to database
    await this.persistEngagementPattern(userId, pattern);

    logger.info('Recorded notification engagement', {
      userId,
      category,
      responseTimeMinutes: readAt ? Math.round((readAt - sentAt) / 1000 / 60) : null,
      engagementScore: pattern.engagementScore
    });
  }

  /**
   * Get user engagement pattern
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Engagement pattern
   */
  async getUserEngagementPattern(userId) {
    // Check cache
    if (this.engagementPatterns.has(userId)) {
      return this.engagementPatterns.get(userId);
    }

    // In production, fetch from database
    // For now, return default pattern
    const pattern = this.getDefaultPattern(userId);
    this.engagementPatterns.set(userId, pattern);
    return pattern;
  }

  /**
   * Calculate optimal send time
   * @param {Object} params - Calculation parameters
   * @returns {Object} Optimal time result
   */
  calculateOptimalTime({ now, pattern, category, priority, quietHours }) {
    // Find peak engagement hours
    const peakHours = this.findPeakEngagementHours(pattern);

    // Check if we're in quiet hours
    if (quietHours && quietHours.enabled && this.isInQuietHours(now, quietHours)) {
      const quietHoursEnd = this.getQuietHoursEnd(now, quietHours);
      return {
        time: quietHoursEnd,
        confidence: 0.7,
        reason: 'Delayed until quiet hours end'
      };
    }

    // For high priority, send within next peak hour
    if (priority === 'high') {
      const nextPeakHour = this.findNextPeakHour(now, peakHours, quietHours);
      if ((nextPeakHour - now) / 1000 / 60 / 60 < 2) {
        return {
          time: nextPeakHour,
          confidence: 0.85,
          reason: 'Scheduled for next peak engagement hour'
        };
      }
    }

    // For medium/low priority, wait for optimal engagement time
    const optimalHour = this.findOptimalHour(now, peakHours, quietHours);
    return {
      time: optimalHour,
      confidence: 0.9,
      reason: 'Scheduled for optimal engagement time based on user patterns'
    };
  }

  /**
   * Find peak engagement hours from pattern
   * @param {Object} pattern - User engagement pattern
   * @returns {Array<number>} Peak hours (0-23)
   */
  findPeakEngagementHours(pattern) {
    if (Object.keys(pattern.hourlyEngagement).length === 0) {
      // Default peak hours: 9 AM, 12 PM, 6 PM
      return [9, 12, 18];
    }

    // Sort hours by engagement count
    const sortedHours = Object.entries(pattern.hourlyEngagement)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([hour]) => parseInt(hour));

    return sortedHours;
  }

  /**
   * Check if current time is in quiet hours
   * @param {Date} time - Time to check
   * @param {Object} quietHours - Quiet hours configuration
   * @returns {boolean} True if in quiet hours
   */
  isInQuietHours(time, quietHours) {
    if (!quietHours || !quietHours.enabled) return false;

    const dayOfWeek = time.getDay();
    if (quietHours.daysOfWeek && !quietHours.daysOfWeek.includes(dayOfWeek)) {
      return false;
    }

    const [startHour, startMinute] = quietHours.startTime.split(':').map(Number);
    const [endHour, endMinute] = quietHours.endTime.split(':').map(Number);

    const currentMinutes = time.getHours() * 60 + time.getMinutes();
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;

    if (startMinutes < endMinutes) {
      // Same day (e.g., 14:00 - 18:00)
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    } else {
      // Crosses midnight (e.g., 22:00 - 08:00)
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
  }

  /**
   * Get quiet hours end time
   * @param {Date} now - Current time
   * @param {Object} quietHours - Quiet hours configuration
   * @returns {Date} End time
   */
  getQuietHoursEnd(now, quietHours) {
    const [endHour, endMinute] = quietHours.endTime.split(':').map(Number);
    const endTime = new Date(now);
    endTime.setHours(endHour, endMinute, 0, 0);

    // If end time is before current time, it's tomorrow
    if (endTime < now) {
      endTime.setDate(endTime.getDate() + 1);
    }

    return endTime;
  }

  /**
   * Find next peak hour
   * @param {Date} now - Current time
   * @param {Array<number>} peakHours - Peak hours
   * @param {Object} quietHours - Quiet hours configuration
   * @returns {Date} Next peak hour
   */
  findNextPeakHour(now, peakHours, quietHours) {
    for (const hour of peakHours) {
      const candidateTime = new Date(now);
      candidateTime.setHours(hour, 0, 0, 0);

      // If hour has passed today, try tomorrow
      if (candidateTime < now) {
        candidateTime.setDate(candidateTime.getDate() + 1);
      }

      if (!this.isInQuietHours(candidateTime, quietHours)) {
        return candidateTime;
      }
    }

    // Fallback: send in 1 hour
    const fallback = new Date(now);
    fallback.setHours(fallback.getHours() + 1);
    return fallback;
  }

  /**
   * Find optimal hour for sending
   * @param {Date} now - Current time
   * @param {Array<number>} peakHours - Peak hours
   * @param {Object} quietHours - Quiet hours configuration
   * @returns {Date} Optimal time
   */
  findOptimalHour(now, peakHours, quietHours) {
    const nextPeak = this.findNextPeakHour(now, peakHours, quietHours);

    // If next peak is more than 12 hours away, send sooner
    if ((nextPeak - now) / 1000 / 60 / 60 > 12) {
      // Find next non-quiet hour
      let candidateTime = new Date(now);
      candidateTime.setHours(candidateTime.getHours() + 1);

      while (this.isInQuietHours(candidateTime, quietHours)) {
        candidateTime.setHours(candidateTime.getHours() + 1);
      }

      return candidateTime;
    }

    return nextPeak;
  }

  /**
   * Calculate engagement score
   * @param {Object} pattern - Engagement pattern
   * @returns {number} Score (0-100)
   */
  calculateEngagementScore(pattern) {
    if (pattern.totalNotifications === 0) return 50;

    const readRate = pattern.readNotifications / pattern.totalNotifications;
    const actionRate = pattern.actionedNotifications / pattern.totalNotifications;

    // Weighted score: 60% read rate, 40% action rate
    const score = readRate * 60 + actionRate * 40;

    return Math.round(score);
  }

  /**
   * Get default engagement pattern
   * @param {string} userId - User ID
   * @returns {Object} Default pattern
   */
  getDefaultPattern(userId) {
    return {
      userId,
      totalNotifications: 0,
      readNotifications: 0,
      actionedNotifications: 0,
      averageResponseTimeMinutes: 0,
      hourlyEngagement: {
        9: 10,  // 9 AM
        12: 15, // 12 PM
        18: 12  // 6 PM
      },
      categoryEngagement: {},
      engagementScore: 50,
      lastUpdated: new Date()
    };
  }

  /**
   * Persist engagement pattern to database
   * @param {string} userId - User ID
   * @param {Object} pattern - Engagement pattern
   */
  async persistEngagementPattern(userId, pattern) {
    // In production, save to database
    // For now, just log
    logger.debug('Persisting engagement pattern', { userId, pattern });
  }
}

module.exports = new SmartTimingService();
