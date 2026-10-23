const mongoose = require('mongoose');
const SILProperty = require('../models/SILProperty');
const UserOrganization = require('../models/UserOrganization');
const User = require('../models/User');
const Notification = require('../models/Notification');
const NotificationPreference = require('../models/NotificationPreference');
const FcmToken = require('../models/FcmToken');
// `config/firebase` exports a wrapper object — `{ FirebaseConfig, firebaseConfig,
// admin, messaging }` — so the sender lives on the exported singleton. Calling
// the method on the module itself throws
// "firebaseConfig.sendMulticastNotification is not a function" at runtime and
// silently drops the push (the Notification history row is still written).
const firebaseModule = require('../config/firebase');
const firebaseConfig = firebaseModule.firebaseConfig || firebaseModule;
const logger = require('../config/logger');

/**
 * SIL roster publish notifications.
 *
 * Publishing a roster is the moment a support worker's week becomes real, so
 * everyone affected must hear about it:
 *
 *   1. Every staff member rostered on the published week (`staffUserIds` on the
 *      roster entries), and
 *   2. Every owner/admin in the organisation — this is compulsory for the
 *      roster's accountability chain, so it is deliberately NOT suppressible by
 *      a per-user notification preference.
 *
 * Group 1 honours `NotificationPreference.categoryEnabled.shiftChanges`
 * (default: on) because a published roster is a shift change. A user with no
 * preference document is treated as opted in, matching the rest of the codebase.
 *
 * Delivery mirrors `services/billing/billingNotificationService.js`:
 *   1. Persist one `Notification` row per recipient (in-app history).
 *   2. Best-effort FCM multicast to registered device tokens.
 * Step 2 never blocks or fails step 1, and the whole thing is fire-and-forget
 * from the publish path so a push outage cannot fail a roster publish.
 *
 * Both platforms are covered by the same call: `sendMulticastNotification`
 * fans out to whatever tokens are registered (Android + iOS), and the Android
 * channels shipped by the app plus the APNs headers below are supplied so the
 * message is delivered with an alert on iOS and on the `rosters` channel on
 * Android. iOS delivery still requires the Apple developer account / APNs key
 * described in IOS_PUSH_NOTIFICATION_SETUP.md — nothing here changes that.
 */

const KIND = 'sil_roster_published';
// The app-side category + Android channel used for roster alerts.
const PREFERENCE_CATEGORY = 'shiftChanges';
const CHANNEL_ID = 'rosters';

function toObjectId(value) {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) return null;
  return new mongoose.Types.ObjectId(value);
}

function weekLabel(weekStarting) {
  if (!weekStarting) return 'this week';
  const date = new Date(weekStarting);
  if (Number.isNaN(date.getTime())) return 'this week';
  return date.toISOString().slice(0, 10);
}

/**
 * Everyone who must be told about a published roster:
 * the rostered staff, plus every owner/admin in the organisation.
 *
 * @returns {Promise<Array<{ userId: any, email: string, compulsory: boolean }>>}
 */
