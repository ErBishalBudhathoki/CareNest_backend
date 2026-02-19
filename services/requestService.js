const Request = require('../models/Request');
const User = require('../models/User');
const FcmToken = require('../models/FcmToken');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { messaging } = require('../firebase-admin-config');
const LeaveBalanceService = require('./leaveBalanceService');
const AppointmentService = require('./appointmentService');
const HolidayService = require('./holidayService');
const mongoose = require('mongoose');

class RequestService {

  async createRequest(requestData, userEmail) {
    const {
      organizationId,
      userId,
      type, // 'Shift', 'TimeOff', 'SHIFT_SWAP_OFFER'
      details,
      note
    } = requestData;

    // Validate Balance for TimeOff
    if (type === 'TimeOff' && details && details.leaveType && details.totalHours) {
      if (details.startDate && details.endDate) {
        try {
          const calculated = await this.calculateLeaveHours(details.startDate, details.endDate, organizationId);
          if (details.totalHours > calculated.totalHours + 0.1) {
            throw new Error(`Total hours cannot exceed ${calculated.totalHours} for the selected dates.`);
          }
        } catch (e) {
          if (e.message.includes('Total hours cannot exceed')) throw e;
          console.error("Error verifying leave hours:", e);
        }
      }

      try {
        const hasBalance = await LeaveBalanceService.checkBalance(userEmail, details.leaveType, details.totalHours);
        if (!hasBalance) {
          throw new Error(`Insufficient ${details.leaveType} balance.`);
        }
      } catch (e) {
        console.error("Balance check failed:", e);
        if (e.message.includes('Insufficient')) throw e;
      }
    }

    let storedUserId = userId;
    // Resolve email to User ID if needed
    if (typeof storedUserId === 'string' && storedUserId.includes('@')) {
      const userDoc = await User.findOne({ email: storedUserId }).select('_id');
      if (userDoc) {
        storedUserId = userDoc._id.toString();
      }
    }

    const requestDoc = new Request({
      organizationId,
      userId: storedUserId,
      createdBy: userEmail,
      type,
      status: 'Pending',
      details,
      note,
      history: [{
        action: 'created',
        performedBy: userEmail,
        timestamp: new Date()
      }]
    });

    await requestDoc.save();

    // Notify admins
    try {
      // Find admins
      // Query User model
      const adminQuery = {
        organizationId: organizationId,
        isActive: true,
        $or: [
          { role: { $regex: /^admin$/i } },
          { roles: { $elemMatch: { $regex: /^admin$/i } } },
          { jobRole: { $regex: /^admin$/i } },
        ]
      };

      const admins = await User.find(adminQuery).select('email fcmToken jobRole role roles');

      console.log('Admin users found in RequestService query:', {
        count: admins.length,
        details: admins.map(u => ({ email: u.email, hasToken: !!u.fcmToken }))
      });

      const adminEmails = admins.map((admin) => admin.email).filter(Boolean);

      // Collect tokens from User profile
      let tokens = admins
        .map((admin) => admin.fcmToken)
        .filter((token) => token && token.trim() !== '');

      // Collect tokens from FcmToken collection
      if (adminEmails.length > 0) {
        const tokenDocs = await FcmToken.find({
          organizationId: organizationId, // FcmToken schema doesn't strict check orgId maybe? But let's keep logic
          // FcmToken schema has userEmail. Check schema again. 
          // Schema has: userEmail, fcmToken. doesn't seem to have organizationId?
          // Let's assume FcmToken MIGHT NOT HAVE organizationId if shared?
          // Previous code queried { organizationId, userEmail: { $in... } }
          // If schema doesn't have organizationId, that query would fail or return empty in Strict mode?
          // Wait, FcmToken.js I viewed earlier showed: userEmail, fcmToken, updatedAt... 
          // NO organizationId in FcmToken schema I saw!
          // But maybe previous code worked because native driver ignores schema?
          // I will query by userEmail only.
          userEmail: { $in: adminEmails }
        }).select('fcmToken');

        tokens = tokens.concat(tokenDocs.map((doc) => doc.fcmToken).filter(Boolean));
      }

      tokens = [...new Set(tokens)];

      if (tokens.length > 0) {
        const message = {
          notification: {
            title: 'New Request',
            body: `${userEmail || 'A user'} has submitted a new ${type} request.`
          },
          tokens: tokens,
          data: {
            type: 'request_created',
            requestId: requestDoc._id.toString(),
            requestType: type,
            title: 'New Request',
            body: `${userEmail || 'A user'} has submitted a new ${type} request.`,
            channelId: 'message',
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
            timestamp: new Date().toISOString(),
          },
          android: { priority: 'high', notification: { channel_id: 'message', sound: 'default' } },
          apns: { payload: { aps: { sound: 'default', 'content-available': 1 } }, headers: { 'apns-priority': '10' } },
        };
        await messaging.sendEachForMulticast(message);
      }
    } catch (error) {
      console.error('Error sending admin notification:', error);
    }

    return requestDoc;
  }

