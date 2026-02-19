/**
 * Smart Expense Service
 * AI-powered expense management with receipt scanning
 */

class SmartExpenseService {
  /**
   * Scan receipt using OCR
   * @param {string} imageBase64 - Base64 encoded image
   * @returns {Object} Extracted receipt data
   */
  async scanReceipt(imageBase64) {
    try {
      // In production, integrate with Google Vision API or Tesseract
      // For now, return mock OCR data
      
      const extractedData = {
        merchant: 'Office Supplies Co.',
        date: new Date().toISOString().split('T')[0],
        amount: 45.99,
        currency: 'AUD',
        items: [
          { description: 'Printer Paper', quantity: 2, price: 15.99 },
          { description: 'Pens (Pack of 10)', quantity: 1, price: 12.99 },
          { description: 'Notebooks', quantity: 3, price: 17.01 }
        ],
        tax: 4.18,
        total: 45.99,
        paymentMethod: 'Credit Card',
        confidence: 0.92
      };
      
      return {
        success: true,
        data: extractedData
      };
    } catch (error) {
      console.error('Error scanning receipt:', error);
      return {
        success: false,
        message: 'Failed to scan receipt',
        error: error.message
      };
    }
  }
  
  /**
   * Extract data from OCR result
   * @param {Object} ocrResult - OCR result
   * @returns {Object} Structured expense data
   */
  extractReceiptData(ocrResult) {
    // In production, parse OCR text and extract structured data
    // For now, return the mock data as-is
    return ocrResult;
  }
  
  /**
   * Categorize expense using AI
   * @param {Object} expenseData - Expense data
   * @returns {Object} Category with confidence
   */
  async categorizeExpense(expenseData) {
    try {
      const { merchant, items, amount } = expenseData;
      
      // Simple rule-based categorization (in production, use ML model)
      let category = 'Other';
      let confidence = 0.5;
      
      const merchantLower = (merchant || '').toLowerCase();
      const itemsText = (items || []).map(i => i.description).join(' ').toLowerCase();
      
      if (merchantLower.includes('office') || itemsText.includes('paper') || itemsText.includes('pen')) {
        category = 'Office Supplies';
        confidence = 0.9;
      } else if (merchantLower.includes('fuel') || merchantLower.includes('petrol') || itemsText.includes('fuel')) {
        category = 'Fuel';
        confidence = 0.95;
      } else if (merchantLower.includes('restaurant') || merchantLower.includes('cafe') || itemsText.includes('meal')) {
        category = 'Meals & Entertainment';
        confidence = 0.85;
      } else if (merchantLower.includes('hotel') || merchantLower.includes('accommodation')) {
        category = 'Accommodation';
        confidence = 0.9;
      } else if (merchantLower.includes('transport') || merchantLower.includes('taxi') || merchantLower.includes('uber')) {
        category = 'Transportation';
        confidence = 0.88;
      } else if (amount && amount < 10) {
        category = 'Miscellaneous';
        confidence = 0.6;
      }
      
      return {
        success: true,
        data: {
          category,
          confidence,
          suggestedCategories: [
            { category, confidence },
            { category: 'Other', confidence: 1 - confidence }
          ]
        }
      };
    } catch (error) {
      console.error('Error categorizing expense:', error);
      return {
        success: false,
        message: 'Failed to categorize expense',
        error: error.message
      };
    }
  }
  