async function resolveRecipients(organizationId, staffUserIds = []) {
  const orgId = toObjectId(organizationId) || organizationId;
  const staffIds = [...new Set(staffUserIds.map(String).filter(Boolean))];

  const recipients = new Map(); // userId(string) -> { userId, email, compulsory }

  // 1. Rostered staff.
  if (staffIds.length > 0) {
    const candidateIds = staffIds.filter((id) => mongoose.Types.ObjectId.isValid(id));

    // Only members of *this* organisation may be notified: roster entries are
    // client-supplied, so an id from another tenant must not receive the
    // organisation's roster details.
    const staffMemberships = await UserOrganization.find({
      organizationId: orgId,
      userId: { $in: candidateIds },
      isActive: true,
    })
      .select('userId')
      .lean();
    const memberIds = staffMemberships
      .map((m) => String(m.userId))
      .filter((id) => mongoose.Types.ObjectId.isValid(id));

    if (memberIds.length > 0) {
      const staff = await User.find({ _id: { $in: memberIds } })
        .select('_id email')
        .lean();
      for (const user of staff) {
        const email = (user.email || '').toLowerCase();
        if (!email) continue;
        recipients.set(String(user._id), {
          userId: user._id,
          email,
          compulsory: false,
        });
      }
    }
  }

  // 2. Owner/admin — compulsory.
  const adminMemberships = await UserOrganization.find({
    organizationId: orgId,
    isActive: true,
    $or: [
      { role: { $in: ['owner', 'admin'] } },
      { permissions: { $in: ['*', 'manage_users'] } },
    ],
  }).lean();

  const adminUserIds = adminMemberships
    .map((m) => m.userId)
    .filter((id) => id && mongoose.Types.ObjectId.isValid(String(id)));

  if (adminUserIds.length > 0) {
    const admins = await User.find({ _id: { $in: adminUserIds } })
      .select('_id email')
      .lean();
    for (const user of admins) {
      const email = (user.email || '').toLowerCase();
      if (!email) continue;
      recipients.set(String(user._id), {
        userId: user._id,
        email,
        compulsory: true,
      });
    }
  }

  return [...recipients.values()];
}

/**
 * Honour per-user preferences for the non-compulsory (rostered staff)
 * recipients only. Owner/admin always receive the published roster.
 */
async function filterByPreference(recipients) {
  const optional = recipients.filter((r) => !r.compulsory);
  if (optional.length === 0) return recipients;

  const prefs = await NotificationPreference.find({
    $or: [
      { userId: { $in: optional.map((r) => String(r.userId)) } },
      { userEmail: { $in: optional.map((r) => r.email) } },
    ],
  }).lean();

  const byUserId = new Map();
  const byEmail = new Map();
  for (const pref of prefs) {
    if (pref.userId) byUserId.set(String(pref.userId), pref);
    if (pref.userEmail) byEmail.set(String(pref.userEmail).toLowerCase(), pref);
  }

  return recipients.filter((r) => {
    if (r.compulsory) return true;
    const pref = byUserId.get(String(r.userId)) || byEmail.get(r.email) || null;
    if (!pref) return true;
    return pref.categoryEnabled?.[PREFERENCE_CATEGORY] !== false;
  });
}

/**
 * Human-readable actor label for the notification body.
 * The publish path passes the actor's EMAIL (it is persisted as
 * `updatedBy`/`createdBy` on the roster), but the notification must show a
 * name — "by Jane Smith", not "by jane@x.com" — so email actors are resolved
 * against the User collection (first+last name), falling back to the raw value.
 */
async function resolveActorLabel(actor = '') {
  const value = (actor || '').trim();
  if (!value) return '';
  if (!value.includes('@')) return value;
  try {
    const user = await User.findOne({ email: value.toLowerCase() })
      .select('firstName lastName displayName name')
      .lean();
    if (!user) return value;
    const name = [user.firstName, user.lastName]
      .filter((v) => v && String(v).trim())
      .map((v) => String(v).trim())
      .join(' ')
      .trim();
    if (name) return name;
    return [user.displayName, user.name]
      .filter((v) => v && String(v).trim())
      .map(String)
      .join(' ')
      .trim() || value;
  } catch {
    return value; // lookup must never break the notification
  }
}

/**
 * Persist + push the "roster published" notification.
 * Never throws: the caller publishes the roster regardless of the outcome.
 */
