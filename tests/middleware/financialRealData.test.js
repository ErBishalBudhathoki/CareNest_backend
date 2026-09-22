/**
 * Financial Intelligence — real-data regression tests.
 *
 * history: KPIs, cash position, forecasts, alerts and scenarios were
 * Math.random() per request (140 call sites, zero DB reads), so every
 * load showed different numbers. These tests pin determinism:
 * identical fixtures => identical output.
 */
const mockInvoiceAggregate = jest.fn();
const mockExpenseAggregate = jest.fn();
const mockUserCount = jest.fn();

jest.mock('../../models/Invoice', () => ({
  Invoice: { aggregate: (...args) => mockInvoiceAggregate(...args) },
  InvoiceStatus: {},
  PaymentStatus: {},
}));

jest.mock('../../models/Expense', () => ({
  aggregate: (...args) => mockExpenseAggregate(...args),
}));

jest.mock('../../models/User', () => ({
  countDocuments: (...args) => mockUserCount(...args),
}));

jest.mock('../../config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  security: jest.fn(),
}));

const dataService = require('../../services/financialDataService');
const financialAnalyticsService = require('../../services/financialAnalyticsService');
const cashFlowPredictionService = require('../../services/cashFlowPredictionService');
const revenueForecastingService = require('../../services/revenueForecastingService');

const ORG = 'org-a';

function armLedger({ paid = [], expenses = [], receivables = null, payables = null } = {}) {
  // Invoice.aggregate calls in order: sumPaid(cur), sumPaid(prev),
  // [fallback x2], receivables, overdue, topClients, monthly...
  // Route by pipeline shape instead of order: inspect match stage.
  mockInvoiceAggregate.mockImplementation((pipeline) => {
    const stages = JSON.stringify(pipeline);
    if (stages.includes('updatedAt')) {
      return Promise.resolve([]);
    }
    if (stages.includes('%Y-%m')) {
      const today = new Date().toISOString().slice(0, 7);
      const total = paid.reduce((s, p) => s + p.amount, 0);
      return Promise.resolve(total ? [{ _id: today, revenue: total }] : []);
    }
    if (stages.includes('$dateToString')) {
      const today = new Date().toISOString().slice(0, 10);
      const total = paid.reduce((s, p) => s + p.amount, 0);
      return Promise.resolve(total ? [{ _id: today, total }] : []);
    }
    if (stages.includes('paidDate') && stages.includes('$group')) {
      const total = paid.reduce((s, p) => s + p.amount, 0);
      return Promise.resolve(total ? [{ total, count: paid.length }] : []);
    }
    if (stages.includes('pending')) {
      const r = receivables || { total: 0, count: 0 };
      return Promise.resolve(r.total ? [{ total: r.total, count: r.count }] : []);
    }
    if (stages.includes('overdue') || stages.includes('dueDate')) {
      return Promise.resolve([]);
    }
    if (stages.includes('clientId')) {
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  });
  mockExpenseAggregate.mockImplementation((pipeline) => {
    const stages = JSON.stringify(pipeline);
    if (stages.includes('$dateToString')) {
      const today = new Date().toISOString().slice(0, 10);
      const total = expenses.reduce((s, e) => s + e.amount, 0);
      return Promise.resolve(total ? [{ _id: today, total }] : []);
    }
    if (stages.includes('expenseDate')) {
      const list = expenses;
      const total = list.reduce((s, e) => s + e.amount, 0);
      return Promise.resolve(total ? [{ total, count: list.length }] : []);
    }
    const p = payables || { total: 0, count: 0 };
    return Promise.resolve(p.total ? [{ total: p.total, count: p.count }] : []);
  });
  mockUserCount.mockResolvedValue(4);
}

describe('financialDataService primitives', () => {
  test('parsePeriod handles units and garbage', () => {
    const p30 = dataService.parsePeriod('30d', new Date('2026-09-22T00:00:00Z'));
    expect(p30.days).toBe(30);
    expect(dataService.parsePeriod('7d').days).toBe(7);
    expect(dataService.parsePeriod('12m').days).toBe(360);
    expect(dataService.parsePeriod('nonsense').days).toBe(30);
  });

  test('changeRatio guards divide-by-zero', () => {
    expect(dataService.changeRatio(10, 0)).toBe(1);
    expect(dataService.changeRatio(0, 0)).toBe(0);
    expect(dataService.changeRatio(110, 100)).toBeCloseTo(0.1, 5);
    expect(dataService.trendOf(0.05)).toBe('up');
    expect(dataService.trendOf(-0.05)).toBe('down');
    expect(dataService.trendOf(0.01)).toBe('stable');
  });
});

describe('KPIs are real and deterministic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    armLedger({
      paid: [{ amount: 1000 }, { amount: 2000 }],
      expenses: [{ amount: 500 }],
      receivables: { total: 700, count: 1 },
      payables: { total: 100, count: 1 },
    });
  });

  test('same fixture twice => same numbers', async () => {
    const first = await financialAnalyticsService.getKPIs(ORG);
    const second = await financialAnalyticsService.getKPIs(ORG);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    const strip = (k) => {
      const c = { ...k };
      delete c.asOf;
      return c;
    };
    expect(strip(second.kpis)).toEqual(strip(first.kpis));
    expect(first.kpis.financial.revenue).toBe(3000);
    expect(first.kpis.financial.netProfit).toBe(2500);
    expect(first.kpis.operational.averageRevenuePerClient).toBe(750);
  });

  test('empty org yields zeros, not randoms', async () => {
    armLedger({});
    const res = await financialAnalyticsService.getKPIs(ORG);
    expect(res.success).toBe(true);
    expect(res.kpis.financial.revenue).toBe(0);
    expect(res.kpis.financial.netMargin).toBe(0);
    expect(res.kpis.operational.utilizationRate).toBeNull();
  });
});