  async getRequests(organizationId, filters = {}) {
    const query = { organizationId };

    if (filters.userId) {
      const filterUserId = filters.userId.toString();
      if (filterUserId.includes('@')) {
        query.$or = [
          { userId: filterUserId },
          { createdBy: filterUserId },
          { 'details.claimantEmail': filterUserId }
        ];
      } else {
        // Resolve ObjectId if possible
        if (mongoose.Types.ObjectId.isValid(filterUserId)) {
          const userDoc = await User.findById(filterUserId).select('email');
          const email = userDoc?.email;
          if (email) {
            query.$or = [
              { userId: filterUserId },
              { userId: email },
              { createdBy: email },
              { 'details.claimantId': filterUserId },
              { 'details.claimantEmail': email }
            ];
          } else {
            query.$or = [{ userId: filterUserId }, { 'details.claimantId': filterUserId }];
          }
        } else {
          query.$or = [{ userId: filterUserId }, { 'details.claimantId': filterUserId }];
        }
      }
    }
    if (filters.status) query.status = filters.status;
    if (filters.type) query.type = filters.type;

    return await Request.find(query).sort({ createdAt: -1 });
  }

  async claimRequest(requestId, claimantId, claimantName, claimantEmail) {
    const request = await Request.findOne({
      _id: requestId,
      status: 'Pending',
      type: 'SHIFT_SWAP_OFFER'
    });

    if (!request) {
      throw new Error('Request not found or not available for claim');
    }

    const update = {
      $set: {
        'details.claimantId': claimantId,
        'details.claimantName': claimantName,
        'details.claimantEmail': claimantEmail,
        status: 'Claimed',
        updatedAt: new Date()
      },
      $push: {
        history: {
          action: 'claimed',
          performedBy: claimantEmail,
          timestamp: new Date()
        }
      }
    };

    const result = await Request.findOneAndUpdate(
      { _id: requestId },
      update,
      { new: true }
    );

    return result;
  }

  async updateRequestStatus(requestId, status, userEmail, reason) {
    const originalRequest = await Request.findById(requestId);
    if (!originalRequest) {
      throw new Error('Request not found');
    }

    // SIDE EFFECTS
    if (status === 'Approved' && originalRequest.type === 'SHIFT_SWAP_OFFER') {
      try {
        const details = originalRequest.details;
        await AppointmentService.reassignShift(
          originalRequest.organizationId,
          originalRequest.createdBy,
          details.claimantEmail,
          details.clientEmail,
          {
            date: details.date,
            startTime: details.startTime,
            endTime: details.endTime,
            break: details.break,
            ndisItem: details.ndisItem,
            highIntensity: details.highIntensity
          }
        );
        console.log(`Shift swap executed for request ${requestId}`);
      } catch (err) {
        console.error('Failed to execute shift swap side effect', err);
        throw new Error(`Shift swap failed: ${err.message}`);
      }
    }

    if (status === 'Approved' && originalRequest.type === 'TimeOff') {
      try {
        const details = originalRequest.details;
        if (details && details.leaveType && details.totalHours) {
          await LeaveBalanceService.updateBalance(
            originalRequest.createdBy,
            details.leaveType,
            -Math.abs(details.totalHours),
            `Leave Request Approved: ${requestId}`
          );
        }
      } catch (err) {
        console.error('Failed to deduct leave balance', err);
        throw new Error(`Failed to update leave balance: ${err.message}`);
      }
    }

    let finalStatus = status;
    let unsetFields = {};

    if (originalRequest.type === 'SHIFT_SWAP_OFFER' && status === 'Declined' && originalRequest.status === 'Claimed') {
      finalStatus = 'Pending';
      unsetFields = {
        'details.claimantId': "",
        'details.claimantName': "",
        'details.claimantEmail': ""
      };
    }

    const update = {
      $set: {
        status: finalStatus,
        updatedAt: new Date(),
        updatedBy: userEmail
      },
      $push: {
        history: {
          action: 'status_updated',
          status: finalStatus,
          performedBy: userEmail,
          reason,
          timestamp: new Date()
        }
      }
    };

    if (Object.keys(unsetFields).length > 0) {
      update.$unset = unsetFields;
    }

    const result = await Request.findByIdAndUpdate(requestId, update, { new: true });

    // Notification
    if (result) {
      try {
        const requesterId = originalRequest.userId?.toString();
        let requesterEmail = null;
        let user = null;

        if (requesterId) {
          if (requesterId.includes('@')) {
            requesterEmail = requesterId;
            user = await User.findOne({ email: requesterEmail });
          } else if (mongoose.Types.ObjectId.isValid(requesterId)) {
            user = await User.findById(requesterId);
            requesterEmail = user?.email;
          }
        }

        let userTokens = [];
        if (user && user.fcmToken) {
          userTokens.push(user.fcmToken);
        }

        if (userTokens.length === 0 && requesterEmail) {
          const userTokenDocs = await FcmToken.find({
            userEmail: requesterEmail
          }).select('fcmToken');
          userTokens = userTokenDocs.map(doc => doc.fcmToken).filter(Boolean);
        }

        userTokens = [...new Set(userTokens)];

        if (userTokens.length > 0) {
          const message = {
            notification: {
              title: `Request ${status}`,
              body: `Your ${originalRequest.type} request has been ${status.toLowerCase()}.${reason ? ` Reason: ${reason}` : ''}`
            },
            tokens: userTokens,
            data: {
              type: 'request_update',
              requestId: requestId,
              status: status,
              channelId: 'message',
              title: `Request ${status}`,
              body: `Your ${originalRequest.type} request has been ${status.toLowerCase()}.${reason ? ` Reason: ${reason}` : ''}`,
              click_action: 'FLUTTER_NOTIFICATION_CLICK',
              timestamp: new Date().toISOString(),
            },
            android: { priority: 'high', notification: { channel_id: 'message', sound: 'default' } },
            apns: { payload: { aps: { sound: 'default', 'content-available': 1 } }, headers: { 'apns-priority': '10' } },
          };

          await messaging.sendEachForMulticast(message);
        }
      } catch (error) {
        console.error('Error sending notification:', error);
      }
    }

    return result;
  }

