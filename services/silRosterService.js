const SILRoster = require('../models/SILRoster');
const SILProperty = require('../models/SILProperty');
const SILOccupancy = require('../models/SILOccupancy');
const Shift = require('../models/Shift');
const silRatioService = require('./silRatioService');
const logger = require('../config/logger');

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
   * Build (or rebuild) a draft roster for a property/week from shifts.
   */
  async buildRoster(organizationId, { propertyId, weekStarting }, actor = '') {
    const property = await SILProperty.findOne({ _id: propertyId, organizationId });
    if (!property) {
      const err = new Error('Property not found.');
      err.statusCode = 404;
      throw err;
    }

    const week = SILRosterService.startOfWeek(weekStarting);
    const weekEnd = new Date(week.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Participants currently residing at the property.
    const occupancies = await SILOccupancy.find({
      organizationId,
      propertyId,
      status: 'active',
    });
    const clientIds = occupancies.map((o) => o.clientId);
    const participants = Math.max(1, clientIds.length);

    // Shifts for those clients in the week.
    let shifts = [];
    if (clientIds.length > 0) {
      shifts = await Shift.find({
        organizationId,
        clientId: { $in: clientIds },
        startTime: { $gte: week, $lt: weekEnd },
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
        warnings.push({
          role: 'ratio',
          message: `${shiftType} shift on ${new Date(shift.startTime)
            .toISOString()
            .slice(0, 10)} is ${compliance} (required ${requiredStaff}, assigned ${assignedStaff}).`,
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

    roster.status = 'published';
    roster.publishedAt = new Date();
    roster.updatedBy = actor;
    await roster.save();
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
