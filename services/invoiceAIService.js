/**
 * Invoice AI Service
 * AI-powered invoice validation, anomaly detection, and payment prediction
 */

/**
 * Detect anomalies in an invoice
 * @param {Object} invoice - Invoice data
 * @returns {Array} List of detected anomalies
 */
exports.detectAnomalies = (invoice) => {
  const anomalies = [];

  // 1. Check for unusual amounts
  const totalAmount = invoice.totalAmount || 0;
  const lineItems = invoice.lineItems || [];
  
  if (lineItems.length > 0) {
    const avgItemAmount = totalAmount / lineItems.length;
    
    lineItems.forEach((item, index) => {
      const itemAmount = item.amount || 0;
      
      // Check for unusually high line item
      if (itemAmount > avgItemAmount * 3) {
        anomalies.push({
          anomalyType: 'unusual_amount',
          severity: 'medium',
          description: `Line item ${index + 1} has unusually high amount`,
          field: `lineItems[${index}].amount`,
          expectedValue: `~$${avgItemAmount.toFixed(2)}`,
          actualValue: `$${itemAmount.toFixed(2)}`,
          suggestion: 'Verify this amount is correct',
        });
      }
      
      // Check for zero or negative amounts
      if (itemAmount <= 0) {
        anomalies.push({
          anomalyType: 'invalid_amount',
          severity: 'high',
          description: `Line item ${index + 1} has invalid amount`,
          field: `lineItems[${index}].amount`,
          expectedValue: '> 0',
          actualValue: itemAmount,
          suggestion: 'Amount must be positive',
        });
      }
    });
  }

  // 2. Check for missing required fields
  const requiredFields = ['clientId', 'organizationId', 'totalAmount', 'dueDate'];
  requiredFields.forEach(field => {
    if (!invoice[field]) {
      anomalies.push({
        anomalyType: 'missing_field',
        severity: 'high',
        description: `Required field '${field}' is missing`,
        field,
        expectedValue: 'non-empty value',
        actualValue: null,
        suggestion: `Please provide ${field}`,
      });
    }
  });

  // 3. Check for overdue due date
  if (invoice.dueDate) {
    const dueDate = new Date(invoice.dueDate);
    const now = new Date();
    
    if (dueDate < now) {
      anomalies.push({
        anomalyType: 'overdue_date',
        severity: 'low',
        description: 'Due date is in the past',
        field: 'dueDate',
        expectedValue: 'future date',
        actualValue: dueDate.toISOString(),
        suggestion: 'Consider updating the due date',
      });
    }
  }

  // 4. Check for duplicate invoice number
  // In production, this would query the database
  // For now, just a placeholder check
  if (!invoice.invoiceNumber || invoice.invoiceNumber.length < 3) {
    anomalies.push({
      anomalyType: 'invalid_invoice_number',
      severity: 'medium',
      description: 'Invoice number is too short or missing',
      field: 'invoiceNumber',
      expectedValue: 'unique identifier (min 3 chars)',
      actualValue: invoice.invoiceNumber || null,
      suggestion: 'Generate a proper invoice number',
    });
  }

  // 5. Check for tax calculation errors
  if (invoice.taxAmount && invoice.subtotal) {
    const expectedTax = invoice.subtotal * 0.1; // Assuming 10% tax
    const actualTax = invoice.taxAmount;
    const taxDifference = Math.abs(expectedTax - actualTax);
    
    if (taxDifference > 0.01) {
      anomalies.push({
        anomalyType: 'tax_calculation_error',
        severity: 'high',
        description: 'Tax amount does not match expected calculation',
        field: 'taxAmount',
        expectedValue: `$${expectedTax.toFixed(2)}`,
        actualValue: `$${actualTax.toFixed(2)}`,
        suggestion: 'Recalculate tax amount',
      });
    }
  }

  return anomalies;
};

/**
 * Validate an invoice
 * @param {Object} invoice - Invoice data
 * @returns {Object} Validation result
 */
