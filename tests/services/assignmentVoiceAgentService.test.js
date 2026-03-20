process.env.GCP_PROJECT_ID = 'test-project';
process.env.REGION = 'australia-southeast1';
process.env.VOICE_AGENT_MODEL = 'gemini-3.0-flash';

const mockGenerateContent = jest.fn();
const mockStartChat = jest.fn();
const mockGetGenerativeModel = jest.fn();
const mockUserFind = jest.fn();
const mockClientFind = jest.fn();
const mockSupportItemFind = jest.fn();
const mockSupportItemFindOne = jest.fn();
const mockAssignClientToUser = jest.fn();

jest.mock('@google-cloud/vertexai', () => ({
  VertexAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
  FunctionDeclarationSchemaType: {
    OBJECT: 'OBJECT',
    STRING: 'STRING',
    BOOLEAN: 'BOOLEAN',
  },
}));

jest.mock('../../models/User', () => ({
  find: mockUserFind,
}));

jest.mock('../../models/Client', () => ({
  find: mockClientFind,
}));

jest.mock('../../models/SupportItem', () => ({
  find: mockSupportItemFind,
  findOne: mockSupportItemFindOne,
}));

jest.mock('../../services/clientService', () => ({
  assignClientToUser: mockAssignClientToUser,
}));

jest.mock('../../utils/logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
}));

function buildLeanQuery(result) {
  return {
    select: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
  };
}

function buildResponse(parts) {
  return {
    response: {
      candidates: [
        {
          content: {
            parts,
          },
        },
      ],
    },
  };
}

