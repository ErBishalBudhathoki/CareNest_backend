/**
 * Advanced Payroll Service
 *
 * Real SCHADS-aware payroll calculation (Phase 1). Replaces the previous
 * hardcoded mock (see docs/NDIS_DEPTH_ROADMAP.md section 1.7).
 *
 * Response shape is preserved for existing callers:
 *   { success: true, data: { userId, period, baseHours, baseRate, baseAmount,
 *     penalties, allowances, leaveAccrual, taxAndSuper, gross, netPay } }
 *
 * The calculation is driven by:
 *   - services/schadsService.js  (time-segmented engine)
 *   - config/schadsRates.js      (effective-dated rate table)
 *
 * Tax/super remain simplified estimates (clearly flagged) and are out of scope
 * for Phase 1.
 */

const schadsService = require('./schadsService');
const schadsRates = require('../config/schadsRates');
const weeklyOvertimeService = require('./weeklyOvertimeService');
const logger = require('../config/logger');

const CASUAL_LOADING_DEFAULT = 0.25;

/** Monday-based week key in the award timezone for weekly allowance caps. */
function weekKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: schadsRates.DEFAULTS.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  const localDay = new Date(`${map.year}-${map.month}-${map.day}T00:00:00.000Z`);
  const daysFromMonday = (localDay.getUTCDay() + 6) % 7;
  localDay.setUTCDate(localDay.getUTCDate() - daysFromMonday);
  return localDay.toISOString().slice(0, 10);
}

/** Map legacy frontend stream labels to award stream enums. */
const STREAM_LABEL_MAP = {
  'home care (disability)': 'disability',
  'home care (aged)': 'home_care',
  'social & community services': 'social_community',
  'crisis accommodation': 'social_community',
  'family day care': 'home_care',
  disability: 'disability',
  home_care: 'home_care',
  social_community: 'social_community',
};

/** Parse a legacy "Level 2" label to the numeric level. */
function parseLevel(value) {
  if (value == null) return undefined;
  if (typeof value === 'number') return value;
  const match = String(value).match(/(\d+)/);
  return match ? parseInt(match[1], 10) : undefined;
}

function normalizeStream(value) {
  if (!value) return undefined;
  const key = String(value).trim().toLowerCase();
  return STREAM_LABEL_MAP[key] || undefined;
}