exports.validateInvoice = (invoice) => {
  const anomalies = exports.detectAnomalies(invoice);
  const warnings = [];

  // Generate warnings for low-severity issues
  anomalies.forEach(anomaly => {
    if (anomaly.severity === 'low') {
      warnings.push(anomaly.description);
    }
  });

  // Calculate confidence score (0-100)
  const criticalCount = anomalies.filter(a => a.severity === 'critical').length;
  const highCount = anomalies.filter(a => a.severity === 'high').length;
  const mediumCount = anomalies.filter(a => a.severity === 'medium').length;
  
  let confidenceScore = 100;
  confidenceScore -= criticalCount * 30;
  confidenceScore -= highCount * 20;
  confidenceScore -= mediumCount * 10;
  confidenceScore = Math.max(0, confidenceScore);

  const isValid = criticalCount === 0 && highCount === 0;

  let summary = 'Invoice is valid';
  if (!isValid) {
    summary = `Found ${anomalies.length} issue(s) that need attention`;
  } else if (mediumCount > 0) {
    summary = `Invoice is valid but has ${mediumCount} warning(s)`;
  }

  return {
    isValid,
    anomalies,
    warnings,
    confidenceScore,
    summary,
  };
};

/**
 * Predict payment date for an invoice
 * @param {Object} invoice - Invoice data
 * @param {Object} clientHistory - Client payment history
 * @returns {Object} Payment prediction
 */
exports.predictPaymentDate = (invoice, clientHistory = {}) => {
  const factors = [];
  let daysToPayment = 30; // Default

  // Factor 1: Client's average payment time (40% weight)
  const avgPaymentDays = clientHistory.avgPaymentDays || 30;
  daysToPayment = avgPaymentDays * 0.4 + daysToPayment * 0.6;
  factors.push(`Historical avg: ${avgPaymentDays} days`);

  // Factor 2: Invoice amount (20% weight)
  const amount = invoice.totalAmount || 0;
  if (amount > 5000) {
    daysToPayment += 5;
    factors.push('Large invoice amount (+5 days)');
  } else if (amount < 500) {
    daysToPayment -= 3;
    factors.push('Small invoice amount (-3 days)');
  }

  // Factor 3: Client payment reliability (20% weight)
  const onTimeRate = clientHistory.onTimePaymentRate || 0.7;
  if (onTimeRate < 0.5) {
    daysToPayment += 10;
    factors.push('Low on-time payment rate (+10 days)');
  } else if (onTimeRate > 0.9) {
    daysToPayment -= 5;
    factors.push('High on-time payment rate (-5 days)');
  }

  // Factor 4: Time of month (10% weight)
  const dueDate = new Date(invoice.dueDate || Date.now());
  const dayOfMonth = dueDate.getDate();
  if (dayOfMonth > 25) {
    daysToPayment += 3;
    factors.push('End of month (+3 days)');
  }

  // Factor 5: Day of week (10% weight)
  const dayOfWeek = dueDate.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    daysToPayment += 2;
    factors.push('Weekend due date (+2 days)');
  }

  // Calculate predicted date
  const predictedDate = new Date(dueDate);
  predictedDate.setDate(predictedDate.getDate() + Math.round(daysToPayment));

  // Determine risk level and probability
  let riskLevel = 'low';
  let probability = 0.8;

  if (daysToPayment > 45) {
    riskLevel = 'high';
    probability = 0.5;
  } else if (daysToPayment > 35) {
    riskLevel = 'medium';
    probability = 0.65;
  }

  // Generate recommendation
  let recommendation = 'Payment expected on time';
  if (riskLevel === 'high') {
    recommendation = 'Consider sending early reminder and following up';
  } else if (riskLevel === 'medium') {
    recommendation = 'Send reminder 1 week before due date';
  }

  return {
    invoiceId: invoice._id || invoice.id,
    predictedPaymentDate: predictedDate,
    probability,
    riskLevel,
    factors,
    recommendation,
  };
};

