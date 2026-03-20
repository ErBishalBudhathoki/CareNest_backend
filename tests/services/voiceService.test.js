const mockVoiceCommandCreate = jest.fn();
const mockVoiceCommandFind = jest.fn();
const mockClientFind = jest.fn();
const mockClientCountDocuments = jest.fn();
const mockUserFind = jest.fn();
const mockSupportItemFind = jest.fn();
const mockInvoiceAggregate = jest.fn();
const mockInvoiceFind = jest.fn();
const mockNotificationHistoryFind = jest.fn();
const mockNotificationHistoryCount = jest.fn();
const mockNotificationHistoryUpdateMany = jest.fn();
const mockOrganizationFindById = jest.fn();
const mockAssignClientToUser = jest.fn();
const mockAssignmentVoiceAgentProcessCommand = jest.fn();

jest.mock('../../models/VoiceCommand', () => ({
  create: mockVoiceCommandCreate,
  find: mockVoiceCommandFind,
}));

jest.mock('../../models/Client', () => ({
  find: mockClientFind,
  countDocuments: mockClientCountDocuments,
}));

jest.mock('../../models/User', () => ({
  find: mockUserFind,
}));

jest.mock('../../models/SupportItem', () => ({
  find: mockSupportItemFind,
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

jest.mock('../../services/clientService', () => ({
  assignClientToUser: mockAssignClientToUser,
}));

jest.mock('../../services/assignmentVoiceAgentService', () => ({
  processCommand: mockAssignmentVoiceAgentProcessCommand,
}));

const voiceService = require('../../services/voiceService');

function buildQuery(result) {
  return {
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
  };
}

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

    mockVoiceCommandFind.mockReturnValue(buildQuery([]));
    mockAssignmentVoiceAgentProcessCommand.mockResolvedValue(null);
    mockClientCountDocuments.mockResolvedValue(0);
    mockInvoiceAggregate.mockResolvedValue([]);
    mockInvoiceFind.mockReturnValue(buildQuery([]));
    mockNotificationHistoryFind.mockReturnValue(buildQuery([]));
    mockNotificationHistoryCount.mockResolvedValue(0);
    mockNotificationHistoryUpdateMany.mockResolvedValue({ modifiedCount: 0 });
    mockOrganizationFindById.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(null),
      catch: jest.fn(),
    });
    mockAssignClientToUser.mockResolvedValue({
      success: true,
      message: 'Assignment created successfully',
      assignmentId: '507f1f77bcf86cd799439099',
    });
  });

  it('returns help capabilities for help commands', async () => {
    const result = await voiceService.processText(
      { id: '507f1f77bcf86cd799439012', organizationId: 'org-1' },
      'what can you do?'
    );

    expect(result.detectedIntent).toBe('capabilities_help');
    expect(result.executed).toBe(true);
    expect(result.resultData.capabilities).toContain(
      'Assign an employee to a client and collect missing schedule or NDIS details'
    );
  });

  it('returns client lookup results for matching client commands', async () => {
    mockClientFind.mockReturnValueOnce(
      buildQuery([
        {
          _id: '507f1f77bcf86cd799439013',
          clientFirstName: 'John',
          clientLastName: 'Citizen',
          clientEmail: 'john@example.com',
          clientPhone: '+61123456789',
          clientCity: 'Sydney',
          isActivated: true,
        },
      ])
    );

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

  it('resolves assignment names and asks for missing schedule details', async () => {
    mockUserFind
      .mockReturnValueOnce(
        buildQuery([
          {
            _id: '507f1f77bcf86cd799439020',
            firstName: 'Pratiksha',
            lastName: 'Sharma',
            email: 'pratiksha@example.com',
            role: 'user',
            roles: ['user'],
          },
        ])
      )
      .mockReturnValueOnce(buildQuery([]));

    mockClientFind
      .mockReturnValueOnce(buildQuery([]))
      .mockReturnValueOnce(
        buildQuery([
          {
            _id: '507f1f77bcf86cd799439021',
            clientFirstName: 'Harry',
            clientLastName: 'Stone',
            clientEmail: 'harry@example.com',
          },
        ])
      );

    const result = await voiceService.processText(
      { id: '507f1f77bcf86cd799439012', organizationId: 'org-1' },
      'assign Pratiksha to Harry'
    );

    expect(result.detectedIntent).toBe('assignment_manage');
    expect(result.executed).toBe(false);
    expect(result.actionType).toBe('navigate');
    expect(result.suggestedRoute).toBe('assignment_schedule');
    expect(result.resultData.assignmentDraft.employee.email).toBe(
      'pratiksha@example.com'
    );
    expect(result.resultData.assignmentDraft.client.email).toBe(
      'harry@example.com'
    );
    expect(result.resultData.missingFields).toEqual(
      expect.arrayContaining(['date', 'timeRange', 'ndisItem'])
    );
  });

  it('creates an assignment when command includes names, time, date, and NDIS item', async () => {
    mockUserFind
      .mockReturnValueOnce(
        buildQuery([
          {
            _id: '507f1f77bcf86cd799439030',
            firstName: 'Pratiksha',
            lastName: 'Sharma',
            email: 'pratiksha@example.com',
            role: 'user',
            roles: ['user'],
          },
        ])
      )
      .mockReturnValueOnce(buildQuery([]));

    mockClientFind
      .mockReturnValueOnce(buildQuery([]))
      .mockReturnValueOnce(
        buildQuery([
          {
            _id: '507f1f77bcf86cd799439031',
            clientFirstName: 'Harry',
            clientLastName: 'Stone',
            clientEmail: 'harry@example.com',
          },
        ])
      );

    mockSupportItemFind.mockReturnValueOnce(
      buildQuery([
        {
          supportItemNumber: '01_001_0107_1_1',
          supportItemName: 'Assistance With Self-Care Activities',
          unit: 'H',
          isActive: true,
        },
      ])
    );

    const result = await voiceService.processText(
      { id: '507f1f77bcf86cd799439012', organizationId: 'org-1' },
      'assign Pratiksha to Harry tomorrow from 9am to 11am with NDIS item 01_001_0107_1_1'
    );

    expect(result.detectedIntent).toBe('assignment_manage');
    expect(result.executed).toBe(true);
    expect(result.actionType).toBe('mutation');
    expect(mockAssignClientToUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userEmail: 'pratiksha@example.com',
        clientEmail: 'harry@example.com',
        dateList: [expect.any(String)],
        startTimeList: ['09:00'],
        endTimeList: ['11:00'],
      })
    );
    expect(result.resultData.assignmentId).toBe('507f1f77bcf86cd799439099');
  });
});
