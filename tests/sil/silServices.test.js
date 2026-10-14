/**
 * Tests for Phase 4 SIL services. Models and price validation are mocked; the
 * service logic is exercised directly.
 */

jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
}));

jest.mock('../../models/SILProperty', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));
jest.mock('../../models/SILOccupancy', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../../models/SILRatioRule', () => ({
  find: jest.fn(),
  create: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));
jest.mock('../../models/SILRoster', () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));
jest.mock('../../models/SILQuote', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../../models/SILRosterOfCare', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../../models/Shift', () => ({ find: jest.fn() }));
jest.mock('../../models/Organization', () => ({ findOne: jest.fn() }));
jest.mock('../../models/Client', () => ({ updateOne: jest.fn() }));
jest.mock('../../services/priceValidationService', () => ({
  priceValidationService: { validatePrice: jest.fn() },
}));

const SILProperty = require('../../models/SILProperty');
const SILOccupancy = require('../../models/SILOccupancy');
const SILRatioRule = require('../../models/SILRatioRule');
const SILQuote = require('../../models/SILQuote');
const SILRosterOfCare = require('../../models/SILRosterOfCare');
const SILRoster = require('../../models/SILRoster');
const Shift = require('../../models/Shift');
const Client = require('../../models/Client');
const { priceValidationService } = require('../../services/priceValidationService');

const silPropertyService = require('../../services/silPropertyService');
const silOccupancyService = require('../../services/silOccupancyService');
const silRatioService = require('../../services/silRatioService');
const silRosterService = require('../../services/silRosterService');
const silQuoteService = require('../../services/silQuoteService');
const silController = require('../../controllers/silController');

describe('SILPropertyService.getVacancies', () => {
  test('computes vacant rooms from active occupancy', async () => {
    SILProperty.findOne.mockResolvedValue({
      _id: 'p1',
      name: 'Richmond House',
      rooms: [
        { roomId: 'r1', label: 'Room 1' },
        { roomId: 'r2', label: 'Room 2' },
      ],
    });
    SILOccupancy.find.mockResolvedValue([{ roomId: 'r1', clientId: 'c1' }]);

    const board = await silPropertyService.getVacancies('org1', 'p1');

    expect(board.totalRooms).toBe(2);
    expect(board.occupiedCount).toBe(1);
    expect(board.vacantCount).toBe(1);
    expect(board.rooms.find((r) => r.roomId === 'r2').occupied).toBe(false);
  });
});

