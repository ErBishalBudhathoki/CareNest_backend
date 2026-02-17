/**
 * Financial Intelligence Integration Tests
 * 
 * Tests critical workflows for the Financial Intelligence feature phase:
 * - Invoice creation and management
 * - Payment processing
 * - Budget tracking
 * - Financial reporting
 */

const tests = [
  {
    name: 'Create client → Generate invoice → Process payment → Verify financial records',
    phase: 'financial-intelligence',
    
    async setup(runner) {
      // Setup: Create test client
      this.testClient = {
        name: 'Test Client for Invoice',
        email: `test-client-${Date.now()}@example.com`,
        phone: '+61400000000',
        address: {
          street: '123 Test St',
          city: 'Sydney',
          state: 'NSW',
          postcode: '2000',
          country: 'Australia'
        },
        ndisNumber: `TEST${Date.now()}`,
        isSeedData: true
      };
      
      const clientResponse = await runner.apiRequest('POST', '/clients', this.testClient);
      this.clientId = clientResponse.data._id || clientResponse.data.id;
    },
    
    async execute(runner) {
      // Step 1: Create invoice
      const invoiceData = {
        clientId: this.clientId,
        invoiceNumber: `INV-${Date.now()}`,
        issueDate: new Date().toISOString(),
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        lineItems: [
          {
            description: 'Support Services',
            quantity: 10,
            unitPrice: 50,
            total: 500
          }
        ],
        subtotal: 500,
        tax: 50,
        total: 550,
        status: 'draft',
        isSeedData: true
      };
      
      const invoiceResponse = await runner.apiRequest('POST', '/invoices', invoiceData);
      this.invoiceId = invoiceResponse.data._id || invoiceResponse.data.id;
      
      // Verify invoice was created
      if (!this.invoiceId) {
        throw new Error('Invoice creation failed - no ID returned');
      }
      
      // Step 2: Send invoice
      await runner.apiRequest('POST', `/invoices/${this.invoiceId}/send`);
      
      // Step 3: Process payment
      const paymentData = {
        invoiceId: this.invoiceId,
        amount: 550,
        method: 'credit_card',
        reference: `PAY-${Date.now()}`,
        isSeedData: true
      };
      
      const paymentResponse = await runner.apiRequest('POST', '/invoices/${this.invoiceId}/payment', paymentData);
      this.paymentId = paymentResponse.data._id || paymentResponse.data.id;
      
      // Step 4: Verify financial records
      const updatedInvoice = await runner.apiRequest('GET', `/invoices/${this.invoiceId}`);
      
      if (updatedInvoice.data.status !== 'paid') {
        throw new Error(`Expected invoice status to be 'paid', got '${updatedInvoice.data.status}'`);
      }
      
      // Verify payment record exists
      const payment = await runner.apiRequest('GET', `/payments/${this.paymentId}`);
      
      if (payment.data.amount !== 550) {
        throw new Error(`Expected payment amount to be 550, got ${payment.data.amount}`);
      }
    },
    
    async teardown(runner) {
      // Cleanup: Delete test data
      try {
        if (this.invoiceId) {
          await runner.apiRequest('DELETE', `/invoices/${this.invoiceId}`);
        }
        if (this.clientId) {
          await runner.apiRequest('DELETE', `/clients/${this.clientId}`);
        }
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  },
  
  {
    name: 'Create budget → Track expenses → Generate financial report',
    phase: 'financial-intelligence',
    
    async setup(runner) {
      // No specific setup needed
    },
    
    async execute(runner) {
      // Step 1: Create budget
      const budgetData = {
        name: `Test Budget ${Date.now()}`,
        period: 'monthly',
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        categories: [
          {
            name: 'Operations',
            allocated: 10000,
            spent: 0
          },
          {
            name: 'Payroll',
            allocated: 50000,
            spent: 0
          }
        ],
        totalAllocated: 60000,
        totalSpent: 0,
        isSeedData: true
      };
      
      const budgetResponse = await runner.apiRequest('POST', '/budgets', budgetData);
      this.budgetId = budgetResponse.data._id || budgetResponse.data.id;
      
      // Verify budget was created
      if (!this.budgetId) {
        throw new Error('Budget creation failed - no ID returned');
      }
      
      // Step 2: Track expenses (simulate spending)
      const updatedBudget = await runner.apiRequest('PUT', `/budgets/${this.budgetId}`, {
        categories: [
          {
            name: 'Operations',
            allocated: 10000,
            spent: 2500
          },
          {
            name: 'Payroll',
            allocated: 50000,
            spent: 35000
          }
        ],
        totalSpent: 37500
      });
      
      // Step 3: Generate financial report
      const reportResponse = await runner.apiRequest('POST', '/financial-reports/generate', {
        budgetId: this.budgetId,
        reportType: 'budget-analysis',
        period: 'monthly'
      });
      
      // Verify report was generated
      if (!reportResponse.data || !reportResponse.data.summary) {
        throw new Error('Financial report generation failed');
      }
      
      // Verify report contains budget data
      if (reportResponse.data.summary.totalAllocated !== 60000) {
        throw new Error(`Expected total allocated to be 60000, got ${reportResponse.data.summary.totalAllocated}`);
      }
    },
    
    async teardown(runner) {
      // Cleanup: Delete test budget
      try {
        if (this.budgetId) {
          await runner.apiRequest('DELETE', `/budgets/${this.budgetId}`);
        }
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  }
];

export default tests;
