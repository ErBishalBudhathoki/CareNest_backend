const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { messaging } = require('../firebase-admin-config');

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
          fcmToken: { $exists: true, $ne: null, $ne: '' }
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

    // Use aggregation to join with users collection to get user details
    const pipeline = [
      { $match: query },
      { $sort: { createdAt: -1 } },
    ];

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

    const update = {
      $set: {
        status,
        updatedAt: new Date(),
        updatedBy: userEmail
      },
      $push: {
        history: {
          action: 'status_updated',
          status,
          performedBy: userEmail,
          reason,
          timestamp: new Date()
        }
      }
    };

    const result = await db.collection('requests').findOneAndUpdate(
      { _id: new ObjectId(requestId) },
      update,
      { returnDocument: 'after' }
    );

    // SIDE EFFECTS
    if (result && status === 'Approved' && originalRequest.type === 'SHIFT_SWAP_OFFER') {
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
            fcmToken: { $exists: true, $ne: null, $ne: '' }
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
}

module.exports = new RequestService();
