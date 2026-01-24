const mongoose = require('mongoose');

const payrollRecordSchema = new mongoose.Schema({
    employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', // Assuming 'User' is the model name for employees in 'login' collection, or strictly just ObjectId
        required: true,
        index: true
    },
    employeeName: { type: String }, // Denormalized for easier display
    organizationId: {
        type: String,
        required: true,
        index: true
    },
    periodStart: {
        type: Date,
        required: true,
        index: true
    },
    periodEnd: {
        type: Date,
        required: true,
        index: true
    },
    grossPay: {
        type: Number,
        required: true,
        min: 0
    },
    taxWithheld: {
        type: Number,
        default: 0,
        min: 0
    },
    superContribution: {
        type: Number,
        default: 0,
        min: 0
    },
    netPay: {
        type: Number,
        default: 0
    },
    totalHours: {
        type: Number,
        default: 0
    },
    earningsBreakdown: {
        basePay: { type: Number, default: 0 },
        saturdayPenalty: { type: Number, default: 0 },
        sundayPenalty: { type: Number, default: 0 },
        publicHolidayPenalty: { type: Number, default: 0 },
        nightShiftPenalty: { type: Number, default: 0 },
        overtimePay: { type: Number, default: 0 },
        allowances: { type: Number, default: 0 }
    },
    hoursBreakdown: {
        baseHours: { type: Number, default: 0 },
        saturdayHours: { type: Number, default: 0 },
        sundayHours: { type: Number, default: 0 },
        publicHolidayHours: { type: Number, default: 0 },
        nightShiftHours: { type: Number, default: 0 },
        overtimeFirst2h: { type: Number, default: 0 },
        overtimeAfter2h: { type: Number, default: 0 }
    },
    anomalies: [{
        type: { type: String },
        description: { type: String },
        severity: { type: String, enum: ['low', 'medium', 'high'] }
    }],
    status: {
        type: String,
        enum: ['draft', 'approved', 'exported', 'paid'],
        default: 'draft',
        index: true
    },
    metadata: {
        generatedAt: { type: Date, default: Date.now },
        generatedBy: { type: String }
    }
}, {
    timestamps: true
});

// Compound index for unique records per period per employee
payrollRecordSchema.index({ employeeId: 1, periodStart: 1, periodEnd: 1 }, { unique: true });

module.exports = mongoose.model('PayrollRecord', payrollRecordSchema);