async function notifyRosterPublished({ organizationId, roster, actor = '' }) {
  try {
    if (!roster) return { delivered: 0, pushed: 0 };

    const actorLabel = await resolveActorLabel(actor);

    const staffUserIds = (roster.entries || []).flatMap((entry) =>
      (entry.staffUserIds || []).map(String)
    );

    const recipients = await filterByPreference(
      await resolveRecipients(organizationId, staffUserIds)
    );

    if (recipients.length === 0) {
      logger.info('Roster publish notification skipped: no recipients', {
        organizationId: String(organizationId),
        rosterId: String(roster._id),
      });
      return { delivered: 0, pushed: 0 };
    }

    const property = roster.propertyId
      ? await SILProperty.findOne({
          _id: roster.propertyId,
          organizationId,
        })
          .select('name')
          .lean()
      : null;

    const week = weekLabel(roster.weekStarting);
    const shiftCount = (roster.entries || []).length;
    const place = property?.name || 'your organisation';
    const title = 'Roster published';
    const message =
      `The roster for ${place} starting ${week} is published` +
      `${shiftCount ? ` (${shiftCount} shift${shiftCount === 1 ? '' : 's'})` : ''}` +
      `${actorLabel ? ` by ${actorLabel}` : ''}. Check your shifts.`;

    const orgId = toObjectId(organizationId);
    const data = {
      type: 'sil_roster',
      kind: KIND,
      rosterId: String(roster._id),
      organizationId: String(organizationId),
      weekStarting: week,
      ...(roster.propertyId ? { propertyId: String(roster.propertyId) } : {}),
    };

    const persisted = recipients.filter((r) => r.userId);
    if (persisted.length > 0) {
      await Notification.insertMany(
        persisted.map((r) => ({
          userId: r.userId,
          ...(orgId ? { organizationId: orgId } : {}),
          type: KIND,
          title,
          message,
          data,
          channels: ['push'],
          priority: 'high',
          status: 'pending',
          createdAt: new Date(),
        }))
      );
    }

    let pushed = 0;
    try {
      const tokenDocs = await FcmToken.find({
        userEmail: { $in: recipients.map((r) => r.email) },
      }).lean();
      const tokens = [
        ...new Set(tokenDocs.map((t) => t.fcmToken).filter(Boolean)),
      ];

      if (tokens.length > 0) {
        const pushData = {
          ...data,
          channelId: CHANNEL_ID,
          title,
          body: message,
        };
        const response = await firebaseConfig.sendMulticastNotification(
          tokens,
          pushData,
          { title, body: message },
          {
            android: {
              priority: 'high',
              notification: {
                channelId: CHANNEL_ID,
                sound: 'default',
              },
            },
            apns: {
              headers: { 'apns-priority': '10' },
              payload: {
                aps: {
                  alert: { title, body: message },
                  sound: 'default',
                  badge: 1,
                  'content-available': 1,
                },
              },
            },
          }
        );
        pushed = response?.successCount ?? tokens.length;

        if (persisted.length > 0) {
          await Notification.updateMany(
            {
              ...(orgId ? { organizationId: orgId } : {}),
              type: KIND,
              status: 'pending',
              'data.rosterId': String(roster._id),
            },
            {
              $set: {
                status: pushed > 0 ? 'sent' : 'failed',
                sentAt: new Date(),
              },
            }
          );
        }
      }
    } catch (error) {
      logger.warn('Roster publish push delivery failed (history retained)', {
        organizationId: String(organizationId),
        rosterId: String(roster._id),
        error: error.message,
      });
    }

    logger.business('Roster publish notification fanned out', {
      event: 'sil_roster_publish_notified',
      organizationId: String(organizationId),
      rosterId: String(roster._id),
      delivered: recipients.length,
      pushed,
    });

    return { delivered: recipients.length, pushed };
  } catch (error) {
    logger.error('Roster publish notification failed', {
      organizationId: String(organizationId),
      rosterId: roster?._id ? String(roster._id) : null,
      error: error.message,
    });
    return { delivered: 0, pushed: 0, error: error.message };
  }
}

module.exports = {
  KIND,
  PREFERENCE_CATEGORY,
  CHANNEL_ID,
  resolveRecipients,
  filterByPreference,
  notifyRosterPublished,
};
