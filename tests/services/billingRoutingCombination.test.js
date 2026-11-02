// Milestone 3.4: Multi-Payer Split Routing for Combination Funding Tests
// Tests routing of individual line items based on NDIS support category and participant plan envelopes,
// ensuring Core/SIL items route to NDIA (claim_csv), Capacity Building to Plan Manager (invoice_pdf),
// and Consumables/Participant items to Self-Managed (invoice_pdf).

const billingRoutingService = require('../../services/billingRoutingService');

describe('BillingRoutingService - Combination Funding Split Routing (Milestone 3.4)', () => {
  describe('resolveLineItemRoute', () => {
    test('routes standard non-combination client to their default funding route', () => {
      const ndiaResult = billingRoutingService.resolveLineItemRoute({
        supportItemNumber: '01_011_0107_1_1',
        fundingType: 'ndia_managed',
      });
      expect(ndiaResult).toEqual({
        fundingRoute: 'ndia_managed',
        recipientType: 'ndia',
        artifact: 'claim_csv',
        category: '01',
      });

      const pmResult = billingRoutingService.resolveLineItemRoute({
        supportItemNumber: '15_056_0128_1_3',
        fundingType: 'plan_managed',
      });
      expect(pmResult).toEqual({
        fundingRoute: 'plan_managed',
        recipientType: 'plan_manager',
        artifact: 'invoice_pdf',
        category: '15',
      });
    });

    test('routes Core/SIL Category 01 to ndia_managed in combination funding', () => {
      const result = billingRoutingService.resolveLineItemRoute({
        supportItemNumber: '01_011_0107_1_1',
        fundingType: 'combination',
      });
      expect(result).toEqual({
        fundingRoute: 'ndia_managed',
        recipientType: 'ndia',
        artifact: 'claim_csv',
        category: '01',
      });
    });

    test('routes Core Category 04 to ndia_managed in combination funding', () => {
      const result = billingRoutingService.resolveLineItemRoute({
        supportItemNumber: '04_104_0125_6_1',
        fundingType: 'combination',
      });
      expect(result.fundingRoute).toBe('ndia_managed');
      expect(result.artifact).toBe('claim_csv');
    });

    test('routes Capacity Building Category 15 to plan_managed in combination funding', () => {
      const result = billingRoutingService.resolveLineItemRoute({
        supportItemNumber: '15_056_0128_1_3',
        fundingType: 'combination',
      });
      expect(result).toEqual({
        fundingRoute: 'plan_managed',
        recipientType: 'plan_manager',
        artifact: 'invoice_pdf',
        category: '15',
      });
    });

    test('routes Capacity Building Category 07 (Coordination) to plan_managed in combination funding', () => {
      const result = billingRoutingService.resolveLineItemRoute({
        supportItemNumber: '07_001_0106_8_3',
        fundingType: 'combination',
      });
      expect(result.fundingRoute).toBe('plan_managed');
    });

    test('routes Category 03 (Consumables) to self_managed in combination funding', () => {
      const result = billingRoutingService.resolveLineItemRoute({
        supportItemNumber: '03_040_0103_1_1',
        fundingType: 'combination',
      });
      expect(result).toEqual({
        fundingRoute: 'self_managed',
        recipientType: 'participant',
        artifact: 'invoice_pdf',
        category: '03',
      });
    });

    test('honors explicit participant planCategory envelope override', () => {
      const planCategories = [
        { categoryNumber: '01', fundingType: 'plan_managed' },
        { categoryNumber: '15', fundingType: 'ndia_managed' },
      ];

      const cat1Result = billingRoutingService.resolveLineItemRoute({
        supportItemNumber: '01_011_0107_1_1',
        fundingType: 'combination',
        planCategories,
      });
      expect(cat1Result.fundingRoute).toBe('plan_managed');
      expect(cat1Result.artifact).toBe('invoice_pdf');

      const cat15Result = billingRoutingService.resolveLineItemRoute({
        supportItemNumber: '15_056_0128_1_3',
        fundingType: 'combination',
        planCategories,
      });
      expect(cat15Result.fundingRoute).toBe('ndia_managed');
      expect(cat15Result.artifact).toBe('claim_csv');
    });
  });

  describe('splitLineItemsByRoute', () => {
    test('partitions mixed line items into appropriate route buckets', () => {
      const client = {
        fundingType: 'combination',
        plan: {
          categories: [],
        },
      };

      const lineItems = [
        {
          supportItemNumber: '01_011_0107_1_1',
          supportItemName: 'SIL Assistance',
          totalPrice: 200,
        },
        {
          supportItemNumber: '15_056_0128_1_3',
          supportItemName: 'Occupational Therapy',
          totalPrice: 190,
        },
        {
          supportItemNumber: '03_040_0103_1_1',
          supportItemName: 'Consumable Equipment',
          totalPrice: 50,
        },
      ];

      const split = billingRoutingService.splitLineItemsByRoute(lineItems, client);

      expect(split.hasMixedRoutes).toBe(true);
      expect(split.activeRoutes).toContain('ndia_managed');
      expect(split.activeRoutes).toContain('plan_managed');
      expect(split.activeRoutes).toContain('self_managed');

      expect(split.routes.ndia_managed).toHaveLength(1);
      expect(split.routes.ndia_managed[0].supportItemNumber).toBe('01_011_0107_1_1');
      expect(split.routes.ndia_managed[0].fundingRoute).toBe('ndia_managed');

      expect(split.routes.plan_managed).toHaveLength(1);
      expect(split.routes.plan_managed[0].supportItemNumber).toBe('15_056_0128_1_3');
      expect(split.routes.plan_managed[0].fundingRoute).toBe('plan_managed');

      expect(split.routes.self_managed).toHaveLength(1);
      expect(split.routes.self_managed[0].supportItemNumber).toBe('03_040_0103_1_1');
      expect(split.routes.self_managed[0].fundingRoute).toBe('self_managed');
    });

    test('returns hasMixedRoutes=false when all items belong to a single route', () => {
      const client = { fundingType: 'ndia_managed' };
      const lineItems = [
        { supportItemNumber: '01_011_0107_1_1', totalPrice: 100 },
        { supportItemNumber: '01_799_0107_1_1', totalPrice: 25 },
      ];

      const split = billingRoutingService.splitLineItemsByRoute(lineItems, client);
      expect(split.hasMixedRoutes).toBe(false);
      expect(split.activeRoutes).toEqual(['ndia_managed']);
      expect(split.routes.ndia_managed).toHaveLength(2);
    });
  });
});
