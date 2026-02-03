const PublicHoliday = require('../models/PublicHoliday');
const logger = require('../config/logger');
const catchAsync = require('../utils/catchAsync');
const { ObjectId } = require('mongodb');
const https = require('https');
const csv = require('csv-parser');

class HolidayController {
  /**
   * Get all holidays
   * GET /api/holidays
   */
  getAllHolidays = catchAsync(async (req, res) => {
    const { organizationId } = req.query;
    
    // Build query: get public holidays (no org) + org-specific holidays
    const query = {
      $or: [
        { organizationId: { $exists: false } },
        { organizationId: null },
        ...(organizationId ? [{ organizationId }] : [])
      ]
    };
    
    const holidays = await PublicHoliday.find(query).sort({ date: 1 });
    
    logger.business('Holidays Retrieved', {
      event: 'holidays_retrieved',
      organizationId,
      count: holidays.length,
      timestamp: new Date().toISOString()
    });
    
    res.status(200).json({
      success: true,
      code: 'HOLIDAYS_RETRIEVED',
      data: holidays
    });
  });

  /**
   * Upload CSV data from GitHub to MongoDB
   * POST /api/holidays/upload-csv
   */
  uploadCSV = catchAsync(async (req, res) => {
    const csvUrl = "https://raw.githubusercontent.com/BishalBudhathoki/backend_rest_api/main/holiday.csv";
    
    // Create a promise to handle the CSV parsing
    const holidaysPromise = new Promise((resolve, reject) => {
      const holidays = [];
      
      https.get(csvUrl, (response) => {
        if (response.statusCode !== 200) {
          return reject(new Error(`Failed to fetch CSV: ${response.statusCode}`));
        }
        
        response
          .pipe(csv())
          .on("data", (data) => {
            // Replace null bytes in the keys for security
            const updatedData = {};
            Object.keys(data).forEach((key) => {
              const updatedKey = key.replace(/\0/g, "_");
              updatedData[updatedKey] = data[key];
            });
            holidays.push(updatedData);
          })
          .on("end", () => {
            if (holidays.length === 0) {
              return reject(new Error("No rows in CSV file"));
            }
            resolve(holidays);
          })
          .on("error", (err) => reject(err));
      }).on("error", (err) => reject(err));
    });
    
    const holidays = await holidaysPromise;
    
    // Clear existing and insert new
    await PublicHoliday.deleteMany({});
    const result = await PublicHoliday.insertMany(holidays.map(h => ({
      name: h.Holiday || h.name,
      date: h.Date || h.date,
      day: h.Day || h.day,
      isCustom: false
    })));
    
    logger.business('Holiday CSV Uploaded', {
      event: 'holiday_csv_uploaded',
      count: result.length,
      timestamp: new Date().toISOString()
    });
    
    res.status(200).json({
      success: true,
      code: 'CSV_UPLOADED',
      message: 'Upload successful',
      count: result.length
    });
  });

  /**
   * Delete a holiday by ID
   * DELETE /api/holidays/:id
   */
  deleteHoliday = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Invalid holiday ID format'
      });
    }
    
    const result = await PublicHoliday.findByIdAndDelete(id);
    
    if (!result) {
      return res.status(404).json({
        success: false,
        code: 'HOLIDAY_NOT_FOUND',
        message: 'Holiday not found'
      });
    }
    
    logger.business('Holiday Deleted', {
      event: 'holiday_deleted',
      holidayId: id,
      timestamp: new Date().toISOString()
    });
    
    res.status(200).json({
      success: true,
      code: 'HOLIDAY_DELETED',
      message: 'Delete successful'
    });
  });

  /**
   * Add a new holiday
   * POST /api/holidays
   */
  addHoliday = catchAsync(async (req, res) => {
    const { name, date, day, organizationId, state } = req.body;
    
    // Check if holiday already exists on the same date
    const existingHoliday = await PublicHoliday.findOne({ 
      date,
      ...(organizationId ? { organizationId } : {})
    });
    
    if (existingHoliday) {
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_HOLIDAY',
        message: 'A holiday already exists on this date'
      });
    }
    
    const holiday = await PublicHoliday.create({
      name,
      date,
      day,
      organizationId: organizationId || null,
      state: state || null,
      isCustom: true
    });
    
    logger.business('Holiday Added', {
      event: 'holiday_added',
      holidayId: holiday._id.toString(),
      organizationId,
      timestamp: new Date().toISOString()
    });
    
    res.status(201).json({
      success: true,
      code: 'HOLIDAY_ADDED',
      message: 'Holiday item added successfully',
      data: holiday
    });
  });

  /**
   * Check if dates are holidays
   * POST /api/holidays/check
   */
  checkHolidays = catchAsync(async (req, res) => {
    const { dates } = req.body; // Array of dates
    
    if (!dates || !Array.isArray(dates)) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'dates array is required'
      });
    }
    
    // Find holidays matching the dates
    const holidays = await PublicHoliday.find({ date: { $in: dates } });
    
    // Create result array with status for each date
    const results = dates.map(date => ({
      date,
      isHoliday: holidays.some(h => h.date === date),
      holidayName: holidays.find(h => h.date === date)?.name || null
    }));
    
    logger.business('Holidays Checked', {
      event: 'holidays_checked',
      dateCount: dates.length,
      timestamp: new Date().toISOString()
    });
    
    res.status(200).json({
      success: true,
      code: 'HOLIDAYS_CHECKED',
      data: results
    });
  });
}

module.exports = new HolidayController();
