const { MongoClient, ServerApiVersion } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const catchAsync = require('../utils/catchAsync');
const logger = require('../config/logger');

const uri = process.env.MONGODB_URI;

class ConfigController {
  // --- Job Roles ---
  getJobRoles = catchAsync(async (req, res) => {
    const client = new MongoClient(uri, { serverApi: ServerApiVersion.v1, tls: true, family: 4 });
    try {
      await client.connect();
      const db = client.db('Invoice');
      const { organizationId } = req.params;
      
      if (!organizationId) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Organization ID is required'
        });
      }
      
      const roles = await db.collection('jobRoles').find({ 
        organizationId, 
        isActive: true 
      }).sort({ title: 1 }).toArray();
      
      if (roles.length === 0) {
        const defaultRoles = [
          { organizationId, title: 'Shift Manager', description: 'Manages shifts', isActive: true, createdAt: new Date(), updatedAt: new Date(), permissions: [] },
          { organizationId, title: 'Nurse', description: 'Registered Nurse', isActive: true, createdAt: new Date(), updatedAt: new Date(), permissions: [] },
          { organizationId, title: 'Caregiver', description: 'Provides care', isActive: true, createdAt: new Date(), updatedAt: new Date(), permissions: [] },
          { organizationId, title: 'Admin', description: 'Administrator', isActive: true, createdAt: new Date(), updatedAt: new Date(), permissions: [] }
        ];
        
        await db.collection('jobRoles').insertMany(defaultRoles);
        
        const newRoles = await db.collection('jobRoles').find({ 
          organizationId, 
          isActive: true 
        }).sort({ title: 1 }).toArray();
        
        return res.status(200).json({
          success: true,
          code: 'JOB_ROLES_RETRIEVED',
          data: newRoles
        });
      }

      logger.business('Retrieved job roles', {
        action: 'config_job_roles_get',
        organizationId,
        count: roles.length
      });

      res.status(200).json({
        success: true,
        code: 'JOB_ROLES_RETRIEVED',
        data: roles
      });
    } finally {
      await client.close();
    }
  });

  createJobRole = catchAsync(async (req, res) => {
    const client = new MongoClient(uri, { serverApi: ServerApiVersion.v1, tls: true, family: 4 });
    try {
      await client.connect();
      const db = client.db('Invoice');
      
      const { organizationId, title, description } = req.body;
      if (!organizationId || !title) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Missing required fields: organizationId, title'
        });
      }

      const existing = await db.collection('jobRoles').findOne({ organizationId, title });
      if (existing) {
        return res.status(409).json({
          success: false,
          code: 'DUPLICATE_ERROR',
          message: 'Job role already exists'
        });
      }

      const role = {
        organizationId,
        title,
        description,
        permissions: [],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await db.collection('jobRoles').insertOne(role);
      role._id = result.insertedId;

      logger.business('Created job role', {
        action: 'config_job_role_create',
        organizationId,
        title,
        roleId: result.insertedId
      });

      res.status(201).json({
        success: true,
        code: 'JOB_ROLE_CREATED',
        data: role
      });
    } finally {
      await client.close();
    }
  });

  // --- Leave Types ---
  getLeaveTypes = catchAsync(async (req, res) => {
    const client = new MongoClient(uri, { serverApi: ServerApiVersion.v1, tls: true, family: 4 });
    try {
      await client.connect();
      const db = client.db('Invoice');
      
      const { organizationId } = req.params;
      
      if (!organizationId) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Organization ID is required'
        });
      }
      
      const types = await db.collection('leaveTypes').find({ 
        organizationId, 
        isActive: true 
      }).sort({ name: 1 }).toArray();

      if (types.length === 0) {
        const defaultTypes = [
          { organizationId, name: 'Vacation', description: 'Annual leave', isActive: true, createdAt: new Date(), updatedAt: new Date() },
          { organizationId, name: 'Sick Leave', description: 'Medical leave', isActive: true, createdAt: new Date(), updatedAt: new Date() },
          { organizationId, name: 'Personal Leave', description: 'Personal time off', isActive: true, createdAt: new Date(), updatedAt: new Date() },
          { organizationId, name: 'Maternity/Paternity', description: 'Parental leave', isActive: true, createdAt: new Date(), updatedAt: new Date() }
        ];
        
        await db.collection('leaveTypes').insertMany(defaultTypes);
        
        const newTypes = await db.collection('leaveTypes').find({ 
          organizationId, 
          isActive: true 
        }).sort({ name: 1 }).toArray();
        
        return res.status(200).json({
          success: true,
          code: 'LEAVE_TYPES_RETRIEVED',
          data: newTypes
        });
      }

      logger.business('Retrieved leave types', {
        action: 'config_leave_types_get',
        organizationId,
        count: types.length
      });

      res.status(200).json({
        success: true,
        code: 'LEAVE_TYPES_RETRIEVED',
        data: types
      });
    } finally {
      await client.close();
    }
  });

  createLeaveType = catchAsync(async (req, res) => {
    const client = new MongoClient(uri, { serverApi: ServerApiVersion.v1, tls: true, family: 4 });
    try {
      await client.connect();
      const db = client.db('Invoice');
      
      const { organizationId, name, description } = req.body;
      if (!organizationId || !name) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Missing required fields: organizationId, name'
        });
      }

      const existing = await db.collection('leaveTypes').findOne({ organizationId, name });
      if (existing) {
        return res.status(409).json({
          success: false,
          code: 'DUPLICATE_ERROR',
          message: 'Leave type already exists'
        });
      }

      const type = {
        organizationId,
        name,
        description,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await db.collection('leaveTypes').insertOne(type);
      type._id = result.insertedId;

      logger.business('Created leave type', {
        action: 'config_leave_type_create',
        organizationId,
        name,
        typeId: result.insertedId
      });

      res.status(201).json({
        success: true,
        code: 'LEAVE_TYPE_CREATED',
        data: type
      });
    } finally {
      await client.close();
    }
  });

  // --- Tax Brackets ---
  getTaxBrackets = catchAsync(async (req, res) => {
    const taxConfig = {
      financialYear: '2024-2025',
      brackets: [
        { min: 0, max: 18200, rate: 0, base: 0 },
        { min: 18201, max: 45000, rate: 0.19, base: 0 },
        { min: 45001, max: 120000, rate: 0.325, base: 5092 },
        { min: 120001, max: 180000, rate: 0.37, base: 29467 },
        { min: 180001, max: null, rate: 0.45, base: 51667 }
      ]
    };
    
    res.status(200).json({
      success: true,
      code: 'TAX_BRACKETS_RETRIEVED',
      data: taxConfig
    });
  });
}

module.exports = new ConfigController();
