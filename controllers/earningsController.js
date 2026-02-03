const earningsService = require('../services/earningsService');
const logger = require('../config/logger');
const catchAsync = require('../utils/catchAsync');

class EarningsController {
  getEarningsSummary = catchAsync(async (req, res) => {
    const { userEmail } = req.params;
    const { startDate, endDate } = req.query;

    if (!userEmail) {
      return res.status(400).json({ success: false, message: 'User email is required' });
    }

    const data = await earningsService.getEarningsSummary(userEmail, startDate, endDate);
    res.status(200).json({ success: true, data });
  });

  getProjectedEarnings = catchAsync(async (req, res) => {
    const { userEmail } = req.params;
    const { startDate } = req.query;

    if (!userEmail) {
      return res.status(400).json({ success: false, message: 'User email is required' });
    }

    const data = await earningsService.getProjectedEarnings(userEmail, startDate);
    res.status(200).json({ success: true, data });
  });

  getEarningsHistory = catchAsync(async (req, res) => {
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
  });
  
  setPayRate = catchAsync(async (req, res) => {
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
  });

  getQuarterlyOTE = catchAsync(async (req, res) => {
    const { userEmail } = req.params;
    const { date } = req.query;

    if (!userEmail) {
      return res.status(400).json({ success: false, message: 'User email is required' });
    }

    const data = await earningsService.getQuarterlyOTE(userEmail, date);
    res.status(200).json({ success: true, data });
  });
}

module.exports = new EarningsController();