describe('SILOccupancyService.createOccupancy', () => {
  test('rejects when the room already has an active occupancy', async () => {
    SILProperty.findOne.mockResolvedValue({
      _id: 'p1',
      rooms: [{ roomId: 'r1' }],
    });
    SILOccupancy.findOne.mockResolvedValue({ _id: 'existing' });

    await expect(
      silOccupancyService.createOccupancy('org1', {
        propertyId: 'p1',
        roomId: 'r1',
        clientId: 'c1',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  test('creates an occupancy when the room is free', async () => {
    SILProperty.findOne.mockResolvedValue({ _id: 'p1', rooms: [{ roomId: 'r1' }] });
    SILOccupancy.findOne.mockResolvedValue(null);
    SILOccupancy.create.mockImplementation(async (doc) => ({ _id: 'o1', ...doc }));

    const occupancy = await silOccupancyService.createOccupancy('org1', {
      propertyId: 'p1',
      roomId: 'r1',
      clientId: 'c1',
    });

    expect(occupancy.status).toBe('active');
    expect(occupancy.fundingType).toBe('plan_managed');
  });

  test('rejects an unknown room', async () => {
    SILProperty.findOne.mockResolvedValue({ _id: 'p1', rooms: [{ roomId: 'r1' }] });
    await expect(
      silOccupancyService.createOccupancy('org1', {
        propertyId: 'p1',
        roomId: 'nope',
        clientId: 'c1',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('SILRatioService.requiredStaff', () => {
  test('falls back to 1:1 when no rule matches', async () => {
    SILRatioRule.find.mockResolvedValue([]);
    SILProperty.findOne.mockResolvedValue({ silDesignCategory: 'basic' });

    const result = await silRatioService.requiredStaff('org1', {
      propertyId: 'p1',
      shiftType: 'day',
      participants: 2,
    });

    expect(result.requiredStaff).toBe(2);
    expect(result.ruleId).toBeNull();
  });

  test('applies a 1:2 ratio rule', async () => {
    SILRatioRule.find.mockResolvedValue([
      {
        _id: 'rule1',
        ratio: { staff: 1, participants: 2 },
        appliesTo: { propertyIds: [], silDesignCategories: [] },
        minParticipants: 1,
        maxParticipants: 0,
      },
    ]);
    SILProperty.findOne.mockResolvedValue({ silDesignCategory: 'basic' });

    const result = await silRatioService.requiredStaff('org1', {
      propertyId: 'p1',
      shiftType: 'day',
      participants: 3,
    });

    // ceil(3/2) * 1 = 2
    expect(result.requiredStaff).toBe(2);
    expect(result.ruleId).toBe('rule1');
  });

  test('2:1 active night requires two staff', async () => {
    SILRatioRule.find.mockResolvedValue([
      {
        _id: 'rule2',
        ratio: { staff: 2, participants: 1 },
        appliesTo: { propertyIds: [], silDesignCategories: [] },
        minParticipants: 1,
        maxParticipants: 0,
      },
    ]);
    SILProperty.findOne.mockResolvedValue({ silDesignCategory: 'robust' });

    const result = await silRatioService.requiredStaff('org1', {
      propertyId: 'p1',
      shiftType: 'active_night',
      participants: 1,
    });

    expect(result.requiredStaff).toBe(2);
  });
});

describe('SILRosterService.startOfWeek', () => {
  test('returns Monday 00:00 UTC', () => {
    // 2026-06-03 is a Wednesday.
    const monday = silRosterService.constructor.startOfWeek(new Date('2026-06-03T15:00:00Z'));
    expect(monday.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  test('a Monday maps to itself', () => {
    const monday = silRosterService.constructor.startOfWeek(new Date('2026-06-01T09:00:00Z'));
    expect(monday.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });
});

describe('SILQuoteService', () => {
  beforeEach(() => {
    priceValidationService.validatePrice.mockResolvedValue({
      isValid: true,
      status: 'within_cap',
      priceCap: 100,
    });
  });

  test('buildQuote prices lines, computes totals and passes validation', async () => {
    SILQuote.create.mockImplementation(async (doc) => ({ _id: 'q1', ...doc }));

    const quote = await silQuoteService.buildQuote('org1', {
      clientId: 'c1',
      lines: [
        { supportNumber: '01_011_0107_1_1', hoursPerWeek: 10, unitPrice: 80 },
        { supportNumber: '01_015_0107_1_1', hoursPerWeek: 5, unitPrice: 60 },
      ],
    });

    expect(quote.lines[0].amount).toBe(800);
    expect(quote.lines[1].amount).toBe(300);
    expect(quote.totals.weeklyHours).toBe(15);
    expect(quote.totals.weeklyAmount).toBe(1100);
    expect(quote.totals.annualAmount).toBe(57200);
    expect(quote.lines[0].priceValidation.passed).toBe(true);
  });

  test('flags a line that fails price validation', async () => {
    priceValidationService.validatePrice.mockResolvedValue({
      isValid: false,
      status: 'over_cap',
      priceCap: 50,
      message: 'Price exceeds cap',
    });
    SILQuote.create.mockImplementation(async (doc) => ({ _id: 'q2', ...doc }));

    const quote = await silQuoteService.buildQuote('org1', {
      clientId: 'c1',
      lines: [{ supportNumber: 'x', hoursPerWeek: 1, unitPrice: 999 }],
    });

    expect(quote.lines[0].priceValidation.passed).toBe(false);
    expect(quote.lines[0].priceValidation.errors.length).toBeGreaterThan(0);
  });

  test('acceptQuote blocks when a line failed validation', async () => {
    SILQuote.findOne.mockResolvedValue({
      _id: 'q1',
      status: 'sent',
      lines: [{ priceValidation: { passed: false } }],
      save: jest.fn(),
    });

    const result = await silQuoteService.acceptQuote('org1', 'q1');
    expect(result.blocked).toBe(true);
  });

  test('acceptQuote succeeds and sets approved metadata', async () => {
    const save = jest.fn();
    SILQuote.findOne.mockResolvedValue({
      _id: 'q1',
      status: 'sent',
      lines: [{ priceValidation: { passed: true } }],
      save,
    });

    const result = await silQuoteService.acceptQuote('org1', 'q1', 'admin@org.com');
    expect(result.quote.status).toBe('accepted');
    expect(result.quote.approvedBy).toBe('admin@org.com');
    expect(save).toHaveBeenCalled();
  });

  test('convertToRosterOfCare creates an active RoC from an accepted quote', async () => {
    const quoteSave = jest.fn();
    SILQuote.findOne.mockResolvedValue({
      _id: 'q1',
      status: 'accepted',
      clientId: 'c1',
      propertyId: 'p1',
      lines: [
        {
          supportNumber: 'x',
          supportName: 'SIL',
          shiftType: 'day',
          hoursPerWeek: 10,
          unitPrice: 80,
          gstCode: 'P2',
          amount: 800,
        },
      ],
      save: quoteSave,
    });
    SILRosterOfCare.create.mockImplementation(async (doc) => ({ _id: 'roc1', ...doc }));

    const result = await silQuoteService.convertToRosterOfCare('org1', 'q1', {}, 'admin@org.com');

    expect(result.rosterOfCare.status).toBe('active');
    expect(result.rosterOfCare.supports).toHaveLength(1);
    expect(result.quote.status).toBe('converted');
    expect(quoteSave).toHaveBeenCalled();
  });

  test('convertToRosterOfCare rejects a non-accepted quote', async () => {
    SILQuote.findOne.mockResolvedValue({ _id: 'q1', status: 'draft' });
    const result = await silQuoteService.convertToRosterOfCare('org1', 'q1');
    expect(result.invalidState).toBe(true);
  });

  test('convertToRosterOfCare propagates the quote funding type to the client', async () => {
    SILQuote.findOne.mockResolvedValue({
      _id: 'q1',
      status: 'accepted',
      clientId: 'c1',
      propertyId: 'p1',
      fundingType: 'ndia_managed',
      lines: [],
      save: jest.fn(),
    });
    SILRosterOfCare.findOne.mockResolvedValue(null);
    SILRosterOfCare.create.mockImplementation(async (doc) => ({ _id: 'roc1', ...doc }));

    const result = await silQuoteService.convertToRosterOfCare('org1', 'q1', {}, 'admin@org.com');

    expect(result.rosterOfCare.status).toBe('active');
    expect(Client.updateOne).toHaveBeenCalledWith(
      { _id: 'c1', organizationId: 'org1' },
      { $set: { fundingType: 'ndia_managed' } },
    );
  });
});

describe('SILRosterService.buildRoster', () => {
  test('builds entries with ratio compliance from shifts', async () => {
    SILProperty.findOne.mockResolvedValue({
      _id: 'p1',
      name: 'House',
      silDesignCategory: 'basic',
    });
    SILOccupancy.find.mockResolvedValue([{ clientId: 'c1' }]);
    Shift.find.mockReturnValue({
      sort: () => Promise.resolve([
        {
          _id: 's1',
          clientId: 'c1',
          employeeId: null,
          startTime: new Date('2026-06-01T09:00:00Z'),
          endTime: new Date('2026-06-01T17:00:00Z'),
        },
      ]),
    });
    SILRatioRule.find.mockResolvedValue([]); // default 1:1
    SILRoster.findOneAndUpdate.mockImplementation(async (filter, update) => ({
      _id: 'r1',
      ...update,
    }));

    const roster = await silRosterService.buildRoster('org1', {
      propertyId: 'p1',
      weekStarting: '2026-06-01',
    });

    expect(roster.entries).toHaveLength(1);
    expect(roster.entries[0].requiredStaff).toBe(1);
    expect(roster.entries[0].assignedStaff).toBe(0);
    expect(roster.entries[0].compliance).toBe('understaffed');
    expect(roster.ratioWarnings.length).toBe(1);
  });

  test('throws 404 when the property does not exist', async () => {
    SILProperty.findOne.mockResolvedValue(null);
    await expect(
      silRosterService.buildRoster('org1', { propertyId: 'nope', weekStarting: '2026-06-01' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('SILController org scoping', () => {
  function mockRes() {
    const res = {};
    res.statusCode = 200;
    res.body = null;
    res.status = jest.fn((c) => {
      res.statusCode = c;
      return res;
    });
    res.json = jest.fn((p) => {
      res.body = p;
      return res;
    });
    return res;
  }

  test('listProperties returns 400 without an organization', async () => {
    const req = { user: {}, query: {} };
    const res = mockRes();
    await silController.listProperties(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('MISSING_ORGANIZATION');
  });
});

describe('SIL findings — §8 validation rules', () => {
  const Organization = require('../../models/Organization');

  test('F4.1 rejects an occupancy overlapping an existing (pending) row', async () => {
    SILProperty.findOne.mockResolvedValue({ _id: 'p1', rooms: [{ roomId: 'r1' }] });
    SILOccupancy.findOne.mockResolvedValue({ _id: 'overlap' });

    await expect(
      silOccupancyService.createOccupancy('org1', {
        propertyId: 'p1',
        roomId: 'r1',
        clientId: 'c1',
        startDate: '2026-06-01',
        endDate: '2026-06-30',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    // The overlap query must consider active AND pending rows.
    const [query] = SILOccupancy.findOne.mock.calls[0];
    expect(query.status).toEqual({ $in: ['active', 'pending'] });
  });

  test('F4.2 rejects converting a quote when the client has an active RoC', async () => {
    SILQuote.findOne.mockResolvedValue({
      _id: 'q1',
      status: 'accepted',
      clientId: 'c1',
      propertyId: 'p1',
      lines: [],
    });
    SILRosterOfCare.findOne.mockResolvedValue({ _id: 'roc-existing' });

    const result = await silQuoteService.convertToRosterOfCare('org1', 'q1');
    expect(result.conflict).toBe(true);
    expect(result.existing._id).toBe('roc-existing');
  });

  test('F4.3 publish reads the org blockOnRatioBreach setting', async () => {
    SILRoster.findOne.mockResolvedValue({
      _id: 'r1',
      entries: [{ compliance: 'understaffed' }],
      ratioWarnings: [],
      save: jest.fn(),
    });
    Organization.findOne.mockReturnValue({
      lean: async () => ({ settings: { sil: { blockOnRatioBreach: true } } }),
    });

    const result = await silRosterService.publishRoster('org1', 'r1', {});
    expect(result.blocked).toBe(true);
  });

  test('F4.3 request flag overrides the org setting', async () => {
    SILRoster.findOne.mockResolvedValue({
      _id: 'r1',
      entries: [{ compliance: 'understaffed' }],
      ratioWarnings: [],
      save: jest.fn(),
    });
    Organization.findOne.mockReturnValue({
      lean: async () => ({ settings: { sil: { blockOnRatioBreach: true } } }),
    });

    const result = await silRosterService.publishRoster('org1', 'r1', {
      blockOnRatioBreach: false,
    });
    expect(result.blocked).toBeUndefined();
    expect(result.roster.status).toBe('published');
  });
});
