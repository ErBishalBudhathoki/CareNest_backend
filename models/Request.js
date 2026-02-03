const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema({
    organizationId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true }, // Typically User _id as string
    createdBy: { type: String, required: true }, // Email
    type: {
        type: String,
        required: true,
        enum: ['Shift', 'TimeOff', 'SHIFT_SWAP_OFFER', 'SHIFT_OFFER'] 
    },
    status: {
        type: String,
        default: 'Pending',
        enum: ['Pending', 'Approved', 'Declined', 'Claimed', 'Cancelled']
    },
    details: { type: mongoose.Schema.Types.Mixed }, // Flexible object for specific request details
    note: String,
    history: [{
        action: String,
        performedBy: String,
        timestamp: { type: Date, default: Date.now },
        status: String,
        reason: String
    }]
}, {
    timestamps: true,
    collection: 'requests',
    toJSON: {
        transform: function (doc, ret) {
            ret.id = ret._id.toString();
            delete ret._id;
            delete ret.__v;
            
            if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
            if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
            
            if (ret.history && Array.isArray(ret.history)) {
                ret.history.forEach(h => {
                    if (h.timestamp) h.timestamp = h.timestamp.toISOString();
                    delete h._id;
                });
            }
            return ret;
        }
    }
});

requestSchema.index({ organizationId: 1, status: 1 });
// requestSchema.index({ userId: 1 }); // Removed duplicate index
requestSchema.index({ createdBy: 1 });

module.exports = mongoose.model('Request', requestSchema);