describe('assignmentVoiceAgentService', () => {
  let assignmentVoiceAgentService;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    mockGetGenerativeModel.mockReturnValue({
      generateContent: mockGenerateContent,
      startChat: mockStartChat,
    });

    assignmentVoiceAgentService = require('../../services/assignmentVoiceAgentService');
  });

  it('returns pending draft data after tool-based name resolution', async () => {
    mockUserFind.mockReturnValueOnce(
      buildLeanQuery([
        {
          _id: 'user-1',
          firstName: 'Pratiksha',
          lastName: 'Sharma',
          email: 'pratiksha@example.com',
          role: 'user',
          roles: ['user'],
        },
      ])
    );

    mockClientFind.mockReturnValueOnce(
      buildLeanQuery([
        {
          _id: 'client-1',
          clientFirstName: 'Harry',
          clientLastName: 'Stone',
          clientEmail: 'harry@example.com',
        },
      ])
    );

    mockGenerateContent
      .mockResolvedValueOnce(
        buildResponse([
          {
            functionCall: {
              name: 'search_employees',
              args: { query: 'Pratiksha' },
            },
          },
        ])
      )
      .mockResolvedValueOnce(
        buildResponse([
          {
            functionCall: {
              name: 'search_clients',
              args: { query: 'Harry' },
            },
          },
        ])
      )
      .mockResolvedValueOnce(
        buildResponse([
          {
            text: JSON.stringify({
              status: 'pending',
              responseText:
                'I found Pratiksha and Harry. I still need the date, time range, and NDIS item.',
              missingFields: ['date', 'timeRange', 'ndisItem'],
              suggestions: ['Tomorrow from 9 to 11'],
              assignmentDraft: {
                employee: {
                  name: 'Pratiksha Sharma',
                  email: 'pratiksha@example.com',
                },
                client: {
                  id: 'client-1',
                  name: 'Harry Stone',
                  email: 'harry@example.com',
                },
              },
            }),
          },
        ])
      );

    const result = await assignmentVoiceAgentService.processCommand({
      userContext: {
        organizationId: 'org-1',
        email: 'admin@example.com',
      },
      commandText: 'assign Pratiksha to Harry',
      pendingDraft: null,
    });

    expect(result.status).toBe('pending');
    expect(result.assignmentDraft.employee.email).toBe('pratiksha@example.com');
    expect(result.assignmentDraft.client.email).toBe('harry@example.com');
    expect(result.missingFields).toEqual(
      expect.arrayContaining(['date', 'timeRange', 'ndisItem'])
    );
    expect(result.candidates.employees[0].email).toBe('pratiksha@example.com');
    expect(result.candidates.clients[0].email).toBe('harry@example.com');
  });

  it('creates an assignment through the create_assignment tool', async () => {
    mockSupportItemFindOne.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue({
        supportItemNumber: '01_001_0107_1_1',
        supportItemName: 'Assistance With Self-Care Activities',
        unit: 'H',
        isActive: true,
      }),
    });

    mockAssignClientToUser.mockResolvedValueOnce({
      assignmentId: 'assignment-1',
      message: 'Assignment created successfully',
    });

    mockGenerateContent
      .mockResolvedValueOnce(
        buildResponse([
          {
            functionCall: {
              name: 'create_assignment',
              args: {
                employeeEmail: 'pratiksha@example.com',
                clientEmail: 'harry@example.com',
                date: '2026-03-21',
                startTime: '09:00',
                endTime: '11:00',
                ndisItemNumber: '01_001_0107_1_1',
              },
            },
          },
        ])
      )
      .mockResolvedValueOnce(
        buildResponse([
          {
            text: JSON.stringify({
              status: 'completed',
              responseText:
                'Assigned Pratiksha to Harry for tomorrow from 09:00 to 11:00.',
              missingFields: [],
              suggestions: ['Open schedule'],
              assignmentDraft: {
                employee: {
                  name: 'Pratiksha Sharma',
                  email: 'pratiksha@example.com',
                },
                client: {
                  name: 'Harry Stone',
                  email: 'harry@example.com',
                },
                schedule: {
                  date: '2026-03-21',
                  startTime: '09:00',
                  endTime: '11:00',
                  break: 'No',
                  highIntensity: false,
                },
                ndisItem: {
                  itemNumber: '01_001_0107_1_1',
                  itemName: 'Assistance With Self-Care Activities',
                },
              },
              assignmentId: 'assignment-1',
              backendMessage: 'Assignment created successfully',
            }),
          },
        ])
      );

    const result = await assignmentVoiceAgentService.processCommand({
      userContext: {
        organizationId: 'org-1',
        email: 'admin@example.com',
      },
      commandText:
        'assign Pratiksha to Harry tomorrow from 9am to 11am with NDIS item 01_001_0107_1_1',
      pendingDraft: null,
    });

    expect(result.status).toBe('completed');
    expect(mockAssignClientToUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userEmail: 'pratiksha@example.com',
        clientEmail: 'harry@example.com',
        dateList: ['2026-03-21'],
        startTimeList: ['09:00'],
        endTimeList: ['11:00'],
      })
    );
    expect(result.assignmentId).toBe('assignment-1');
    expect(result.assignmentDraft.ndisItem.itemNumber).toBe('01_001_0107_1_1');
  });

  it('normalizes spoken NDIS item numbers with missing zero padding', async () => {
    mockSupportItemFindOne.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue({
        supportItemNumber: '01_001_0107_1_1',
        supportItemName: 'Assistance With Self-Care Activities',
        unit: 'H',
        isActive: true,
      }),
    });

    mockAssignClientToUser.mockResolvedValueOnce({
      assignmentId: 'assignment-2',
      message: 'Assignment created successfully',
    });

    mockGenerateContent
      .mockResolvedValueOnce(
        buildResponse([
          {
            functionCall: {
              name: 'create_assignment',
              args: {
                employeeEmail: 'pratiksha@example.com',
                clientEmail: 'harry@example.com',
                date: '2026-03-24',
                startTime: '09:00',
                endTime: '11:00',
                ndisItemNumber: '01_001_107_1_1',
              },
            },
          },
        ])
      )
      .mockResolvedValueOnce(
        buildResponse([
          {
            text: JSON.stringify({
              status: 'completed',
              responseText: 'Assigned Pratiksha to Harry.',
              missingFields: [],
              assignmentDraft: {
                employee: {
                  email: 'pratiksha@example.com',
                },
                client: {
                  email: 'harry@example.com',
                },
                schedule: {
                  date: '2026-03-24',
                  startTime: '09:00',
                  endTime: '11:00',
                },
                ndisItem: {
                  itemNumber: '01_001_0107_1_1',
                  itemName: 'Assistance With Self-Care Activities',
                },
              },
              assignmentId: 'assignment-2',
            }),
          },
        ])
      );

    const result = await assignmentVoiceAgentService.processCommand({
      userContext: {
        organizationId: 'org-1',
        email: 'admin@example.com',
      },
      commandText:
        'assign Pratiksha to Harry next Tuesday 9 to 11 with ndis item 01_001_107_1_1',
      pendingDraft: null,
    });

    expect(mockAssignClientToUser).toHaveBeenCalledWith(
      expect.objectContaining({
        ndisItem: expect.objectContaining({
          itemNumber: '01_001_0107_1_1',
        }),
      })
    );
    expect(result.status).toBe('completed');
  });

  it('resolves a spoken NDIS support item name through the agent tool before creating the assignment', async () => {
    mockSupportItemFind.mockReturnValueOnce({
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        {
          supportItemNumber: '01_001_0107_1_1',
          supportItemName: 'Assistance With Self-Care Activities',
          description: 'Support for assistance with self care activities.',
          unit: 'H',
          isActive: true,
        },
      ]),
    });

    mockSupportItemFindOne.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue({
        supportItemNumber: '01_001_0107_1_1',
        supportItemName: 'Assistance With Self-Care Activities',
        unit: 'H',
        isActive: true,
      }),
    });

    mockAssignClientToUser.mockResolvedValueOnce({
      assignmentId: 'assignment-3',
      message: 'Assignment created successfully',
    });

    mockGenerateContent
      .mockResolvedValueOnce(
        buildResponse([
          {
            functionCall: {
              name: 'resolve_ndis_support_item',
              args: {
                query: 'assistance with self care activities',
              },
            },
          },
        ])
      )
      .mockResolvedValueOnce(
        buildResponse([
          {
            functionCall: {
              name: 'create_assignment',
              args: {
                employeeEmail: 'pratiksha@example.com',
                clientEmail: 'harry@example.com',
                date: '2026-03-24',
                startTime: '09:00',
                endTime: '11:00',
                ndisItemNumber: '01_001_0107_1_1',
              },
            },
          },
        ])
      )
      .mockResolvedValueOnce(
        buildResponse([
          {
            text: JSON.stringify({
              status: 'completed',
              responseText:
                'Assigned Pratiksha to Harry with Assistance With Self-Care Activities.',
              missingFields: [],
              suggestions: ['Open schedule'],
              assignmentDraft: {
                employee: {
                  email: 'pratiksha@example.com',
                },
                client: {
                  email: 'harry@example.com',
                },
                schedule: {
                  date: '2026-03-24',
                  startTime: '09:00',
                  endTime: '11:00',
                },
                ndisItem: {
                  itemNumber: '01_001_0107_1_1',
                  itemName: 'Assistance With Self-Care Activities',
                },
              },
              assignmentId: 'assignment-3',
              backendMessage: 'Assignment created successfully',
            }),
          },
        ])
      );

    const result = await assignmentVoiceAgentService.processCommand({
      userContext: {
        organizationId: 'org-1',
        email: 'admin@example.com',
      },
      commandText:
        'assign Pratiksha to Harry next Tuesday 9 to 11 with assistance with self care activities',
      pendingDraft: {
        employee: {
          name: 'Pratiksha Sharma',
          email: 'pratiksha@example.com',
        },
        client: {
          id: 'client-1',
          name: 'Harry Stone',
          email: 'harry@example.com',
        },
        schedule: {
          date: '2026-03-24',
          startTime: '09:00',
          endTime: '11:00',
          break: 'No',
          highIntensity: false,
        },
      },
    });

    expect(mockSupportItemFind).toHaveBeenCalledWith(
      expect.objectContaining({
        isActive: true,
      })
    );
    expect(mockAssignClientToUser).toHaveBeenCalledWith(
      expect.objectContaining({
        ndisItem: expect.objectContaining({
          itemNumber: '01_001_0107_1_1',
          itemName: 'Assistance With Self-Care Activities',
        }),
      })
    );
    expect(result.status).toBe('completed');
    expect(result.executionMode).toBe('agent');
    expect(result.toolCalls).toEqual(
      expect.arrayContaining(['resolve_ndis_support_item', 'create_assignment'])
    );
  });
});
