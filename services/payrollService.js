const { MongoClient, ServerApiVersion } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const logger = require('../config/logger');
const schadsService = require('./schadsService');
const taxService = require('./taxService');
const anomalyService = require('./anomalyService');
const userService = require('./userService');

const uri = process.env.MONGODB_URI;

class PayrollService {
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

    /**
     * Generate Payroll Summary for a given period and organization
     */
    async getPayrollSummary(organizationId, startDate, endDate) {
        try {
            const db = await this.connect();

            // 1. Fetch Employees
            const employees = await userService.getOrganizationEmployees(organizationId);

            // 2. Fetch Worked Records (Shifts)
            const query = {
                organizationId: organizationId,
                shiftDate: {
                    $gte: startDate,
                    $lte: endDate
                },
                isActive: true
            };

            const shifts = await db.collection('workedTime').find(query).toArray();

            // 3. Process Data
            const payrollData = {
                summary: {
                    totalEmployees: 0,
                    totalGrossPay: 0,
                    totalHours: 0,
                    totalTax: 0,
                    totalSuper: 0,
                    periodStart: startDate,
                    periodEnd: endDate
                },
                breakdown: {
                    basePay: 0,
                    afternoonPenalties: 0,
                    nightShiftPenalties: 0,
                    saturdayPenalties: 0,
                    sundayPenalties: 0,
                    publicHolidayPenalties: 0,
                    overtimeFirst2h: 0,
                    overtimeAfter2h: 0
                },
                employees: [],
                anomalies: []
            };

            const shiftsByUser = {};
            for (const shift of shifts) {
                if (!shiftsByUser[shift.userEmail]) shiftsByUser[shift.userEmail] = [];
                shiftsByUser[shift.userEmail].push(shift);
            }

            for (const employee of employees) {
                const empShifts = shiftsByUser[employee.email] || [];
                const empResult = this.calculateEmployeePayroll(employee, empShifts);
                
                payrollData.employees.push(empResult);
                
                payrollData.summary.totalEmployees++;
                payrollData.summary.totalGrossPay += empResult.grossPay;
                payrollData.summary.totalHours += empResult.hoursWorked;
                payrollData.summary.totalTax += empResult.tax;
                payrollData.summary.totalSuper += empResult.super;
                
                payrollData.breakdown.basePay += empResult.breakdown.baseEarnings || 0;
                payrollData.breakdown.afternoonPenalties += empResult.breakdown.afternoonEarnings || 0;
                payrollData.breakdown.nightShiftPenalties += empResult.breakdown.nightShiftEarnings || 0;
                payrollData.breakdown.saturdayPenalties += empResult.breakdown.saturdayEarnings || 0;
                payrollData.breakdown.sundayPenalties += empResult.breakdown.sundayEarnings || 0;
                payrollData.breakdown.publicHolidayPenalties += empResult.breakdown.publicHolidayEarnings || 0;
                payrollData.breakdown.overtimeFirst2h += empResult.breakdown.overtimeFirst2hEarnings || 0;
                payrollData.breakdown.overtimeAfter2h += empResult.breakdown.overtimeAfter2hEarnings || 0;
                
                if (empResult.anomalies && empResult.anomalies.length > 0) {
                    payrollData.anomalies.push(...empResult.anomalies.map(a => ({
                        ...a,
                        employeeId: employee._id,
                        employeeName: `${employee.firstName} ${employee.lastName}`
                    })));
                }
            }
            
            this.roundObject(payrollData.summary);
            this.roundObject(payrollData.breakdown);

            return payrollData;

        } catch (error) {
            logger.error('Error generating payroll summary', error);
            throw error;
        }
    }

