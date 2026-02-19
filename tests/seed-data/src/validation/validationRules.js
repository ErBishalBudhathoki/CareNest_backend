/**
 * Validation Rules for All Entity Types
 * 
 * Defines required fields, formats, ranges, and custom validators
 * for each entity type in the system.
 */

const validationRules = {
  // User validation rules
  user: {
    required: ['email', 'password', 'firstName', 'lastName', 'role'],
    formats: {
      email: 'email',
      phone: 'phone'
    },
    ranges: {
      role: {
        enum: ['admin', 'worker', 'client', 'family', 'manager', 'supervisor']
      },
      password: {
        minLength: 8,
        maxLength: 128
      },
      firstName: {
        minLength: 1,
        maxLength: 50
      },
      lastName: {
        minLength: 1,
        maxLength: 50
      }
    },
    customValidators: [
      (data) => {
        // Password must contain at least one number and one letter
        if (data.password && !/(?=.*[a-zA-Z])(?=.*\d)/.test(data.password)) {
          return {
            valid: false,
            field: 'password',
            message: 'Password must contain at least one letter and one number'
          };
        }
        return { valid: true };
      }
    ]
  },

  // Client validation rules
  client: {
    required: ['firstName', 'lastName', 'dateOfBirth', 'organizationId'],
    formats: {
      email: 'email',
      phone: 'phone',
      dateOfBirth: 'date',
      emergencyContactPhone: 'phone'
    },
    ranges: {
      firstName: {
        minLength: 1,
        maxLength: 50
      },
      lastName: {
        minLength: 1,
        maxLength: 50
      },
      ndisNumber: {
        minLength: 9,
        maxLength: 9
      }
    },
    customValidators: [
      (data) => {
        // Date of birth must be in the past
        if (data.dateOfBirth) {
          const dob = new Date(data.dateOfBirth);
          if (dob >= new Date()) {
            return {
              valid: false,
              field: 'dateOfBirth',
              message: 'Date of birth must be in the past'
            };
          }
        }
        return { valid: true };
      }
    ]
  },

  // Worker validation rules
  worker: {
    required: ['userId', 'organizationId', 'employmentType'],
    formats: {
      email: 'email',
      phone: 'phone',
      startDate: 'date'
    },
    ranges: {
      employmentType: {
        enum: ['full-time', 'part-time', 'casual', 'contractor']
      },
      hourlyRate: {
        min: 0,
        max: 1000
      }
    }
  },

  // Shift validation rules
  shift: {
    required: ['clientId', 'startTime', 'endTime', 'organizationId'],
    formats: {
      startTime: 'date',
      endTime: 'date'
    },
    ranges: {
      status: {
        enum: ['unassigned', 'assigned', 'in-progress', 'completed', 'cancelled']
      },
      duration: {
        min: 0.5,
        max: 24
      }
    },
    customValidators: [
      (data) => {
        // End time must be after start time
        if (data.startTime && data.endTime) {
          const start = new Date(data.startTime);
          const end = new Date(data.endTime);
          if (end <= start) {
            return {
              valid: false,
              field: 'endTime',
              message: 'End time must be after start time'
            };
          }
        }
        return { valid: true };
      }
    ]
  },

  // Invoice validation rules
  invoice: {
    required: ['clientId', 'organizationId', 'invoiceNumber', 'issueDate', 'dueDate'],
    formats: {
      issueDate: 'date',
      dueDate: 'date'
    },
    ranges: {
      status: {
        enum: ['draft', 'sent', 'paid', 'overdue', 'cancelled']
      },
      totalAmount: {
        min: 0
      },
      invoiceNumber: {
        minLength: 1,
        maxLength: 50
      }
    },
    customValidators: [
      (data) => {
        // Due date must be after issue date
        if (data.issueDate && data.dueDate) {
          const issue = new Date(data.issueDate);
          const due = new Date(data.dueDate);
          if (due < issue) {
            return {
              valid: false,
              field: 'dueDate',
              message: 'Due date must be on or after issue date'
            };
          }
        }
        return { valid: true };
      }
    ]
  },

  // Care Plan validation rules
  carePlan: {
    required: ['clientId', 'organizationId', 'startDate'],
    formats: {
      startDate: 'date',
      endDate: 'date',
      reviewDate: 'date'
    },
    ranges: {
      status: {
        enum: ['active', 'inactive', 'under-review', 'completed']
      }
    },
    customValidators: [
      (data) => {
        // End date must be after start date
        if (data.startDate && data.endDate) {
          const start = new Date(data.startDate);
          const end = new Date(data.endDate);
          if (end <= start) {
            return {
              valid: false,
              field: 'endDate',
              message: 'End date must be after start date'
            };
          }
        }
        return { valid: true };
      }
    ]
  },

  // Medication validation rules
  medication: {
    required: ['clientId', 'name', 'dosage', 'frequency'],
    formats: {
      startDate: 'date',
      endDate: 'date'
    },
    ranges: {
      name: {
        minLength: 1,
        maxLength: 100
      },
      dosage: {
        minLength: 1,
        maxLength: 50
      }
    }
  },

  // Incident validation rules
  incident: {
    required: ['clientId', 'organizationId', 'incidentDate', 'type', 'severity'],
    formats: {
      incidentDate: 'date'
    },
    ranges: {
      type: {
        enum: ['injury', 'illness', 'behavioral', 'medication-error', 'other']
      },
      severity: {
        enum: ['low', 'medium', 'high', 'critical']
      }
    }
  },

  // Timesheet validation rules
  timesheet: {
    required: ['workerId', 'shiftId', 'clockIn', 'organizationId'],
    formats: {
      clockIn: 'date',
      clockOut: 'date'
    },
    ranges: {
      status: {
        enum: ['pending', 'approved', 'rejected']
      }
    },
    customValidators: [
      (data) => {
        // Clock out must be after clock in
        if (data.clockIn && data.clockOut) {
          const clockIn = new Date(data.clockIn);
          const clockOut = new Date(data.clockOut);
          if (clockOut <= clockIn) {
            return {
              valid: false,
              field: 'clockOut',
              message: 'Clock out must be after clock in'
            };
          }
        }
        return { valid: true };
      }
    ]
  },

  // Expense validation rules
  expense: {
    required: ['workerId', 'organizationId', 'amount', 'category', 'date'],
    formats: {
      date: 'date'
    },
    ranges: {
      amount: {
        min: 0,
        max: 100000
      },
      category: {
        enum: ['travel', 'meals', 'supplies', 'equipment', 'training', 'other']
      },
      status: {
        enum: ['pending', 'approved', 'rejected', 'reimbursed']
      }
    }
  },

  // Compliance Record validation rules
  complianceRecord: {
    required: ['workerId', 'organizationId', 'certificationType', 'issueDate', 'expiryDate'],
    formats: {
      issueDate: 'date',
      expiryDate: 'date'
    },
    ranges: {
      certificationType: {
        enum: [
          'first-aid',
          'cpr',
          'working-with-children',
          'police-check',
          'ndis-worker-screening',
          'manual-handling',
          'medication-administration',
          'other'
        ]
      },
      status: {
        enum: ['valid', 'expiring-soon', 'expired', 'pending']
      }
    },
    customValidators: [
      (data) => {
        // Expiry date must be after issue date
        if (data.issueDate && data.expiryDate) {
          const issue = new Date(data.issueDate);
          const expiry = new Date(data.expiryDate);
          if (expiry <= issue) {
            return {
              valid: false,
              field: 'expiryDate',
              message: 'Expiry date must be after issue date'
            };
          }
        }
        return { valid: true };
      }
    ]
  },

  // Appointment validation rules
  appointment: {
    required: ['clientId', 'workerId', 'startTime', 'endTime', 'organizationId'],
    formats: {
      startTime: 'date',
      endTime: 'date'
    },
    ranges: {
      status: {
        enum: ['scheduled', 'confirmed', 'in-progress', 'completed', 'cancelled']
      }
    },
    customValidators: [
      (data) => {
        // End time must be after start time
        if (data.startTime && data.endTime) {
          const start = new Date(data.startTime);
          const end = new Date(data.endTime);
          if (end <= start) {
            return {
              valid: false,
              field: 'endTime',
              message: 'End time must be after start time'
            };
          }
        }
        return { valid: true };
      }
    ]
  },

  // Payment validation rules
  payment: {
    required: ['invoiceId', 'amount', 'paymentDate', 'organizationId'],
    formats: {
      paymentDate: 'date'
    },
    ranges: {
      amount: {
        min: 0
      },
      paymentMethod: {
        enum: ['cash', 'credit-card', 'bank-transfer', 'direct-debit', 'other']
      },
      status: {
        enum: ['pending', 'completed', 'failed', 'refunded']
      }
    }
  },

  // Budget validation rules
  budget: {
    required: ['organizationId', 'name', 'amount', 'startDate', 'endDate'],
    formats: {
      startDate: 'date',
      endDate: 'date'
    },
    ranges: {
      amount: {
        min: 0
      },
      name: {
        minLength: 1,
        maxLength: 100
      }
    },
    customValidators: [
      (data) => {
        // End date must be after start date
        if (data.startDate && data.endDate) {
          const start = new Date(data.startDate);
          const end = new Date(data.endDate);
          if (end <= start) {
            return {
              valid: false,
              field: 'endDate',
              message: 'End date must be after start date'
            };
          }
        }
        return { valid: true };
      }
    ]
  },

  // Organization validation rules
  organization: {
    required: ['name', 'email'],
    formats: {
      email: 'email',
      phone: 'phone',
      website: 'url'
    },
    ranges: {
      name: {
        minLength: 1,
        maxLength: 100
      }
    }
  }
};

export { validationRules };
export default validationRules;
