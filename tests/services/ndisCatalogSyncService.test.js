/**
 * Milestone 7.2: the catalogue sync stamps `priceGuideVersion` on every
 * SupportItem it upserts instead of leaving every row at the 'current'
 * default. Version labels follow the NDIS fiscal year (1 July – 30 June).
 */
jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
  debug: jest.fn(),
  security: jest.fn(),
}));

// The unit test never touches the network or the database.
jest.mock('../../config/database', () => ({
  getDatabase: jest.fn(() => {
    throw new Error('database not available in unit tests');
  }),
}));

const service = require('../../services/ndisCatalogSyncService');

describe('derivePriceGuideVersion', () => {
  test('a July-starting row belongs to that fiscal year guide', () => {
    expect(service.derivePriceGuideVersion(new Date(Date.UTC(2025, 6, 1)))).toBe('2025-26');
    expect(service.derivePriceGuideVersion(new Date(Date.UTC(2026, 6, 1)))).toBe('2026-27');
  });

  test('a row starting before July belongs to the previous fiscal year guide', () => {
    expect(service.derivePriceGuideVersion(new Date(Date.UTC(2026, 5, 30)))).toBe('2025-26');
    expect(service.derivePriceGuideVersion(new Date(Date.UTC(2025, 2, 15)))).toBe('2024-25');
    expect(service.derivePriceGuideVersion(new Date(Date.UTC(2025, 0, 1)))).toBe('2024-25');
  });

  test('the legacy 9999-12-31 sentinel derives current', () => {
    expect(service.derivePriceGuideVersion(new Date('9999-12-31T00:00:00.000Z'))).toBe('current');
  });

  test('unparseable input derives current', () => {
    expect(service.derivePriceGuideVersion('not-a-date')).toBe('current');
    expect(service.derivePriceGuideVersion(null)).toBe('current');
  });
});

describe('_toSupportItemDocument — priceGuideVersion stamping', () => {
  const row = (startDate) => ({
    'Support Item Number': '01_011_0107_1_1',
    'Support Item Name': 'Daily living assistance',
    'Start date': startDate,
    National: '65.47',
  });

  test('stamps 2025-26 for a 2025-07-01 YYYYMMDD start', () => {
    const doc = service._toSupportItemDocument(row('20250701'), {});
    expect(doc.priceGuideVersion).toBe('2025-26');
    expect(doc.startDate).toEqual(new Date(Date.UTC(2025, 6, 1)));
  });

  test('stamps 2024-25 for a March 2025 start', () => {
    const doc = service._toSupportItemDocument(row('20250315'), {});
    expect(doc.priceGuideVersion).toBe('2024-25');
  });
});
