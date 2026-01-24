const mongoose = require('mongoose');

const onboardingRecordSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  organizationId: { type: String, required: true, index: true }, // Using String to match other models, usually ObjectId
  
  status: { 
    type: String, 
    enum: ['pending', 'submitted', 'changes_requested', 'completed'], 
    default: 'pending' 
  },
  
  currentStep: { type: Number, default: 1 },
  
  steps: {
    personalDetails: { 
      status: { type: String, default: 'pending' },
      updatedAt: Date
    },
    bankDetails: { 
      status: { type: String, default: 'pending' },
      updatedAt: Date
    },
    taxDetails: { 
      status: { type: String, default: 'pending' },
      tfn: String,
      taxScale: String,
      updatedAt: Date 
    },
    superannuation: { 
      status: { type: String, default: 'pending' },
      fundName: String,
      memberNumber: String,
      usi: String,
      updatedAt: Date 
    },
    documents: { 
      status: { type: String, default: 'pending' },
      count: { type: Number, default: 0 },
      updatedAt: Date
    }
  },
  
  probation: {
    startDate: Date,
    endDate: Date,
    reviewDate: Date,
    status: { 
      type: String, 
      enum: ['active', 'passed', 'extended', 'failed'], 
      default: 'active' 
    }
  }
}, {
  timestamps: true,
  collection: 'onboarding_records'
});

// Static method to create initial record
onboardingRecordSchema.statics.createInitialRecord = function(userId, organizationId) {
  return new this({
    userId,
    organizationId,
    status: 'pending',
    currentStep: 1,
    steps: {
        personalDetails: { status: 'pending', updatedAt: null },
        bankDetails: { status: 'pending', updatedAt: null },
        taxDetails: { 
            status: 'pending',
            tfn: null, 
            taxScale: null,
            updatedAt: null 
        },
        superannuation: { 
            status: 'pending',
            fundName: null,
            memberNumber: null,
            usi: null,
            updatedAt: null 
        },
        documents: { status: 'pending', count: 0 }
    },
    probation: {
        startDate: null,
        endDate: null,
        reviewDate: null,
        status: 'active'
    }
  });
};

module.exports = mongoose.model('OnboardingRecord', onboardingRecordSchema);
