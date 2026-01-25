const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { messaging } = require('../firebase-admin-config');
const LeaveBalanceService = require('./leaveBalanceService'); // Import LeaveBalanceService

const uri = process.env.MONGODB_URI;

class RequestService {
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

  async createRequest(requestData, userEmail) {
    const db = await this.connect();
    const {
      organizationId,
      userId,
      type, // 'Shift' or 'TimeOff'
      details, // Object containing specific fields
      note
    } = requestData;

    // Validate Balance for TimeOff
    if (type === 'TimeOff' && details && details.leaveType && details.totalHours) {
        // Validate hours against dates
        if (details.startDate && details.endDate) {
            try {
                const calculated = await this.calculateLeaveHours(details.startDate, details.endDate, organizationId);
                // Allow small tolerance for floating point
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
                // We could throw error, but maybe we just allow it and let manager reject?
                // PRD says "Prevent requests that exceed available balance"
                throw new Error(`Insufficient ${details.leaveType} balance.`);
            }
        } catch (e) {
            console.error("Balance check failed:", e);
             // If user not found or balance service error, maybe block or warn. 
             // If "Insufficient...", rethrow.
             if (e.message.includes('Insufficient')) throw e;
        }
    }

    let storedUserId = userId;
    if (typeof storedUserId === 'string' && storedUserId.includes('@')) {
      const userDoc = await db.collection('login').findOne(
        { email: storedUserId },
        { projection: { _id: 1 } }
      );
      if (userDoc?._id) {
        storedUserId = userDoc._id.toString();
      }
    }

    const requestDoc = {
      _id: new ObjectId(),
      organizationId,
      userId: storedUserId,
      createdBy: userEmail,
      type,
      status: 'Pending', // Pending, Approved, Declined
      details,
      note,
      createdAt: new Date(),
      updatedAt: new Date(),
      history: [{
        action: 'created',
        performedBy: userEmail,
        timestamp: new Date()
      }]
    };

    await db.collection('requests').insertOne(requestDoc);

    // Notify admins
    try {
      // Get admins with their FCM tokens directly from login collection
      const admins = await db.collection('login').find({
        organizationId: organizationId,
        isActive: { $ne: false },
        $or: [
          { role: { $regex: /^admin$/i } },
          { roles: { $elemMatch: { $regex: /^admin$/i } } },
          { jobRole: { $regex: /^admin$/i } },
        ],
      }).project({ email: 1, fcmToken: 1, role: 1, roles: 1, jobRole: 1 }).toArray();

      console.log('Admin users found in RequestService query:', {
        count: admins.length,
        details: admins.map(u => ({
          email: u.email,
          role: u.role,
          roles: u.roles,
          jobRole: u.jobRole,
          hasToken: !!u.fcmToken
        }))
      });

      const adminEmails = admins.map((admin) => admin.email).filter(Boolean);

      let tokens = admins
        .map((admin) => admin.fcmToken)
        .filter((token) => token && token.trim() !== '');

      const tokenDocs = adminEmails.length > 0
        ? await db.collection('fcmTokens').find({
          organizationId: organizationId,
          userEmail: { $in: adminEmails },
          fcmToken: { $exists: true, $nin: [null, ''] }
        }).project({ fcmToken: 1 }).toArray()
        : [];

      tokens = tokens.concat(tokenDocs.map((doc) => doc.fcmToken).filter(Boolean));

      // Deduplicate tokens
      tokens = [...new Set(tokens)];

      console.log(`Found ${tokens.length} admin FCM tokens for organization ${organizationId}`);

      if (tokens.length > 0) {
        const message = {
          notification: {
            title: 'New Request',
            body: `${userEmail || 'A user'} has submitted a new ${type} request.`
          },
          tokens: tokens, // Use tokens for multicast
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
          android: {
            priority: 'high',
            notification: {
              channel_id: 'message',
              sound: 'default',
            },
          },
          apns: {
            payload: { aps: { sound: 'default', 'content-available': 1 } },
            headers: { 'apns-priority': '10' },
          },
        };
        await messaging.sendEachForMulticast(message);
        console.log(`Notification sent to ${tokens.length} admins`);
      }
    } catch (error) {
      console.error('Error sending admin notification:', error);
    }

    return requestDoc;
  }

