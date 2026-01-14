const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const https = require('https');
const csv = require('csv-parser');
const HolidaySchema = require('../models/holidaySchema');

// MongoDB connection URI from environment
const uri = process.env.MONGODB_URI;

class HolidayService {
  /**
   * Get all holidays from the database (Global + Organization Specific)
   * @param {string} organizationId - Optional organization ID to filter custom holidays
   * @returns {Promise<Array>} Array of holiday objects
   */
  static async getAllHolidays(organizationId = null) {
    let client;
    try {
      client = await MongoClient.connect(uri, { 
        serverApi: ServerApiVersion.v1 
      });
      
      const db = client.db("Invoice"); 
      const collection = db.collection("holidaysList"); 

      // Filter: Public holidays (no organizationId) OR holidays for this organization
      const query = {
        $or: [
          { organizationId: { $exists: false } },
          { organizationId: null },
          { isCustom: false }, // Legacy support
          ...(organizationId ? [{ organizationId: organizationId }] : [])
        ]
      };

      const holidays = await collection.find(query).toArray();
      return holidays;
    } finally {
      if (client) {
        await client.close();
      }
    }
  }

  /**
   * Upload CSV data from GitHub to MongoDB
   * @returns {Promise<Object>} Result object with success status and count
   */
  static async uploadCSVData() {
    let client;
    try {
      // Create a promise to handle the CSV parsing
      const holidaysPromise = new Promise((resolve, reject) => {
        const holidays = [];
        
        // Send an HTTP GET request to the remote CSV file
        const csvUrl = "https://raw.githubusercontent.com/BishalBudhathoki/backend_rest_api/main/holiday.csv";
        
        https.get(csvUrl, (response) => {
          if (response.statusCode !== 200) {
            return reject(new Error(`Failed to fetch CSV: ${response.statusCode}`));
          }
          
          response
            .pipe(csv())
            .on("data", (data) => {
              // Replace null bytes in the keys for security
              const updatedData = {};
              Object.keys(data).forEach((key) => {
                const updatedKey = key.replace(/\0/g, "_"); 
                updatedData[updatedKey] = data[key];
              });
              
              holidays.push(updatedData);
            })
            .on("end", () => {
              if (holidays.length === 0) {
                return reject(new Error("No rows in CSV file"));
              }
              resolve(holidays);
            })
            .on("error", (err) => {
              reject(err);
            });
        }).on("error", (err) => {
          reject(err);
        });
      });
      
      // Wait for the CSV parsing to complete
      const holidays = await holidaysPromise;
      
      // Connect to MongoDB
      client = await MongoClient.connect(uri, {
        serverApi: ServerApiVersion.v1,
      });
      
      const db = client.db("Invoice");
      const collection = db.collection("holidaysList");
      
      // Delete existing data and insert new data
      await collection.deleteMany({});
      const result = await collection.insertMany(holidays);
      
      return {
        success: true,
        message: "Upload successful",
        count: result.insertedCount
      };
    } finally {
      if (client) {
        await client.close();
      }
    }
  }

  /**
   * Delete a holiday by ID
   * @param {string} id - MongoDB ObjectId of the holiday to delete
   * @returns {Promise<Object>} Result object with success status
   */
  static async deleteHoliday(id) {
    let client;
    try {
      // Validate the ID format
      if (!ObjectId.isValid(id)) {
        throw new Error("Invalid holiday ID format");
      }
      
      // Connect to MongoDB
      client = await MongoClient.connect(uri, { 
        serverApi: ServerApiVersion.v1 
      });
      
      const db = client.db("Invoice");
      const collection = db.collection("holidaysList");

      // Delete the document with the given ID
      const result = await collection.deleteOne({ _id: new ObjectId(id) });
      
      if (result.deletedCount === 0) {
        throw new Error("Holiday not found");
      }
      
      return {
        success: true,
        message: "Delete successful"
      };
    } finally {
      if (client) {
        await client.close();
      }
    }
  }

  /**
   * Add a new holiday
   * @param {Object} holidayData - Holiday data (Holiday, Date, Day, organizationId)
   * @returns {Promise<Object>} Result object with success status and inserted ID
   */
  static async addHoliday(holidayData) {
    let client;
    try {
      // Validate schema
      const validation = HolidaySchema.validate(holidayData);
      if (!validation.isValid) {
        throw new Error(validation.errors.join(', '));
      }

      const { Holiday, Date, Day, organizationId } = holidayData;
      
      const newHoliday = { 
        Holiday, 
        Date, 
        Day,
        organizationId: organizationId || null,
        isCustom: !!organizationId, // Mark as custom if org ID is present
        createdAt: new Date()
      };
      
      // Connect to MongoDB
      client = await MongoClient.connect(uri, { 
        serverApi: ServerApiVersion.v1 
      });
      
      const db = client.db("Invoice");
      const collection = db.collection("holidaysList");

      // Check if holiday already exists on the same date FOR THIS ORGANIZATION (or global)
      const query = { 
        Date: Date,
        $or: [
          { organizationId: organizationId || null }, // Same scope
          { organizationId: { $exists: false } } // Or conflicts with global
        ]
      };

      const existingHoliday = await collection.findOne(query);
      if (existingHoliday) {
        throw new Error("A holiday already exists on this date for your organization");
      }
      
      // Insert the new holiday
      const result = await collection.insertOne(newHoliday);
      
      return {
        success: true,
        message: "Holiday item added successfully",
        id: result.insertedId
      };
    } finally {
      if (client) {
        await client.close();
      }
    }
  }

  /**
   * Check if dates are holidays
   * @param {string} dateList - Comma-separated list of dates to check
   * @returns {Promise<Array>} Array of "Holiday" or "No Holiday" for each date
   */
  static async checkHolidays(dateList) {
    let client;
    try {
      if (!dateList) {
        throw new Error("Missing dateList parameter");
      }
      
      const dates = dateList.split(",");
      
      // Connect to MongoDB
      client = await MongoClient.connect(uri, { 
        serverApi: ServerApiVersion.v1 
      });
      
      const db = client.db("Invoice");
      const collection = db.collection("holidaysList");
      
      // Find holidays matching the dates
      const query = { Date: { $in: dates } };
      const holidays = await collection.find(query).toArray();
      
      // Create result array with "Holiday" or "No Holiday" for each date
      const holidayStatusList = dates.map(date => 
        holidays.find(holiday => holiday.Date === date) ? "Holiday" : "No Holiday"
      );
      
      return holidayStatusList;
    } finally {
      if (client) {
        await client.close();
      }
    }
  }
}

module.exports = HolidayService;