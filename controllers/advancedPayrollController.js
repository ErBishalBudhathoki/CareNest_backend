const advancedPayrollService = require('../services/advancedPayrollService');
const PayrollRecord = require('../models/PayrollRecord');
const User = require('../models/User');
const { Invoice } = require('../models/Invoice');
const mongoose = require('mongoose');

const SUPPORTED_EXPORT_FORMATS = ['json', 'csv', 'xero', 'myob'];

class AdvancedPayrollController {
  async calculatePayroll(req, res) {
    try {
      const payrollData = req.body;
      const result = await advancedPayrollService.calculatePayroll(payrollData);
      return res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }
  
  async getPayslip(req, res) {
    try {
      const { userId, period } = req.params;
      const result = await advancedPayrollService.generatePayslip(userId, period);
      return res.status(result.success ? 200 : 500).json(result);
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }
  
  async generatePayslips(req, res) {
    try {
      const body = req.body || {};
      const organizationId = this._resolveOrganizationId(
        body.organizationId,
        req.user
      );

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID is required.'
        });
      }

      if (!this._canAccessOrganization(req.user, organizationId)) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to generate payslips for this organization.'
        });
      }

      const range = this._parseDateRange({
        period: body.period,
        startDate: body.startDate,
        endDate: body.endDate
      });

      if (!range.valid) {
        return res.status(400).json({
          success: false,
          message: range.message
        });
      }

      const {
        periodStart,
        periodEndExclusive,
        periodLabel,
        rangeStartIso,
        rangeEndIso
      } = range;
      const periodEndInclusive = new Date(periodEndExclusive.getTime() - 1);

      // Employee invoices are the source of truth for payroll generation.
      // We include createdAt fallbacks for legacy data where line-item dates were not persisted.
      const employeeInvoices = await Invoice.find({
        organizationId,
        'metadata.invoiceType': 'employee',
        'deletion.isDeleted': { $ne: true },
        $or: [
          { 'lineItems.date': { $gte: periodStart, $lt: periodEndExclusive } },
          { 'auditTrail.createdAt': { $gte: periodStart, $lt: periodEndExclusive } },
          { createdAt: { $gte: periodStart, $lt: periodEndExclusive } }
        ]
      }).lean();

      if (employeeInvoices.length === 0) {
        return res.status(200).json({
          success: true,
          message: 'No employee invoices found for the selected period.',
          data: {
            organizationId,
            period: periodLabel,
            dateRange: {
              startDate: rangeStartIso,
              endDate: rangeEndIso
            },
            sourceInvoiceCount: 0,
            payslipsGenerated: 0,
            employeesProcessed: 0,
            skippedInvoices: 0
          }
        });
      }

      const candidateEmployeeIds = new Set();
      const candidateEmployeeEmails = new Set();

      for (const invoice of employeeInvoices) {
        const profile = this._extractEmployeeProfile(invoice);
        if (profile.employeeId && mongoose.Types.ObjectId.isValid(profile.employeeId)) {
          candidateEmployeeIds.add(profile.employeeId);
        }
        if (profile.employeeEmail) {
          candidateEmployeeEmails.add(profile.employeeEmail.toLowerCase());
        }
      }

      let users = [];
      const userLookupConditions = [
        ...(candidateEmployeeIds.size > 0
          ? [{ _id: { $in: Array.from(candidateEmployeeIds) } }]
          : []),
        ...(candidateEmployeeEmails.size > 0
          ? [{ email: { $in: Array.from(candidateEmployeeEmails) } }]
          : [])
      ];

      if (userLookupConditions.length > 0) {
        users = await User.find({
          organizationId,
          $or: userLookupConditions
        }, 'firstName lastName email').lean();
      }

      const usersById = new Map(
        users.map((user) => [user._id.toString(), user])
      );
      const usersByEmail = new Map(
        users
          .filter((user) => typeof user.email === 'string')
          .map((user) => [user.email.toLowerCase(), user])
      );

      const aggregatedByEmployee = new Map();
      const skippedInvoices = [];

      for (const invoice of employeeInvoices) {
        const profile = this._extractEmployeeProfile(invoice);
        const resolvedUser = this._resolveEmployeeUser(profile, usersById, usersByEmail);

        if (!resolvedUser) {
          skippedInvoices.push({
            invoiceNumber: invoice.invoiceNumber || '',
            reason: 'Unable to resolve employee identity from invoice payload.'
          });
          continue;
        }

        const totals = this._extractInvoicePayrollTotals(
          invoice,
          periodStart,
          periodEndExclusive
        );

        if (totals.grossPay <= 0 && totals.totalHours <= 0) {
          skippedInvoices.push({
            invoiceNumber: invoice.invoiceNumber || '',
            reason: 'Invoice contains no payroll totals for the selected period.'
          });
          continue;
        }

        const key = resolvedUser._id.toString();
        const existing = aggregatedByEmployee.get(key) || {
          employee: resolvedUser,
          employeeName: this._displayNameForUser(resolvedUser),
          grossPay: 0,
          totalHours: 0,
          sourceInvoiceCount: 0
        };

        existing.grossPay += totals.grossPay;
        existing.totalHours += totals.totalHours;
        existing.sourceInvoiceCount += 1;
        aggregatedByEmployee.set(key, existing);
      }

      if (aggregatedByEmployee.size === 0) {
        return res.status(200).json({
          success: true,
          message: 'Employee invoices were found, but none contained payable data.',
          data: {
            organizationId,
            period: periodLabel,
            dateRange: {
              startDate: rangeStartIso,
              endDate: rangeEndIso
            },
            sourceInvoiceCount: employeeInvoices.length,
            payslipsGenerated: 0,
            employeesProcessed: 0,
            skippedInvoices: skippedInvoices.length,
            skippedDetails: skippedInvoices.slice(0, 20)
          }
        });
      }

      const generatedBy = req.user?.email || req.user?.userId || 'system';
      const upsertOperations = [];
      const employeeSummaries = [];

      for (const employeeAggregate of aggregatedByEmployee.values()) {
        const grossPay = this._round(employeeAggregate.grossPay);
        const totalHours = this._round(employeeAggregate.totalHours);
        const taxWithheld = this._round(grossPay * 0.19);
        const superContribution = this._round(grossPay * 0.11);
        const netPay = this._round(grossPay - taxWithheld);

        upsertOperations.push({
          updateOne: {
            filter: {
              employeeId: employeeAggregate.employee._id,
              organizationId,
              periodStart,
              periodEnd: periodEndInclusive
            },
            update: {
              $set: {
                employeeId: employeeAggregate.employee._id,
                employeeName: employeeAggregate.employeeName,
                organizationId,
                periodStart,
                periodEnd: periodEndInclusive,
                grossPay,
                taxWithheld,
                superContribution,
                netPay,
                totalHours,
                earningsBreakdown: {
                  basePay: grossPay,
                  saturdayPenalty: 0,
                  sundayPenalty: 0,
                  publicHolidayPenalty: 0,
                  nightShiftPenalty: 0,
                  overtimePay: 0,
                  allowances: 0
                },
                status: 'approved',
                metadata: {
                  generatedAt: new Date(),
                  generatedBy
                }
              }
            },
            upsert: true
          }
        });

        employeeSummaries.push({
          employeeId: employeeAggregate.employee._id.toString(),
          employeeEmail: employeeAggregate.employee.email || '',
          employeeName: employeeAggregate.employeeName,
          sourceInvoiceCount: employeeAggregate.sourceInvoiceCount,
          totalHours,
          grossPay,
          taxWithheld,
          superContribution,
          netPay
        });
      }

      await PayrollRecord.bulkWrite(upsertOperations, { ordered: false });

      const totals = employeeSummaries.reduce((acc, row) => {
        acc.totalHours += row.totalHours;
        acc.totalGrossPay += row.grossPay;
        acc.totalTax += row.taxWithheld;
        acc.totalSuper += row.superContribution;
        acc.totalNetPay += row.netPay;
        return acc;
      }, {
        totalHours: 0,
        totalGrossPay: 0,
        totalTax: 0,
        totalSuper: 0,
        totalNetPay: 0
      });

      return res.status(200).json({
        success: true,
        message: `Generated ${employeeSummaries.length} payslip record(s) from employee invoices.`,
        data: {
          organizationId,
          period: periodLabel,
          dateRange: {
            startDate: rangeStartIso,
            endDate: rangeEndIso
          },
          sourceInvoiceCount: employeeInvoices.length,
          payslipsGenerated: employeeSummaries.length,
          employeesProcessed: employeeSummaries.length,
          skippedInvoices: skippedInvoices.length,
          totals: {
            totalHours: this._round(totals.totalHours),
            totalGrossPay: this._round(totals.totalGrossPay),
            totalTax: this._round(totals.totalTax),
            totalSuper: this._round(totals.totalSuper),
            totalNetPay: this._round(totals.totalNetPay)
          },
          employees: employeeSummaries,
          skippedDetails: skippedInvoices.slice(0, 20)
        }
      });
    } catch (error) {
      console.error('Error generating payslips:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  }
  
  async getPayrollSummary(req, res) {
    try {
      const organizationId = this._resolveOrganizationId(
        req.params.organizationId,
        req.user
      );
      const { period } = req.params;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID is required.'
        });
      }

      if (!this._canAccessOrganization(req.user, organizationId)) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to access this organization.'
        });
      }

      const range = this._parseDateRange({ period });
      if (!range.valid) {
        return res.status(400).json({
          success: false,
          message: range.message
        });
      }

      const { periodStart, periodEndExclusive } = range;

      // Get all payroll records for this organization and period
      const payrollRecords = await PayrollRecord.find({
        organizationId,
        periodStart: { $gte: periodStart, $lt: periodEndExclusive }
      }).lean();
      
      // Get total employees count for organization
      const totalEmployees = await User.countDocuments({
        organizationId,
        isActive: true
      });
      
      // Calculate totals from payroll records
      let totalGrossPay = 0;
      let totalTax = 0;
      let totalSuper = 0;
      let totalNetPay = 0;
      
      const employeeSummaries = payrollRecords.map(record => ({
        userId: record.employeeId?.toString() || '',
        userName: record.employeeName || 'Unknown',
        grossPay: record.grossPay || 0,
        netPay: record.netPay || 0
      }));
      
      payrollRecords.forEach(record => {
        totalGrossPay += record.grossPay || 0;
        totalTax += record.taxWithheld || 0;
        totalSuper += record.superContribution || 0;
        totalNetPay += record.netPay || 0;
      });
      
      // If no payroll records exist, return zeros (not an error)
      return res.status(200).json({
        success: true,
        data: {
          organizationId,
          period,
          totalEmployees,
          totalGrossPay: Math.round(totalGrossPay * 100) / 100,
          totalTax: Math.round(totalTax * 100) / 100,
          totalSuper: Math.round(totalSuper * 100) / 100,
          totalNetPay: Math.round(totalNetPay * 100) / 100,
          employees: employeeSummaries
        }
      });
    } catch (error) {
      console.error('Error getting payroll summary:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  }
  
  async exportPayrollData(req, res) {
    try {
      const body = req.body || {};
      const format = String(body.format || 'json').toLowerCase();
      const organizationId = this._resolveOrganizationId(
        body.organizationId,
        req.user
      );

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID is required.'
        });
      }

      if (!this._canAccessOrganization(req.user, organizationId)) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to export payroll for this organization.'
        });
      }

      if (!SUPPORTED_EXPORT_FORMATS.includes(format)) {
        return res.status(400).json({
          success: false,
          message: `Invalid export format. Supported formats: ${SUPPORTED_EXPORT_FORMATS.join(', ')}.`
        });
      }

      const range = this._parseDateRange({
        period: body.period,
        startDate: body.startDate,
        endDate: body.endDate
      });

      if (!range.valid) {
        return res.status(400).json({
          success: false,
          message: range.message
        });
      }

      const {
        periodStart,
        periodEndExclusive,
        periodLabel,
        rangeStartIso,
        rangeEndIso
      } = range;

      const payrollRecords = await PayrollRecord.find({
        organizationId,
        periodStart: { $gte: periodStart, $lt: periodEndExclusive }
      })
        .sort({ employeeName: 1, createdAt: 1 })
        .lean();

      const employeeIds = [
        ...new Set(
          payrollRecords
            .map((record) => record.employeeId?.toString?.())
            .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
        ),
      ];

      const employees = employeeIds.length
        ? await User.find({ _id: { $in: employeeIds } }, 'firstName lastName email').lean()
        : [];

      const employeeMap = new Map(
        employees.map((employee) => [employee._id.toString(), employee])
      );

      const payrollRows = payrollRecords.map((record) => {
        const employeeId = record.employeeId?.toString?.() || '';
        const employee = employeeMap.get(employeeId);
        const fallbackName = [employee?.firstName, employee?.lastName]
          .filter(Boolean)
          .join(' ')
          .trim();

        return {
          employeeId,
          employeeName: record.employeeName || fallbackName || 'Unknown',
          employeeEmail: employee?.email || '',
          totalHours: this._round(record.totalHours),
          grossPay: this._round(record.grossPay),
          taxWithheld: this._round(record.taxWithheld),
          superContribution: this._round(record.superContribution),
          netPay: this._round(record.netPay),
          status: record.status || 'draft',
          periodStart: record.periodStart
            ? new Date(record.periodStart).toISOString().slice(0, 10)
            : rangeStartIso,
          periodEnd: record.periodEnd
            ? new Date(record.periodEnd).toISOString().slice(0, 10)
            : rangeEndIso,
        };
      });

      const summary = payrollRows.reduce(
        (acc, row) => {
          acc.totalEmployees += 1;
          acc.totalHours += row.totalHours;
          acc.totalGrossPay += row.grossPay;
          acc.totalTax += row.taxWithheld;
          acc.totalSuper += row.superContribution;
          acc.totalNetPay += row.netPay;
          return acc;
        },
        {
          totalEmployees: 0,
          totalHours: 0,
          totalGrossPay: 0,
          totalTax: 0,
          totalSuper: 0,
          totalNetPay: 0
        }
      );

      summary.totalHours = this._round(summary.totalHours);
      summary.totalGrossPay = this._round(summary.totalGrossPay);
      summary.totalTax = this._round(summary.totalTax);
      summary.totalSuper = this._round(summary.totalSuper);
      summary.totalNetPay = this._round(summary.totalNetPay);

      if (format === 'json') {
        return res.status(200).json({
          success: true,
          message: payrollRows.length
            ? 'Payroll data exported successfully.'
            : 'No payroll data found for the selected period.',
          data: {
            format,
            organizationId,
            period: periodLabel,
            dateRange: {
              startDate: rangeStartIso,
              endDate: rangeEndIso
            },
            summary,
            rows: payrollRows,
            exportedAt: new Date().toISOString()
          }
        });
      }

      if (format === 'csv') {
        const csvHeaders = [
          'employee_name',
          'employee_email',
          'total_hours',
          'gross_pay',
          'tax_withheld',
          'super_contribution',
          'net_pay',
          'period_start',
          'period_end',
          'status'
        ];

        const csvRows = payrollRows.map((row) => ({
          employee_name: row.employeeName,
          employee_email: row.employeeEmail,
          total_hours: row.totalHours,
          gross_pay: row.grossPay,
          tax_withheld: row.taxWithheld,
          super_contribution: row.superContribution,
          net_pay: row.netPay,
          period_start: row.periodStart,
          period_end: row.periodEnd,
          status: row.status
        }));

        const csv = csvRows.length
          ? this._buildCsv(csvRows)
          : this._buildCsvTemplate(csvHeaders);
        return res.status(200).json({
          success: true,
          message: payrollRows.length
            ? 'Payroll CSV export generated successfully.'
            : 'No payroll data found. Returning empty CSV template.',
          filename: `payroll_export_${periodLabel}.csv`,
          csv,
          summary
        });
      }

      const providerRows = format === 'xero'
        ? payrollRows.map((row) => ({
            employee_name: row.employeeName,
            email: row.employeeEmail,
            pay_period_start: row.periodStart,
            pay_period_end: row.periodEnd,
            ordinary_hours: row.totalHours,
            gross_earnings: row.grossPay,
            tax_withheld: row.taxWithheld,
            super_contribution: row.superContribution,
            net_pay: row.netPay
          }))
        : payrollRows.map((row) => ({
            employee_name: row.employeeName,
            email: row.employeeEmail,
            pay_period_start: row.periodStart,
            pay_period_end: row.periodEnd,
            total_hours: row.totalHours,
            gross_pay: row.grossPay,
            payg_withholding: row.taxWithheld,
            super_guarantee: row.superContribution,
            net_pay: row.netPay
          }));

      const providerHeaders = format === 'xero'
        ? [
            'employee_name',
            'email',
            'pay_period_start',
            'pay_period_end',
            'ordinary_hours',
            'gross_earnings',
            'tax_withheld',
            'super_contribution',
            'net_pay'
          ]
        : [
            'employee_name',
            'email',
            'pay_period_start',
            'pay_period_end',
            'total_hours',
            'gross_pay',
            'payg_withholding',
            'super_guarantee',
            'net_pay'
          ];

      return res.status(200).json({
        success: true,
        message: payrollRows.length
          ? `Payroll export payload prepared for ${format.toUpperCase()}.`
          : `No payroll data found for ${format.toUpperCase()} export.`,
        data: {
          format,
          organizationId,
          period: periodLabel,
          dateRange: {
            startDate: rangeStartIso,
            endDate: rangeEndIso
          },
          summary,
          rows: providerRows,
          exportedAt: new Date().toISOString()
        },
        filename: `payroll_export_${format}_${periodLabel}.csv`,
        csv: providerRows.length
          ? this._buildCsv(providerRows)
          : this._buildCsvTemplate(providerHeaders)
      });
    } catch (error) {
      console.error('Error exporting payroll data:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  _resolveOrganizationId(requestedOrganizationId, user) {
    const bodyOrgId = requestedOrganizationId
      ? String(requestedOrganizationId).trim()
      : '';

    if (bodyOrgId) {
      return bodyOrgId;
    }

    const userOrgId = user?.organizationId
      ? String(user.organizationId).trim()
      : '';

    if (userOrgId) {
      return userOrgId;
    }

    const lastActiveOrgId = user?.lastActiveOrganizationId
      ? String(user.lastActiveOrganizationId).trim()
      : '';

    return lastActiveOrgId || null;
  }

  _canAccessOrganization(user, organizationId) {
    if (!organizationId) return false;
    if (!user) return false;

    const userOrgId = user.organizationId
      ? String(user.organizationId).trim()
      : '';

    if (userOrgId && userOrgId === organizationId) {
      return true;
    }

    const roles = Array.isArray(user.roles) && user.roles.length
      ? user.roles
      : (user.role ? [user.role] : []);

    return roles.includes('superadmin');
  }

  _parseDateRange({ period, startDate, endDate }) {
    const trimmedPeriod = typeof period === 'string' ? period.trim() : '';
    if (trimmedPeriod) {
      const periodRegex = /^(\d{4})-(0[1-9]|1[0-2])$/;
      const match = trimmedPeriod.match(periodRegex);
      if (!match) {
        return {
          valid: false,
          message: 'Invalid period format. Use YYYY-MM format.'
        };
      }

      const year = Number(match[1]);
      const month = Number(match[2]);
      const periodStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
      const periodEndExclusive = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
      const rangeEnd = new Date(periodEndExclusive.getTime() - 1);

      return {
        valid: true,
        periodStart,
        periodEndExclusive,
        periodLabel: trimmedPeriod,
        rangeStartIso: periodStart.toISOString().slice(0, 10),
        rangeEndIso: rangeEnd.toISOString().slice(0, 10)
      };
    }

    if (!startDate || !endDate) {
      return {
        valid: false,
        message: 'Either period (YYYY-MM) or both startDate and endDate are required.'
      };
    }

    const rangeStart = new Date(startDate);
    const rangeEnd = new Date(endDate);

    if (
      Number.isNaN(rangeStart.getTime()) ||
      Number.isNaN(rangeEnd.getTime())
    ) {
      return {
        valid: false,
        message: 'Invalid startDate or endDate.'
      };
    }

    rangeStart.setHours(0, 0, 0, 0);
    rangeEnd.setHours(23, 59, 59, 999);

    if (rangeEnd < rangeStart) {
      return {
        valid: false,
        message: 'endDate must be greater than or equal to startDate.'
      };
    }

    const periodEndExclusive = new Date(rangeEnd.getTime() + 1);
    const label = `${rangeStart.toISOString().slice(0, 10)}_to_${rangeEnd
      .toISOString()
      .slice(0, 10)}`;

    return {
      valid: true,
      periodStart: rangeStart,
      periodEndExclusive,
      periodLabel: label,
      rangeStartIso: rangeStart.toISOString().slice(0, 10),
      rangeEndIso: rangeEnd.toISOString().slice(0, 10)
    };
  }

  _round(value) {
    const numeric = Number(value) || 0;
    return Math.round(numeric * 100) / 100;
  }

  _displayNameForUser(user) {
    const name = [user?.firstName, user?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (name) return name;
    return user?.email || 'Unknown Employee';
  }

  _resolveEmployeeUser(profile, usersById, usersByEmail) {
    if (!profile) return null;

    if (profile.employeeId && usersById.has(profile.employeeId)) {
      return usersById.get(profile.employeeId);
    }

    if (profile.employeeEmail) {
      const normalized = profile.employeeEmail.toLowerCase();
      if (usersByEmail.has(normalized)) {
        return usersByEmail.get(normalized);
      }
    }

    return null;
  }

  _extractEmployeeProfile(invoice) {
    const employeeContext = invoice?.employeeContext || {};
    const payloadClient = this._firstPayloadClient(invoice);
    const payloadEmployeeDetails = payloadClient?.employeeDetails || {};
    const payloadMeta = invoice?.metadata || {};
    const billedTo = invoice?.header?.billedTo || {};

    const employeeId = this._normalizeString(
      employeeContext.employeeId ||
      payloadEmployeeDetails.id ||
      payloadEmployeeDetails.employeeId ||
      payloadMeta.employeeId
    );

    const employeeEmail = this._normalizeString(
      employeeContext.employeeEmail ||
      billedTo.email ||
      payloadClient?.employeeEmail ||
      payloadEmployeeDetails.email ||
      payloadMeta.employeeEmail
    );

    const employeeName = this._normalizeString(
      employeeContext.employeeName ||
      billedTo.name ||
      payloadClient?.employeeName ||
      payloadEmployeeDetails.name
    );

    return {
      employeeId,
      employeeEmail,
      employeeName
    };
  }

  _extractInvoicePayrollTotals(invoice, periodStart, periodEndExclusive) {
    let grossPay = 0;
    let totalHours = 0;

    const addItemTotals = (item) => {
      if (!item || typeof item !== 'object') return;

      const itemDate = this._parseDateLike(item.date);
      if (itemDate && (itemDate < periodStart || itemDate >= periodEndExclusive)) {
        return;
      }

      const quantity = this._toNumber(
        item.quantity ?? item.hours ?? item.totalHours
      );
      const unitPrice = this._toNumber(
        item.price ?? item.rate ?? item.unitPrice
      );
      let lineTotal = this._toNumber(
        item.totalPrice ?? item.amount ?? item.total ?? item.lineTotal
      );

      if (lineTotal <= 0 && quantity > 0 && unitPrice > 0) {
        lineTotal = quantity * unitPrice;
      }

      totalHours += quantity;
      grossPay += lineTotal;
    };

    const lineItems = Array.isArray(invoice?.lineItems) ? invoice.lineItems : [];
    for (const item of lineItems) {
      addItemTotals(item);
    }

    if (grossPay <= 0 && totalHours <= 0) {
      const payloadClient = this._firstPayloadClient(invoice);
      const payloadItems = [
        ...(Array.isArray(payloadClient?.items) ? payloadClient.items : []),
        ...(Array.isArray(payloadClient?.lineItems) ? payloadClient.lineItems : [])
      ];
      for (const item of payloadItems) {
        addItemTotals(item);
      }
    }

    if (grossPay <= 0) {
      const financialSummary = invoice?.financialSummary || {};
      const subtotal = this._toNumber(financialSummary.subtotal);
      const totalAmount = this._toNumber(financialSummary.totalAmount);
      grossPay = subtotal > 0 ? subtotal : totalAmount;
    }

    return {
      grossPay: this._round(grossPay),
      totalHours: this._round(totalHours)
    };
  }

  _firstPayloadClient(invoice) {
    const payload = invoice?.calculatedPayloadData;
    if (!payload || typeof payload !== 'object') return null;
    const clients = Array.isArray(payload.clients) ? payload.clients : [];
    if (clients.length === 0) return null;
    return clients[0] && typeof clients[0] === 'object' ? clients[0] : null;
  }

  _normalizeString(value) {
    if (value === null || value === undefined) return '';
    const normalized = String(value).trim();
    return normalized;
  }

  _toNumber(value) {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const normalized = value.trim();
      if (!normalized) return 0;
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  _parseDateLike(value) {
    if (!value) return null;

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === 'number') {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;

      const isoLike = new Date(trimmed);
      if (!Number.isNaN(isoLike.getTime())) {
        return isoLike;
      }

      const ddmmyyyy = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (ddmmyyyy) {
        const day = Number(ddmmyyyy[1]);
        const month = Number(ddmmyyyy[2]);
        const year = Number(ddmmyyyy[3]);
        const parsed = new Date(Date.UTC(year, month - 1, day));
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      }
    }

    return null;
  }

  _buildCsv(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return '';
    }

    const headers = Object.keys(rows[0]);
    const lines = [headers.map(this._escapeCsvValue).join(',')];

    for (const row of rows) {
      const line = headers.map((header) => {
        const value = row[header];
        return this._escapeCsvValue(value);
      }).join(',');
      lines.push(line);
    }

    return lines.join('\n');
  }

  _buildCsvTemplate(headers) {
    if (!Array.isArray(headers) || headers.length === 0) {
      return '';
    }

    return headers.map((header) => this._escapeCsvValue(header)).join(',');
  }

  _escapeCsvValue(value) {
    if (value === null || value === undefined) {
      return '""';
    }

    const normalized = String(value).replace(/"/g, '""');
    return `"${normalized}"`;
  }
}

module.exports = new AdvancedPayrollController();
