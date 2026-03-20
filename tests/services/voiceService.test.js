const mockVoiceCommandCreate = jest.fn();
const mockClientFind = jest.fn();
const mockInvoiceAggregate = jest.fn();
const mockInvoiceFind = jest.fn();
const mockNotificationHistoryFind = jest.fn();
const mockNotificationHistoryCount = jest.fn();
const mockNotificationHistoryUpdateMany = jest.fn();
const mockOrganizationFindById = jest.fn();

jest.mock('../../models/VoiceCommand', () => ({
  create: mockVoiceCommandCreate,
  find: jest.fn(),
}));

jest.mock('../../models/Client', () => ({
  find: mockClientFind,
  countDocuments: jest.fn(),
}));

jest.mock('../../models/ClientAssignment', () => ({
  find: jest.fn(),
  countDocuments: jest.fn(),
}));

jest.mock('../../models/Invoice', () => ({
  Invoice: {
    aggregate: mockInvoiceAggregate,
    find: mockInvoiceFind,
  },
}));

jest.mock('../../models/NotificationHistory', () => ({
  find: mockNotificationHistoryFind,
  countDocuments: mockNotificationHistoryCount,
  updateMany: mockNotificationHistoryUpdateMany,
}));

jest.mock('../../models/Organization', () => ({
  findById: mockOrganizationFindById,
}));

const voiceService = require('../../services/voiceService');

describe('voiceService', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockVoiceCommandCreate.mockImplementation(async (payload) => ({
      _id: '507f1f77bcf86cd799439011',
      createdAt: new Date('2026-03-20T10:00:00.000Z'),
      ...payload,
      toObject() {
        return {
          _id: this._id,
          createdAt: this.createdAt,
          ...payload,
        };
      },
    }));

    mockInvoiceAggregate.mockResolvedValue([]);
    mockInvoiceFind.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
    mockNotificationHistoryFind.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
    mockNotificationHistoryCount.mockResolvedValue(0);
    mockNotificationHistoryUpdateMany.mockResolvedValue({ modifiedCount: 0 });
    mockOrganizationFindById.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(null),
      catch: jest.fn(),
    });
  });

  it('returns help capabilities for help commands', async () => {
    const result = await voiceService.processText(
      { id: '507f1f77bcf86cd799439012', organizationId: 'org-1' },
      'what can you do?'
    );

    expect(result.detectedIntent).toBe('capabilities_help');
    expect(result.executed).toBe(true);
    expect(result.resultData.capabilities).toContain('Show dashboard summary');
  });

  it('returns client lookup results for matching client commands', async () => {
    const lean = jest.fn().mockResolvedValue([
      {
        _id: '507f1f77bcf86cd799439013',
        clientFirstName: 'John',
        clientLastName: 'Citizen',
        clientEmail: 'john@example.com',
        clientPhone: '+61123456789',
        clientCity: 'Sydney',
        isActivated: true,
      },
    ]);

    mockClientFind.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean,
    });

    const result = await voiceService.processText(
      { id: '507f1f77bcf86cd799439012', organizationId: 'org-1' },
      'find client John'
    );

    expect(result.detectedIntent).toBe('client_lookup');
    expect(result.executed).toBe(true);
    expect(result.suggestedRoute).toBe('client_list');
    expect(result.resultData.clients[0].name).toBe('John Citizen');
  });

  it('marks unread notifications as read', async () => {
    mockNotificationHistoryUpdateMany.mockResolvedValue({ modifiedCount: 3 });

    const result = await voiceService.processText(
      { id: '507f1f77bcf86cd799439012' },
      'mark all notifications as read'
    );

    expect(result.detectedIntent).toBe('mark_notifications_read');
    expect(result.executed).toBe(true);
    expect(result.resultData.markedCount).toBe(3);
  });
});
