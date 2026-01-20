const earningsService = require('../services/earningsService');
const logger = require('../config/logger');

class EarningsController {
  async getEarningsSummary(req, res) {
    try {
      const { userEmail } = req.params; // Or from req.user if using middleware
      const { startDate, endDate } = req.query;

      if (!userEmail) {
        return res.status(400).json({ success: false, message: 'User email is required' });
      }

      const data = await earningsService.getEarningsSummary(userEmail, startDate, endDate);
      res.status(200).json({ success: true, data });
    } catch (error) {
      logger.error('Error fetching earnings summary', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getProjectedEarnings(req, res) {
    try {
      const { userEmail } = req.params;
      const { startDate } = req.query;

      if (!userEmail) {
        return res.status(400).json({ success: false, message: 'User email is required' });
      }

      const data = await earningsService.getProjectedEarnings(userEmail, startDate);
      res.status(200).json({ success: true, data });
    } catch (error) {
      logger.error('Error fetching projected earnings', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getEarningsHistory(req, res) {
    try {
      const { userEmail } = req.params;
      const { startDate, endDate, bucket } = req.query;

      if (!userEmail) {
        return res
          .status(400)
          .json({ success: false, message: 'User email is required' });
      }

      const data = await earningsService.getEarningsHistory(
        userEmail,
        startDate,
        endDate,
        bucket
      );
      res.status(200).json({ success: true, data });
    } catch (error) {
      logger.error('Error fetching earnings history', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
  
  async setPayRate(req, res) {
      try {
          const { userEmail } = req.params;
          const { rate, type, rates, classificationLevel, payPoint, stream, employmentType, activeAllowances, dob } = req.body;
          
          if (!rate) {
               return res.status(400).json({ success: false, message: 'Rate is required' });
          }
          
          const success = await earningsService.setPayRate(
            userEmail, 
            rate, 
            type, 
            rates, 
            classificationLevel, 
            payPoint,
            stream,
            employmentType,
            activeAllowances,
            dob
          );
          if (success) {
              res.status(200).json({ success: true, message: 'Pay rate updated' });
          } else {
              res.status(404).json({ success: false, message: 'User not found' });
          }
      } catch (error) {
          logger.error('Error setting pay rate', error);
          res.status(500).json({ success: false, message: error.message });
      }
  }

  async getQuarterlyOTE(req, res) {
    try {
      const { userEmail } = req.params;
      const { date } = req.query;

      if (!userEmail) {
        return res.status(400).json({ success: false, message: 'User email is required' });
      }

      const data = await earningsService.getQuarterlyOTE(userEmail, date);
      res.status(200).json({ success: true, data });
    } catch (error) {
      logger.error('Error fetching quarterly OTE', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new EarningsController();
