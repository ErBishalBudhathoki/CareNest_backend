/**
 * InvoiceFactory - Factory for generating invoice entities
 * 
 * Creates invoices with line items, realistic amounts, and payment terms
 */

import EntityFactory from './EntityFactory.js';
import validationRules from '../validation/validationRules.js';

class InvoiceFactory extends EntityFactory {
  constructor() {
    super('invoice', validationRules.invoice);
  }

  /**
   * Create an invoice with optional overrides
   * @param {Object} overrides - Optional field overrides
   * @returns {Object} Generated invoice
   */
  create(overrides = {}) {
    const issueDate = this._randomPastDate(0.5);
    const dueDate = new Date(issueDate);
    dueDate.setDate(dueDate.getDate() + this._randomPick([7, 14, 30]));

    const lineItems = this._generateLineItems();
    const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0);
    const gst = subtotal * 0.1;
    const totalAmount = subtotal + gst;

    const invoice = {
      id: this._generateId(),
      clientId: this._generateId(),
      organizationId: this._generateId(),
      invoiceNumber: this._generateInvoiceNumber(),
      issueDate,
      dueDate,
      status: this._determineStatus(dueDate),
      lineItems,
      subtotal: parseFloat(subtotal.toFixed(2)),
      gst: parseFloat(gst.toFixed(2)),
      totalAmount: parseFloat(totalAmount.toFixed(2)),
      amountPaid: 0,
      amountDue: parseFloat(totalAmount.toFixed(2)),
      paymentTerms: this._randomPick(['Net 7', 'Net 14', 'Net 30', 'Due on receipt']),
      notes: this.faker.lorem.sentence(),
      metadata: {
        billingPeriod: {
          start: this._randomPastDate(1),
          end: issueDate
        },
        generatedBy: 'seed-data-generator',
        category: this._randomPick(['care-services', 'support-services', 'equipment', 'other'])
      },
      createdAt: issueDate,
      updatedAt: new Date()
    };

    const merged = this._mergeOverrides(invoice, overrides);
    return this._markAsSeedData(merged);
  }

  /**
   * Generate invoice line items
   * @private
   * @returns {Array} Array of line items
   */
  _generateLineItems() {
    const itemCount = this._randomInt(1, 5);
    const items = [];

    const serviceTypes = [
      { description: 'Personal Care Services', rate: 45.50 },
      { description: 'Meal Preparation', rate: 38.00 },
      { description: 'Medication Management', rate: 42.00 },
      { description: 'Transportation Services', rate: 35.00 },
      { description: 'Social Support', rate: 40.00 },
      { description: 'Domestic Assistance', rate: 36.50 },
      { description: 'Respite Care', rate: 48.00 }
    ];

    for (let i = 0; i < itemCount; i++) {
      const service = this._randomPick(serviceTypes);
      const quantity = this._randomNumber(1, 40, 1); // Hours
      const rate = service.rate;
      const total = quantity * rate;

      items.push({
        description: service.description,
        quantity,
        unit: 'hours',
        rate,
        total: parseFloat(total.toFixed(2))
      });
    }

    return items;
  }

  /**
   * Generate realistic invoice number
   * @private
   * @returns {string} Invoice number
   */
  _generateInvoiceNumber() {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const sequence = this.faker.string.numeric(4);
    return `INV-${year}${month}-${sequence}`;
  }

  /**
   * Determine invoice status based on due date
   * @private
   * @param {Date} dueDate - Invoice due date
   * @returns {string} Invoice status
   */
  _determineStatus(dueDate) {
    const now = new Date();
    const random = Math.random();

    // 70% paid, 20% sent, 10% overdue/draft
    if (random < 0.7) {
      return 'paid';
    } else if (random < 0.9) {
      return 'sent';
    } else if (dueDate < now) {
      return 'overdue';
    } else {
      return this._randomPick(['draft', 'sent']);
    }
  }
}

export default InvoiceFactory;
