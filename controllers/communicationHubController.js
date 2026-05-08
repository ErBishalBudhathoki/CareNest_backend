const communicationHubService = require('../services/communicationHubService');

class CommunicationHubController {
  async sendMessage(req, res) {
    try {
      const result = await communicationHubService.sendMessage(req.body);
      return res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }
  
  async getConversations(req, res) {
    try {
      const { userId } = req.params;
      const result = await communicationHubService.getConversations(userId);
      return res.status(result.success ? 200 : 500).json(result);
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }
  
  async getMessages(req, res) {
    try {
      const { conversationId } = req.params;
      const result = await communicationHubService.getMessages(conversationId);
      return res.status(result.success ? 200 : 500).json(result);
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }
  
  async broadcastMessage(req, res) {
    try {
      const initiatorId = req.user.userId || req.user.id;
      const result = await communicationHubService.broadcastMessage(req.body, initiatorId);
      return res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  async getActiveBroadcasts(req, res) {
    try {
      const organizationId = req.body.organizationId || req.user.organizationId;
      const result = await communicationHubService.getActiveBroadcasts(organizationId);
      return res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  async getBroadcastHistory(req, res) {
    try {
      const organizationId = req.body.organizationId || req.user.organizationId;
      const result = await communicationHubService.getBroadcastHistory(organizationId);
      return res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  async acknowledgeBroadcast(req, res) {
    try {
      const { broadcastId } = req.params;
      const userId = req.body.userId || req.user.userId || req.user.id;
      const result = await communicationHubService.acknowledgeBroadcast(broadcastId, userId);
      return res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }
  
  async scheduleMessage(req, res) {
    try {
      return res.status(200).json({ success: true, message: 'Message scheduled' });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }
  
  async getMessageTemplates(req, res) {
    try {
      return res.status(200).json({ success: true, data: [] });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }
  
  async getMessageStatus(req, res) {
    try {
      return res.status(200).json({ success: true, data: { status: 'delivered' } });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new CommunicationHubController();
