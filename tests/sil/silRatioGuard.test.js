/**
 * Milestone 6.2: SIL Ratio Breach Guard & Enforcement Modes Unit Tests
 */

jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
}));

jest.mock('../../services/silRosterNotificationService', () => ({
  notifyRosterPublished: jest.fn().mockResolvedValue(true),
}));

const mockRosterFindOne = jest.fn();
jest.mock('../../models/SILRoster', () => ({
  findOne: (...args) => mockRosterFindOne(...args),
}));

const mockOrgFindOne = jest.fn();
jest.mock('../../models/Organization', () => ({
  findOne: (...args) => mockOrgFindOne(...args),
}));

const silRosterService = require('../../services/silRosterService');

describe('Milestone 6.2: SIL Ratio Breach Guard & Enforcement Modes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('blocks publishing understaffed roster when organization setting blockOnRatioBreach is true', async () => {
    // Org lookup returns blockOnRatioBreach: true
    mockOrgFindOne.mockReturnValue({
      lean: () => Promise.resolve({
        _id: 'org123',
        settings: {
          sil: {
            blockOnRatioBreach: true,
          },
        },
      }),
    });

    const mockRosterDoc = {
      _id: 'roster1',
      organizationId: 'org123',
      status: 'draft',
      entries: [
        {
          date: new Date('2026-11-09T00:00:00Z'),
          shiftType: 'day',
          requiredStaff: 2,
          assignedStaff: 1,
          compliance: 'understaffed',
        },
      ],
      save: jest.fn().mockResolvedValue(true),
    };
    mockRosterFindOne.mockResolvedValue(mockRosterDoc);

    // Call publish with no explicit override (undefined)
    const result = await silRosterService.publishRoster('org123', 'roster1', {}, 'admin@carenest.test');

    expect(result.blocked).toBe(true);
    expect(result.understaffed).toBeDefined();
    expect(result.understaffed.length).toBe(1);
    expect(mockRosterDoc.save).not.toHaveBeenCalled();
    expect(mockRosterDoc.status).toBe('draft');
  });

  test('allows publishing understaffed roster when blockOnRatioBreach is explicitly overridden to false', async () => {
    mockOrgFindOne.mockReturnValue({
      lean: () => Promise.resolve({
        _id: 'org123',
        settings: {
          sil: {
            blockOnRatioBreach: true,
          },
        },
      }),
    });

    const mockRosterDoc = {
      _id: 'roster2',
      organizationId: 'org123',
      status: 'draft',
      entries: [
        {
          date: new Date('2026-11-16T00:00:00Z'),
          shiftType: 'day',
          requiredStaff: 2,
          assignedStaff: 1,
          compliance: 'understaffed',
        },
      ],
      save: jest.fn().mockResolvedValue(true),
    };
    mockRosterFindOne.mockResolvedValue(mockRosterDoc);

    const result = await silRosterService.publishRoster(
      'org123',
      'roster2',
      { blockOnRatioBreach: false },
      'admin@carenest.test',
    );

    expect(result.blocked).toBeUndefined();
    expect(result.roster.status).toBe('published');
    expect(mockRosterDoc.save).toHaveBeenCalled();
  });

  test('allows publishing fully compliant roster even when blockOnRatioBreach is true', async () => {
    mockOrgFindOne.mockReturnValue({
      lean: () => Promise.resolve({
        _id: 'org123',
        settings: {
          sil: {
            blockOnRatioBreach: true,
          },
        },
      }),
    });

    const mockRosterDoc = {
      _id: 'roster3',
      organizationId: 'org123',
      status: 'draft',
      entries: [
        {
          date: new Date('2026-11-23T00:00:00Z'),
          shiftType: 'day',
          requiredStaff: 1,
          assignedStaff: 1,
          compliance: 'ok',
        },
      ],
      save: jest.fn().mockResolvedValue(true),
    };
    mockRosterFindOne.mockResolvedValue(mockRosterDoc);

    const result = await silRosterService.publishRoster('org123', 'roster3', {}, 'admin@carenest.test');

    expect(result.blocked).toBeUndefined();
    expect(result.roster.status).toBe('published');
    expect(mockRosterDoc.save).toHaveBeenCalled();
  });
});
