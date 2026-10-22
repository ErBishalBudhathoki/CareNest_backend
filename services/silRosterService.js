const SILRoster = require('../models/SILRoster');
const SILProperty = require('../models/SILProperty');
const SILOccupancy = require('../models/SILOccupancy');
const SILRosterOfCare = require('../models/SILRosterOfCare');
const Client = require('../models/Client');
const Shift = require('../models/Shift');
const silRatioService = require('./silRatioService');
const silRosterNotificationService = require('./silRosterNotificationService');
const dateHelpers = require('../utils/dateHelpers');
const logger = require('../config/logger');

const DAY_INDEX = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const DEFAULT_TZ = 'Australia/Sydney';

/**
 * SIL roster operations (Phase 4). Rosters reference Phase 1 `Shift`
 * documents; they never duplicate authoritative times.
 * See docs/SIL_MANAGEMENT_SPEC.md sections 3.4 and 4.
 */
class SILRosterService {
  /** Monday 00:00 UTC for the week containing `date`. */
  static startOfWeek(date) {
    const d = new Date(date);
    const day = d.getUTCDay(); // 0=Sun
    const diff = (day + 6) % 7; // days since Monday
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff));
    return monday;
  }

  async getRoster(organizationId, propertyId, weekStarting) {
    const week = SILRosterService.startOfWeek(weekStarting);
    return SILRoster.findOne({ organizationId, propertyId, weekStarting: week });
  }

  /**
   * Materialise an active roster of care's agreed weekly pattern into that
   * week's Shifts (unassigned), so staff can be assigned in one place.
   *
   * Each support with a `days` + `startTime`/`endTime` pattern produces one
   * shift per agreed day. Idempotent: a shift already linked to this RoC at the
   * same start time is skipped, so re-planning a week never duplicates.
   *
   * @param {string} organizationId
   * @param {string} rosterOfCareId
   * @param {Object} opts - { weekStarting, timezone }
   * @param {string} actor
   * @returns {Promise<Object>} { notFound } | { invalidState } | { clientNotFound }
   *   | { noPattern } | { roc, week, created, skipped }
   */
  async materializeRocShifts(organizationId, rosterOfCareId, opts = {}, actor = '') {
    const timezone = opts.timezone || DEFAULT_TZ;
    const roc = await SILRosterOfCare.findOne({ _id: rosterOfCareId, organizationId });
    if (!roc) return { notFound: true };
    if (!['active', 'under_review'].includes(roc.status)) {
      return { invalidState: true, status: roc.status };
    }

    const client = await Client.findOne({ _id: roc.clientId, organizationId }).lean();
    if (!client) return { clientNotFound: true };

    const supports = (roc.supports || []).filter(
      (s) => Array.isArray(s.days) && s.days.length > 0 && s.startTime && s.endTime,
    );
    if (supports.length === 0) {
      return { noPattern: true, roc };
    }

    const week = SILRosterService.startOfWeek(opts.weekStarting || new Date());
    const monday = dateHelpers.getZonedDateParts(week, timezone);
    const clientEmail = client.clientEmail || client.email || '';

    const created = [];
    const skipped = [];

    for (const support of supports) {
      for (const day of support.days) {
        const offset = DAY_INDEX[day];
        if (offset === undefined) continue;

        const base = new Date(Date.UTC(monday.year, monday.month - 1, monday.day + offset));
        const dp = dateHelpers.getZonedDateParts(base, timezone);
        const [sh, sm] = String(support.startTime).split(':').map(Number);
        const [eh, em] = String(support.endTime).split(':').map(Number);
        const start = dateHelpers.zonedWallClockToUtc(
          dp.year, dp.month, dp.day, sh || 0, sm || 0, timezone,
        );
        let end = dateHelpers.zonedWallClockToUtc(
          dp.year, dp.month, dp.day, eh || 0, em || 0, timezone,
        );
        if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);

        const exists = await Shift.findOne({
          organizationId,
          clientId: roc.clientId,
          silRosterOfCareId: roc._id,
          startTime: start,
        });
        if (exists) {
          skipped.push(exists._id);
          continue;
        }

        const shift = await Shift.create({
          organizationId,
          clientId: roc.clientId,
          clientEmail,
          startTime: start,
          endTime: end,
          status: 'pending',
          shiftType: support.shiftType || 'day',
          silRosterOfCareId: roc._id,
          supportItems: [
            { itemNumber: support.supportNumber, itemName: support.supportName, unit: 'H' },
          ],
        });
        created.push(shift);
      }
    }

    logger.business('SIL RoC materialised', {
      event: 'sil_roc_materialised',
      organizationId,
      rosterOfCareId: String(roc._id),
      created: created.length,
      skipped: skipped.length,
    });

    return { roc, week, created, skipped };
  }

  /**
   * Build (or rebuild) a draft roster for a property/week from shifts.
   */
  async buildRoster(organizationId, { propertyId, weekStarting, timezone }, actor = '') {
    const property = await SILProperty.findOne({ _id: propertyId, organizationId });
    if (!property) {
      const err = new Error('Property not found.');
      err.statusCode = 404;
      throw err;
    }

    const tz = timezone || DEFAULT_TZ;
    const week = SILRosterService.startOfWeek(weekStarting);
    // The week boundary must be the org-local Monday 00:00, not UTC midnight —
    // shifts are created in Australia/Sydney, so a Monday 09:00 AEDT shift is
    // Sunday 22:00 UTC and would fall outside a UTC window.
    const monday = dateHelpers.getZonedDateParts(week, tz);
    const weekStartUtc = dateHelpers.zonedWallClockToUtc(
      monday.year, monday.month, monday.day, 0, 0, tz,
    );
    const weekEndUtc = new Date(weekStartUtc.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Participants currently residing at the property.
    const occupancies = await SILOccupancy.find({
      organizationId,
      propertyId,
      status: 'active',
    });
    const clientIds = occupancies.map((o) => o.clientId);
    const participants = Math.max(1, clientIds.length);

    // Shifts for those clients in the (org-local) week.
    let shifts = [];
    if (clientIds.length > 0) {
      shifts = await Shift.find({
        organizationId,
        clientId: { $in: clientIds },
        startTime: { $gte: weekStartUtc, $lt: weekEndUtc },
      }).sort({ startTime: 1 });
    }

    const entries = [];
    const warnings = [];

    for (const shift of shifts) {
      const shiftType = this._deriveShiftType(shift);
      const { requiredStaff, ruleId } = await silRatioService.requiredStaff(organizationId, {
        propertyId,
        shiftType,
        participants: 1,
        property,
      });
      const assignedStaff = shift.employeeId ? 1 : 0;

      let compliance = 'ok';
      if (assignedStaff < requiredStaff) compliance = 'understaffed';
      else if (assignedStaff > requiredStaff) compliance = 'overstaffed';

      entries.push({
        shiftId: shift._id,
        clientIds: shift.clientId ? [shift.clientId] : [],
        staffUserIds: shift.employeeId ? [shift.employeeId] : [],
        shiftType,
        ratioRuleId: ruleId || null,
        requiredStaff,
        assignedStaff,
        compliance,
        startTime: shift.startTime,
        endTime: shift.endTime,
      });

      if (compliance !== 'ok') {
        // Name the shift by its LOCAL date in the roster timezone —
        // `toISOString()` would print the UTC date, which is the previous
        // calendar day for morning shifts east of UTC (e.g. a Sydney Monday
        // 09:00 shift is stored as Sunday 22:00Z and would read 2026-10-18).
        const startParts = dateHelpers.getZonedDateParts(shift.startTime, timezone);
        const localDate = [
          String(startParts.year).padStart(2, '0'),
          String(startParts.month).padStart(2, '0'),
          String(startParts.day).padStart(2, '0'),
        ].join('-');
        warnings.push({
          role: 'ratio',
          message: `${shiftType} shift on ${localDate} is ${compliance} (required ${requiredStaff}, assigned ${assignedStaff}).`,
        });
      }
    }

    const roster = await SILRoster.findOneAndUpdate(
      { organizationId, propertyId, weekStarting: week },
      {
        organizationId,
        propertyId,
        weekStarting: week,
        entries,
        ratioWarnings: warnings,
        updatedBy: actor,
        $setOnInsert: { status: 'draft', createdBy: actor },
      },
      { new: true, upsert: true, runValidators: true },
    );

    logger.business('SIL Roster Built', {
      event: 'sil_roster_built',
      organizationId,
      propertyId: String(propertyId),
      entries: entries.length,
      participants,
    });

    return roster;
  }

  async updateRoster(organizationId, id, { entries }, actor = '') {
    const roster = await SILRoster.findOne({ _id: id, organizationId });
    if (!roster) return null;

    if (Array.isArray(entries)) {
      roster.entries = entries.map((entry) => ({
        ...entry,
        compliance: this._complianceFor(entry),
      }));
      roster.ratioWarnings = roster.entries
        .filter((e) => e.compliance !== 'ok')
        .map((e) => ({
          role: 'ratio',
          message: `${e.shiftType} shift is ${e.compliance}.`,
        }));
    }
    roster.updatedBy = actor;
    await roster.save();
    return roster;
  }

  /**
   * Publish a roster. Blocks only when `blockOnRatioBreach` is true and there
   * are understaffed entries; otherwise publishes with warnings.
   *
   * A successful publish notifies every rostered staff member plus the
   * organisation's owner/admin (§4). Notifications are dispatched after the
   * roster is saved and are never awaited, so a push outage cannot fail or
   * delay a publish.
   */
  async publishRoster(organizationId, id, { blockOnRatioBreach } = {}, actor = '') {
    const roster = await SILRoster.findOne({ _id: id, organizationId });
    if (!roster) return { notFound: true };

    // §8.5: the org setting is authoritative; an explicit request flag may
    // override it. Default is warn-only (false).
    let effectiveBlock = blockOnRatioBreach === true;
    try {
      const Organization = require('../models/Organization');
      const org = await Organization.findOne({ organizationId }).lean();
      const setting = org?.settings?.sil?.blockOnRatioBreach;
      if (setting !== undefined && blockOnRatioBreach === undefined) {
        effectiveBlock = setting === true;
      }
    } catch (_) {
      // Fall back to the request flag.
    }

    const understaffed = roster.entries.filter((e) => e.compliance === 'understaffed');
    if (effectiveBlock && understaffed.length > 0) {
      return { blocked: true, roster, understaffed };
    }

    // Re-publishing an already-published roster is an edit, not a fresh
    // announcement: notify only on the draft -> published transition so
    // workers are not re-pinged for every tweak.
    const isFirstPublish = roster.status !== 'published';

    roster.status = 'published';
    roster.publishedAt = new Date();
    roster.updatedBy = actor;
    await roster.save();

    if (isFirstPublish) {
      silRosterNotificationService
        .notifyRosterPublished({ organizationId, roster, actor })
        .catch((error) => {
          logger.error('Roster publish notification dispatch failed', {
            organizationId,
            rosterId: String(roster._id),
            error: error.message,
          });
        });
    }

    return { roster };
  }

  async getCompliance(organizationId, id) {
    const roster = await SILRoster.findOne({ _id: id, organizationId });
    if (!roster) return null;
    const summary = { ok: 0, understaffed: 0, overstaffed: 0, ratio_breach: 0 };
    for (const e of roster.entries) {
      summary[e.compliance] = (summary[e.compliance] || 0) + 1;
    }
    return { rosterId: roster._id.toString(), summary, warnings: roster.ratioWarnings };
  }

  _deriveShiftType(shift) {
    if (shift.shiftType) return shift.shiftType;
    const hour = new Date(shift.startTime).getHours();
    if (hour >= 22 || hour < 6) return 'active_night';
    if (hour >= 17) return 'evening';
    return 'day';
  }

  _complianceFor(entry) {
    const required = Number(entry.requiredStaff) || 1;
    const assigned = Number(entry.assignedStaff) || 0;
    if (assigned < required) return 'understaffed';
    if (assigned > required) return 'overstaffed';
    return 'ok';
  }
}

module.exports = new SILRosterService();
