const mongoose = require('mongoose');
const logger = require('../utils/logger').createLogger('MongooseConfig');

const connectMongoose = async () => {
  try {
    const uri = process.env.MONGODB_URI;
    
    if (!uri) {
      throw new Error('MONGODB_URI environment variable is not defined');
    }

    // Mongoose connection options
    const options = {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    };

    await mongoose.connect(uri, options);
    
    logger.info('Mongoose connected successfully');
    
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