describe('cash position is real', () => {
  test('net position derives from ledger', async () => {
    jest.clearAllMocks();
    armLedger({
      paid: [{ amount: 5000 }],
      expenses: [{ amount: 2000 }],
      receivables: { total: 1500, count: 2 },
      payables: { total: 800, count: 1 },
    });
    const res = await cashFlowPredictionService.getCurrentPosition(ORG);
    expect(res.success).toBe(true);
    expect(res.position.cash).toBe(3000);
    expect(res.position.receivables).toBe(1500);
    expect(res.position.payables).toBe(800);
    expect(res.position.netPosition).toBe(3700);
  });
});

describe('forecast is deterministic', () => {
  test('same fixture twice => identical series', async () => {
    jest.clearAllMocks();
    armLedger({
      paid: [{ amount: 3000 }],
      expenses: [{ amount: 1000 }],
    });
    const a = await cashFlowPredictionService.forecastCashFlow(ORG, 7);
    const b = await cashFlowPredictionService.forecastCashFlow(ORG, 7);
    expect(a.success).toBe(true);
    const strip = (f) => ({ ...f, generatedAt: '', currentPosition: {} });
    expect(strip(b.forecast)).toEqual(strip(a.forecast));
    expect(a.forecast.dailyForecast).toHaveLength(7);
    expect(a.forecast.dailyForecast[0].confidence).toBeGreaterThan(
      a.forecast.dailyForecast[6].confidence,
    );
  });

  test('horizon is capped', async () => {
    jest.clearAllMocks();
    armLedger({});
    const res = await cashFlowPredictionService.forecastCashFlow(ORG, 9999);
    expect(res.forecast.horizon).toBe(365);
    expect(res.forecast.dailyForecast).toHaveLength(365);
  });
});

describe('alerts follow rules, not dice', () => {
  test('no overdue, healthy cash => no alerts', async () => {
    jest.clearAllMocks();
    armLedger({
      paid: [{ amount: 100000 }],
      expenses: [{ amount: 1000 }],
      receivables: { total: 0, count: 0 },
      payables: { total: 0, count: 0 },
    });
    const res = await cashFlowPredictionService.getAlerts(ORG);
    expect(res.success).toBe(true);
    expect(res.alerts).toEqual([]);
    expect(res.summary).toEqual({ total: 0, high: 0, medium: 0 });
  });
});

describe('scenarios scale from trailing base', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('bands are fixed multiples of the base', async () => {
    armLedger({ paid: [{ amount: 9000 }] });
    const res = await revenueForecastingService.generateScenarios(ORG, 90);
    expect(res.success).toBe(true);
    const s = res.scenarios;
    expect(s.mostLikely.totalRevenue).toBe(9000);
    expect(s.bestCase.totalRevenue).toBe(12150);
    expect(s.worstCase.totalRevenue).toBe(6750);
    expect(s.bestCase.probability).toBe(0.15);
  });
});

describe('dashboard composes real primitives', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    armLedger({
      paid: [{ amount: 4000 }, { amount: 1000 }],
      expenses: [{ amount: 1500 }],
    });
  });

  test('kpis/trends/costs derive from ledger, stable across calls', async () => {
    const a = await financialAnalyticsService.getDashboard(ORG, '30d');
    const b = await financialAnalyticsService.getDashboard(ORG, '30d');
    expect(a.success).toBe(true);
    expect(a.dashboard.kpis.revenue.value).toBe(5000);
    expect(a.dashboard.kpis.profit.value).toBe(3500);
    expect(a.dashboard.kpis.cashFlow.value).toBe(3500);
    expect(a.dashboard.trends).toHaveLength(12);
    const strip = (d) => ({ ...d, generatedAt: '' });
    expect(strip(b.dashboard)).toEqual(strip(a.dashboard));
  });
});
