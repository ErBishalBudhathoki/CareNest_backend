/**
 * WebSocket Handler for Real-Time Client Portal
 * Handles real-time communication for live tracking, messaging, and notifications
 */

const realtimeTrackingService = require('../services/realtimeTrackingService');
const messagingService = require('../services/messagingService');

/**
 * Initialize WebSocket handlers
 * @param {Object} io - Socket.io instance
 */
exports.initializeSocketHandlers = (io) => {
  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    // Authentication
    socket.on('authenticate', async (data) => {
      try {
        const { userId, userType, token } = data;
        
        // Verify JWT token (implement your auth logic)
        // For now, just store user info
        socket.userId = userId;
        socket.userType = userType; // 'client', 'worker', 'family'
        
        socket.emit('authenticated', { success: true, userId });
        console.log(`User authenticated: ${userId} (${userType})`);
      } catch (error) {
        socket.emit('authentication-error', { message: error.message });
      }
    });

    // Join appointment room for real-time updates
    socket.on('join-appointment', (data) => {
      const { appointmentId } = data;
      socket.join(`appointment-${appointmentId}`);
      console.log(`Socket ${socket.id} joined appointment-${appointmentId}`);
      
      socket.emit('joined-appointment', { appointmentId });
    });

    // Leave appointment room
    socket.on('leave-appointment', (data) => {
      const { appointmentId } = data;
      socket.leave(`appointment-${appointmentId}`);
      console.log(`Socket ${socket.id} left appointment-${appointmentId}`);
    });

    // Worker location update
    socket.on('location-update', async (data) => {
      try {
        const { appointmentId, latitude, longitude, accuracy, timestamp } = data;
        
        // Save location update
        const locationData = await realtimeTrackingService.updateWorkerLocation({
          appointmentId,
          workerId: socket.userId,
          latitude,
          longitude,
          accuracy,
          timestamp: timestamp || new Date(),
        });

        // Broadcast to all clients watching this appointment
        io.to(`appointment-${appointmentId}`).emit('worker-location', {
          appointmentId,
          latitude,
          longitude,
          accuracy,
          timestamp: locationData.timestamp,
          eta: locationData.eta,
          distance: locationData.distance,
        });

        // Check geofence
        const geofenceEvent = await realtimeTrackingService.checkGeofence({
          appointmentId,
          latitude,
          longitude,
        });

        if (geofenceEvent.triggered) {
          io.to(`appointment-${appointmentId}`).emit('geofence-event', {
            appointmentId,
            event: geofenceEvent.event, // 'approaching', 'arrived', 'departed'
            distance: geofenceEvent.distance,
            timestamp: new Date(),
          });
        }
      } catch (error) {
        console.error('Error handling location update:', error);
        socket.emit('location-update-error', { message: error.message });
      }
    });

    // Appointment status update
    socket.on('status-update', async (data) => {
      try {
        const { appointmentId, status, progress, notes } = data;
        
        // Update appointment status
        const statusData = await realtimeTrackingService.updateAppointmentStatus({
          appointmentId,
          workerId: socket.userId,
          status, // 'scheduled', 'en_route', 'arrived', 'in_progress', 'completed'
          progress, // 0-100
          notes,
          timestamp: new Date(),
        });

        // Broadcast to all clients
        io.to(`appointment-${appointmentId}`).emit('appointment-status', {
          appointmentId,
          status: statusData.status,
          progress: statusData.progress,
          notes: statusData.notes,
          timestamp: statusData.timestamp,
        });
      } catch (error) {
        console.error('Error handling status update:', error);
        socket.emit('status-update-error', { message: error.message });
      }
    });

    // Send message
    socket.on('send-message', async (data) => {
      try {
        const { conversationId, recipientId, message, attachments } = data;
        
        // Save message
        const messageData = await messagingService.sendMessage({
          conversationId,
          senderId: socket.userId,
          senderType: socket.userType,
          recipientId,
          message,
          attachments,
          timestamp: new Date(),
        });

        // Emit to sender (confirmation)
        socket.emit('message-sent', {
          messageId: messageData._id,
          conversationId,
          timestamp: messageData.timestamp,
        });

        // Emit to recipient
        io.to(`user-${recipientId}`).emit('new-message', {
          messageId: messageData._id,
          conversationId,
          senderId: socket.userId,
          senderName: messageData.senderName,
          message: messageData.message,
          attachments: messageData.attachments,
          timestamp: messageData.timestamp,
        });
      } catch (error) {
        console.error('Error sending message:', error);
        socket.emit('message-error', { message: error.message });
      }
    });

    // Typing indicator
    socket.on('typing-start', (data) => {
      const { conversationId, recipientId } = data;
      io.to(`user-${recipientId}`).emit('user-typing', {
        conversationId,
        userId: socket.userId,
      });
    });

    socket.on('typing-stop', (data) => {
      const { conversationId, recipientId } = data;
      io.to(`user-${recipientId}`).emit('user-stopped-typing', {
        conversationId,
        userId: socket.userId,
      });
    });

    // Message read receipt
    socket.on('message-read', async (data) => {
      try {
        const { messageId, conversationId } = data;
        
        await messagingService.markMessageAsRead({
          messageId,
          readBy: socket.userId,
          readAt: new Date(),
        });

        // Notify sender
        io.to(`conversation-${conversationId}`).emit('message-read-receipt', {
          messageId,
          readBy: socket.userId,
          readAt: new Date(),
        });
      } catch (error) {
        console.error('Error marking message as read:', error);
      }
    });

    // Emergency SOS
    socket.on('emergency-sos', async (data) => {
      try {
        const { appointmentId, location, message } = data;
        
        // Create emergency alert
        const alert = await realtimeTrackingService.createEmergencyAlert({
          appointmentId,
          userId: socket.userId,
          userType: socket.userType,
          location,
          message,
          timestamp: new Date(),
        });

        // Broadcast to all relevant parties
        io.to(`appointment-${appointmentId}`).emit('emergency-alert', {
          alertId: alert._id,
          appointmentId,
          userId: socket.userId,
          location,
          message,
          timestamp: alert.timestamp,
        });

        // Also notify organization admins
        io.to('organization-admins').emit('emergency-alert', {
          alertId: alert._id,
          appointmentId,
          userId: socket.userId,
          location,
          message,
          timestamp: alert.timestamp,
        });
      } catch (error) {
        console.error('Error handling emergency SOS:', error);
        socket.emit('sos-error', { message: error.message });
      }
    });

    // Join user room for direct messages
    socket.on('join-user-room', () => {
      if (socket.userId) {
        socket.join(`user-${socket.userId}`);
        console.log(`Socket ${socket.id} joined user-${socket.userId}`);
      }
    });

    // Disconnect
    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
    });
  });

  // Heartbeat to keep connections alive
  setInterval(() => {
    io.emit('heartbeat', { timestamp: new Date() });
  }, 30000); // Every 30 seconds
};

/**
 * Emit event to specific appointment
 * @param {Object} io - Socket.io instance
 * @param {String} appointmentId - Appointment ID
 * @param {String} event - Event name
 * @param {Object} data - Event data
 */
exports.emitToAppointment = (io, appointmentId, event, data) => {
  io.to(`appointment-${appointmentId}`).emit(event, data);
};

/**
 * Emit event to specific user
 * @param {Object} io - Socket.io instance
 * @param {String} userId - User ID
 * @param {String} event - Event name
 * @param {Object} data - Event data
 */
exports.emitToUser = (io, userId, event, data) => {
  io.to(`user-${userId}`).emit(event, data);
};