  async getRequests(organizationId, filters = {}) {
    const db = await this.connect();
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
        if (ObjectId.isValid(filterUserId)) {
          const userDoc = await db.collection('login').findOne(
            { _id: new ObjectId(filterUserId) },
            { projection: { email: 1 } }
          );
          const email = userDoc?.email?.toString();
          if (email) {
            query.$or = [
              { userId: filterUserId },
              { userId: email },
              { createdBy: email },
              { 'details.claimantId': filterUserId },
              { 'details.claimantEmail': email }
            ];
          } else {
            query.$or = [
              { userId: filterUserId },
              { 'details.claimantId': filterUserId }
            ];
          }
        } else {
          query.$or = [
            { userId: filterUserId },
            { 'details.claimantId': filterUserId }
          ];
        }
      }
    }
    if (filters.status) query.status = filters.status;
    if (filters.type) query.type = filters.type;

    return await db.collection('requests').find(query).sort({ createdAt: -1 }).toArray();
  }

  async claimRequest(requestId, claimantId, claimantName, claimantEmail) {
    const db = await this.connect();

    // 1. Verify request is pending and type is SHIFT_SWAP_OFFER
    const request = await db.collection('requests').findOne({
      _id: new ObjectId(requestId),
      status: 'Pending',
      type: 'SHIFT_SWAP_OFFER'
    });

    if (!request) {
      throw new Error('Request not found or not available for claim');
    }

    // 2. Update request with claim details
    const update = {
      $set: {
        'details.claimantId': claimantId,
        'details.claimantName': claimantName,
        'details.claimantEmail': claimantEmail,
        status: 'Claimed', // Intermediate status awaiting admin approval? Or Pending Approval?
        // Let's use 'Pending Approval' if admin needs to approve. 
        // Or if 'Claimed' means it waits for admin. 
        // Implementation plan said "Admin approval workflow".
        // So let's set status to 'Pending Approval' or keep 'Claimed' and admin filters by 'Claimed'.
        // Let's use 'Claimed' as a status distinct from 'Pending' (Open) and 'Approved' (Final).
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

    const result = await db.collection('requests').findOneAndUpdate(
      { _id: new ObjectId(requestId) },
      update,
      { returnDocument: 'after' }
    );

    // Notify Admin? (Should be handled by separate notification logic or here)
    // For now we return result.
    return result;
  }

  async updateRequestStatus(requestId, status, userEmail, reason) {
    const db = await this.connect();

    // 1. Get the original request to find the requester
    const originalRequest = await db.collection('requests').findOne({ _id: new ObjectId(requestId) });
    if (!originalRequest) {
      throw new Error('Request not found');
    }

    // SIDE EFFECTS - Execute BEFORE updating status to ensure consistency
    if (status === 'Approved' && originalRequest.type === 'SHIFT_SWAP_OFFER') {
      try {
        const AppointmentService = require('./appointmentService');
        const details = originalRequest.details;

        // Reassign the shift
        await AppointmentService.reassignShift(
          originalRequest.organizationId,
          originalRequest.createdBy, // Old user (requester) - Use createdBy which is email
          details.claimantEmail, // New user (claimant) - MUST be present if claimed
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

    // Handle Leave Balance Deduction on Approval
    if (status === 'Approved' && originalRequest.type === 'TimeOff') {
        try {
            const details = originalRequest.details;
            if (details && details.leaveType && details.totalHours) {
                // Determine userEmail for deduction
                // originalRequest.createdBy is userEmail
                await LeaveBalanceService.updateBalance(
                    originalRequest.createdBy, 
                    details.leaveType, 
                    -Math.abs(details.totalHours), 
                    `Leave Request Approved: ${requestId}`
                );
                console.log(`Deducted ${details.totalHours} hours from ${originalRequest.createdBy} for ${details.leaveType}`);
            }
        } catch (err) {
            console.error('Failed to deduct leave balance', err);
            // Should we block approval? Probably yes.
            throw new Error(`Failed to update leave balance: ${err.message}`);
        }
    }

    let finalStatus = status;
    let unsetFields = {};

    // Special handling for Declining a SHIFT_SWAP_OFFER that was already Claimed
    // Instead of closing the request, we reset it to Pending so others can claim it
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

    // Apply the unset if needed
    if (Object.keys(unsetFields).length > 0) {
      update.$unset = unsetFields;
    }

    const result = await db.collection('requests').findOneAndUpdate(
      { _id: new ObjectId(requestId) },
      update,
      { returnDocument: 'after' }
    );

    // 2. Send Notification to the User (Existing logic)
    if (result) {
      try {
        console.log('Request status updated, processing notification for request:', requestId);
        // Find user to get FCM token
        const requesterId = originalRequest.userId?.toString();
        let user = null;
        let requesterEmail = null;
        if (requesterId) {
          if (requesterId.includes('@')) {
            user = await db.collection('login').findOne({ email: requesterId });
            requesterEmail = requesterId;
          } else if (ObjectId.isValid(requesterId)) {
            user = await db.collection('login').findOne({ _id: new ObjectId(requesterId) });
            requesterEmail = user?.email?.toString() || null;
          }
        }

        const organizationId = originalRequest.organizationId;

        // Primary: Get FCM token directly from login collection
        let userTokens = [];
        if (user && user.fcmToken) {
          userTokens = [user.fcmToken];
          console.log(`Found FCM token in login collection for ${requesterEmail}`);
        }

        // Fallback: Check fcmTokens collection if no token in login
        if (userTokens.length === 0 && requesterEmail) {
          const userTokenDocs = await db.collection('fcmTokens').find({
            organizationId: organizationId,
            userEmail: requesterEmail,
            fcmToken: { $exists: true, $nin: [null, ''] }
          }).project({ fcmToken: 1 }).toArray();
          userTokens = userTokenDocs.map(doc => doc.fcmToken).filter(Boolean);
          if (userTokens.length > 0) {
            console.log(`Found FCM token in fcmTokens collection for ${requesterEmail}`);
          }
        }

        // Deduplicate tokens
        userTokens = [...new Set(userTokens)];

        console.log(`Total FCM tokens found for user ${requesterEmail || requesterId}: ${userTokens.length}`);

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
            android: {
              priority: 'high',
              notification: {
                channel_id: 'message',
                sound: 'default',
              },
            },
            apns: {
              payload: { aps: { sound: 'default', 'content-available': 1 } },
              headers: { 'apns-priority': '10' },
            },
          };

          await messaging.sendEachForMulticast(message);
          console.log(`Notification sent to ${requesterEmail || requesterId}`);
        } else {
          console.log(`No FCM token found for user ${requesterId}`);
        }
      } catch (error) {
        console.error('Error sending notification:', error);
        // Don't fail the request update if notification fails
      }
    }

    return result.value;
  }

  async getLeaveForecast(userEmail, targetDate) {
    // 1. Get Current Balance from Service
    // We assume forecast is mainly for Annual Leave
    const balances = await LeaveBalanceService.getBalances(userEmail);
    const currentBalance = balances.annualLeave || 0;

    const target = new Date(targetDate);
    const now = new Date();
    
    // 2. Calculate Future Accrual
    // Rule: 20 days per year = 1.66 days/month.
    // Assuming 7.6 hours per day = 12.66 hours/month.
    const ACCRUAL_RATE_HOURS_PER_MONTH = 12.66;
    
    // Calculate months difference
    const getMonthsDiff = (d1, d2) => {
        let months;
        months = (d2.getFullYear() - d1.getFullYear()) * 12;
        months -= d1.getMonth();
        months += d2.getMonth();
        return months <= 0 ? 0 : months;
    };

    const monthsToTarget = getMonthsDiff(now, target);
    const forecastAccrual = monthsToTarget * ACCRUAL_RATE_HOURS_PER_MONTH;
    
    // 3. Calculate Approved Future Leave (not yet taken but approved)
    // If LeaveBalanceService.updateBalance is called on Approval, then currentBalance ALREADY reflects approved leave?
    // My implementation deducts on Approval. So currentBalance is already reduced by approved leave.
    // So we don't need to subtract again.
    // However, if the approved leave is in the *future*, it is still deducted from balance.
    // So currentBalance = Available Balance.
    
    // 4. Forecast
    const forecastBalance = currentBalance + forecastAccrual;
    
    return {
        accrued: parseFloat((balances.accruedHours || 0).toFixed(2)), // We might not track this perfectly in simple service yet
        taken: parseFloat((balances.usedHours || 0).toFixed(2)),
        balance: parseFloat(currentBalance.toFixed(2)),
        forecast: parseFloat(forecastBalance.toFixed(2)),
        targetDate: target
    };
  }

  /**
   * Calculate leave hours excluding weekends and public holidays
   * @param {string} startDate - ISO date string
   * @param {string} endDate - ISO date string
   * @param {string} organizationId - Organization ID
   * @param {number} dailyHours - Hours per day (default 7.6)
   */
  async calculateLeaveHours(startDate, endDate, organizationId, dailyHours = 7.6) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error("Invalid date format");
    }

    if (end < start) {
      throw new Error("End date must be after start date");
    }

    // 1. Get Holidays
    const HolidayService = require('./holidayService');
    const allHolidays = await HolidayService.getAllHolidays(organizationId);
    
    // Convert holidays to a Set of date strings (DD-MM-YYYY or YYYY-MM-DD - DB uses DD-MM-YYYY)
    const holidayDates = new Set(allHolidays.map(h => h.Date)); // DB stores as "DD-MM-YYYY" string based on schema check
    
    // Helper to format date as DD-MM-YYYY
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
    
    // Iterate loop
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
      
      // Next day
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
