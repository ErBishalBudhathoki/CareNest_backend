/**
 * Invoice Generation Service
 * Replaces random algorithm with clientAssignment-based item extraction
 * Task 2.1: Enhanced Invoice Generation Backend
 */

const mongoose = require('mongoose');
const ClientAssignment = require('../models/ClientAssignment');
const Client = require('../models/Client');
const WorkedTime = require('../models/WorkedTime');
const Expense = require('../models/Expense');
const CustomPricing = require('../models/CustomPricing');
const PricingSettings = require('../models/PricingSettings');
const SupportItem = require('../models/SupportItem');
const Organization = require('../models/Organization');
const { priceValidationService } = require('./priceValidationService');
const TripService = require('./tripService');
const logger = require('../config/logger');

class InvoiceGenerationService {
  /**
   * Generate bulk invoices for multiple clients with pre-configured pricing
   * Task 2.5: Add bulk invoice generation with pre-configured pricing
   */
  async generateBulkInvoices(bulkGenerationParams) {
    try {
      const {
        organizationId,
        userEmail,
        clients, // Array of client objects with clientEmail, startDate, endDate
        usePreConfiguredPricing = true,
        skipPricePrompts = true,
        includeExpenses = true,
        batchSize = 10
      } = bulkGenerationParams;
      
      // Validate bulk generation parameters
      const validationErrors = this.validateBulkGenerationParams(bulkGenerationParams);
      if (validationErrors.length > 0) {
        return {
          success: false,
          message: 'Bulk generation validation failed',
          errors: validationErrors
        };
      }
      
      const results = {
        success: true,
        totalClients: clients.length,
        processedClients: 0,
        successfulInvoices: [],
        failedInvoices: [],
        summary: {
          totalInvoices: 0,
          totalLineItems: 0,
          totalAmount: 0,
          totalServiceAmount: 0,
          totalExpenseAmount: 0,
          processingTime: 0
        },
        metadata: {
          organizationId,
          userEmail,
          generatedAt: new Date(),
          usePreConfiguredPricing,
          skipPricePrompts,
          includeExpenses,
          batchSize
        }
      };
      
      const startTime = Date.now();
      
      // Process clients in batches to avoid overwhelming the system
      for (let i = 0; i < clients.length; i += batchSize) {
        const batch = clients.slice(i, i + batchSize);
        const batchPromises = batch.map(async (clientData) => {
          try {
            const invoiceResult = await this.generateSingleInvoiceForBulk(
              userEmail,
              clientData.clientEmail,
              clientData.startDate,
              clientData.endDate,
              {
                usePreConfiguredPricing,
                skipPricePrompts,
                includeExpenses,
                organizationId
              }
            );
            
            if (invoiceResult.success) {
              results.successfulInvoices.push({
                clientEmail: clientData.clientEmail,
                ...invoiceResult
              });
              
              // Update summary
              results.summary.totalInvoices++;
              results.summary.totalLineItems += invoiceResult.summary.totalItems;
              results.summary.totalAmount += invoiceResult.summary.totalAmount;
              results.summary.totalServiceAmount += invoiceResult.summary.serviceAmount || 0;
              results.summary.totalExpenseAmount += invoiceResult.summary.expenseAmount || 0;
            } else {
              results.failedInvoices.push({
                clientEmail: clientData.clientEmail,
                error: invoiceResult.error || 'Unknown error',
                details: invoiceResult.details
              });
            }
            
            results.processedClients++;
          } catch (error) {
            results.failedInvoices.push({
              clientEmail: clientData.clientEmail,
              error: error.message,
              details: 'Exception during invoice generation'
            });
            results.processedClients++;
          }
        });
        
        // Wait for current batch to complete before processing next batch
        await Promise.all(batchPromises);
      }
      
      results.summary.processingTime = Date.now() - startTime;
      
      return results;
      
    } catch (error) {
      logger.error('Bulk invoice generation failed', {
        error: error.message,
        stack: error.stack,
        organizationId: bulkGenerationParams.organizationId,
        clientCount: bulkGenerationParams.clients?.length
      });
      return {
        success: false,
        message: 'Bulk invoice generation failed',
        error: error.message
      };
    }
  }
  
