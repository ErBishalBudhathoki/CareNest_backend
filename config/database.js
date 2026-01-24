/**
 * Database Configuration
 * Provides a getDatabase() function that returns the MongoDB database object
 * from the existing Mongoose connection for raw MongoDB operations.
 */

const mongoose = require('mongoose');

/**
 * Get the MongoDB database instance from Mongoose connection
 * This allows using raw MongoDB driver operations alongside Mongoose
 * @returns {Promise<import('mongodb').Db>} MongoDB database instance
 */
async function getDatabase() {
    // Ensure Mongoose is connected
    if (mongoose.connection.readyState !== 1) {
        // Wait for connection if connecting
        if (mongoose.connection.readyState === 2) {
            await new Promise((resolve) => {
                mongoose.connection.once('connected', resolve);
            });
        } else {
            throw new Error('MongoDB not connected. Please ensure Mongoose is connected before calling getDatabase().');
        }
    }

    // Return the native MongoDB Db object from Mongoose connection
    return mongoose.connection.db;
}

module.exports = { getDatabase };
