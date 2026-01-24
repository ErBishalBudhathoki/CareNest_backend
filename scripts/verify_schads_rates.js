const payrollService = require('../services/payrollService');
const schadsService = require('../services/schadsService');

// Mock Data
const baseRate = 30.00;

const permEmployee = {
    _id: 'perm_1',
    firstName: 'Permanent',
    lastName: 'Employee',
    email: 'perm@test.com',
    payRate: baseRate,
    employmentType: 'Permanent'
};

const casualEmployee = {
    _id: 'casual_1',
    firstName: 'Casual',
    lastName: 'Employee',
    email: 'casual@test.com',
    payRate: baseRate,
    employmentType: 'Casual'
};

// Helper to create shift
const createShift = (dateStr, startHour, endHour, isPH = false) => {
    const start = new Date(`${dateStr}T${startHour.toString().padStart(2, '0')}:00:00`);
    let end = new Date(`${dateStr}T${endHour.toString().padStart(2, '0')}:00:00`);
    
    // Handle midnight crossing
    if (endHour < startHour) {
        end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    }

    return {
        startTime: start,
        endTime: end,
        breakDuration: 0,
        isPublicHoliday: isPH,
        userEmail: 'test@test.com' // dummy
    };
};

const runScenario = (name, shifts) => {
    console.log(`\n--- Scenario: ${name} ---`);
    
    // Calc for Permanent
    const permResult = payrollService.calculateEmployeePayroll(permEmployee, shifts);
    console.log(`PERMANENT: Gross $${permResult.grossPay} | Breakdown:`, 
        Object.entries(permResult.breakdown).filter(([k,v]) => v > 0).map(([k,v]) => `${k}: $${v.toFixed(2)}`).join(', ')
    );

    // Calc for Casual
    const casualResult = payrollService.calculateEmployeePayroll(casualEmployee, shifts);
    console.log(`CASUAL   : Gross $${casualResult.grossPay} | Breakdown:`, 
        Object.entries(casualResult.breakdown).filter(([k,v]) => v > 0).map(([k,v]) => `${k}: $${v.toFixed(2)}`).join(', ')
    );
    
    return { perm: permResult, casual: casualResult };
};

// 1. Standard Weekday (Mon 9am-5pm) - 8 hours
// Perm: 8 * 30 * 1.0 = 240
// Casual: 8 * 30 * 1.25 = 300
runScenario('Weekday Day Shift (9am-5pm)', [createShift('2024-06-03', 9, 17)]);

// 2. Afternoon Shift (Mon 2pm-10pm) - 8 hours
// Perm: 8 * 30 * 1.125 = 270
// Casual: 8 * 30 * 1.375 = 330
runScenario('Weekday Afternoon Shift (2pm-10pm)', [createShift('2024-06-03', 14, 22)]);

// 3. Night Shift (Mon 10pm-6am) - 8 hours
// Perm: 8 * 30 * 1.15 = 276
// Casual: 8 * 30 * 1.40 = 336
runScenario('Weekday Night Shift (10pm-6am)', [createShift('2024-06-03', 22, 6)]);

// 4. Saturday (Sat 9am-5pm) - 8 hours
// Perm: 8 * 30 * 1.5 = 360
// Casual: 8 * 30 * 1.75 = 420
runScenario('Saturday Shift (9am-5pm)', [createShift('2024-06-01', 9, 17)]);

// 5. Sunday (Sun 9am-5pm) - 8 hours
// Perm: 8 * 30 * 2.0 = 480
// Casual: 8 * 30 * 2.25 = 540
runScenario('Sunday Shift (9am-5pm)', [createShift('2024-06-02', 9, 17)]);

// 6. Public Holiday - 8 hours
// Perm: 8 * 30 * 2.5 = 600
// Casual: 8 * 30 * 2.75 = 660
runScenario('Public Holiday Shift', [createShift('2024-06-03', 9, 17, true)]);

console.log('\nVerification Complete.');
