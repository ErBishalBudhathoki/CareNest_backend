// Milestone 3.2: Multi-participant activity transport in SIL tests
// Tests even splitting of travel distances across co-transported participants
// and generation of split activity transport line items (NDIS Item 01_799_0107_1_1).

jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
}));

const mockTripFindOne = jest.fn();
jest.mock('../../models/Trip', () => ({
  findOne: (...args) => mockTripFindOne(...args),
}));

const providerTravelService = require('../../services/providerTravelService');

describe('ProviderTravelService - Multi-Participant Activity Transport (Milestone 3.2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('splitMileageAmongParticipants', () => {
    test('evenly splits 30km among 3 participants (10km each)', () => {
      const splits = providerTravelService.splitMileageAmongParticipants({
        totalKm: 30,
        clientIds: ['c1', 'c2', 'c3'],
      });

      expect(splits).toHaveLength(3);
      expect(splits[0]).toEqual({
        clientId: 'c1',
        km: 10,
        share: 0.33,
        totalTripKm: 30,
      });
      expect(splits[1]).toEqual({
        clientId: 'c2',
        km: 10,
        share: 0.33,
        totalTripKm: 30,
      });
      expect(splits[2]).toEqual({
        clientId: 'c3',
        km: 10,
        share: 0.33,
        totalTripKm: 30,
      });
    });

    test('evenly splits 25km between 2 participants (12.5km each)', () => {
      const splits = providerTravelService.splitMileageAmongParticipants({
        totalKm: 25,
        clientIds: ['c1', 'c2'],
      });

      expect(splits).toHaveLength(2);
      expect(splits[0].km).toBe(12.5);
      expect(splits[0].share).toBe(0.5);
      expect(splits[1].km).toBe(12.5);
      expect(splits[1].share).toBe(0.5);
    });

    test('handles single participant with 100% share', () => {
      const splits = providerTravelService.splitMileageAmongParticipants({
        totalKm: 18.4,
        clientIds: ['c1'],
      });

      expect(splits).toHaveLength(1);
      expect(splits[0]).toEqual({
        clientId: 'c1',
        km: 18.4,
        share: 1.0,
        totalTripKm: 18.4,
      });
    });

    test('handles empty or missing clientIds by returning single null client entry', () => {
      const splits = providerTravelService.splitMileageAmongParticipants({
        totalKm: 15,
        clientIds: [],
      });

      expect(splits).toHaveLength(1);
      expect(splits[0].clientId).toBeNull();
      expect(splits[0].km).toBe(15);
      expect(splits[0].share).toBe(1.0);
    });
  });

  describe('createActivityTransportCharges', () => {
    test('creates split charges from explicit input list', async () => {
      const charges = await providerTravelService.createActivityTransportCharges(
        'org1',
        {
          totalKm: 45,
          clientIds: ['clientA', 'clientB', 'clientC'],
          supportItemNumber: '01_799_0107_1_1',
          supportItemName: 'Activity Based Transport',
          date: '2026-06-15T00:00:00.000Z',
        },
        'system',
      );

      expect(charges).toHaveLength(3);
      expect(charges[0]).toMatchObject({
        organizationId: 'org1',
        clientId: 'clientA',
        km: 15,
        supportItemNumber: '01_799_0107_1_1',
        supportItemName: 'Activity Based Transport',
        share: 0.33,
        totalTripKm: 45,
      });
      expect(charges[1].clientId).toBe('clientB');
      expect(charges[1].km).toBe(15);
      expect(charges[2].clientId).toBe('clientC');
      expect(charges[2].km).toBe(15);
    });

    test('creates split charges from persisted Trip record', async () => {
      mockTripFindOne.mockResolvedValue({
        _id: 'trip123',
        organizationId: 'org1',
        distance: 24,
        clientIds: ['c1', 'c2'],
      });

      const charges = await providerTravelService.createActivityTransportCharges(
        'org1',
        { tripId: 'trip123' },
        'system',
      );

      expect(mockTripFindOne).toHaveBeenCalledWith({
        _id: 'trip123',
        organizationId: 'org1',
      });
      expect(charges).toHaveLength(2);
      expect(charges[0].km).toBe(12);
      expect(charges[0].clientId).toBe('c1');
      expect(charges[1].km).toBe(12);
      expect(charges[1].clientId).toBe('c2');
    });

    test('throws 404 when referenced trip is not found', async () => {
      mockTripFindOne.mockResolvedValue(null);

      await expect(
        providerTravelService.createActivityTransportCharges('org1', { tripId: 'missing' }),
      ).rejects.toMatchObject({
        statusCode: 404,
        message: 'Trip not found.',
      });
    });

    test('throws 400 when no participants are specified', async () => {
      await expect(
        providerTravelService.createActivityTransportCharges('org1', { totalKm: 20 }),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'At least one participant must be specified for activity transport.',
      });
    });
  });
});

