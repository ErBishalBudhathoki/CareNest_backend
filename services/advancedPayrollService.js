/**
 * Advanced Payroll Service
 * Comprehensive payroll with award rates and calculations
 */

class AdvancedPayrollService {
  /**
   * Calculate payroll with award rates
   * @param {Object} payrollData - Payroll data
   * @returns {Object} Calculation result
   */
  async calculatePayroll(payrollData) {
    try {
      const { userId, period, hours, awardLevel } = payrollData;
      
      // Mock award rates (SCHADS Award 2024)
      const baseRate = 28.50; // Level 2 base rate
      const calculation = {
        userId,
        period,
        baseHours: hours.regular || 0,
        baseRate,
        baseAmount: (hours.regular || 0) * baseRate,
        penalties: this.calculatePenaltyRates(hours),
        allowances: this.calculateAllowances(payrollData),
        leaveAccrual: this.calculateLeaveAccrual(hours.regular || 0, baseRate),
        taxAndSuper: this.calculateTaxAndSuper((hours.regular || 0) * baseRate),
        grossPay: 0,
        netPay: 0
      };
      
      // Calculate gross pay
      calculation.grossPay = calculation.baseAmount + 
                            calculation.penalties.total +
                            calculation.allowances.total;
      
      // Calculate net pay
      calculation.netPay = calculation.grossPay - 
                          calculation.taxAndSuper.tax +
                          calculation.taxAndSuper.super;
      
      return {
        success: true,
        data: calculation
      };
    } catch (error) {
      console.error('Error calculating payroll:', error);
      return {
        success: false,
        message: 'Failed to calculate payroll',
        error: error.message
      };
    }
  }
  
  /**
   * Calculate penalty rates
   * @param {Object} hours - Hours breakdown
   * @returns {Object} Penalty calculations
   */
  calculatePenaltyRates(hours) {
    const baseRate = 28.50;
    
    return {
      saturday: {
        hours: hours.saturday || 0,
        rate: baseRate * 1.5,
        amount: (hours.saturday || 0) * baseRate * 1.5
      },
      sunday: {
        hours: hours.sunday || 0,
        rate: baseRate * 1.75,
        amount: (hours.sunday || 0) * baseRate * 1.75
      },
      publicHoliday: {
        hours: hours.publicHoliday || 0,
        rate: baseRate * 2.5,
        amount: (hours.publicHoliday || 0) * baseRate * 2.5
      },
      overtime: {
        hours: hours.overtime || 0,
        rate: baseRate * 1.5,
        amount: (hours.overtime || 0) * baseRate * 1.5
      },
      total: 0
    };
  }
  
  /**
   * Calculate allowances
   * @param {Object} payrollData - Payroll data
   * @returns {Object} Allowance calculations
   */
  calculateAllowances(payrollData) {
    return {
      travel: payrollData.travelKm ? payrollData.travelKm * 0.85 : 0,
      meal: payrollData.mealAllowance || 0,
      sleepover: payrollData.sleepovers ? payrollData.sleepovers * 65.50 : 0,
      firstAid: payrollData.hasFirstAid ? 1.50 : 0,
      total: 0
    };
  }
  
  /**
   * Calculate leave accrual
   * @param {number} hours - Hours worked
   * @param {number} rate - Hourly rate
   * @returns {Object} Leave accrual
   */
  calculateLeaveAccrual(hours, rate) {
    const annualLeaveRate = 0.0769; // 4 weeks per year
    const sickLeaveRate = 0.0385; // 2 weeks per year
    
    return {
      annualLeave: {
        hours: hours * annualLeaveRate,
        amount: hours * rate * annualLeaveRate
      },
      sickLeave: {
        hours: hours * sickLeaveRate,
        amount: hours * rate * sickLeaveRate
      }
    };
  }
  
  /**
   * Calculate tax and superannuation
   * @param {number} grossPay - Gross pay amount
   * @returns {Object} Tax and super calculations
   */
  calculateTaxAndSuper(grossPay) {
    // Simplified tax calculation (2024 rates)
    const taxRate = 0.19; // 19% for income $18,201 - $45,000
    const superRate = 0.11; // 11% superannuation
    
    return {
      tax: grossPay * taxRate,
      super: grossPay * superRate,
      taxRate,
      superRate
    };
  }
  
  /**
   * Generate payslip
   * @param {string} userId - User ID
   * @param {string} period - Pay period
   * @returns {Object} Payslip data
   */
  async generatePayslip(userId, period) {
    try {
      // Mock payslip data
      const payslip = {
        payslipId: `PAYSLIP-${Date.now()}`,
        userId,
        period,
        generatedDate: new Date().toISOString(),
        earnings: {
          baseHours: 80,
          baseRate: 28.50,
          baseAmount: 2280.00,
          penalties: 342.00,
          allowances: 85.00,
          total: 2707.00
        },
        deductions: {
          tax: 514.33,
          super: 297.77,
          total: 812.10
        },
        netPay: 1894.90,
        ytd: {
          grossPay: 32496.00,
          tax: 6174.24,
          super: 3574.56,
          netPay: 22747.20
        }
      };
      
      return {
        success: true,
        data: payslip
      };
    } catch (error) {
      console.error('Error generating payslip:', error);
      return {
        success: false,
        message: 'Failed to generate payslip',
        error: error.message
      };
    }
  }
}

module.exports = new AdvancedPayrollService();