  async getLeaveForecast(userEmail, targetDate) {
    const balances = await LeaveBalanceService.getBalances(userEmail);
    const currentBalance = balances.annualLeave || 0;

    const target = new Date(targetDate);
    const now = new Date();

    // 2. Calculate Future Accrual
    // Rule: 20 days per year = 1.66 days/month.
    // Assuming 7.6 hours per day = 12.66 hours/month.
    const ACCRUAL_RATE_HOURS_PER_MONTH = 12.66;

    const getMonthsDiff = (d1, d2) => {
      let months;
      months = (d2.getFullYear() - d1.getFullYear()) * 12;
      months -= d1.getMonth();
      months += d2.getMonth();
      return months <= 0 ? 0 : months;
    };

    const monthsToTarget = getMonthsDiff(now, target);
    const forecastAccrual = monthsToTarget * ACCRUAL_RATE_HOURS_PER_MONTH;
    const forecastBalance = currentBalance + forecastAccrual;

    return {
      accrued: parseFloat((balances.accruedHours || 0).toFixed(2)),
      taken: parseFloat((balances.usedHours || 0).toFixed(2)),
      balance: parseFloat(currentBalance.toFixed(2)),
      forecast: parseFloat(forecastBalance.toFixed(2)),
      targetDate: target
    };
  }

  async calculateLeaveHours(startDate, endDate, organizationId, dailyHours = 7.6) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error("Invalid date format");
    }

    if (end < start) {
      throw new Error("End date must be after start date");
    }

    const allHolidays = await HolidayService.getAllHolidays(organizationId);

    // DB stores as "DD-MM-YYYY" string based on schema check
    const holidayDates = new Set(allHolidays.map(h => h.Date));

    const formatDate = (date) => {
      const d = date.getDate().toString().padStart(2, '0');
      const m = (date.getMonth() + 1).toString().padStart(2, '0');
      const y = date.getFullYear();
      return `${d}-${m}-${y}`;
    };

    let totalHours = 0;
    let workingDays = 0;
    let weekendDays = 0;
    let holidayDays = 0;

    const current = new Date(start);
    while (current <= end) {
      const dayOfWeek = current.getDay(); // 0 = Sun, 6 = Sat
      const dateStr = formatDate(current);

      if (dayOfWeek === 0 || dayOfWeek === 6) {
        weekendDays++;
      } else if (holidayDates.has(dateStr)) {
        holidayDays++;
      } else {
        workingDays++;
        totalHours += dailyHours;
      }
      current.setDate(current.getDate() + 1);
    }

    return {
      totalHours: parseFloat(totalHours.toFixed(2)),
      breakdown: {
        workingDays,
        weekendDays,
        holidayDays,
        dailyHours
      }
    };
  }
}

module.exports = new RequestService();
