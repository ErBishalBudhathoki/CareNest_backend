/**
 * Client Portal Service
 * Real-time client/family portal with live updates
 */

class ClientPortalService {
  /**
   * Get client dashboard data
   * @param {string} clientId - Client ID
   * @returns {Object} Dashboard data
   */
  async getClientDashboard(clientId) {
    try {
      // In production, query database for client data
      // For now, return mock dashboard data
      
      const dashboard = {
        clientId,
        clientName: 'John Doe',
        todayAppointments: [
          {
            appointmentId: 'APT-1',
            workerName: 'Jane Smith',
            serviceName: 'Personal Care',
            startTime: '09:00',
            endTime: '11:00',
            status: 'in_progress',
            eta: '5 minutes',
            workerPhoto: null
          }
        ],
        upcomingAppointments: [
          {
            appointmentId: 'APT-2',
            workerName: 'Bob Johnson',
            serviceName: 'Community Access',
            date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            startTime: '14:00',
            endTime: '16:00',
            status: 'scheduled'
          }
        ],
        recentActivity: [
          {
            type: 'service_completed',
            message: 'Personal Care service completed',
            timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
          }
        ],
        notifications: [
          {
            id: 'NOTIF-1',
            type: 'worker_arriving',
            message: 'Your worker is 5 minutes away',
            timestamp: new Date().toISOString(),
            read: false
          }
        ]
      };
      
      return {
        success: true,
        data: dashboard
      };
    } catch (error) {
      console.error('Error getting client dashboard:', error);
      return {
        success: false,
        message: 'Failed to get dashboard',
        error: error.message
      };
    }
  }
  
  /**
   * Get real-time worker location
   * @param {string} appointmentId - Appointment ID
   * @returns {Object} Worker location data
   */
  async getWorkerLocation(appointmentId) {
    try {
      // In production, get real-time location from GPS tracking
      // For now, return mock location data
      
      const location = {
        appointmentId,
        workerName: 'Jane Smith',
        latitude: -33.8688,
        longitude: 151.2093,
        accuracy: 10,
        timestamp: new Date().toISOString(),
        isEnRoute: true,
        eta: '5 minutes',
        distanceRemaining: 1.2, // km
        lastUpdated: new Date().toISOString()
      };
      
      return {
        success: true,
        data: location
      };
    } catch (error) {
      console.error('Error getting worker location:', error);
      return {
        success: false,
        message: 'Failed to get location',
        error: error.message
      };
    }
  }
  
  /**
   * Get appointment status
   * @param {string} appointmentId - Appointment ID
   * @returns {Object} Appointment status
   */
  async getAppointmentStatus(appointmentId) {
    try {
      // In production, query database for appointment status
      // For now, return mock status
      
      const status = {
        appointmentId,
        status: 'in_progress', // scheduled, en_route, arrived, in_progress, completed, cancelled
        workerName: 'Jane Smith',
        serviceName: 'Personal Care',
        startTime: '09:00',
        endTime: '11:00',
        actualStartTime: '09:05',
        actualEndTime: null,
        eta: '5 minutes',
        notes: [],
        photos: [],
        checklistItems: [
          { item: 'Personal hygiene', completed: true },
          { item: 'Medication assistance', completed: false },
          { item: 'Meal preparation', completed: false }
        ],
        lastUpdated: new Date().toISOString()
      };
      
      return {
        success: true,
        data: status
      };
    } catch (error) {
      console.error('Error getting appointment status:', error);
      return {
        success: false,
        message: 'Failed to get status',
        error: error.message
      };
    }
  }
  
  /**
   * Send message to worker
   * @param {Object} messageData - Message data
   * @returns {Object} Send result
   */
  async sendClientMessage(messageData) {
    try {
      const { clientId, workerId, appointmentId, message, messageType } = messageData;
      
      if (!clientId || !workerId || !message) {
        return {
          success: false,
          message: 'Client ID, worker ID, and message are required'
        };
      }
      
      // In production, save message to database and send notification
      // For now, return mock success
      
      const sentMessage = {
        messageId: `MSG-${Date.now()}`,
        clientId,
        workerId,
        appointmentId,
        message,
        messageType: messageType || 'text',
        sentAt: new Date().toISOString(),
        status: 'sent',
        readAt: null
      };
      
      return {
        success: true,
        data: sentMessage
      };
    } catch (error) {
      console.error('Error sending client message:', error);
      return {
        success: false,
        message: 'Failed to send message',
        error: error.message
      };
    }
  }
  
  /**
   * Submit service feedback
   * @param {Object} feedbackData - Feedback data
   * @returns {Object} Submit result
   */
  async submitServiceFeedback(feedbackData) {
    try {
      const { clientId, appointmentId, rating, comments, categories } = feedbackData;
      
      if (!clientId || !appointmentId || !rating) {
        return {
          success: false,
          message: 'Client ID, appointment ID, and rating are required'
        };
      }
      
      // Validate rating (1-5)
      if (rating < 1 || rating > 5) {
        return {
          success: false,
          message: 'Rating must be between 1 and 5'
        };
      }
      
      // In production, save feedback to database
      // For now, return mock success
      
      const feedback = {
        feedbackId: `FEEDBACK-${Date.now()}`,
        clientId,
        appointmentId,
        rating,
        comments: comments || '',
        categories: categories || [],
        submittedAt: new Date().toISOString(),
        status: 'submitted'
      };
      
      return {
        success: true,
        data: feedback
      };
    } catch (error) {
      console.error('Error submitting feedback:', error);
      return {
        success: false,
        message: 'Failed to submit feedback',
        error: error.message
      };
    }
  }
  
  /**
   * Get service history
   * @param {string} clientId - Client ID
   * @param {number} limit - Number of records to return
   * @returns {Object} Service history
   */
  async getServiceHistory(clientId, limit = 10) {
    try {
      // In production, query database for service history
      // For now, return mock history
      
      const history = [];
      for (let i = 0; i < limit; i++) {
        const daysAgo = i + 1;
        const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
        
        history.push({
          appointmentId: `APT-${i + 1}`,
          date: date.toISOString().split('T')[0],
          workerName: i % 2 === 0 ? 'Jane Smith' : 'Bob Johnson',
          serviceName: i % 3 === 0 ? 'Personal Care' : i % 3 === 1 ? 'Community Access' : 'Domestic Assistance',
          startTime: '09:00',
          endTime: '11:00',
          duration: 120, // minutes
          status: 'completed',
          rating: Math.floor(Math.random() * 2) + 4, // 4 or 5
          notes: 'Service completed successfully',
          photos: []
        });
      }
      
      return {
        success: true,
        data: {
          clientId,
          totalRecords: history.length,
          history
        }
      };
    } catch (error) {
      console.error('Error getting service history:', error);
      return {
        success: false,
        message: 'Failed to get history',
        error: error.message
      };
    }
  }
}

module.exports = new ClientPortalService();
