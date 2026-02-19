/**
 * Relationship Rules - Defines how entities relate to each other
 * 
 * Specifies dependencies, foreign keys, and relationship cardinality
 */

const relationshipRules = {
  // Organization - Root entity, no dependencies
  organization: {
    dependsOn: [],
    required: [],
    references: {}
  },

  // User - Depends on organization
  user: {
    dependsOn: ['organization'],
    required: [],
    references: {},
    manyToOne: {
      organizationId: {
        type: 'organization',
        required: false // Some users may not belong to an organization
      }
    }
  },

  // Client - Depends on organization and users
  client: {
    dependsOn: ['organization', 'user'],
    required: ['organizationId'],
    references: {
      organizationId: 'organization'
    },
    manyToOne: {
      organizationId: {
        type: 'organization',
        required: true
      }
    }
  },

  // Worker - Depends on user and organization
  worker: {
    dependsOn: ['user', 'organization'],
    required: ['userId', 'organizationId'],
    references: {
      userId: 'user',
      organizationId: 'organization'
    },
    manyToOne: {
      userId: {
        type: 'user',
        required: true,
        selector: (users) => users.find(u => u.role === 'worker') || users[0]
      },
      organizationId: {
        type: 'organization',
        required: true
      }
    }
  },

  // Shift - Depends on client, worker (optional), and organization
  shift: {
    dependsOn: ['client', 'worker', 'organization'],
    required: ['clientId', 'organizationId'],
    references: {
      clientId: 'client',
      workerId: 'worker',
      organizationId: 'organization'
    },
    manyToOne: {
      clientId: {
        type: 'client',
        required: true
      },
      workerId: {
        type: 'worker',
        required: false // Can be unassigned
      },
      organizationId: {
        type: 'organization',
        required: true
      }
    }
  },

  // Invoice - Depends on client and organization
  invoice: {
    dependsOn: ['client', 'organization'],
    required: ['clientId', 'organizationId'],
    references: {
      clientId: 'client',
      organizationId: 'organization'
    },
    manyToOne: {
      clientId: {
        type: 'client',
        required: true
      },
      organizationId: {
        type: 'organization',
        required: true
      }
    }
  },

  // Payment - Depends on invoice and organization
  payment: {
    dependsOn: ['invoice', 'organization'],
    required: ['invoiceId', 'organizationId'],
    references: {
      invoiceId: 'invoice',
      organizationId: 'organization'
    },
    manyToOne: {
      invoiceId: {
        type: 'invoice',
        required: true
      },
      organizationId: {
        type: 'organization',
        required: true
      }
    }
  },

  // Care Plan - Depends on client, worker, and organization
  carePlan: {
    dependsOn: ['client', 'worker', 'organization', 'user'],
    required: ['clientId', 'organizationId'],
    references: {
      clientId: 'client',
      organizationId: 'organization',
      assignedWorkerId: 'worker',
      createdBy: 'user'
    },
    manyToOne: {
      clientId: {
        type: 'client',
        required: true
      },
      organizationId: {
        type: 'organization',
        required: true
      },
      assignedWorkerId: {
        type: 'worker',
        required: false
      },
      createdBy: {
        type: 'user',
        required: false
      }
    }
  },

  // Medication - Depends on client
  medication: {
    dependsOn: ['client'],
    required: ['clientId'],
    references: {
      clientId: 'client'
    },
    manyToOne: {
      clientId: {
        type: 'client',
        required: true
      }
    }
  },

  // Incident - Depends on client and organization
  incident: {
    dependsOn: ['client', 'organization', 'worker'],
    required: ['clientId', 'organizationId'],
    references: {
      clientId: 'client',
      organizationId: 'organization',
      reportedBy: 'worker'
    },
    manyToOne: {
      clientId: {
        type: 'client',
        required: true
      },
      organizationId: {
        type: 'organization',
        required: true
      },
      reportedBy: {
        type: 'worker',
        required: false
      }
    }
  },

  // Timesheet - Depends on worker, shift, and organization
  timesheet: {
    dependsOn: ['worker', 'shift', 'organization'],
    required: ['workerId', 'shiftId', 'organizationId'],
    references: {
      workerId: 'worker',
      shiftId: 'shift',
      organizationId: 'organization'
    },
    manyToOne: {
      workerId: {
        type: 'worker',
        required: true
      },
      shiftId: {
        type: 'shift',
        required: true
      },
      organizationId: {
        type: 'organization',
        required: true
      }
    }
  },

  // Expense - Depends on worker and organization
  expense: {
    dependsOn: ['worker', 'organization'],
    required: ['workerId', 'organizationId'],
    references: {
      workerId: 'worker',
      organizationId: 'organization'
    },
    manyToOne: {
      workerId: {
        type: 'worker',
        required: true
      },
      organizationId: {
        type: 'organization',
        required: true
      }
    }
  },

  // Compliance Record - Depends on worker and organization
  complianceRecord: {
    dependsOn: ['worker', 'organization'],
    required: ['workerId', 'organizationId'],
    references: {
      workerId: 'worker',
      organizationId: 'organization'
    },
    manyToOne: {
      workerId: {
        type: 'worker',
        required: true
      },
      organizationId: {
        type: 'organization',
        required: true
      }
    }
  },

  // Appointment - Depends on client, worker, and organization
  appointment: {
    dependsOn: ['client', 'worker', 'organization'],
    required: ['clientId', 'workerId', 'organizationId'],
    references: {
      clientId: 'client',
      workerId: 'worker',
      organizationId: 'organization'
    },
    manyToOne: {
      clientId: {
        type: 'client',
        required: true
      },
      workerId: {
        type: 'worker',
        required: true
      },
      organizationId: {
        type: 'organization',
        required: true
      }
    }
  },

  // Budget - Depends on organization
  budget: {
    dependsOn: ['organization'],
    required: ['organizationId'],
    references: {
      organizationId: 'organization'
    },
    manyToOne: {
      organizationId: {
        type: 'organization',
        required: true
      }
    }
  }
};

/**
 * Get dependency graph for visualization or analysis
 * @returns {Object} Dependency graph
 */
function getDependencyGraph() {
  const graph = {};
  
  for (const [entityType, rules] of Object.entries(relationshipRules)) {
    graph[entityType] = {
      dependsOn: rules.dependsOn || [],
      requiredFields: rules.required || [],
      references: Object.keys(rules.references || {})
    };
  }
  
  return graph;
}

/**
 * Get entities in dependency order (topological sort)
 * @returns {Array} Entity types in dependency order
 */
function getEntityOrder() {
  const order = [];
  const visited = new Set();
  const visiting = new Set();

  function visit(entityType) {
    if (visited.has(entityType)) return;
    if (visiting.has(entityType)) {
      throw new Error(`Circular dependency detected involving ${entityType}`);
    }

    visiting.add(entityType);

    const rules = relationshipRules[entityType];
    if (rules && rules.dependsOn) {
      for (const dep of rules.dependsOn) {
        if (relationshipRules[dep]) {
          visit(dep);
        }
      }
    }

    visiting.delete(entityType);
    visited.add(entityType);
    order.push(entityType);
  }

  for (const entityType of Object.keys(relationshipRules)) {
    visit(entityType);
  }

  return order;
}

export {
  relationshipRules,
  getDependencyGraph,
  getEntityOrder
};

export default relationshipRules;
