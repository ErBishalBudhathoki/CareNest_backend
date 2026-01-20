const { MongoClient, ServerApiVersion } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const TripService = require('./tripService');
const OrganizationService = require('./organizationService');

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

    // 1. Get User Pay Rate and ID
    const user = await db.collection('login').findOne({ email: userEmail });
    const payRate = user?.payRate || 0;
    const payType = user?.payType || 'Hourly';
    const userId = user?._id?.toString();
    const organizationId = user?.organizationId;

    // 2. Get Mileage Rate
    let mileageRate = 0;
    if (organizationId) {
        try {
            const org = await OrganizationService.getOrganizationById(organizationId);
            mileageRate = org?.settings?.mileage?.reimbursementRate || 0;
        } catch (e) {
            console.error('Error fetching organization mileage rate', e);
        }
    }

    // 3. Get Worked Time Records
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

    // 4. Get Mileage Records
    let mileageRecords = [];
    if (userId && startDate && endDate) {
        try {
            // Ensure we use Date objects for comparison if TripService expects them, 
            // but the startDate/endDate passed here are likely strings YYYY-MM-DD.
            // TripService expects YYYY-MM-DD strings or Dates? 
            // TripService: new Date(startDate) - so strings work.
            mileageRecords = await TripService.getReimbursableTrips(userId, startDate, endDate);
        } catch (e) {
            console.error('Error fetching mileage records', e);
        }
    }

    let totalHours = 0;
    let totalMileage = 0;
    
    // Aggregate by date
    const dailyMap = {};

    for (const record of workedRecords) {
        const hours = this.parseDurationToHours(record.timeWorked);
        totalHours += hours;
        
        const dateKey = record.shiftDate;
        if (!dailyMap[dateKey]) {
            dailyMap[dateKey] = { hours: 0, mileage: 0 };
        }
        dailyMap[dateKey].hours += hours;
    }

    for (const trip of mileageRecords) {
        const dist = parseFloat(trip.distance) || 0;
        totalMileage += dist;
        
        // Trip date is Date object
        const dateKey = trip.date.toISOString().split('T')[0];
        
        if (!dailyMap[dateKey]) {
            dailyMap[dateKey] = { hours: 0, mileage: 0 };
        }
        dailyMap[dateKey].mileage += dist;
    }

    // Convert dailyMap to array
    const earningsHistory = Object.keys(dailyMap).map(date => {
        const dayData = dailyMap[date];
        const hoursEarnings = dayData.hours * payRate;
        const mileageEarnings = dayData.mileage * mileageRate;
        
        return {
            date,
            hours: dayData.hours,
            earnings: hoursEarnings,
            mileage: dayData.mileage,
            mileageEarnings: mileageEarnings,
            totalDailyEarnings: hoursEarnings + mileageEarnings
        };
    }).sort((a, b) => a.date.localeCompare(b.date));

    return {
        totalHours: parseFloat(totalHours.toFixed(2)),
        totalEarnings: parseFloat((totalHours * payRate).toFixed(2)),
        totalMileage: parseFloat(totalMileage.toFixed(2)),
        totalMileageEarnings: parseFloat((totalMileage * mileageRate).toFixed(2)),
        mileageRate,
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
  async setPayRate(userEmail, rate, type = 'Hourly', rates = null, classificationLevel = null, payPoint = null, stream = null, employmentType = null, activeAllowances = [], dob = null) {
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
      if (dob) updateData.dob = dob; // Save Date of Birth

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

  // Get Quarterly OTE for Super Cap Calculation
  async getQuarterlyOTE(userEmail, dateStr) {
    const db = await this.connect();
    
    // Determine start of quarter
    const date = dateStr ? new Date(dateStr) : new Date();
    const month = date.getMonth(); // 0-11
    const year = date.getFullYear();
    
    let quarterStartMonth;
    if (month >= 0 && month <= 2) quarterStartMonth = 0; // Jan-Mar (Q3 financial)
    else if (month >= 3 && month <= 5) quarterStartMonth = 3; // Apr-Jun (Q4 financial)
    else if (month >= 6 && month <= 8) quarterStartMonth = 6; // Jul-Sep (Q1 financial)
    else quarterStartMonth = 9; // Oct-Dec (Q2 financial)
    
    const quarterStartDate = new Date(Date.UTC(year, quarterStartMonth, 1));
    const quarterStartStr = quarterStartDate.toISOString().split('T')[0];
    
    // Determine end date (exclusive of current invoice period start, effectively up to yesterday)
    // Or simpler: Get ALL earnings in this quarter, and let frontend subtract if needed?
    // Actually, we want YTD OTE *before* this invoice. 
    // Assuming 'dateStr' is the invoice start date.
    
    // Query worked time in this quarter up to (but strictly before?) 
    // Actually, usually we just want "What has been paid in this quarter so far".
    // For simplicity, we'll fetch all earnings in the quarter up to the provided date.
    
    const query = {
        userEmail: userEmail,
        isActive: true,
        shiftDate: {
            $gte: quarterStartStr,
            $lt: dateStr // Up to provided date (exclusive)
        }
    };
    
    const workedRecords = await db.collection('workedTime').find(query).toArray();
    
    // Get user pay details for rate calculation if historical rates aren't stored on the record
    // Note: ideally workedRecords should store the rate snapshot. If not, we estimate with current rate
    // or we'd need a more complex historical rate lookup.
    // For now, assuming current rate or rate stored on record.
    
    const user = await db.collection('login').findOne({ email: userEmail });
    const currentPayRate = user?.payRate || 0;
    
    let totalOTE = 0;
    
    for (const record of workedRecords) {
        // Calculate hours
        const hours = this.parseDurationToHours(record.timeWorked);
        
        // Determine rate
        // Ideally we check if it was overtime.
        // If our workedTime record doesn't store 'isOvertime' or 'rateSource', we might over-estimate OTE.
        // However, usually OTE is just Ordinary Hours * Rate.
        // We'll assume for now that historical records in 'workedTime' are mostly ordinary or we apply base rate.
        // Limitation: If we don't store the rate breakdown on workedTime, this is an estimate.
        
        let rate = currentPayRate; 
        // If we had stored rate on record: record.hourlyRate
        
        // Exclude overtime? 
        // If we can't distinguish OT from Ordinary in historical data easily without re-running the whole rules engine,
        // we might have to assume all 'workedTime' is OTE (unless it's explicitly flagged).
        // SCHADS: Overtime is usually separate or >10h. 
        // For a robust implementation, we'd need to re-run the daily logic or store 'earningsType' on the record.
        // Given current architecture, we'll sum (hours * rate) and return it as best-effort OTE.
        
        totalOTE += (hours * rate);
    }
    
    return {
        quarterStart: quarterStartStr,
        quarterlyOTE: parseFloat(totalOTE.toFixed(2))
    };
  }
}

module.exports = new EarningsService();