  /**
   * Validate expense against policy
   * @param {Object} expenseData - Expense data
   * @returns {Object} Validation result
   */
  async validateExpensePolicy(expenseData) {
    try {
      const { category, amount, date } = expenseData;
      
      // Mock policy rules
      const policyRules = {
        'Office Supplies': { maxAmount: 100, requiresReceipt: true },
        'Fuel': { maxAmount: 150, requiresReceipt: true },
        'Meals & Entertainment': { maxAmount: 50, requiresReceipt: true },
        'Accommodation': { maxAmount: 200, requiresReceipt: true },
        'Transportation': { maxAmount: 100, requiresReceipt: false },
        'Miscellaneous': { maxAmount: 50, requiresReceipt: true }
      };
      
      const rule = policyRules[category] || { maxAmount: 50, requiresReceipt: true };
      const violations = [];
      const warnings = [];
      
      // Check amount limit
      if (amount > rule.maxAmount) {
        violations.push({
          type: 'amount_exceeded',
          message: `Amount $${amount} exceeds policy limit of $${rule.maxAmount} for ${category}`,
          severity: 'high'
        });
      }
      
      // Check if receipt is required
      if (rule.requiresReceipt && amount > 10) {
        warnings.push({
          type: 'receipt_required',
          message: `Receipt is required for ${category} expenses over $10`,
          severity: 'medium'
        });
      }
      
      // Check expense age (warn if older than 30 days)
      const expenseDate = new Date(date);
      const daysSinceExpense = Math.floor((Date.now() - expenseDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysSinceExpense > 30) {
        warnings.push({
          type: 'old_expense',
          message: `Expense is ${daysSinceExpense} days old. Submit expenses within 30 days.`,
          severity: 'low'
        });
      }
      
      const isCompliant = violations.length === 0;
      
      return {
        success: true,
        data: {
          isCompliant,
          requiresApproval: !isCompliant || amount > 100,
          violations,
          warnings,
          policyRule: rule
        }
      };
    } catch (error) {
      console.error('Error validating expense policy:', error);
      return {
        success: false,
        message: 'Failed to validate policy',
        error: error.message
      };
    }
  }
  
  /**
   * Detect duplicate receipts
   * @param {string} receiptHash - Hash of receipt image
   * @returns {Object} Duplicate check result
   */
  async detectDuplicateReceipts(receiptHash) {
    try {
      // In production, check database for matching receipt hashes
      // For now, return mock result (no duplicate)
      
      const isDuplicate = Math.random() < 0.1; // 10% chance of duplicate for demo
      
      if (isDuplicate) {
        return {
          success: true,
          data: {
            isDuplicate: true,
            matchedExpense: {
              expenseId: 'EXP-12345',
              date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
              amount: 45.99,
              merchant: 'Office Supplies Co.'
            },
            confidence: 0.95
          }
        };
      }
      
      return {
        success: true,
        data: {
          isDuplicate: false,
          confidence: 0.98
        }
      };
    } catch (error) {
      console.error('Error detecting duplicate receipt:', error);
      return {
        success: false,
        message: 'Failed to detect duplicate',
        error: error.message
      };
    }
  }
  
  /**
   * Calculate mileage from GPS locations
   * @param {Array} locations - Array of {lat, lng, timestamp}
   * @returns {Object} Mileage calculation
   */
  async calculateMileage(locations) {
    try {
      if (!locations || locations.length < 2) {
        return {
          success: false,
          message: 'At least 2 locations required for mileage calculation'
        };
      }
      
      // Calculate distance using Haversine formula
      let totalDistance = 0;
      
      for (let i = 0; i < locations.length - 1; i++) {
        const loc1 = locations[i];
        const loc2 = locations[i + 1];
        
        const distance = this.calculateDistance(
          loc1.lat,
          loc1.lng,
          loc2.lat,
          loc2.lng
        );
        
        totalDistance += distance;
      }
      
      // Convert to km
      const distanceKm = totalDistance;
      
      // Calculate reimbursement (ATO rate: $0.85 per km for 2024)
      const ratePerKm = 0.85;
      const reimbursement = distanceKm * ratePerKm;
      
      return {
        success: true,
        data: {
          totalDistance: Math.round(distanceKm * 100) / 100,
          unit: 'km',
          ratePerKm,
          reimbursement: Math.round(reimbursement * 100) / 100,
          currency: 'AUD',
          startLocation: locations[0],
          endLocation: locations[locations.length - 1],
          waypoints: locations.length - 2
        }
      };
    } catch (error) {
      console.error('Error calculating mileage:', error);
      return {
        success: false,
        message: 'Failed to calculate mileage',
        error: error.message
      };
    }
  }
  
  /**
   * Calculate distance between two coordinates using Haversine formula
   * @param {number} lat1 - Latitude 1
   * @param {number} lon1 - Longitude 1
   * @param {number} lat2 - Latitude 2
   * @param {number} lon2 - Longitude 2
   * @returns {number} Distance in kilometers
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    
    return distance;
  }
  
  /**
   * Convert degrees to radians
   * @param {number} degrees - Degrees
   * @returns {number} Radians
   */
  toRad(degrees) {
    return degrees * (Math.PI / 180);
  }
}

module.exports = new SmartExpenseService();
