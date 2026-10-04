const mongoose = require('mongoose');
const logger = require('../utils/logger').createLogger('MongooseConfig');

// Aggregation timeout: analytics pipelines previously ran with no maxTimeMS, so
// a bad pipeline could pin a Cloud Run instance at the 300s request timeout.
// Default 15s, override per call as today; this is the ceiling for every call
// that forgot to set one.
const AGGREGATE_MAX_TIME_MS = Number(process.env.AGGREGATE_MAX_TIME_MS || 15000);
const originalAggregate = mongoose.Model.aggregate;
mongoose.Model.aggregate = function aggregateWithTimeout(pipeline, options) {
  return originalAggregate.call(this, pipeline, { maxTimeMS: AGGREGATE_MAX_TIME_MS, ...options });
};

const connectMongoose = async () => {
  try {
    const uri = process.env.MONGODB_URI;
    const dbName = process.env.DB_NAME || process.env.MONGODB_DATABASE || 'Invoice';

    if (!uri) {
      throw new Error('MONGODB_URI environment variable is not defined');
    }

    console.log('🔗 [MONGOOSE] Connecting to MongoDB...');
    console.log('🔗 [MONGOOSE] Database name:', dbName);

    // Mongoose connection options
    const options = {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      dbName: dbName, // Explicitly set database name
    };

    await mongoose.connect(uri, options);

    console.log('🔗 [MONGOOSE] Connected successfully to database:', mongoose.connection.db?.databaseName);
    logger.info('Mongoose connected successfully', { dbName: mongoose.connection.db?.databaseName });

    mongoose.connection.on('error', (err) => {
      logger.error('Mongoose connection error', { error: err.message });
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('Mongoose disconnected');
    });

  } catch (error) {
    logger.error('Failed to connect Mongoose', { error: error.message });
    // Don't exit process here, let the main server handle it or retry
    throw error;
  }
};

module.exports = connectMongoose;
