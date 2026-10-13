const SILRatioRule = require('../models/SILRatioRule');
const SILProperty = require('../models/SILProperty');

/**
 * Staffing-ratio computation for SIL shifts (Phase 4).
 * See docs/SIL_MANAGEMENT_SPEC.md sections 3.3 and 4.
 */
class SILRatioService {
  /**
   * Resolve the applicable ratio rule for a property/shift type.
   * A rule applies when:
   *   - shiftType matches
   *   - it is active
   *   - its propertyIds is empty OR contains the property
   *   - its silDesignCategories is empty OR contains the property's design category
   *   - participant count is within [minParticipants, maxParticipants] (0 = unbounded)
   * The most specific rule (matching property) wins.
   */
  async resolveRule(organizationId, { propertyId, shiftType, participants = 1, property } = {}) {
    const rules = await SILRatioRule.find({
      organizationId,
      isActive: true,
      shiftType,
    });

    const prop = property || (propertyId
      ? await SILProperty.findOne({ _id: propertyId, organizationId })
      : null);
    const designCategory = prop?.silDesignCategory;

    const applicable = rules.filter((rule) => {
      const propIds = (rule.appliesTo?.propertyIds || []).map((id) => id.toString());
      if (propIds.length > 0 && (!propertyId || !propIds.includes(String(propertyId)))) {
        return false;
      }
      const cats = rule.appliesTo?.silDesignCategories || [];
      if (cats.length > 0 && (!designCategory || !cats.includes(designCategory))) {
        return false;
      }
      const min = rule.minParticipants || 0;
      const max = rule.maxParticipants || 0;
      if (participants < min) return false;
      if (max > 0 && participants > max) return false;
      return true;
    });

    if (applicable.length === 0) return null;

    // Prefer rules that explicitly target the property.
    applicable.sort((a, b) => {
      const aProp = (a.appliesTo?.propertyIds || []).length > 0 ? 1 : 0;
      const bProp = (b.appliesTo?.propertyIds || []).length > 0 ? 1 : 0;
      return bProp - aProp;
    });

    return applicable[0];
  }

  /**
   * Compute required staff for a shift.
   * @returns {{ requiredStaff:number, ruleId:string|null, ratio:object|null }}
   */
  async requiredStaff(organizationId, opts) {
    const { participants = 1 } = opts;
    const rule = await this.resolveRule(organizationId, opts);

    if (!rule) {
      // Default 1:1 — one staff per participant.
      return { requiredStaff: Math.max(1, participants), ruleId: null, ratio: { staff: 1, participants: 1 } };
    }

    const ratioStaff = rule.ratio?.staff || 1;
    const ratioParticipants = rule.ratio?.participants || 1;
    const requiredStaff = Math.max(
      1,
      Math.ceil(participants / ratioParticipants) * ratioStaff,
    );

    return {
      requiredStaff,
      ruleId: rule._id.toString(),
      ratio: { staff: ratioStaff, participants: ratioParticipants },
    };
  }

  /** CRUD passthroughs. */
  async listRules(organizationId, { shiftType, isActive } = {}) {
    const filter = { organizationId };
    if (shiftType) filter.shiftType = shiftType;
    if (isActive !== undefined) filter.isActive = isActive;
    return SILRatioRule.find(filter).sort({ name: 1 });
  }

  async createRule(organizationId, data) {
    return SILRatioRule.create({ organizationId, ...data });
  }

  async updateRule(organizationId, id, data) {
    return SILRatioRule.findOneAndUpdate({ _id: id, organizationId }, data, {
      new: true,
      runValidators: true,
    });
  }

  async deleteRule(organizationId, id) {
    return SILRatioRule.findOneAndUpdate(
      { _id: id, organizationId },
      { isActive: false },
      { new: true },
    );
  }
}

module.exports = new SILRatioService();
