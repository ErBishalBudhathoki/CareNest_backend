const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const logger = require('../config/logger');

const uri = process.env.MONGODB_URI;

class ConfigController {
  // --- Job Roles ---

  async getJobRoles(req, res) {
    const client = new MongoClient(uri, { serverApi: ServerApiVersion.v1, tls: true, family: 4 });
    try {
      await client.connect();
      const db = client.db('Invoice');
      const { organizationId } = req.params;
      
      const roles = await db.collection('jobRoles').find({ 
        organizationId, 
        isActive: true 
      }).sort({ title: 1 }).toArray();
      
      // If no roles exist, seed default ones (optional, for convenience)
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
        
        return res.status(200).json({ success: true, data: newRoles });
      }

      res.status(200).json({
        success: true,
        data: roles
      });
    } catch (error) {
      logger.error('Error fetching job roles', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching job roles'
      });
    } finally {
      await client.close();
    }
  }

  async createJobRole(req, res) {
    const client = new MongoClient(uri, { serverApi: ServerApiVersion.v1, tls: true, family: 4 });
    try {
      await client.connect();
      const db = client.db('Invoice');
      
      const { organizationId, title, description } = req.body;
      if (!organizationId || !title) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
      }

      // Check for duplicate
      const existing = await db.collection('jobRoles').findOne({ organizationId, title });
      if (existing) {
        return res.status(409).json({ success: false, message: 'Job role already exists' });
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

      res.status(201).json({ success: true, data: role });
    } catch (error) {
      logger.error('Error creating job role', error);
      res.status(500).json({ success: false, message: 'Error creating job role' });
    } finally {
      await client.close();
    }
  }

  // --- Leave Types ---

  async getLeaveTypes(req, res) {
    const client = new MongoClient(uri, { serverApi: ServerApiVersion.v1, tls: true, family: 4 });
    try {
      await client.connect();
      const db = client.db('Invoice');
      
      const { organizationId } = req.params;
      const types = await db.collection('leaveTypes').find({ 
        organizationId, 
        isActive: true 
      }).sort({ name: 1 }).toArray();

      // Seed default if empty
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
        
        return res.status(200).json({ success: true, data: newTypes });
      }

      res.status(200).json({
        success: true,
        data: types
      });
    } catch (error) {
      logger.error('Error fetching leave types', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching leave types'
      });
    } finally {
      await client.close();
    }
  }

  async createLeaveType(req, res) {
    const client = new MongoClient(uri, { serverApi: ServerApiVersion.v1, tls: true, family: 4 });
    try {
      await client.connect();
      const db = client.db('Invoice');
      
      const { organizationId, name, description } = req.body;
      if (!organizationId || !name) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
      }

      // Check for duplicate
      const existing = await db.collection('leaveTypes').findOne({ organizationId, name });
      if (existing) {
        return res.status(409).json({ success: false, message: 'Leave type already exists' });
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

      res.status(201).json({ success: true, data: type });
    } catch (error) {
      logger.error('Error creating leave type', error);
      res.status(500).json({ success: false, message: 'Error creating leave type' });
    } finally {
      await client.close();
    }
  }
  // --- Tax Brackets ---
  async getTaxBrackets(req, res) {
    // Return 2024-2025 ATO Resident Tax Rates
    // This could be moved to a DB collection 'tax_configurations' in the future
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
      data: taxConfig
    });
  }
}

module.exports = new ConfigController();