/**
 * Suggest optimal reminder timing
 * @param {Object} invoice - Invoice data
 * @param {Object} prediction - Payment prediction
 * @returns {Array} List of suggested reminders
 */
exports.suggestReminders = (invoice, prediction) => {
  const reminders = [];
  const dueDate = new Date(invoice.dueDate || Date.now());
  const now = new Date();

  // Reminder 1: 7 days before due date
  const reminder1Date = new Date(dueDate);
  reminder1Date.setDate(reminder1Date.getDate() - 7);
  
  if (reminder1Date > now) {
    reminders.push({
      invoiceId: invoice._id || invoice.id,
      suggestedSendTime: reminder1Date,
      channel: 'email',
      message: 'Friendly reminder: Invoice due in 7 days',
      successProbability: 0.7,
      reason: 'First reminder - gentle nudge',
    });
  }

  // Reminder 2: 1 day before due date (if high risk)
  if (prediction.riskLevel === 'high' || prediction.riskLevel === 'medium') {
    const reminder2Date = new Date(dueDate);
    reminder2Date.setDate(reminder2Date.getDate() - 1);
    
    if (reminder2Date > now) {
      reminders.push({
        invoiceId: invoice._id || invoice.id,
        suggestedSendTime: reminder2Date,
        channel: 'sms',
        message: 'Urgent: Invoice due tomorrow',
        successProbability: 0.85,
        reason: 'High-risk client - urgent reminder',
      });
    }
  }

  // Reminder 3: On due date
  if (dueDate > now) {
    reminders.push({
      invoiceId: invoice._id || invoice.id,
      suggestedSendTime: dueDate,
      channel: 'email',
      message: 'Invoice due today - please process payment',
      successProbability: 0.6,
      reason: 'Due date reminder',
    });
  }

  return reminders;
};

/**
 * Auto-generate invoices for a period
 * @param {Array} appointments - Appointments to invoice
 * @param {Object} options - Generation options
 * @returns {Object} Generation result
 */
exports.autoGenerateInvoices = async (appointments, options = {}) => {
  const result = {
    totalInvoices: 0,
    successfulInvoices: 0,
    failedInvoices: 0,
    invoiceIds: [],
    errors: [],
  };

  // Group by client if requested
  let invoiceGroups = [];
  if (options.groupByClient) {
    const clientGroups = {};
    appointments.forEach(apt => {
      const clientId = apt.clientId || apt.clientEmail;
      if (!clientGroups[clientId]) {
        clientGroups[clientId] = [];
      }
      clientGroups[clientId].push(apt);
    });
    invoiceGroups = Object.values(clientGroups);
  } else {
    invoiceGroups = appointments.map(apt => [apt]);
  }

  result.totalInvoices = invoiceGroups.length;

  // Generate invoices
  for (const group of invoiceGroups) {
    try {
      // Calculate total
      const totalAmount = group.reduce((sum, apt) => {
        return sum + (apt.amount || 0);
      }, 0);

      // Create invoice object
      const invoice = {
        clientId: group[0].clientId,
        organizationId: group[0].organizationId,
        totalAmount,
        subtotal: totalAmount / 1.1, // Assuming 10% tax
        taxAmount: totalAmount - (totalAmount / 1.1),
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        invoiceNumber: `INV-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        lineItems: group.map(apt => ({
          description: apt.service || 'Service',
          amount: apt.amount || 0,
          appointmentId: apt._id,
        })),
      };

      // Validate if requested
      if (options.validateBeforeGeneration) {
        const validation = exports.validateInvoice(invoice);
        if (!validation.isValid) {
          result.failedInvoices++;
          result.errors.push(`Validation failed for client ${invoice.clientId}`);
          continue;
        }
      }

      // In production, save to database
      // For now, just add to result
      result.successfulInvoices++;
      result.invoiceIds.push(invoice.invoiceNumber);
    } catch (error) {
      result.failedInvoices++;
      result.errors.push(error.message);
    }
  }

  result.summary = `Generated ${result.successfulInvoices}/${result.totalInvoices} invoices successfully`;

  return result;
};