class AdvancedPayrollService {
  /**
   * Resolve an award profile (base rate + multipliers + flags) from a user
   * document or an explicit payroll request.
   *
   * Supports three input shapes:
   *   1. Structured: `employee.award = { level, stream, employmentType, ... }`
   *   2. Legacy labels: `employee.classificationLevel`, `.stream`, `.employmentType`
   *   3. Legacy resolved rates: `employee.rates = { baseRate, saturdayRate, ... }`
   *      (already include casual loading) -> used directly, no double-loading.
   */
  resolveProfile(employee = {}, serviceDate) {
    const award = employee.award || {};

    const employmentTypeRaw =
      award.employmentType || employee.employmentType || '';
    const isCasual = employmentTypeRaw.toString().toLowerCase().includes('casual');

    // Legacy fully-resolved rates take precedence to avoid double-loading.
    const legacyRates = employee.rates || null;
    const hasResolvedRates =
      legacyRates &&
      Number(legacyRates.baseRate) > 0 &&
      (Number(legacyRates.saturdayRate) > 0 || Number(legacyRates.sundayRate) > 0);

    // Structured / label-derived level + stream.
    const level = award.level != null ? award.level : parseLevel(employee.classificationLevel);
    const stream = normalizeStream(award.stream || employee.stream) || 'disability';
    const payPoint = award.payPoint || employee.payPoint;

    let baseRate;
    const overrides = Array.isArray(award.rateOverrides) ? award.rateOverrides : [];
    if (overrides.length > 0) {
      const target = serviceDate ? new Date(serviceDate) : new Date();
      const applicable = overrides
        .filter((o) => o && o.effectiveFrom && new Date(o.effectiveFrom) <= target)
        .sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom));
      const chosen = applicable[0];
      if (chosen && chosen.rates && chosen.rates.baseRate != null) {
        baseRate = Number(chosen.rates.baseRate);
      }
    }

    if (baseRate == null) {
      baseRate = schadsRates.resolveBaseRate({
        awardCode: award.awardCode,
        stream,
        level,
        payPoint,
        date: serviceDate,
        payRateFallback: Number(employee.payRate) || 0,
      });
    }

    const multipliers = schadsRates.resolveMultipliers(
      award.awardCode || schadsRates.SCHADS_AWARD_CODE,
      serviceDate,
    );

    // If the employee has an explicit payRate that differs from the table and
    // no structured level was provided, prefer their stored payRate (legacy).
    if (level == null && Number(employee.payRate) > 0) {
      baseRate = Number(employee.payRate);
    }

    const categoryRates = hasResolvedRates
      ? {
          base: Number(legacyRates.baseRate),
          afternoon: Number(legacyRates.eveningShiftRate) || undefined,
          night: Number(legacyRates.nightShiftRate) || undefined,
          saturday: Number(legacyRates.saturdayRate) || undefined,
          sunday: Number(legacyRates.sundayRate) || undefined,
          publicHoliday: Number(legacyRates.publicHolidayRate) || undefined,
          overtimeFirst2h: Number(legacyRates.overtimeRate) || undefined,
          overtimeAfter2h: Number(legacyRates.overtimeRate2) || undefined,
        }
      : null;

    return {
      baseRate,
      isCasual,
      employmentType: employmentTypeRaw || 'full_time',
      categoryRates,
      multipliers: {
        ...multipliers,
        casualLoading:
          award.casualLoadingRate != null
            ? Number(award.casualLoadingRate)
            : multipliers.casualLoading != null
            ? multipliers.casualLoading
            : CASUAL_LOADING_DEFAULT,
      },
      timezone: schadsRates.DEFAULTS.timezone,
      standardHoursPerDay:
        award.standardHoursPerDay || schadsRates.DEFAULTS.standardHoursPerDay,
      allowances: {
        firstAid: !!award.firstAidAllowance,
        meal: !!award.mealAllowanceEligible,
      },
    };
  }

  /**
   * Calculate payroll for a set of shifts for one employee.
   *
   * @param {Object} payrollData - {
   *   userId, period, hours?, shifts?, employee?, holidaySet?
   * }
   */
  async calculatePayroll(payrollData = {}) {
    try {
      const { userId, period } = payrollData;
      const employee = payrollData.employee || {};
      const shifts = Array.isArray(payrollData.shifts) ? payrollData.shifts : [];
      const holidaySet =
        payrollData.holidaySet instanceof Set ? payrollData.holidaySet : new Set();

      if (shifts.length === 0 && payrollData.hours) {
        // Legacy path: callers that only pass an aggregate hours object.
        return this._calculateFromAggregateHours({ ...payrollData, userId });
      }

      const profile = this.resolveProfile(employee, shifts[0]?.startTime);

      // Aggregate across shifts using the segmented engine.
      const totals = this._emptyTotals();
      let shiftAmountTotal = 0;
      const allowanceTotals = { firstAid: 0, meal: 0, sleepover: 0 };
      const firstAidByWeek = new Map();
      const weeklyShifts = [];

      for (const shift of shifts) {
        const {
          aggregates,
          amount,
          segments: pricedSegments,
        } = schadsService.calculateShiftAmount(shift, {
          baseRate: profile.baseRate,
          isCasual: profile.isCasual,
          categoryRates: profile.categoryRates,
          multipliers: profile.multipliers,
          timezone: profile.timezone,
          standardHoursPerDay: profile.standardHoursPerDay,
          holidaySet,
        });

        this._accumulateHours(totals, aggregates);
        shiftAmountTotal += amount.gross;

        if (Array.isArray(pricedSegments)) {
          weeklyShifts.push({
            startTime: shift.startTime,
            segments: pricedSegments.map((segment) => ({
              category: segment.category,
              hours: segment.hours,
              rate: segment.rate,
            })),
          });
        }

        // Shift-type allowances. Amounts are effective-dated data, resolved
        // against the shift date so historical pay is reproducible.
        const shiftAllowances = schadsRates.resolveAllowances(undefined, shift.startTime);
        const type = (shift.shiftType || '').toString().toLowerCase();
        if (type === 'sleepover') {
          allowanceTotals.sleepover += shiftAllowances.sleepoverAllowance;
        }
        if (profile.allowances.firstAid && shift.firstAidShift) {
          const key = weekKey(shift.startTime);
          const employmentType = String(profile.employmentType || '').toLowerCase();
          const isPartTimeOrCasual =
            employmentType.includes('casual') ||
            employmentType.includes('part') ||
            /(^|[_\s-])pt($|[_\s-])/.test(employmentType);
          if (isPartTimeOrCasual && shiftAllowances.firstAidHourly != null) {
            // Part-time/casual: $0.56 per hour, capped per week.
            const maxWeekly =
              shiftAllowances.firstAidMaxWeekly ?? shiftAllowances.firstAidAllowance;
            const accrued =
              (firstAidByWeek.get(key) || 0) +
              shiftAllowances.firstAidHourly * (aggregates.totalHours || 0);
            firstAidByWeek.set(key, Math.min(maxWeekly, accrued));
          } else {
            // Full-time: the weekly first-aid allowance, once per week.
            firstAidByWeek.set(key, shiftAllowances.firstAidAllowance);
          }
        }
        const overtimeHours =
          (aggregates.overtimeFirst2h || 0) + (aggregates.overtimeAfter2h || 0);
        if (profile.allowances.meal && overtimeHours > 0) {
          allowanceTotals.meal += shiftAllowances.mealAllowance;
          if (
            overtimeHours > 4 &&
            shiftAllowances.mealAdditionalAfter4hOvertime
          ) {
            allowanceTotals.meal += shiftAllowances.mealAdditionalAfter4hOvertime;
          }
        }
      }

      allowanceTotals.firstAid =
        Math.round(
          Array.from(firstAidByWeek.values()).reduce((sum, v) => sum + v, 0) * 100,
        ) / 100;

      const allowancesTotal =
        allowanceTotals.firstAid + allowanceTotals.meal + allowanceTotals.sleepover;

      // Weekly overtime is a separate SCHADS obligation from daily overtime.
      // Only the premium is added, because the ordinary hours are already in
      // shiftAmountTotal.
      const weeklyOvertime = weeklyOvertimeService.calculateWeeklyOvertime({
        shifts: weeklyShifts,
        employmentType: profile.employmentType,
        multipliers: profile.multipliers,
        baseRate: profile.baseRate,
      });
      const grossFromShifts = shiftAmountTotal + weeklyOvertime.amount;

      const penalties = this._buildPenalties(totals, profile, grossFromShifts);
      penalties.weeklyOvertime = weeklyOvertime;
      penalties.total = this._round(penalties.total + weeklyOvertime.amount);
      const grossPay = grossFromShifts + allowancesTotal;

      return this._buildResult({
        userId,
        period,
        profile,
        totals,
        penalties,
        weeklyOvertime,
        allowances: {
          travel: 0,
          meal: allowanceTotals.meal,
          sleepover: allowanceTotals.sleepover,
          firstAid: allowanceTotals.firstAid,
          total: allowancesTotal,
        },
        grossPay,
      });
    } catch (error) {
      logger.error('Error calculating payroll:', error);
      return {
        success: false,
        message: 'Failed to calculate payroll',
        error: error.message,
      };
    }
  }

  /**
   * Legacy aggregate path: compute penalties from summed hours using the
   * resolved base rate. Kept so older callers keep working.
   */
  _calculateFromAggregateHours(payrollData) {
    const { userId, period, hours = {}, employee = {} } = payrollData;
    const profile = this.resolveProfile(employee);
    const baseRate = profile.baseRate;
    const loaded = 1 + (profile.isCasual ? profile.multipliers.casualLoading : 0);
    const mult = profile.multipliers;

    const penalties = {
      saturday: {
        hours: hours.saturday || 0,
        rate: baseRate * (mult.saturday || 1.5) * loaded,
        amount: (hours.saturday || 0) * baseRate * (mult.saturday || 1.5) * loaded,
      },
      sunday: {
        hours: hours.sunday || 0,
        rate: baseRate * (mult.sunday || 1.75) * loaded,
        amount: (hours.sunday || 0) * baseRate * (mult.sunday || 1.75) * loaded,
      },
      publicHoliday: {
        hours: hours.publicHoliday || 0,
        rate: baseRate * (mult.publicHoliday || 2.5) * loaded,
        amount: (hours.publicHoliday || 0) * baseRate * (mult.publicHoliday || 2.5) * loaded,
      },
      overtime: {
        hours: hours.overtime || 0,
        rate: baseRate * (mult.overtimeFirst2h || 1.5),
        amount: (hours.overtime || 0) * baseRate * (mult.overtimeFirst2h || 1.5),
      },
      total: 0,
    };
    penalties.total = this._round(
      penalties.saturday.amount +
        penalties.sunday.amount +
        penalties.publicHoliday.amount +
        penalties.overtime.amount,
    );

    const baseHours = hours.regular || 0;
    const baseAmount = baseHours * baseRate * loaded;
    const allowanceDate =
      payrollData.period?.endDate ||
      payrollData.period?.end ||
      payrollData.period?.startDate ||
      payrollData.period?.start ||
      payrollData.date;
    const allowanceRates = schadsRates.resolveAllowances(undefined, allowanceDate);
    const allowances = {
      travel: payrollData.travelKm ? payrollData.travelKm * 0.85 : 0,
      meal: payrollData.mealAllowance || 0,
      sleepover: payrollData.sleepovers
        ? payrollData.sleepovers * allowanceRates.sleepoverAllowance
        : 0,
      firstAid: payrollData.hasFirstAid ? allowanceRates.firstAidAllowance : 0,
      total: 0,
    };
    allowances.total = this._round(
      allowances.travel + allowances.meal + allowances.sleepover + allowances.firstAid,
    );

    const grossPay = baseAmount + penalties.total + allowances.total;
    const taxAndSuper = this.calculateTaxAndSuper(grossPay);

    return {
      success: true,
      data: {
        userId,
        period,
        baseHours,
        baseRate,
        baseAmount: this._round(baseAmount),
        penalties,
        allowances,
        leaveAccrual: this.calculateLeaveAccrual(baseHours, baseRate),
        taxAndSuper,
        grossPay: this._round(grossPay),
        netPay: this._round(grossPay - taxAndSuper.tax),
        estimateOnly: true,
      },
    };
  }

  _emptyTotals() {
    return {
      baseHours: 0,
      afternoonShiftHours: 0,
      nightShiftHours: 0,
      saturdayHours: 0,
      sundayHours: 0,
      publicHolidayHours: 0,
      overtimeFirst2h: 0,
      overtimeAfter2h: 0,
      totalHours: 0,
    };
  }

  _accumulateHours(totals, aggregates) {
    for (const key of Object.keys(totals)) {
      totals[key] += aggregates[key] || 0;
    }
  }

  /** Resolve the dollar rate for a category, honouring legacy resolved rates. */
  _categoryRate(profile, category) {
    const cr = profile.categoryRates;
    if (cr && cr[category] != null && cr[category] > 0) return cr[category];
    const baseRate = profile.baseRate;
    const mult = profile.multipliers;
    const casual = profile.isCasual ? mult.casualLoading || 0 : 0;
    switch (category) {
      case 'afternoon':
        return baseRate * ((mult.afternoon || 1.125) + casual);
      case 'night':
        return baseRate * ((mult.night || 1.15) + casual);
      case 'saturday':
        return baseRate * ((mult.saturday || 1.5) + casual);
      case 'sunday':
        return baseRate * ((mult.sunday || 2.0) + casual);
      case 'publicHoliday':
        return baseRate * ((mult.publicHoliday || 2.5) + casual);
      case 'overtimeFirst2h':
        return baseRate * (mult.overtimeFirst2h || 1.5);
      case 'overtimeAfter2h':
        return baseRate * (mult.overtimeAfter2h || 2.0);
      case 'base':
      default:
        return baseRate * (mult.base || 1) * (1 + casual);
    }
  }

  _buildPenalties(totals, profile, grossFromShifts) {
    const satRate = this._categoryRate(profile, 'saturday');
    const sunRate = this._categoryRate(profile, 'sunday');
    const phRate = this._categoryRate(profile, 'publicHoliday');
    const ot1Rate = this._categoryRate(profile, 'overtimeFirst2h');
    const ot2Rate = this._categoryRate(profile, 'overtimeAfter2h');

    const saturday = {
      hours: this._round(totals.saturdayHours),
      rate: this._round(satRate),
      amount: this._round(totals.saturdayHours * satRate),
    };
    const sunday = {
      hours: this._round(totals.sundayHours),
      rate: this._round(sunRate),
      amount: this._round(totals.sundayHours * sunRate),
    };
    const publicHoliday = {
      hours: this._round(totals.publicHolidayHours),
      rate: this._round(phRate),
      amount: this._round(totals.publicHolidayHours * phRate),
    };
    const overtime = {
      hours: this._round(totals.overtimeFirst2h + totals.overtimeAfter2h),
      rate: this._round(ot1Rate),
      amount: this._round(
        totals.overtimeFirst2h * ot1Rate + totals.overtimeAfter2h * ot2Rate,
      ),
    };

    const total = this._round(
      saturday.amount + sunday.amount + publicHoliday.amount + overtime.amount,
    );

    return { saturday, sunday, publicHoliday, overtime, total, grossFromShifts: this._round(grossFromShifts) };
  }

  _buildResult({ userId, period, profile, totals, penalties, weeklyOvertime, allowances, grossPay }) {
    const baseHours = totals.baseHours + totals.afternoonShiftHours + totals.nightShiftHours;
    const baseAmount = this._round(
      totals.baseHours * this._categoryRate(profile, 'base') +
        totals.afternoonShiftHours * this._categoryRate(profile, 'afternoon') +
        totals.nightShiftHours * this._categoryRate(profile, 'night'),
    );

    const taxAndSuper = this.calculateTaxAndSuper(grossPay);

    return {
      success: true,
      data: {
        userId,
        period,
        baseHours: this._round(baseHours),
        baseRate: profile.baseRate,
        baseAmount,
        hoursBreakdown: {
          baseHours: this._round(totals.baseHours),
          afternoonShiftHours: this._round(totals.afternoonShiftHours),
          nightShiftHours: this._round(totals.nightShiftHours),
          saturdayHours: this._round(totals.saturdayHours),
          sundayHours: this._round(totals.sundayHours),
          publicHolidayHours: this._round(totals.publicHolidayHours),
          overtimeFirst2h: this._round(totals.overtimeFirst2h),
          overtimeAfter2h: this._round(totals.overtimeAfter2h),
          totalHours: this._round(totals.totalHours),
        },
        penalties,
        weeklyOvertime: weeklyOvertime || null,
        allowances,
        leaveAccrual: this.calculateLeaveAccrual(baseHours, profile.baseRate),
        taxAndSuper,
        grossPay: this._round(grossPay),
        netPay: this._round(grossPay - taxAndSuper.tax),
        estimateOnly: true,
      },
    };
  }

  calculateLeaveAccrual(hours, rate) {
    const annualLeaveRate = 0.0769; // 4 weeks per year
    const sickLeaveRate = 0.0385; // 2 weeks per year

    return {
      annualLeave: {
        hours: this._round(hours * annualLeaveRate),
        amount: this._round(hours * rate * annualLeaveRate),
      },
      sickLeave: {
        hours: this._round(hours * sickLeaveRate),
        amount: this._round(hours * rate * sickLeaveRate),
      },
    };
  }

  calculateTaxAndSuper(grossPay) {
    const taxRate = 0.19; // simplified bracket $18,201 - $45,000
    const superRate = 0.11; // 11% superannuation
    return {
      tax: this._round(grossPay * taxRate),
      super: this._round(grossPay * superRate),
      taxRate,
      superRate,
    };
  }

  /**
   * Generate a payslip for a user/period.
   * Derives from PayrollRecord when available; otherwise returns a structured
   * (empty-safe) payslip placeholder. Retains the original response shape.
   *
   * `organizationId` is required: payroll records hold a per-organisation
   * salary, so a lookup that is not scoped by tenant returns another
   * organisation's numbers for the same employee id.
   */
  async generatePayslip(userId, period, organizationId = null) {
    try {
      if (!organizationId) {
        return { success: false, message: 'Organization ID is required.' };
      }

      const PayrollRecord = require('../models/PayrollRecord');
      const records = await PayrollRecord.find({
        employeeId: userId,
        organizationId: String(organizationId),
      })
        .sort({ periodStart: -1 })
        .lean();

      let record = null;
      if (period) {
        record = records.find((r) => this._periodMatches(r, period));
      }
      if (!record && records.length > 0) {
        record = records[0];
      }

      if (!record) {
        return {
          success: true,
          data: {
            payslipId: `PAYSLIP-${Date.now()}`,
            userId,
            period: period || '',
            generatedDate: new Date().toISOString(),
            earnings: {
              baseHours: 0,
              baseRate: 0,
              baseAmount: 0,
              penalties: 0,
              allowances: 0,
              total: 0,
            },
            deductions: { tax: 0, super: 0, total: 0 },
            netPay: 0,
            ytd: { grossPay: 0, tax: 0, super: 0, netPay: 0 },
            message: 'No payroll records found for this employee.',
          },
        };
      }

      const grossPay = this._round(record.grossPay);
      const tax = this._round(record.taxWithheld);
      const superContribution = this._round(record.superContribution);
      const netPay = this._round(record.netPay);

      return {
        success: true,
        data: {
          payslipId: `PAYSLIP-${record._id || Date.now()}`,
          userId,
          period: period || this._periodLabel(record),
          generatedDate: new Date().toISOString(),
          earnings: {
            baseHours: this._round(record.totalHours),
            baseRate: grossPay && record.totalHours ? this._round(grossPay / record.totalHours) : 0,
            baseAmount: grossPay,
            penalties: 0,
            allowances: 0,
            total: grossPay,
          },
          deductions: {
            tax,
            super: superContribution,
            total: this._round(tax + superContribution),
          },
          netPay,
          ytd: {
            grossPay,
            tax,
            super: superContribution,
            netPay,
          },
        },
      };
    } catch (error) {
      logger.error('Error generating payslip:', error);
      return {
        success: false,
        message: 'Failed to generate payslip',
        error: error.message,
      };
    }
  }

  _periodMatches(record, period) {
    if (!record || !record.periodStart) return false;
    const label = this._periodLabel(record);
    return label === period;
  }

  _periodLabel(record) {
    if (!record || !record.periodStart) return '';
    const start = new Date(record.periodStart);
    return `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  _round(value) {
    const numeric = Number(value) || 0;
    return Math.round(numeric * 100) / 100;
  }
}

module.exports = new AdvancedPayrollService();