  /**
   * Generate a single invoice for bulk processing with pre-configured pricing
   */
  async generateSingleInvoiceForBulk(userEmail, clientEmail, startDate, endDate, options = {}) {
    try {
      const {
        usePreConfiguredPricing = true,
        skipPricePrompts = true,
        includeExpenses = true,
        organizationId
      } = options;
      
      // Get client assignment data
      const assignment = await ClientAssignment.findOne({
        userEmail: userEmail,
        clientEmail: clientEmail,
        isActive: true
      });
      
      if (!assignment) {
        return {
          success: false,
          error: 'No active assignment found',
          details: `No assignment found for user ${userEmail} and client ${clientEmail}`
        };
      }
      
      // Get client data
      const client = await Client.findOne({
        clientEmail: clientEmail,
        isActive: true
      });
      
      if (!client) {
        return {
          success: false,
          error: 'Client not found',
          details: `Client ${clientEmail} not found or inactive`
        };
      }
      
      // Get worked time data
      const workedTimeData = await this.getWorkedTimeData(userEmail, clientEmail, startDate, endDate);
      
      // Extract line items from assignment
      const lineItems = await this.extractLineItemsFromAssignment(
        assignment, 
        client, 
        workedTimeData, 
        startDate, 
        endDate
      );
      
      // Include expenses if requested
      if (includeExpenses) {
        const expenseLineItems = await this.getApprovedExpensesForInvoice(
          organizationId || assignment.organizationId,
          client._id,
          startDate,
          endDate
        );
        
        const convertedExpensePromises = expenseLineItems.map(expense => 
          this.convertExpenseToLineItem(expense)
        );
        const convertedExpenses = await Promise.all(convertedExpensePromises);
        
        lineItems.push(...convertedExpenses);
      }
      
      // Include Mileage (Billable Trips)
      const mileageLineItems = await this.getBillableTripsForInvoice(client._id, startDate, endDate);
      if (mileageLineItems.length > 0) {
          const convertedMileagePromises = mileageLineItems.map(trip => 
              this.convertTripToLineItem(trip, client, organizationId || assignment.organizationId)
          );
          const convertedMileage = await Promise.all(convertedMileagePromises);
          lineItems.push(...convertedMileage.filter(item => item !== null));
      }
      
      // Apply pre-configured pricing if enabled
      if (usePreConfiguredPricing) {
        await this.applyPreConfiguredPricing(lineItems, organizationId || assignment.organizationId, client._id);
      }
      
      // Filter out items with missing prices if skipPricePrompts is true
      let validLineItems = lineItems;
      if (skipPricePrompts) {
        validLineItems = lineItems.filter(item => item.unitPrice > 0);
      }
      
      // Validate line items
      const validation = await this.validateInvoiceLineItems(validLineItems);
      
      // Separate service items and expense items for summary
      const serviceItems = validLineItems.filter(item => item.type !== 'expense');
      const expenseItems = validLineItems.filter(item => item.type === 'expense');
      
      const result = {
        success: true,
        lineItems: validLineItems,
        validation,
        metadata: {
          assignmentId: assignment._id,
          clientId: client._id,
          generatedAt: new Date(),
          extractionMethod: 'bulk generation with pre-configured pricing',
          totalItems: validLineItems.length,
          serviceItems: serviceItems.length,
          expenseItems: expenseItems.length,
          usePreConfiguredPricing,
          skipPricePrompts,
          includeExpenses
        },
        summary: {
          totalItems: validLineItems.length,
          serviceItems: serviceItems.length,
          expenseItems: expenseItems.length,
          totalAmount: validLineItems.reduce((sum, item) => sum + item.totalPrice, 0),
          serviceAmount: serviceItems.reduce((sum, item) => sum + item.totalPrice, 0),
          expenseAmount: expenseItems.reduce((sum, item) => sum + item.totalPrice, 0),
          ndisCompliant: validation.isValid,
          hasErrors: validation.errors.length > 0,
          hasWarnings: validation.warnings.length > 0
        }
      };
      
      return result;
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        details: 'Exception during single invoice generation for bulk processing'
      };
    }
  }
  
  /**
   * Apply pre-configured pricing to line items
   */
  async applyPreConfiguredPricing(lineItems, organizationId, clientId) {
    for (const item of lineItems) {
      if (!item.unitPrice || item.unitPrice === 0) {
        try {
          const pricing = await this.getPricingForItem(
            item.ndisItemNumber,
            organizationId,
            clientId,
            'NSW', // Default state, could be made configurable
            'standard' // Default provider type, could be made configurable
          );
          
          if (pricing && pricing.price > 0) {
            item.unitPrice = pricing.price;
            item.totalPrice = item.quantity * pricing.price;
            item.pricingSource = pricing.source;
            item.pricingApplied = true;
          }
        } catch (error) {
          logger.warn('Failed to apply pricing for item', {
            ndisItemNumber: item.ndisItemNumber,
            error: error.message,
            organizationId: item.organizationId
          });
          item.pricingApplied = false;
        }
      }
    }
  }
  
  /**
    * Validate bulk generation parameters
    */
   validateBulkGenerationParams(params) {
     const errors = [];
     
     if (!params.organizationId) {
       errors.push('Organization ID is required for bulk generation');
     }
     
     if (!params.userEmail || typeof params.userEmail !== 'string') {
       errors.push('Valid userEmail is required for bulk generation');
     }
     
     if (!params.clients || !Array.isArray(params.clients) || params.clients.length === 0) {
       errors.push('At least one client is required for bulk generation');
     }
     
     if (params.clients && Array.isArray(params.clients)) {
       params.clients.forEach((client, index) => {
         if (!client.clientEmail) {
           errors.push(`Client at index ${index} is missing clientEmail`);
         }
         if (!client.startDate) {
           errors.push(`Client at index ${index} is missing startDate`);
         }
         if (!client.endDate) {
           errors.push(`Client at index ${index} is missing endDate`);
         }
         
         // Validate date format
         if (client.startDate && isNaN(Date.parse(client.startDate))) {
           errors.push(`Client at index ${index} has invalid startDate format`);
         }
         if (client.endDate && isNaN(Date.parse(client.endDate))) {
           errors.push(`Client at index ${index} has invalid endDate format`);
         }
       });
     }
     
     if (params.batchSize && (typeof params.batchSize !== 'number' || params.batchSize < 1 || params.batchSize > 50)) {
       errors.push('Batch size must be a number between 1 and 50');
     }
     
     return errors;
   }
   

  /**
   * Generate invoice line items based on clientAssignment data
   * Replaces the random algorithm with intelligent item extraction
   */
  async generateInvoiceLineItems(userEmail, clientEmail, startDate, endDate) {
    try {
      // Get client assignment data
      const assignment = await ClientAssignment.findOne({
        userEmail: userEmail,
        clientEmail: clientEmail,
        isActive: true
      });

      if (!assignment) {
        throw new Error('No active assignment found for the specified user and client');
      }

      // Get client details for additional context
      const client = await Client.findOne({
        clientEmail: clientEmail,
        isActive: true
      });

      if (!client) {
        throw new Error('Client not found or inactive');
      }

      // Get worked time data for the specified period
      const workedTimeData = await this.getWorkedTimeData(userEmail, clientEmail, startDate, endDate);

      // Generate line items based on assignment schedule and worked time
      const lineItems = await this.extractLineItemsFromAssignment(
        assignment,
        client,
        workedTimeData,
        startDate,
        endDate
      );

      // Include Mileage (Billable Trips)
      const mileageLineItems = await this.getBillableTripsForInvoice(client._id, startDate, endDate);
      if (mileageLineItems.length > 0) {
          const convertedMileagePromises = mileageLineItems.map(trip => 
              this.convertTripToLineItem(trip, client, client.organizationId)
          );
          const convertedMileage = await Promise.all(convertedMileagePromises);
          lineItems.push(...convertedMileage.filter(item => item !== null));
      }

      // Note: Expenses are now handled separately via the includeExpenses parameter
      // in the endpoint, not automatically included in line items
      const allLineItems = lineItems;

      // Check for missing prices that require prompts
      const itemsWithMissingPrices = allLineItems.filter(item => item.promptRequired);
      const validLineItems = allLineItems.filter(item => !item.promptRequired);

      // Validate line items for NDIS compliance (only valid items)
      const validation = await this.validateInvoiceLineItems(validLineItems);

      // Separate service items and expense items for summary
      const serviceItems = validLineItems.filter(item => item.type !== 'expense');
      const expenseItems = validLineItems.filter(item => item.type === 'expense');

      const result = {
        success: true,
        lineItems: validLineItems,
        validation,
        metadata: {
          assignmentId: assignment._id,
          clientId: client._id,
          organizationId: client.organizationId,
          generatedAt: new Date(),
          extractionMethod: 'clientAssignment-based with automatic expense inclusion',
          totalItems: validLineItems.length,
          serviceItems: serviceItems.length,
          expenseItems: expenseItems.length
        },
        summary: {
          totalItems: validLineItems.length,
          serviceItems: serviceItems.length,
          expenseItems: expenseItems.length,
          totalAmount: validLineItems.reduce((sum, item) => sum + item.totalPrice, 0),
          serviceAmount: serviceItems.reduce((sum, item) => sum + item.totalPrice, 0),
          expenseAmount: expenseItems.reduce((sum, item) => sum + item.totalPrice, 0),
          ndisCompliant: validation.isValid,
          hasErrors: validation.errors.length > 0,
          hasWarnings: validation.warnings.length > 0
        }
      };

      // Add prompt information if there are missing prices
      if (itemsWithMissingPrices.length > 0) {
        result.pricePrompts = {
          required: true,
          count: itemsWithMissingPrices.length,
          items: itemsWithMissingPrices.map(item => ({
            ndisItemNumber: item.ndisItemNumber,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            promptData: item.promptData
          }))
        };
        result.summary.requiresPricePrompts = true;
      }

      return result;

    } catch (error) {
      logger.error('Invoice line items generation failed', {
        error: error.message,
        stack: error.stack,
        userEmail,
        clientEmail,
        startDate,
        endDate
      });
      throw error;
    }
  }

  /**
   * Extract line items from client assignment data
   */
  async extractLineItemsFromAssignment(assignment, client, workedTimeData, startDate, endDate) {
    const lineItems = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Process assignment schedule data
    if (assignment.schedule && Array.isArray(assignment.schedule)) {
      for (const scheduleItem of assignment.schedule) {
        const scheduleDate = new Date(scheduleItem.date);
        
        // Check if schedule date falls within the invoice period
        if (scheduleDate >= start && scheduleDate <= end) {
          const lineItem = await this.createLineItemFromSchedule(
            scheduleItem,
            assignment,
            client
          );
          
          if (lineItem) {
            lineItems.push(lineItem);
          }
        }
      }
    }

    // If no schedule data, fall back to worked time data
    if (lineItems.length === 0 && workedTimeData.length > 0) {
      for (const workEntry of workedTimeData) {
        const lineItem = await this.createLineItemFromWorkedTime(
          workEntry,
          assignment,
          client
        );
        
        if (lineItem) {
          lineItems.push(lineItem);
        }
      }
    }

    return lineItems;
  }

  /**
   * Create line item from schedule data
   */
  /**
   * Create an invoice line item from an assignment schedule entry.
   *
   * Derives pricing via getPricingForItem using organization/client custom pricing,
   * MMM-aware NDIS caps, and time-band ratios. When base pricing is missing,
   * returns a prompt-enabled line item instead of a $0.00 rate.
   *
   * Parameters:
   * - scheduleItem: Object containing date, startTime, endTime, break, and optional postcode.
   * - assignment: Assignment object providing NDIS item fallbacks and metadata.
   * - client: Client object with ids and default postcode.
   * - workedTimeData: Optional supporting worked-time info.
   *
   * Returns:
   * - A line item object with quantity, unitPrice, totalPrice, and pricingMetadata fields:
   *   - pricingSource, isCustomPricing, ndisCompliant
   *   - basePrice, capRatio
   *   - priceCapApplied, priceCapBase
   *   - mmmRating, mmmMultiplier
   * - Or a prompt-enabled item (pricingStatus: 'missing') when base price is not configured.
   */
  async createLineItemFromSchedule(scheduleItem, assignment, client) {
    try {
      // Get NDIS item information
      const ndisItem = scheduleItem.ndisItem || assignment.ndisItem;
      
      if (!ndisItem || !ndisItem.itemNumber) {
        logger.warn('No NDIS item found for schedule', {
          scheduleDate: scheduleItem.date,
          userEmail: assignment.userEmail,
          clientEmail: assignment.clientEmail
        });
        return null;
      }

      // Calculate hours worked
      const startTime = this.parseTime(scheduleItem.startTime);
      const endTime = this.parseTime(scheduleItem.endTime);
      const breakMinutes = this.parseBreakMinutes(scheduleItem.break);
      
      const totalMinutes = this.calculateWorkMinutes(startTime, endTime, breakMinutes);
      const hoursWorked = totalMinutes / 60;

      // Determine provider type: use provided or infer from item metadata
      const inferredProviderType = (() => {
        const name = (ndisItem.itemName || ndisItem.description || '').toLowerCase();
        return name.includes('high intensity') ? 'highIntensity' : 'standard';
      })();

      const providerTypeUsed = scheduleItem.providerType || inferredProviderType || 'standard';

      // Determine service delivery postcode for MMM pricing
      const serviceLocationPostcode = (
        scheduleItem.serviceLocationPostcode ||
        scheduleItem.postcode ||
        assignment.serviceLocationPostcode ||
        client.clientZip ||
        null
      );

      // Get pricing information with enhanced validation
      const pricing = await this.getPricingForItem(
        ndisItem.itemNumber,
        client.organizationId,
        client._id,
        scheduleItem.state || 'NSW',
        providerTypeUsed,
        serviceLocationPostcode
      );

      // Determine quantity and unit price based on NDIS item unit
      // Validate pricing before calculations
      if (!pricing || pricing.price === null || pricing.price === undefined || isNaN(pricing.price)) {
        logger.warn('Invalid pricing for NDIS item', {
          ndisItemNumber: ndisItem.itemNumber,
          pricing,
          scheduleDate: scheduleItem.date
        });
        return null;
      }

      let quantity, unitPrice;
      if (ndisItem.unit && ndisItem.unit.toUpperCase() === 'H') {
        // Hourly service
        quantity = hoursWorked;
        unitPrice = pricing.price;
      } else {
        // Per-item service
        quantity = 1;
        unitPrice = pricing.price * hoursWorked;
      }

      // Handle missing pricing - store prompt data for later resolution instead of $0 rate
      if (pricing.source === 'missing') {
        const safeQuantity = isNaN(quantity) ? 0 : quantity;
        return {
          date: scheduleItem.date,
          description: `${ndisItem.itemNumber} - ${ndisItem.itemName || ndisItem.description}`,
          quantity: parseFloat(safeQuantity.toFixed(2)),
          unitPrice: 0,
          totalPrice: 0,
          ndisItemNumber: ndisItem.itemNumber,
          ndisItemName: ndisItem.itemName || ndisItem.description,
          unit: ndisItem.unit || 'H',
          isHighIntensity: scheduleItem.highIntensity || false,
          startTime: scheduleItem.startTime,
          endTime: scheduleItem.endTime,
          breakMinutes: breakMinutes,
          hoursWorked: parseFloat(hoursWorked.toFixed(2)),
          source: 'clientAssignment',
          organizationId: client.organizationId,
          clientId: client._id,
          assignmentId: assignment._id,
          providerType: providerTypeUsed,
          serviceLocationPostcode: serviceLocationPostcode,
          pricingStatus: 'missing',
          promptRequired: true,
          promptData: {
            ...pricing.promptData,
            quantity: safeQuantity,
            unit: ndisItem.unit || 'H',
            scheduleId: scheduleItem._id,
            organizationId: client.organizationId,
            clientId: client._id
          },
          pricingMetadata: {
            pricingSource: pricing.source,
            isCustomPricing: pricing.isCustom,
            ndisCompliant: pricing.ndisCompliant,
            servicePostcode: serviceLocationPostcode,
            basePrice: pricing.basePrice,
            capRatio: pricing.capRatio,
            priceCapApplied: pricing.priceCap,
            priceCapBase: pricing.validationDetails?.priceCapBase,
            mmmRating: pricing.validationDetails?.mmmRating,
            mmmMultiplier: pricing.validationDetails?.mmmMultiplier
          }
        };
      }

      // Ensure values are valid numbers before calling toFixed
      const safeQuantity = isNaN(quantity) ? 0 : quantity;
      const safeUnitPrice = isNaN(unitPrice) ? 0 : unitPrice;
      const safeTotalPrice = safeQuantity * safeUnitPrice;

      // Detect time band (Weekday Daytime/Evening/Night) for annotation only
      const dateObj = new Date(scheduleItem.date);
      const isWeekend = [0,6].includes(dateObj.getDay());
      const timeBand = (() => {
        if (isWeekend) return null; // Focus on weekday bands per requirement
        // Weekday Daytime: 06:00–20:00; Evening: 20:00–24:00; Night: crosses midnight or before 06:00
        const startMin = startTime;
        const endMin = endTime;
        const crossesMidnight = endMin < startMin; // e.g., 23:00→01:00
        const sixAM = 6 * 60;
        const eightPM = 20 * 60;
        if (!crossesMidnight) {
          if (startMin >= sixAM && endMin <= eightPM) return 'Weekday Daytime';
          if (startMin >= eightPM && endMin <= (24 * 60)) return 'Weekday Evening';
          if (startMin < sixAM || endMin > eightPM) return 'Weekday Night';
        } else {
          // Any service finishing after midnight counts as Night
          return 'Weekday Night';
        }
        return null;
      })();

      return {
        date: scheduleItem.date,
        description: `${ndisItem.itemNumber} - ${ndisItem.itemName || ndisItem.description}`,
        quantity: parseFloat(safeQuantity.toFixed(2)),
        unitPrice: parseFloat(safeUnitPrice.toFixed(2)),
        totalPrice: parseFloat(safeTotalPrice.toFixed(2)),
        ndisItemNumber: ndisItem.itemNumber,
        ndisItemName: ndisItem.itemName || ndisItem.description,
        unit: ndisItem.unit || 'H',
        isHighIntensity: scheduleItem.highIntensity || false,
        startTime: scheduleItem.startTime,
        endTime: scheduleItem.endTime,
        breakMinutes: breakMinutes,
        hoursWorked: parseFloat(hoursWorked.toFixed(2)),
        source: 'clientAssignment',
        organizationId: client.organizationId,
        clientId: client._id,
        assignmentId: assignment._id,
        providerType: providerTypeUsed,
        serviceLocationPostcode: serviceLocationPostcode,
        pricingMetadata: {
          pricingSource: pricing.source,
          isCustomPricing: pricing.isCustom,
          ndisCompliant: pricing.ndisCompliant,
          timeBand: timeBand,
          servicePostcode: serviceLocationPostcode,
          basePrice: pricing.basePrice,
          capRatio: pricing.capRatio,
          priceCapApplied: pricing.priceCap,
          priceCapBase: pricing.validationDetails?.priceCapBase,
          mmmRating: pricing.validationDetails?.mmmRating,
          mmmMultiplier: pricing.validationDetails?.mmmMultiplier
        }
      };

    } catch (error) {
      logger.error('Error creating line item from schedule', {
      error: error.message,
      stack: error.stack,
      scheduleData: scheduleItem
    });
      return null;
    }
  }

  /**
   * Create line item from worked time data (fallback method)
   *
   * Similar to schedule-based builder but uses a worked-time entry. Pricing is
   * derived via getPricingForItem with MMM-aware caps. When pricing cannot be
   * resolved, returns a prompt-enabled item rather than a $0.00 rate.
   *
   * Parameters:
   * - workEntry: Worked time record with date, timeWorked, providerType, and optional postcode.
   * - assignment: Assignment context providing NDIS item number and metadata.
   * - client: Client context with ids and default postcode.
   *
   * Returns:
   * - A line item with pricingMetadata (basePrice, capRatio, priceCapApplied, priceCapBase,
   *   mmmRating, mmmMultiplier) or prompt-enabled when pricing is missing/invalid.
   */
  async createLineItemFromWorkedTime(workEntry, assignment, client) {
    try {
      // Use assigned NDIS item or default
      const ndisItemNumber = assignment.assignedNdisItemNumber || '01_001_0107_1_1'; // Default support item
      
      // Get NDIS item details
      const ndisItem = await this.getNdisItemDetails(ndisItemNumber);
      
      if (!ndisItem) {
        logger.warn('NDIS item not found', {
      ndisItemNumber
    });
        return null;
      }

      // Determine provider type: use provided or infer from item metadata
      const inferredProviderType = (() => {
        const name = (ndisItem.itemName || '').toLowerCase();
        return name.includes('high intensity') ? 'highIntensity' : 'standard';
      })();
      const providerTypeUsed = workEntry.providerType || inferredProviderType || 'standard';

      // Determine service delivery postcode for MMM pricing
      const serviceLocationPostcode = (
        workEntry.serviceLocationPostcode ||
        workEntry.postcode ||
        assignment.serviceLocationPostcode ||
        client.clientZip ||
        null
      );

      // Get pricing information with enhanced validation
      const pricing = await this.getPricingForItem(
        ndisItemNumber,
        client.organizationId,
        client._id,
        workEntry.state || 'NSW',
        providerTypeUsed,
        serviceLocationPostcode
      );

      const hoursWorked = parseFloat(workEntry.timeWorked) || 0;
      
      // Validate pricing before calculations
      if (!pricing || pricing.price === null || pricing.price === undefined || isNaN(pricing.price)) {
        logger.warn('Invalid pricing for NDIS item', {
      ndisItemNumber,
      pricing
    });
        // Return a line item with zero pricing for manual review
        return {
          date: workEntry.date,
          description: `${ndisItemNumber} - ${ndisItem.itemName}`,
          quantity: parseFloat(hoursWorked.toFixed(2)),
          unitPrice: 0,
          totalPrice: 0,
          ndisItemNumber: ndisItemNumber,
          ndisItemName: ndisItem.itemName,
          unit: ndisItem.unit || 'H',
          hoursWorked: hoursWorked,
          source: 'workedTime',
          organizationId: client.organizationId,
          clientId: client._id,
          assignmentId: assignment._id,
          pricingStatus: 'invalid',
          promptRequired: true,
          providerType: providerTypeUsed,
          serviceLocationPostcode: serviceLocationPostcode,
          pricingMetadata: {
            pricingSource: 'invalid',
            isCustomPricing: false,
            ndisCompliant: false,
            error: 'Invalid or missing pricing data'
          }
        };
      }

      let quantity, unitPrice;
      if (ndisItem.unit && ndisItem.unit.toUpperCase() === 'H') {
        quantity = hoursWorked;
        unitPrice = pricing.price;
      } else {
        quantity = 1;
        unitPrice = pricing.price * hoursWorked;
      }

      // Handle missing pricing - store prompt data for later resolution
      if (pricing.source === 'missing') {
        const safeQuantity = isNaN(quantity) ? 0 : quantity;
        return {
          date: workEntry.date,
          description: `${ndisItemNumber} - ${ndisItem.itemName}`,
          quantity: parseFloat(safeQuantity.toFixed(2)),
          unitPrice: 0,
          totalPrice: 0,
          ndisItemNumber: ndisItemNumber,
          ndisItemName: ndisItem.itemName,
          unit: ndisItem.unit || 'H',
          hoursWorked: hoursWorked,
          source: 'workedTime',
          organizationId: client.organizationId,
          clientId: client._id,
          assignmentId: assignment._id,
          pricingStatus: 'missing',
          promptRequired: true,
          providerType: providerTypeUsed,
          serviceLocationPostcode: serviceLocationPostcode,
          promptData: {
            ...pricing.promptData,
            quantity: quantity,
            unit: ndisItem.unit || 'H',
            workEntryId: workEntry._id,
            clientId: client._id,
            organizationId: client.organizationId
          },
          pricingMetadata: {
            pricingSource: pricing.source,
            isCustomPricing: pricing.isCustom,
            ndisCompliant: pricing.ndisCompliant,
            requiresManualPricing: pricing.requiresManualPricing
          }
        };
      }

      // Ensure values are valid numbers before calling toFixed
      const safeQuantity = isNaN(quantity) ? 0 : quantity;
      const safeUnitPrice = isNaN(unitPrice) ? 0 : unitPrice;
      const safeTotalPrice = safeQuantity * safeUnitPrice;

      return {
        date: workEntry.date,
        description: `${ndisItemNumber} - ${ndisItem.itemName}`,
        quantity: parseFloat(safeQuantity.toFixed(2)),
        unitPrice: parseFloat(safeUnitPrice.toFixed(2)),
        totalPrice: parseFloat(safeTotalPrice.toFixed(2)),
        ndisItemNumber: ndisItemNumber,
        ndisItemName: ndisItem.itemName,
        unit: ndisItem.unit || 'H',
        hoursWorked: hoursWorked,
        source: 'workedTime',
        organizationId: client.organizationId,
        clientId: client._id,
        assignmentId: assignment._id,
        providerType: providerTypeUsed,
        serviceLocationPostcode: serviceLocationPostcode,
        pricingMetadata: {
          pricingSource: pricing.source,
          isCustomPricing: pricing.isCustom,
          ndisCompliant: pricing.ndisCompliant,
          basePrice: pricing.basePrice,
          capRatio: pricing.capRatio,
          priceCapApplied: pricing.priceCap,
          priceCapBase: pricing.validationDetails?.priceCapBase,
          mmmRating: pricing.validationDetails?.mmmRating,
          mmmMultiplier: pricing.validationDetails?.mmmMultiplier
        }
      };

    } catch (error) {
      logger.error('Error creating line item from worked time', {
      error: error.message,
      stack: error.stack,
      workedTimeData: workEntry
    });
      return null;
    }
  }

  /**
   * Get worked time data for the specified period
   */
  async getWorkedTimeData(userEmail, clientEmail, startDate, endDate) {
    try {
      // Normalize start/end to Date objects for reliable range queries
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        logger.warn('getWorkedTimeData: Invalid date inputs, using raw values', {
          userEmail,
          clientEmail,
          startDate,
          endDate
        });
      }

      const workedTimeData = await WorkedTime.find({
        userEmail: userEmail,
        clientEmail: clientEmail,
        date: {
          $gte: isNaN(start.getTime()) ? startDate : start,
          $lte: isNaN(end.getTime()) ? endDate : end
        }
      });

      return workedTimeData || [];
    } catch (error) {
      logger.error('Error fetching worked time data', {
      error: error.message,
      stack: error.stack,
      userEmail,
      clientEmail,
      startDate,
      endDate
    });
      return [];
    }
  }

  /**
   * Get approved expenses for automatic inclusion in invoice generation
   * Task 2.4: Implement automatic expense inclusion in invoice generation
   * Returns raw expense data instead of converting to line items
   */
  async getApprovedExpensesForInvoice(organizationId, clientId, startDate, endDate) {
    try {
      logger.debug('getApprovedExpensesForInvoice called', {
      organizationId,
      organizationIdType: typeof organizationId,
      clientId,
      clientIdType: typeof clientId,
      startDate,
      startDateType: typeof startDate,
      endDate,
      endDateType: typeof endDate
    });
      
      // Keep clientId as string if it's stored as string, or ObjectId if model uses ObjectId
      // Since we migrated to Mongoose models, clientId in Expense model is ObjectId.
      // We should cast it if it's a string.
      
      const query = {
        organizationId: new mongoose.Types.ObjectId(organizationId),
        clientId: new mongoose.Types.ObjectId(clientId),
        expenseDate: {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        },
        approvalStatus: 'approved',
        isActive: true,
        isReimbursable: true // Only include reimbursable expenses in invoices
      };
      
      // Query for approved expenses within the date range
      const expenses = await Expense.find(query);
      
      // Return raw expense data with formatted fields for invoice display
      const formattedExpenses = expenses.map(expense => ({
        _id: expense._id,
        description: expense.description,
        amount: expense.amount,
        category: expense.category,
        subcategory: expense.subcategory,
        expenseDate: expense.expenseDate,
        receiptUrl: expense.receiptUrl,
        submittedBy: expense.submittedBy,
        approvedAt: expense.updatedAt,
        clientId: expense.clientId,
        organizationId: expense.organizationId,
        isReimbursable: expense.isReimbursable,
        metadata: {
          source: 'expense',
          originalExpenseId: expense._id
        }
      }));

      return formattedExpenses;
    } catch (error) {
      logger.error('Error retrieving approved expenses for invoice', {
       error: error.message,
       stack: error.stack,
       organizationId,
       clientId,
       startDate,
       endDate
     });
      return []; // Return empty array on error to not break invoice generation
    }
  }

  /**
   * Convert expense record to invoice line item format
   */
  async convertExpenseToLineItem(expense) {
    try {
      // If expense has a support item number, use it for NDIS compliance
      let ndisItemNumber = expense.supportItemNumber;
      let itemDescription = expense.supportItemName || expense.description;
      let unitPrice = expense.amount;
      let quantity = 1;
      let unit = 'each';

      // If no support item number, create a generic expense line item
      if (!ndisItemNumber) {
        // Use a generic expense code or create one based on category
        ndisItemNumber = this.getExpenseCategoryCode(expense.category);
        itemDescription = `${expense.category}: ${expense.description}`;
      }

      // Get NDIS item details for validation if available
      let ndisDetails = null;
      if (ndisItemNumber && ndisItemNumber !== 'EXPENSE_OTHER') {
        ndisDetails = await this.getNdisItemDetails(ndisItemNumber);
      }

      const lineItem = {
        id: expense._id.toString(),
        type: 'expense',
        ndisItemNumber: ndisItemNumber,
        itemDescription: itemDescription,
        quantity: quantity,
        unit: unit,
        unitPrice: unitPrice,
        totalPrice: unitPrice * quantity,
        date: expense.expenseDate,
        expenseId: expense._id,
        category: expense.category,
        subcategory: expense.subcategory,
        receiptUrl: expense.receiptUrl,
        notes: expense.notes,
        submittedBy: expense.submittedBy,
        approvedAt: expense.updatedAt,
        pricingStatus: 'fixed', // Expenses have fixed pricing
        promptRequired: false,
        ndisCompliant: ndisDetails ? true : false,
        metadata: {
          source: 'expense',
          expenseCategory: expense.category,
          expenseSubcategory: expense.subcategory,
          originalExpenseId: expense._id,
          isReimbursable: expense.isReimbursable
        }
      };

      return lineItem;
    } catch (error) {
      logger.error('Expense to line item conversion failed', {
        error: error.message,
        stack: error.stack,
        expenseId: expense._id
      });
      return null;
    }
  }

  /**
   * Get NDIS item code for expense categories
   */
  getExpenseCategoryCode(category) {
    const categoryMappings = {
      'transportation': '01_011_0107_1_1', // Transport - Public transport
      'accommodation': '01_012_0117_1_1', // Accommodation/Tenancy
      'meals': '01_013_0133_1_1', // Daily Tasks/Shared Living
      'equipment': '03_092_0104_6_1', // Assistive Technology
      'training': '02_104_0125_6_1', // Capacity Building
      'support': '01_015_0106_1_1', // Community/Social/Civic
      'other': 'EXPENSE_OTHER'
    };

    return categoryMappings[category.toLowerCase()] || 'EXPENSE_OTHER';
  }

  /**
   * Get pricing for NDIS item with dynamic lookup
   * Priority: Client-specific → Organization → NDIS caps
   */
  /**
   * Retrieve pricing for a specific NDIS item and derive the actual chargeable price (base price-only).
   *
   * Pricing resolution order (base price-only):
   * 1) Client-specific custom pricing for the exact item
   * 2) Organization custom pricing for the exact item
   * 3) If no base price found, return a prompt-required payload (source: 'missing')
   *
   * Business rule: Never use NDIS cap for Rate. No clamping to cap.
   *
   * @param {string} ndisItemNumber - Support item number being priced
   * @param {string} organizationId - Organization identifier
   * @param {string|object} clientId - Client identifier (string or ObjectId)
   * @param {string} [state='NSW'] - Australian state used for cap lookup
   * @param {('standard'|'highIntensity')} [providerType='standard'] - Provider type used for cap lookup
   * @param {string|null} [servicePostcode=null] - Optional service delivery postcode for MMM adjustments
   * @returns {Promise<{price:number, source:string, isCustom:boolean, ndisCompliant:boolean, exceedsNdisCap:boolean, priceCap:number|null, priceCapWarning?:string, validationDetails?:object, basePrice?:number, capRatio?:number, requiresManualPricing?:boolean, promptData?:object}>}
   */
  async getPricingForItem(ndisItemNumber, organizationId, clientId, state = 'NSW', providerType = 'standard', servicePostcode = null) {
    try {
      // Resolve MMM-aware price cap for the requested item (for validation metadata only; never used for Rate)
      let itemPriceCap = null;

      // 1. Check for client-specific pricing
      const clientPricing = await CustomPricing.findOne({
        supportItemNumber: ndisItemNumber,
        organizationId: new mongoose.Types.ObjectId(organizationId),
        clientId: new mongoose.Types.ObjectId(clientId),
        isActive: true,
        approvalStatus: 'approved'
      });

      if (clientPricing) {
        // Use exact-item base price directly (no clamping to cap)
        const derivedValidation = await priceValidationService.validatePrice(
          ndisItemNumber,
          clientPricing.customPrice,
          state,
          providerType,
          new Date(),
          { servicePostcode }
        );

        return {
          price: clientPricing.customPrice,
          source: 'client-specific',
          isCustom: true,
          ndisCompliant: derivedValidation.isValid,
          exceedsNdisCap: !derivedValidation.isValid && derivedValidation.status === 'exceeds_cap',
          priceCap: derivedValidation.priceCap ?? itemPriceCap,
          priceCapWarning: !derivedValidation.isValid && derivedValidation.status === 'exceeds_cap' ? `Client-specific price $${clientPricing.customPrice.toFixed(2)} exceeds NDIS price cap of $${(derivedValidation.priceCap ?? itemPriceCap).toFixed(2)} for ${state} ${providerType} services` : null,
          validationDetails: derivedValidation,
          basePrice: clientPricing.customPrice,
          capRatio: 1.0
        };
      }

      // 2. Check for organization custom pricing
      const orgPricing = await CustomPricing.findOne({
        supportItemNumber: ndisItemNumber,
        organizationId: new mongoose.Types.ObjectId(organizationId),
        clientId: { $exists: false },
        isActive: true,
        approvalStatus: 'approved'
      });

      if (orgPricing) {
        const derivedValidation = await priceValidationService.validatePrice(
          ndisItemNumber,
          orgPricing.customPrice,
          state,
          providerType,
          new Date(),
          { servicePostcode }
        );

        return {
          price: orgPricing.customPrice,
          source: 'organization',
          isCustom: true,
          ndisCompliant: derivedValidation.isValid,
          exceedsNdisCap: !derivedValidation.isValid && derivedValidation.status === 'exceeds_cap',
          priceCap: derivedValidation.priceCap ?? itemPriceCap,
          priceCapWarning: !derivedValidation.isValid && derivedValidation.status === 'exceeds_cap' ? `Organization price $${orgPricing.customPrice.toFixed(2)} exceeds NDIS price cap of $${(derivedValidation.priceCap ?? itemPriceCap).toFixed(2)} for ${state} ${providerType} services` : null,
          validationDetails: derivedValidation,
          basePrice: orgPricing.customPrice,
          capRatio: 1.0
        };
      }

      // 3. Check for organization fallback base rate from pricingSettings
      const pricingSettings = await PricingSettings.findOne({
        organizationId: new mongoose.Types.ObjectId(organizationId),
        isActive: true
      });

      if (pricingSettings && typeof pricingSettings.fallbackBaseRate === 'number' && pricingSettings.fallbackBaseRate > 0) {
        const fallbackRate = pricingSettings.fallbackBaseRate;
        logger.info('Using organization fallback base rate for invoice pricing', {
          ndisItemNumber,
          organizationId,
          fallbackRate
        });

        const derivedValidation = await priceValidationService.validatePrice(
          ndisItemNumber,
          fallbackRate,
          state,
          providerType,
          new Date(),
          { servicePostcode }
        );

        const ndisItem = await this.getNdisItemDetails(ndisItemNumber);
        return {
          price: fallbackRate,
          source: 'fallback-base-rate',
          isCustom: false,
          ndisCompliant: derivedValidation.isValid,
          exceedsNdisCap: !derivedValidation.isValid && derivedValidation.status === 'exceeds_cap',
          priceCap: derivedValidation.priceCap ?? itemPriceCap,
          priceCapWarning: !derivedValidation.isValid && derivedValidation.status === 'exceeds_cap' 
            ? `Fallback base rate ${fallbackRate.toFixed(2)} exceeds NDIS price cap of ${(derivedValidation.priceCap ?? itemPriceCap).toFixed(2)} for ${state} ${providerType} services` 
            : null,
          validationDetails: derivedValidation,
          basePrice: fallbackRate,
          capRatio: 1.0,
          supportItemDetails: ndisItem ? {
            supportItemName: ndisItem.supportItemName,
            supportType: ndisItem.supportType,
            unit: ndisItem.unit,
            quoteRequired: ndisItem.quoteRequired
          } : null
        };
      }

      // No base price found: return prompt-required payload (no cap fallback)
      const ndisItem = await this.getNdisItemDetails(ndisItemNumber);
      return {
        price: 0,
        source: 'missing',
        isCustom: false,
        ndisCompliant: true,
        exceedsNdisCap: false,
        priceCap: itemPriceCap,
        requiresManualPricing: true,
        promptData: {
          required: true,
          message: 'Base price not configured. Please set a custom price or configure a fallback base rate in Pricing Configuration.',
          context: {
            targetItemNumber: ndisItemNumber,
            state,
            providerType,
            suggestion: 'Navigate to Pricing Configuration Dashboard to set a fallback base rate, or use NDIS Pricing Management to set a custom price for this item.'
          }
        },
        supportItemDetails: ndisItem ? {
          supportItemName: ndisItem.supportItemName,
          supportType: ndisItem.supportType,
          unit: ndisItem.unit,
          quoteRequired: ndisItem.quoteRequired
        } : null
      };

    } catch (error) {
      logger.error('Item pricing retrieval failed', {
        error: error.message,
        stack: error.stack,
        ndisItemNumber,
        organizationId,
        clientId,
        state,
        providerType,
        servicePostcode
      });
      return {
        price: 0,
        source: 'error',
        isCustom: false,
        ndisCompliant: false,
        exceedsNdisCap: false,
        error: error.message,
        priceCap: null
      };
    }
  }

  /**
   * Get NDIS item details
   */
  async getNdisItemDetails(itemNumber) {
    try {
      const ndisItem = await SupportItem.findOne({
        supportItemNumber: itemNumber
      });
      
      return ndisItem;
    } catch (error) {
      logger.error('NDIS item details fetch failed', {
        error: error.message,
        stack: error.stack,
        itemNumber
      });
      return null;
    }
  }

  /**
   * Parse time string to minutes from midnight
   */
  parseTime(timeStr) {
    // Robustly handle formats like:
    // - "6:00 AM", "12:30 pm"
    // - "18:45" (24h)
    // - "6 AM", "3 pm"
    // - "6" (hour only)
    try {
      if (!timeStr) return 0;
      const str = String(timeStr).trim();

      // Match h:mm a/pm
      const ampmMatch = str.match(/^\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])\s*$/);
      if (ampmMatch) {
        let h = parseInt(ampmMatch[1], 10) % 12; // 12 AM/PM handled below
        const m = parseInt(ampmMatch[2], 10);
        const isPm = ampmMatch[3].toLowerCase() === 'pm';
        if (isPm) h += 12;
        // 12 AM -> 0 hours; 12 PM -> 12 hours already handled via %12 and PM add
        return h * 60 + m;
      }

      // Match 24-hour HH:mm
      const twentyFourMatch = str.match(/^\s*(\d{1,2}):(\d{2})\s*$/);
      if (twentyFourMatch) {
        const h = parseInt(twentyFourMatch[1], 10);
        const m = parseInt(twentyFourMatch[2], 10);
        if (!isNaN(h) && !isNaN(m)) {
          return h * 60 + m;
        }
      }

      // Match "h AM/PM" without minutes
      const hourAmPmMatch = str.match(/^\s*(\d{1,2})\s*([AaPp][Mm])\s*$/);
      if (hourAmPmMatch) {
        let h = parseInt(hourAmPmMatch[1], 10) % 12;
        const isPm = hourAmPmMatch[2].toLowerCase() === 'pm';
        if (isPm) h += 12;
        return h * 60; // no minutes implies :00
      }

      // Generic "h:mm" inside longer strings (e.g., "6:00 AM NSW")
      const embeddedMatch = str.match(/(\d{1,2}):(\d{2})/);
      if (embeddedMatch) {
        let h = parseInt(embeddedMatch[1], 10);
        const m = parseInt(embeddedMatch[2], 10);
        if (/pm/i.test(str) && h < 12) h += 12;
        if (/am/i.test(str) && h === 12) h = 0;
        return h * 60 + m;
      }

      // Hour-only numeric string
      const hourOnlyMatch = str.match(/^\d{1,2}$/);
      if (hourOnlyMatch) {
        return parseInt(hourOnlyMatch[0], 10) * 60;
      }

      // Last chance: parse integer minutes directly
      const asInt = parseInt(str, 10);
      if (!isNaN(asInt)) return asInt;

      // Unrecognized format
      logger && logger.warn && logger.warn('Unable to parse time string', { timeStr });
      return 0;
    } catch (err) {
      logger && logger.error && logger.error('parseTime error', { timeStr, error: err.message });
      return 0;
    }
  }

  /**
   * Parse break field to minutes. Accepts numeric minutes, "HH:MM", or strings like "30 minutes".
   */
  parseBreakMinutes(breakStr) {
    try {
      if (breakStr === null || breakStr === undefined) return 0;
      const str = String(breakStr).trim();

      // Numeric minutes
      if (/^\d+$/.test(str)) return parseInt(str, 10);

      // HH:MM format
      const hm = str.match(/^(\d{1,2}):(\d{2})$/);
      if (hm) {
        const h = parseInt(hm[1], 10);
        const m = parseInt(hm[2], 10);
        return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
      }

      // Extract first number in string (e.g., "30 minutes")
      const anyNum = str.match(/(\d{1,3})/);
      if (anyNum) return parseInt(anyNum[1], 10);

      return 0;
    } catch (err) {
      logger && logger.error && logger.error('parseBreakMinutes error', { breakStr, error: err.message });
      return 0;
    }
  }

  /**
   * Calculate work minutes between start and end time, minus break
   */
  calculateWorkMinutes(startMinutes, endMinutes, breakMinutes) {
    let totalMinutes = endMinutes - startMinutes;
    
    // Handle overnight shifts
    if (totalMinutes < 0) {
      totalMinutes += 24 * 60; // Add 24 hours
    }
    
    return Math.max(0, totalMinutes - breakMinutes);
  }

  /**
   * Validate invoice generation parameters
   */
  validateGenerationParams(userEmail, clientEmail, startDate, endDate) {
    const errors = [];

    if (!userEmail || typeof userEmail !== 'string') {
      errors.push('Valid userEmail is required');
    }

    if (!clientEmail || typeof clientEmail !== 'string') {
      errors.push('Valid clientEmail is required');
    }

    if (!startDate || isNaN(new Date(startDate))) {
      errors.push('Valid startDate is required');
    }

    if (!endDate || isNaN(new Date(endDate))) {
      errors.push('Valid endDate is required');
    }

    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      errors.push('startDate must be before endDate');
    }

    return errors;
  }

  /**
   * Validate invoice generation parameters
   */
  validateInvoiceGenerationParams(params) {
    const errors = [];

    if (!params.organizationId) {
      errors.push('Organization ID is required');
    }

    if (!params.clientId) {
      errors.push('Client ID is required');
    }

    if (!params.startDate || !params.endDate) {
      errors.push('Start date and end date are required');
    }

    if (params.startDate && params.endDate) {
      const start = new Date(params.startDate);
      const end = new Date(params.endDate);
      
      if (start >= end) {
        errors.push('Start date must be before end date');
      }

      // Check if date range is reasonable (not more than 3 months)
      const diffMonths = (end - start) / (1000 * 60 * 60 * 24 * 30);
      if (diffMonths > 3) {
        errors.push('Date range cannot exceed 3 months');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate invoice line items for NDIS compliance and pricing issues
   */
  async validateInvoiceLineItems(lineItems, options = {}) {
    try {
      const {
        defaultState = 'NSW',
        defaultProviderType = 'standard',
        skipPriceValidation = false
      } = options;

      const validationResults = {
        isValid: true,
        totalItems: lineItems.length,
        validItems: 0,
        invalidItems: 0,
        warnings: [],
        errors: [],
        itemValidations: [],
        priceValidationSummary: null
      };

      // Basic validation first
      for (const item of lineItems) {
        const itemValidation = {
          lineItemId: item.id || item._id,
          ndisItemNumber: item.ndisItemNumber,
          isValid: true,
          issues: []
        };

        // Check for zero or negative quantities
        if (!item.quantity || item.quantity <= 0) {
          itemValidation.isValid = false;
          itemValidation.issues.push({
            type: 'invalid_quantity',
            message: 'Quantity must be greater than zero',
            severity: 'error'
          });
          validationResults.errors.push(`Item ${item.ndisItemNumber}: Invalid quantity`);
        }

        // Check for zero or negative unit price
        if (!item.unitPrice || item.unitPrice <= 0) {
          itemValidation.isValid = false;
          itemValidation.issues.push({
            type: 'invalid_unit_price',
            message: 'Unit price must be greater than zero',
            severity: 'error'
          });
          validationResults.errors.push(`Item ${item.ndisItemNumber}: Invalid unit price`);
        }

        // Check for missing NDIS item number
        if (!item.ndisItemNumber) {
          itemValidation.isValid = false;
          itemValidation.issues.push({
            type: 'missing_ndis_item',
            message: 'NDIS item number is required',
            severity: 'error'
          });
          validationResults.errors.push(`Line item missing NDIS item number`);
        }

        if (itemValidation.isValid) {
          validationResults.validItems++;
        } else {
          validationResults.invalidItems++;
          validationResults.isValid = false;
        }

        validationResults.itemValidations.push(itemValidation);
      }

      // Enhanced price validation using dedicated price validation service
      if (!skipPriceValidation && lineItems.length > 0) {
        try {
          const priceValidationResult = await this.validateLineItemPricing(
            lineItems,
            defaultState,
            defaultProviderType
          );

          validationResults.priceValidationSummary = priceValidationResult.summary;

          // Merge price validation results with basic validation
          priceValidationResult.results.forEach((priceResult, index) => {
            const itemValidation = validationResults.itemValidations[index];
            if (itemValidation) {
              // Add price validation issues
              if (!priceResult.isValid) {
                itemValidation.isValid = false;
                validationResults.isValid = false;
                
                if (priceResult.status === 'exceeds_cap') {
                  itemValidation.issues.push({
                    type: 'pricing_exceeds_cap',
                    message: `Price $${priceResult.proposedPrice} exceeds NDIS cap of $${priceResult.priceCap}`,
                    severity: 'error',
                    priceCap: priceResult.priceCap,
                    proposedPrice: priceResult.proposedPrice
                  });
                  validationResults.errors.push(`Item ${priceResult.supportItemNumber}: Price exceeds NDIS cap`);
                } else if (priceResult.status === 'item_not_found') {
                  itemValidation.issues.push({
                    type: 'ndis_item_not_found',
                    message: 'NDIS item not found in price guide',
                    severity: 'error'
                  });
                  validationResults.errors.push(`Item ${priceResult.supportItemNumber}: Not found in NDIS price guide`);
                }
              }

              // Add warnings for quote requirements
              if (priceResult.requiresQuote) {
                itemValidation.issues.push({
                  type: 'quote_required',
                  message: 'This item requires a quote for pricing above standard rates',
                  severity: 'warning'
                });
                validationResults.warnings.push(`Item ${priceResult.supportItemNumber}: Quote required`);
              }

              // Add price validation details
              itemValidation.priceValidation = {
                isValid: priceResult.isValid,
                status: priceResult.status,
                priceCap: priceResult.priceCap,
                proposedPrice: priceResult.proposedPrice,
                requiresQuote: priceResult.requiresQuote,
                compliancePercentage: priceResult.compliancePercentage
              };

              // Attach MMM and cap metadata back to the original line item for UI/processing
              const li = lineItems[index];
              if (li) {
                li.exceedsPriceCap = priceResult.status === 'exceeds_cap';
                li.priceCap = priceResult.priceCap;
                li.pricingMetadata = li.pricingMetadata || {};
                if (priceResult.validationDetails) {
                  const { priceCapBase, mmmRating, mmmMultiplier } = priceResult.validationDetails;
                  if (priceCapBase !== undefined) li.pricingMetadata.priceCapBase = priceCapBase;
                  if (mmmRating !== undefined) li.pricingMetadata.mmmRating = mmmRating;
                  if (mmmMultiplier !== undefined) li.pricingMetadata.mmmMultiplier = mmmMultiplier;
                }
                if (priceResult.priceCap !== undefined) {
                  li.pricingMetadata.priceCapApplied = priceResult.priceCap;
                }
              }
            }
          });

          // Recalculate valid/invalid counts after price validation
          validationResults.validItems = validationResults.itemValidations.filter(item => item.isValid).length;
          validationResults.invalidItems = validationResults.itemValidations.filter(item => !item.isValid).length;

        } catch (priceValidationError) {
          logger.warn('Price validation service unavailable', {
            error: priceValidationError.message,
            lineItemCount: lineItems.length
          });
          validationResults.warnings.push('Price validation service unavailable - basic validation only');
        }
      }

      return validationResults;

    } catch (error) {
      logger.error('Invoice line items validation failed', {
        error: error.message,
        stack: error.stack,
        lineItemCount: lineItems.length
      });
      return {
        isValid: false,
        error: error.message,
        totalItems: lineItems.length,
        validItems: 0,
        invalidItems: lineItems.length,
        warnings: [],
        errors: [error.message],
        itemValidations: []
      };
    }
  }

  /**
   * Validate line item pricing using the dedicated price validation service
   */
  async validateLineItemPricing(lineItems, defaultState = 'NSW', defaultProviderType = 'standard') {
    try {
      // Transform line items for price validation
      const validationRequests = lineItems.map((item, index) => ({
        requestId: item.id || `line_${index}`,
        supportItemNumber: item.ndisItemNumber,
        proposedPrice: item.unitPrice,
        state: item.state || defaultState,
        providerType: item.providerType || defaultProviderType,
        serviceDate: item.serviceDate || new Date(),
        quantity: item.quantity || 1,
        description: item.description || item.itemName,
        servicePostcode: item.serviceLocationPostcode || item.servicePostcode || null
      }));

      // Use the price validation service directly
      const results = await priceValidationService.validatePricesBatch(validationRequests);
      const summary = priceValidationService.getValidationSummary(results);

      // Calculate enhanced summary with invoice-specific metrics
      let totalInvoiceAmount = 0;
      let totalCompliantAmount = 0;
      let hasNonCompliantItems = false;

      const enhancedResults = results.map((result, index) => {
        const lineItem = lineItems[index];
        const quantity = lineItem?.quantity || 1;
        const lineTotal = result.proposedPrice * quantity;
        const compliantLineTotal = result.priceCap ? Math.min(result.proposedPrice, result.priceCap) * quantity : lineTotal;
        
        totalInvoiceAmount += lineTotal;
        totalCompliantAmount += compliantLineTotal;
        
        if (!result.isValid && result.status === 'exceeds_cap') {
          hasNonCompliantItems = true;
        }

        return {
          ...result,
          lineItem: {
            quantity,
            lineTotal,
            compliantLineTotal,
            excessAmount: lineTotal - compliantLineTotal
          }
        };
      });

      const enhancedSummary = {
        ...summary,
        totalInvoiceAmount,
        totalCompliantAmount,
        totalExcessAmount: totalInvoiceAmount - totalCompliantAmount,
        hasNonCompliantItems,
        compliancePercentage: totalInvoiceAmount > 0 ? ((totalCompliantAmount / totalInvoiceAmount) * 100).toFixed(2) : 100
      };

      return {
        results: enhancedResults,
        summary: enhancedSummary
      };

    } catch (error) {
      logger.error('Line item pricing validation failed', {
        error: error.message,
        stack: error.stack,
        lineItemCount: lineItems.length,
        defaultState,
        defaultProviderType
      });
      throw new Error(`Price validation failed: ${error.message}`);
    }
  }
  /**
   * Get billable trips for invoice
   */
  async getBillableTripsForInvoice(clientId, startDate, endDate) {
    try {
      // Ensure clientId is string
      const clientIdStr = clientId.toString();
      return await TripService.getBillableTrips(clientIdStr, startDate, endDate);
    } catch (error) {
      logger.error('Error fetching billable trips', { error: error.message });
      return [];
    }
  }

  /**
   * Convert trip to line item
   */
  async convertTripToLineItem(trip, client, organizationId) {
    try {
      // 1. Determine Rate
      let rate = 0;
      
      // Check Client override
      if (client.billingSettings && client.billingSettings.mileageRate) {
        rate = client.billingSettings.mileageRate;
      } else {
        // Check Org default
        const org = await Organization.findById(organizationId);
        rate = org?.settings?.mileage?.defaultBillingRate || 0;
      }

      const quantity = parseFloat(trip.distance) || 0;
      const totalPrice = quantity * rate;

      return {
        id: trip._id.toString(),
        type: 'travel',
        ndisItemNumber: '07_001_0106_8_3', // Example Transport Code (Provider Travel - Non-Labour Costs)
        // Or '01_011_0107_1_1' (Public Transport).
        // Best to use "Provider Travel - Non-Labour Costs" usually.
        // Let's stick to a generic description and maybe a configurable code later.
        // For now, I'll use '07_001_0106_8_3' as a placeholder for "Provider Travel".
        itemDescription: `Travel: ${trip.startLocation} to ${trip.endLocation} (${trip.distance}km)`,
        quantity: quantity,
        unit: 'km',
        unitPrice: rate,
        totalPrice: totalPrice,
        date: trip.date,
        tripId: trip._id,
        pricingStatus: 'fixed',
        promptRequired: false,
        ndisCompliant: true,
        metadata: {
            source: 'trip',
            tripType: trip.tripType
        }
      };
    } catch (error) {
      logger.error('Error converting trip to line item', { error: error.message });
      return null;
    }
  }
}

module.exports = new InvoiceGenerationService();
