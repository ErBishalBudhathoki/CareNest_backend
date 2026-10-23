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
jest.mock('../../models/Shift', () => ({ find: jest.fn(), findOne: jest.fn(), create: jest.fn() }));
jest.mock('../../models/Organization', () => ({ findOne: jest.fn() }));
jest.mock('../../models/Client', () => ({ updateOne: jest.fn(), findOne: jest.fn() }));
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

/** Default tenant lookups: the client/property exist in the caller's org. */
const orgExists = (value = { _id: 'c1' }) => ({
  select: () => ({ lean: async () => value }),
});

beforeEach(() => {
  // `buildQuote` and `createOccupancy` now verify the referenced participant
  // belongs to the organisation before writing.
  Client.findOne.mockReturnValue(orgExists());
  SILProperty.findOne.mockReturnValue(orgExists({ _id: 'p1' }));
});

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

  test('rejects a participant from another organisation', async () => {
    SILProperty.findOne.mockResolvedValue({ _id: 'p1', rooms: [{ roomId: 'r1' }] });
    Client.findOne.mockReturnValue(orgExists(null));

    await expect(
      silOccupancyService.createOccupancy('org1', {
        propertyId: 'p1',
        roomId: 'r1',
        clientId: 'foreign-client',
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'CROSS_ORG_CLIENT' });
    expect(SILOccupancy.create).not.toHaveBeenCalled();
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

  test('rejects a participant from another organisation', async () => {
    Client.findOne.mockReturnValue(orgExists(null));

    await expect(
      silQuoteService.buildQuote('org1', {
        clientId: 'foreign-client',
        lines: [{ supportNumber: 'x', hoursPerWeek: 1, unitPrice: 80 }],
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'CROSS_ORG_CLIENT' });
    expect(SILQuote.create).not.toHaveBeenCalled();
  });

  test('rejects a property from another organisation', async () => {
    SILProperty.findOne.mockReturnValue(orgExists(null));

    await expect(
      silQuoteService.buildQuote('org1', {
        clientId: 'c1',
        propertyId: 'foreign-property',
        lines: [{ supportNumber: 'x', hoursPerWeek: 1, unitPrice: 80 }],
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'CROSS_ORG_PROPERTY' });
    expect(SILQuote.create).not.toHaveBeenCalled();
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

  test('rejects an over-cap NDIA-managed quote at save time', async () => {
    priceValidationService.validatePrice.mockResolvedValue({
      isValid: false,
      status: 'over_cap',
      priceCap: 50,
      message: 'Price exceeds cap',
    });

    await expect(
      silQuoteService.buildQuote('org1', {
        clientId: 'c1',
        fundingType: 'ndia_managed',
        lines: [{ supportNumber: 'x', hoursPerWeek: 1, unitPrice: 999 }],
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PRICE_CAP_EXCEEDED',
    });
    expect(SILQuote.create).not.toHaveBeenCalled();
  });

  test('allows a within-cap NDIA-managed quote', async () => {
    SILQuote.create.mockImplementation(async (doc) => ({ _id: 'q3', ...doc }));

    const quote = await silQuoteService.buildQuote('org1', {
      clientId: 'c1',
      fundingType: 'ndia_managed',
      lines: [{ supportNumber: 'x', hoursPerWeek: 1, unitPrice: 80 }],
    });

    expect(quote.lines[0].priceValidation.passed).toBe(true);
  });

  test('fails closed when the NDIS price catalog is unavailable', async () => {
    priceValidationService.validatePrice.mockRejectedValue(
      new Error('catalog offline'),
    );

    await expect(
      silQuoteService.buildQuote('org1', {
        clientId: 'c1',
        lines: [{ supportNumber: 'x', hoursPerWeek: 1, unitPrice: 80 }],
      }),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: 'PRICE_CATALOG_UNAVAILABLE',
    });
    expect(SILQuote.create).not.toHaveBeenCalled();
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

  test('ratio warnings name shifts by the roster-timezone date, not UTC', async () => {
    // A Sydney Monday 09:00 shift is stored as Sunday 22:00Z (AEDT, UTC+11);
    // the warning must read the local date 2026-10-19, not the UTC-day
    // 2026-10-18 that a raw toISOString() would produce.
    SILProperty.findOne.mockResolvedValue({
      _id: 'p1',
      name: 'House',
      silDesignCategory: 'basic',
    });
    SILOccupancy.find.mockResolvedValue([{ clientId: 'c1' }]);
    Shift.find.mockReturnValue({
      sort: () => Promise.resolve([
        {
          _id: 's2',
          clientId: 'c1',
          employeeId: null,
          startTime: new Date('2026-10-18T22:00:00Z'),
          endTime: new Date('2026-10-19T00:00:00Z'),
        },
      ]),
    });
    SILRatioRule.find.mockResolvedValue([]); // default 1:1
    SILRoster.findOneAndUpdate.mockImplementation(async (filter, update) => ({
      _id: 'r2',
      ...update,
    }));

    const roster = await silRosterService.buildRoster('org1', {
      propertyId: 'p1',
      weekStarting: '2026-10-19',
    });

    expect(roster.ratioWarnings[0].message).toContain('on 2026-10-19');
    expect(roster.ratioWarnings[0].message).not.toContain('2026-10-18');
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

describe('SILRosterService.materializeRocShifts', () => {
  const rocWithPattern = {
    _id: 'roc1',
    status: 'active',
    clientId: 'c1',
    supports: [
      { supportNumber: '01_002_0107_1_1', supportName: 'Night', shiftType: 'active_night', hoursPerWeek: 21, days: ['Mon', 'Tue'], startTime: '22:00', endTime: '06:00' },
      { supportNumber: '01_016_0104_1_1', supportName: 'Day', shiftType: 'day', hoursPerWeek: 10, days: ['Wed'], startTime: '09:00', endTime: '15:00' },
    ],
  };

  test('creates one shift per agreed day and is idempotent', async () => {
    SILRosterOfCare.findOne.mockResolvedValue(rocWithPattern);
    Client.findOne.mockReturnValue({ lean: async () => ({ _id: 'c1', clientEmail: 'c@x.com' }) });
    // First run: no existing shifts.
    Shift.findOne.mockResolvedValue(null);
    const createdDocs = [];
    Shift.create.mockImplementation(async (doc) => {
      const d = { _id: `s${createdDocs.length + 1}`, ...doc };
      createdDocs.push(d);
      return d;
    });

    const result = await silRosterService.materializeRocShifts('org1', 'roc1', {
      weekStarting: '2026-10-12', // a Monday
    });

    // 2 (Mon,Tue night) + 1 (Wed day) = 3 shifts.
    expect(result.created).toHaveLength(3);
    expect(result.skipped).toHaveLength(0);
    // Night shift crosses midnight → end > start.
    const night = createdDocs.find((d) => d.shiftType === 'active_night');
    expect(new Date(night.endTime) > new Date(night.startTime)).toBe(true);
    // All carry the RoC link.
    expect(createdDocs.every((d) => String(d.silRosterOfCareId) === 'roc1')).toBe(true);
  });

  test('skips shifts that already exist (idempotent re-plan)', async () => {
    SILRosterOfCare.findOne.mockResolvedValue(rocWithPattern);
    Client.findOne.mockReturnValue({ lean: async () => ({ _id: 'c1', clientEmail: 'c@x.com' }) });
    Shift.findOne.mockResolvedValue({ _id: 'existing' });
    Shift.create.mockClear();

    const result = await silRosterService.materializeRocShifts('org1', 'roc1', { weekStarting: '2026-10-12' });
    expect(result.created).toHaveLength(0);
    expect(result.skipped).toHaveLength(3);
    expect(Shift.create).not.toHaveBeenCalled();
  });

  test('returns noPattern when supports have no days/times', async () => {
    SILRosterOfCare.findOne.mockResolvedValue({
      _id: 'roc2', status: 'active', clientId: 'c1',
      supports: [{ supportNumber: 'x', hoursPerWeek: 5 }],
    });
    Client.findOne.mockReturnValue({ lean: async () => ({ _id: 'c1' }) });
    const result = await silRosterService.materializeRocShifts('org1', 'roc2', {});
    expect(result.noPattern).toBe(true);
  });

  test('rejects a non-active roster of care', async () => {
    SILRosterOfCare.findOne.mockResolvedValue({ _id: 'roc3', status: 'draft', supports: [] });
    const result = await silRosterService.materializeRocShifts('org1', 'roc3', {});
    expect(result.invalidState).toBe(true);
  });
});

describe('SILRosterService.buildRoster — org-local week window', () => {
  test('queries shifts against the Sydney Monday, not UTC midnight', async () => {
    SILProperty.findOne.mockResolvedValue({ _id: 'p1', name: 'House', silDesignCategory: 'basic' });
    SILOccupancy.find.mockResolvedValue([{ clientId: 'c1' }]);
    Shift.find.mockReturnValue({ sort: () => Promise.resolve([]) });
    SILRoster.findOneAndUpdate.mockImplementation(async (filter, update) => ({ _id: 'r1', ...update }));

    await silRosterService.buildRoster('org1', { propertyId: 'p1', weekStarting: '2026-06-01' });

    const [query] = Shift.find.mock.calls[0];
    // 2026-06-01 is a Monday; Sydney (AEST, +10) Monday 00:00 = 2026-05-31T14:00Z.
    // A UTC-midnight window would have started 2026-06-01T00:00Z and missed
    // early-Monday Sydney shifts.
    expect(query.startTime.$gte.toISOString()).toBe('2026-05-31T14:00:00.000Z');
    expect(query.startTime.$lt.toISOString()).toBe('2026-06-07T14:00:00.000Z');
  });
});

describe('SILController organisation resolution', () => {
  test('prefers the request organisation context (multi-org header)', () => {
    const req = {
      organizationContext: { organizationId: 'org-header' },
      user: { organizationId: 'org-primary' },
    };
    expect(silController._org(req)).toBe('org-header');
  });

  test('falls back to the user organisation when no context is set', () => {
    expect(silController._org({ user: { organizationId: 'org-primary' } })).toBe(
      'org-primary',
    );
  });
});