    /**
     * Calculate payroll for a single employee
     */
    calculateEmployeePayroll(employee, shifts) {
        const result = {
            employeeId: employee._id,
            name: `${employee.firstName} ${employee.lastName}`,
            email: employee.email,
            grossPay: 0,
            hoursWorked: 0,
            tax: 0,
            super: 0,
            breakdown: {},
            anomalies: []
        };

        const hoursBreakdown = {
            baseHours: 0,
            afternoonShiftHours: 0,
            nightShiftHours: 0,
            saturdayHours: 0,
            sundayHours: 0,
            publicHolidayHours: 0,
            overtimeFirst2h: 0,
            overtimeAfter2h: 0
        };
        
        const earningsBreakdown = {
            baseEarnings: 0,
            afternoonEarnings: 0,
            nightShiftEarnings: 0,
            saturdayEarnings: 0,
            sundayEarnings: 0,
            publicHolidayEarnings: 0,
            overtimeFirst2hEarnings: 0,
            overtimeAfter2hEarnings: 0
        };

        const baseRate = parseFloat(employee.payRate) || 0;
        const employmentType = employee.employmentType || 'Permanent'; // Default to Perm if not set
        const isCasual = employmentType.toLowerCase() === 'casual';

        // Define SCHADS Multipliers based on Employment Type
        // Note: We assume 'baseRate' is the Permanent Base Rate.
        // If the user stored a Casual Rate as 'baseRate', we'd need to reverse calc, but standard practice is Perm Base.
        
        const mult = {
            base: isCasual ? 1.25 : 1.0,
            afternoon: isCasual ? 1.375 : 1.125, // 12.5% loading
            night: isCasual ? 1.40 : 1.15,       // 15% loading
            sat: isCasual ? 1.75 : 1.5,          // 150%
            sun: isCasual ? 2.25 : 2.0,          // 200%
            ph: isCasual ? 2.75 : 2.5,           // 250%
            ot1: 1.5, // Casual OT is 150% of Base (not loaded)
            ot2: 2.0  // Casual OT is 200% of Base (not loaded)
        };

        const r = {
            base: baseRate * mult.base,
            afternoon: baseRate * mult.afternoon,
            night: baseRate * mult.night,
            sat: baseRate * mult.sat,
            sun: baseRate * mult.sun,
            ph: baseRate * mult.ph,
            ot1: baseRate * mult.ot1,
            ot2: baseRate * mult.ot2
        };

        for (const shift of shifts) {
            // Calculate Hours Breakdown
            const breakdown = schadsService.calculateShiftBreakdown(shift);
            
            // Accumulate Hours
            result.hoursWorked += breakdown.totalHours;
            hoursBreakdown.baseHours += breakdown.baseHours;
            hoursBreakdown.afternoonShiftHours += (breakdown.afternoonShiftHours || 0);
            hoursBreakdown.nightShiftHours += breakdown.nightShiftHours;
            hoursBreakdown.saturdayHours += breakdown.saturdayHours;
            hoursBreakdown.sundayHours += breakdown.sundayHours;
            hoursBreakdown.publicHolidayHours += breakdown.publicHolidayHours;
            hoursBreakdown.overtimeFirst2h += breakdown.overtimeFirst2h;
            hoursBreakdown.overtimeAfter2h += breakdown.overtimeAfter2h;
            
            // Calculate Earnings for this shift
            earningsBreakdown.baseEarnings += breakdown.baseHours * r.base;
            earningsBreakdown.afternoonEarnings += (breakdown.afternoonShiftHours || 0) * r.afternoon;
            earningsBreakdown.nightShiftEarnings += breakdown.nightShiftHours * r.night;
            earningsBreakdown.saturdayEarnings += breakdown.saturdayHours * r.sat;
            earningsBreakdown.sundayEarnings += breakdown.sundayHours * r.sun;
            earningsBreakdown.publicHolidayEarnings += breakdown.publicHolidayHours * r.ph;
            earningsBreakdown.overtimeFirst2hEarnings += breakdown.overtimeFirst2h * r.ot1;
            earningsBreakdown.overtimeAfter2hEarnings += breakdown.overtimeAfter2h * r.ot2;
            
            // Anomalies
            const shiftAnomalies = anomalyService.checkShift(shift);
            if (shiftAnomalies.length > 0) {
                result.anomalies.push(...shiftAnomalies);
            }
        }

        // Sum Gross Pay
        result.grossPay = Object.values(earningsBreakdown).reduce((a, b) => a + b, 0);
        
        // Calculate Tax & Super
        result.tax = taxService.calculateWithholding(result.grossPay);
        result.super = taxService.calculateSuper(result.grossPay);
        
        // Attach breakdowns
        result.breakdown = earningsBreakdown;
        result.hoursBreakdown = hoursBreakdown;
        
        // Rounding
        result.grossPay = parseFloat(result.grossPay.toFixed(2));
        result.hoursWorked = parseFloat(result.hoursWorked.toFixed(2));
        result.tax = parseFloat(result.tax.toFixed(2));
        result.super = parseFloat(result.super.toFixed(2));
        
        return result;
    }

    roundObject(obj) {
        for (const key in obj) {
            if (typeof obj[key] === 'number') {
                obj[key] = parseFloat(obj[key].toFixed(2));
            }
        }
    }
}

module.exports = new PayrollService();
