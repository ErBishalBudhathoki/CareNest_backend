const { MongoClient, ServerApiVersion } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const uri = process.env.MONGODB_URI;

class EarningsService {
  constructor() {
    this.client = null;
  }

  async connect() {
    if (!this.client) {
      this.client = new MongoClient(uri, { serverApi: ServerApiVersion.v1, tls: true, family: 4 });
      await this.client.connect();
    }
    return this.client.db('Invoice');
  }

  // Helper: Parse "HH:MM:SS" to decimal hours
  parseDurationToHours(timeString) {
    if (!timeString) return 0;
    const parts = timeString.split(':').map(Number);
    if (parts.length !== 3) return 0;
    return parts[0] + (parts[1] / 60) + (parts[2] / 3600);
  }

  // Helper: Parse "9:00 AM" to minutes from midnight
  parseTimeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const [time, period] = timeStr.split(' ');
    let [hours, minutes] = time.split(':').map(Number);
    
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    
    return (hours * 60) + minutes;
  }

  // Helper: Calculate duration between two time strings (e.g. "9:00 AM", "5:00 PM") in hours
  calculateShiftDuration(startStr, endStr, breakStr) {
    if (!startStr || !endStr) return 0;
    
    const startMinutes = this.parseTimeToMinutes(startStr);
    const endMinutes = this.parseTimeToMinutes(endStr);
    
    let durationMinutes = endMinutes - startMinutes;
    if (durationMinutes < 0) durationMinutes += 24 * 60; // Handle overnight? Unlikely for this app context but good to have
    
    // Deduct break if any (assuming "No", "30 mins", "1 hour")
    if (breakStr && breakStr !== 'No') {
      if (breakStr.includes('min')) {
        const breakMins = parseInt(breakStr) || 0;
        durationMinutes -= breakMins;
      } else if (breakStr.includes('hour')) {
        const breakHours = parseFloat(breakStr) || 0;
        durationMinutes -= (breakHours * 60);
      }
    }
    
    return Math.max(0, durationMinutes / 60);
  }

  async getEarningsSummary(userEmail, startDate, endDate) {
    const db = await this.connect();

    // 1. Get User Pay Rate
    const user = await db.collection('login').findOne({ email: userEmail });
    const payRate = user?.payRate || 0;
    const payType = user?.payType || 'Hourly';

    // 2. Get Worked Time Records
    // Assuming shiftDate is stored as "YYYY-MM-DD" string or Date object. 
    // Based on previous search, it's likely a string "YYYY-MM-DD".
    // We'll try to match strictly or use string comparison.
    
    const query = {
      userEmail: userEmail,
      isActive: true
    };

    if (startDate && endDate) {
      query.shiftDate = {
        $gte: startDate,
        $lte: endDate
      };
    }

    const workedRecords = await db.collection('workedTime').find(query).toArray();

    let totalHours = 0;
    let earningsHistory = [];

    // Group by Month or Week could be done here, but let's return raw daily data for frontend to aggregate or pre-aggregate here.
    // Let's aggregate by date.
    const dailyMap = {};

    for (const record of workedRecords) {
        const hours = this.parseDurationToHours(record.timeWorked);
        totalHours += hours;
        
        const dateKey = record.shiftDate;
        if (!dailyMap[dateKey]) {
            dailyMap[dateKey] = 0;
        }
        dailyMap[dateKey] += hours;
    }

    // Convert dailyMap to array
    earningsHistory = Object.keys(dailyMap).map(date => ({
        date,
        hours: dailyMap[date],
        earnings: dailyMap[date] * payRate
    })).sort((a, b) => a.date.localeCompare(b.date));

    return {
        totalHours: parseFloat(totalHours.toFixed(2)),
        totalEarnings: parseFloat((totalHours * payRate).toFixed(2)),
        payRate,
        payType,
        history: earningsHistory
    };
  }

  async getProjectedEarnings(userEmail, startDate) {
    const db = await this.connect();
    
    // 1. Get User Pay Rate
    const user = await db.collection('login').findOne({ email: userEmail });
    const payRate = user?.payRate || 0;
    
    if (payRate === 0) {
        return {
            projectedHours: 0,
            projectedEarnings: 0,
            breakdown: []
        };
    }

    // 2. Get Client Assignments (Schedule)
    const assignments = await db.collection('clientAssignments').find({
        userEmail: userEmail,
        isActive: true
    }).toArray();

    let projectedHours = 0;
    let breakdown = [];
    
    const startFilter = startDate ? new Date(startDate) : new Date();
    startFilter.setHours(0,0,0,0);

    for (const assignment of assignments) {
        // Handle new 'schedule' array
        if (assignment.schedule && Array.isArray(assignment.schedule)) {
            for (const shift of assignment.schedule) {
                // Parse date
                const shiftDate = new Date(shift.date);
                if (shiftDate >= startFilter) {
                    const duration = this.calculateShiftDuration(shift.startTime, shift.endTime, shift.break);
                    projectedHours += duration;
                    breakdown.push({
                        date: shift.date,
                        clientEmail: assignment.clientEmail,
                        hours: duration,
                        earnings: duration * payRate
                    });
                }
            }
        } 
        // Handle legacy 'dateList'
        else if (assignment.dateList && Array.isArray(assignment.dateList)) {
             for (let i = 0; i < assignment.dateList.length; i++) {
                const dateStr = assignment.dateList[i];
                if (!dateStr) continue;
                
                const shiftDate = new Date(dateStr);
                if (shiftDate >= startFilter) {
                    const startTime = assignment.startTimeList?.[i];
                    const endTime = assignment.endTimeList?.[i];
                    const breakTime = assignment.breakList?.[i];
                    
                    const duration = this.calculateShiftDuration(startTime, endTime, breakTime);
                    projectedHours += duration;
                     breakdown.push({
                        date: dateStr,
                        clientEmail: assignment.clientEmail,
                        hours: duration,
                        earnings: duration * payRate
                    });
                }
             }
        }
    }

    // Sort breakdown
    breakdown.sort((a, b) => new Date(a.date) - new Date(b.date));

    return {
        projectedHours: parseFloat(projectedHours.toFixed(2)),
        projectedEarnings: parseFloat((projectedHours * payRate).toFixed(2)),
        breakdown
    };
  }

  _parseIsoDateToUtc(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const parts = dateStr.split('-').map(Number);
    if (parts.length !== 3) return null;
    const [y, m, d] = parts;
    if (!y || !m || !d) return null;
    return new Date(Date.UTC(y, m - 1, d));
  }

  _formatUtcDate(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  _getWeekStartUtc(date) {
    const day = date.getUTCDay();
    const daysSinceMonday = (day + 6) % 7;
    const start = new Date(date);
    start.setUTCDate(date.getUTCDate() - daysSinceMonday);
    start.setUTCHours(0, 0, 0, 0);
    return start;
  }

  _getMonthStartUtc(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }

  async getEarningsHistory(userEmail, startDate, endDate, bucket = 'month') {
    const db = await this.connect();

    const user = await db.collection('login').findOne({ email: userEmail });
    const payRate = user?.payRate || 0;

    const start =
      this._parseIsoDateToUtc(startDate) ||
      new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 5, 1));
    const end =
      this._parseIsoDateToUtc(endDate) ||
      new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0));

    const query = {
      userEmail: userEmail,
      isActive: true,
      shiftDate: {
        $gte: this._formatUtcDate(start),
        $lte: this._formatUtcDate(end),
      },
    };

    const workedRecords = await db.collection('workedTime').find(query).toArray();

    const byPeriod = {};
    for (const record of workedRecords) {
      const date = this._parseIsoDateToUtc(record.shiftDate);
      if (!date) continue;

      const hours = this.parseDurationToHours(record.timeWorked);
      const startKeyDate =
        String(bucket).toLowerCase() === 'week'
          ? this._getWeekStartUtc(date)
          : this._getMonthStartUtc(date);

      const key = this._formatUtcDate(startKeyDate);
      if (!byPeriod[key]) {
        byPeriod[key] = 0;
      }
      byPeriod[key] += hours;
    }

    const results = Object.keys(byPeriod)
      .sort((a, b) => a.localeCompare(b))
      .map((periodStart) => {
        const startUtc = this._parseIsoDateToUtc(periodStart);
        const endUtc =
          String(bucket).toLowerCase() === 'week'
            ? new Date(Date.UTC(startUtc.getUTCFullYear(), startUtc.getUTCMonth(), startUtc.getUTCDate() + 6))
            : new Date(Date.UTC(startUtc.getUTCFullYear(), startUtc.getUTCMonth() + 1, 0));

        const hours = parseFloat(byPeriod[periodStart].toFixed(2));
        const earnings = parseFloat((hours * payRate).toFixed(2));
        return {
          periodStart: this._formatUtcDate(startUtc),
          periodEnd: this._formatUtcDate(endUtc),
          hours,
          earnings,
        };
      });

    return {
      bucket: String(bucket).toLowerCase() === 'week' ? 'week' : 'month',
      payRate,
      items: results,
    };
  }
  
  // Admin function to set rate (Enhanced for SCHADS)
  async setPayRate(userEmail, rate, type = 'Hourly', rates = null, classificationLevel = null, payPoint = null, stream = null, employmentType = null, activeAllowances = []) {
      const db = await this.connect();
      
      const updateData = { 
          payRate: parseFloat(rate), 
          payType: type 
      };

      if (classificationLevel) updateData.classificationLevel = classificationLevel;
      if (payPoint) updateData.payPoint = payPoint;
      if (stream) updateData.stream = stream;
      if (employmentType) updateData.employmentType = employmentType;
      if (activeAllowances) updateData.activeAllowances = activeAllowances;

      if (rates) {
          updateData.payRates = {
              baseRate: parseFloat(rates.baseRate || rate),
              saturdayRate: parseFloat(rates.saturdayRate || 0),
              sundayRate: parseFloat(rates.sundayRate || 0),
              publicHolidayRate: parseFloat(rates.publicHolidayRate || 0),
              overtimeRate: parseFloat(rates.overtimeRate || 0), // First 2 hours
              overtimeRate2: parseFloat(rates.overtimeRate2 || 0), // After 2 hours
              nightShiftRate: parseFloat(rates.nightShiftRate || 0),
              eveningShiftRate: parseFloat(rates.eveningShiftRate || 0),
          };
      }

      const result = await db.collection('login').updateOne(
          { email: userEmail },
          { $set: updateData }
      );
      return result.modifiedCount > 0 || result.matchedCount > 0;
  }
}

module.exports = new EarningsService();
