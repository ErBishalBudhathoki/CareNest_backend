const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const https = require('https');
const csv = require('csv-parser');
const HolidaySchema = require('../models/holidaySchema');

// MongoDB connection URI from environment
const uri = process.env.MONGODB_URI;

class HolidayService {
  // Nager.Date responses are stable for a year. Keep a short-lived in-process
  // cache so payroll for many employees does not hammer the public API.
  static _publicHolidayCache = new Map();

  /**
   * Build a Set of 'YYYY-MM-DD' zoned date keys for the SCHADS engine's
   * public-holiday detection (Phase 1). Accepts the DB 'DD-MM-YYYY' format and
   * ISO/DD-MM-YYYY inputs.
   *
   * The calendar is the union of:
   *   - official public holidays for the organisation's state (external API)
   *   - organisation-configured holidays (MongoDB)
   * A date only counts when one of those sources says it is a holiday.
   *
   * @param {string} organizationId
   * @param {Object} [options] - { startDate, endDate }
   * @returns {Promise<Set<string>>}
   */
  static async getHolidayDateKeys(organizationId = null, options = {}) {
    const holidays = await this.getAllHolidays(organizationId, options);
    const set = new Set();
    for (const holiday of holidays || []) {
      const key = this.toDateKey(holiday?.Date ?? holiday?.date ?? holiday?.holidayDate);
      if (key) set.add(key);
    }
    return set;
  }

  /** Convert a holiday date value to a 'YYYY-MM-DD' key, or null. */
  static toDateKey(value) {
    if (!value) return null;
    const s = String(value).trim();
    let m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/); // DD-MM-YYYY
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); // DD/MM/YYYY
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  }

  /**
   * Get all holidays for an organisation.
   *
   * Public holidays are fetched from the Nager.Date API for the relevant
   * year(s) and filtered to the organisation's state. Organisation holidays
   * from MongoDB are always added. If the external API is unreachable the DB
   * holidays are still returned, so a network outage never removes a holiday
   * the organisation explicitly configured.
   *
   * @param {string} organizationId - Optional ID to filter custom holidays
   * @param {Object} [options] - { startDate, endDate, includeExternal }
   * @returns {Promise<Array>} Array of holiday objects
   */
  static async getAllHolidays(organizationId = null, options = {}) {
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

      const storedHolidays = await collection.find(query).toArray();

      if (options.includeExternal === false) {
        return storedHolidays;
      }

      const state = await this.getOrganizationState(db, organizationId);
      const externalHolidays = await this.fetchPublicHolidaysForRange(
        options.startDate,
        options.endDate,
        state,
      );

      // Organisation-configured holidays win on a shared date (custom label).
      const byDate = new Map();
      for (const holiday of externalHolidays) {
        byDate.set(this.toDateKey(holiday.Date), holiday);
      }
      for (const holiday of storedHolidays) {
        byDate.set(this.toDateKey(holiday.Date ?? holiday.date), holiday);
      }
      return Array.from(byDate.values());
    } finally {
      if (client) {
        await client.close();
      }
    }
  }

  /** Read the organisation's state from its billing address. */
  static async getOrganizationState(db, organizationId) {
    if (!organizationId) return null;
    try {
      const candidates = [{ _id: String(organizationId) }];
      if (ObjectId.isValid(String(organizationId))) {
        candidates.push({ _id: new ObjectId(String(organizationId)) });
      }
      const org = await db.collection('organizations').findOne(
        { $or: candidates },
        { projection: { address: 1, 'address.state': 1 } },
      );
      const raw = org?.address?.state;
      if (!raw) return null;
      const value = String(raw).trim().toUpperCase();
      if (value.startsWith('AU-')) return value.slice(3);
      return value.length <= 3 ? value : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Fetch official Australian public holidays for the years spanned by the
   * payroll period, filtered by state. Returns documents shaped like the
   * MongoDB holidaysList rows.
   */
  static async fetchPublicHolidaysForRange(startDate, endDate, state) {
    const now = new Date();
    const start = startDate ? new Date(startDate) : now;
    const end = endDate ? new Date(endDate) : start;
    const first = start < end ? start : end;
    const last = start < end ? end : start;
    if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return [];

    const years = [];
    for (let year = first.getUTCFullYear(); year <= last.getUTCFullYear() && years.length < 4; year += 1) {
      years.push(year);
    }
    if (years.length === 0) years.push(now.getFullYear());

    const results = [];
    for (const year of years) {
      const rows = await this.fetchPublicHolidays(year);
      for (const row of rows) {
        if (this.publicHolidayAppliesToState(row, state)) {
          results.push({
            Holiday: row.name || row.localName,
            Date: row.date,
            Day: row.date ? new Date(row.date).toLocaleDateString('en-AU', { weekday: 'long' }) : '',
            isCustom: false,
            jurisdiction: row.counties?.length ? row.counties.join(',') : 'national',
            source: 'nager',
          });
        }
      }
    }
    return results;
  }

  static publicHolidayAppliesToState(row, state) {
    const counties = Array.isArray(row?.counties) ? row.counties : [];
    if (counties.length === 0) return true; // national holiday
    if (!state) return true; // unknown org state: keep the full calendar
    const target = `AU-${String(state).toUpperCase()}`;
    return counties.includes(target);
  }

  static fetchPublicHolidays(year) {
    const cached = this._publicHolidayCache.get(year);
    if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000) {
      return Promise.resolve(cached.rows);
    }
    const url = `https://date.nager.at/api/v3/publicholidays/${year}/AU`;

    return new Promise((resolve) => {
      const request = https.get(url, { timeout: 2500 }, (response) => {
        let body = '';
        if (response.statusCode !== 200) {
          response.resume();
          resolve([]);
          return;
        }
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => {
          try {
            const rows = JSON.parse(body);
            if (!Array.isArray(rows)) return resolve([]);
            this._publicHolidayCache.set(year, { rows, at: Date.now() });
            resolve(rows);
          } catch (_) {
            resolve([]);
          }
        });
      });
      request.on('timeout', () => { request.destroy(); resolve([]); });
      request.on('error', () => resolve([]));
    });
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