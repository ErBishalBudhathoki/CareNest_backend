const mongoose = require('mongoose');

const payrollSettingSchema = new mongoose.Schema({
    organizationId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    schadsConfig: {
        enabled: { type: Boolean, default: true },
        nightShiftStart: { type: Number, default: 20 }, // 8 PM
        nightShiftEnd: { type: Number, default: 6 },   // 6 AM
        standardDayHours: { type: Number, default: 8 },
        overtimeThreshold: { type: Number, default: 10 }
    },
    taxSettings: {
        withholdingEnabled: { type: Boolean, default: true },
        superGuaranteeRate: { type: Number, default: 0.115 } // 11.5%
    },
    exportFormats: {
        defaultFormat: { type: String, enum: ['csv', 'json', 'xero', 'myob'], default: 'csv' },
        includeHeaders: { type: Boolean, default: true }
    },
    autoAnomalyDetection: {
        type: Boolean,
        default: true
    },
    updatedBy: { type: String }
}, {
    timestamps: true
});

module.exports = mongoose.model('PayrollSetting', payrollSettingSchema);
