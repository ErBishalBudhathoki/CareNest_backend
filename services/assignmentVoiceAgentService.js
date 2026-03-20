const {
  FunctionDeclarationSchemaType,
  VertexAI,
} = require('@google-cloud/vertexai');

const Client = require('../models/Client');
const SupportItem = require('../models/SupportItem');
const User = require('../models/User');
const logger = require('../utils/logger');
const clientService = require('./clientService');

const DEFAULT_VOICE_AGENT_MODEL = 'gemini-3.0-flash';
const MAX_AGENT_STEPS = 6;

class AssignmentVoiceAgentService {
  constructor() {
    const projectId =
      process.env.GCP_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT;
    const location =
      process.env.REGION ||
      process.env.GCP_REGION ||
      process.env.GCP_LOCATION ||
      process.env.GOOGLE_CLOUD_LOCATION;
    const modelName =
      process.env.VOICE_AGENT_MODEL || DEFAULT_VOICE_AGENT_MODEL;
    this.modelName = modelName;

    if (
      process.env.VOICE_AGENT_ENABLED === 'false' ||
      !projectId ||
      !location
    ) {
      this.model = null;
      return;
    }

    try {
      this.vertexAI = new VertexAI({
        project: projectId,
        location,
      });
      this.model = this.vertexAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1024,
        },
      });
    } catch (error) {
      logger.warn('Assignment voice agent initialization failed.', {
        error: error.message,
      });
      this.model = null;
    }
  }

  isAvailable() {
    return !!this.model;
  }

  async processCommand({ userContext, commandText, pendingDraft = null }) {
    if (!this.model || !userContext?.organizationId) {
      return null;
    }

    const observedCandidates = {
      employees: [],
      clients: [],
      ndisItems: [],
    };
    const toolCalls = [];
    const contents = [
      {
        role: 'user',
        parts: [
          {
            text: this._buildPlannerPrompt({
              userContext,
              commandText,
              pendingDraft,
            }),
          },
        ],
      },
    ];

    try {
      for (let step = 0; step < MAX_AGENT_STEPS; step += 1) {
        const result = await this.model.generateContent({
          contents,
          tools: this._getTools(),
        });
        const response = result?.response;
        const candidate = response?.candidates?.[0];
        const parts = candidate?.content?.parts || [];
        const functionCalls = parts
          .filter((part) => !!part.functionCall)
          .map((part) => part.functionCall);

        if (functionCalls.length > 0) {
          contents.push({
            role: 'model',
            parts: parts.filter((part) => !!part.functionCall),
          });

          const functionResponseParts = [];
          for (const functionCall of functionCalls) {
            toolCalls.push(functionCall.name);
            const toolResult = await this._executeTool({
              userContext,
              name: functionCall.name,
              args: functionCall.args || {},
            });
            this._collectObservedCandidates(observedCandidates, toolResult);
            functionResponseParts.push({
              functionResponse: {
                name: functionCall.name,
                response: {
                  name: functionCall.name,
                  content: toolResult,
                },
              },
            });
          }

          contents.push({
            role: 'user',
            parts: functionResponseParts,
          });
          continue;
        }

        const text = parts
          .map((part) => part.text)
          .filter(Boolean)
          .join('\n')
          .trim();
        const parsed = this._parseJsonResponse(text);
        if (!parsed) {
          return null;
        }

        return this._normalizeFinalResult({
          finalResult: parsed,
          pendingDraft,
          observedCandidates,
          toolCalls,
        });
      }
    } catch (error) {
      logger.warn('Assignment voice agent failed. Falling back to rule-based flow.', {
        error: error.message,
      });
      return null;
    }

    return null;
  }

  _buildPlannerPrompt({ userContext, commandText, pendingDraft }) {
    const today = new Date().toISOString().split('T')[0];
    const draft = pendingDraft ? JSON.stringify(pendingDraft, null, 2) : 'null';

    return [
      'You are the CareNest assignment voice agent.',
      'Scope: only the CareNest app. Never suggest external actions.',
      'Your job is to complete or continue a client-to-employee assignment workflow.',
      'Use tools to resolve employee names, client names, NDIS items, schedule details, and to create the assignment.',
      'If the user gives a full or partial NDIS support item name, use resolve_ndis_support_item to map that spoken name to the correct support item number before creating the assignment.',
      'Never invent emails, IDs, dates, times, or support items. Use tool outputs only.',
      'If anything required is missing or ambiguous, ask only for the missing app data.',
      'If the request can be completed, call create_assignment before responding.',
      'If the user says names in either order, infer employee vs client from tool results.',
      `Today's date: ${today}.`,
      `Organization ID: ${userContext.organizationId}.`,
      `Authenticated user email: ${userContext.email || 'unknown'}.`,
      `Pending assignment draft from earlier turns: ${draft}.`,
      `Latest user command: ${commandText}`,
      'Return JSON only with this shape:',
      JSON.stringify(
        {
          status: 'pending or completed',
          responseText: 'short user-facing response',
          missingFields: ['employee', 'client', 'date', 'timeRange', 'ndisItem'],
          suggestions: ['short follow-up suggestion'],
          assignmentDraft: {
            employee: { name: 'string', email: 'string' },
            client: { id: 'string', name: 'string', email: 'string' },
            schedule: {
              date: 'YYYY-MM-DD',
              startTime: 'HH:MM',
              endTime: 'HH:MM',
              break: 'Yes or No',
              highIntensity: false,
            },
            ndisItem: {
              itemNumber: 'string',
              itemName: 'string',
            },
          },
          assignmentId: 'string or null',
          backendMessage: 'string or null',
        },
        null,
        2
      ),
    ].join('\n');
  }

  _getTools() {
    return [
      {
        functionDeclarations: [
          {
            name: 'search_employees',
            description:
              'Search assignable employees within the current organization by name or email.',
            parameters: {
              type: FunctionDeclarationSchemaType.OBJECT,
              properties: {
                query: {
                  type: FunctionDeclarationSchemaType.STRING,
                },
              },
              required: ['query'],
            },
          },
          {
            name: 'search_clients',
            description:
              'Search active clients within the current organization by name or email.',
            parameters: {
              type: FunctionDeclarationSchemaType.OBJECT,
              properties: {
                query: {
                  type: FunctionDeclarationSchemaType.STRING,
                },
              },
              required: ['query'],
            },
          },
          {
            name: 'resolve_ndis_support_item',
            description:
              'Resolve the most likely NDIS support item from a spoken full name, partial name, or item number. Returns the best match and alternatives.',
            parameters: {
              type: FunctionDeclarationSchemaType.OBJECT,
              properties: {
                query: {
                  type: FunctionDeclarationSchemaType.STRING,
                },
              },
              required: ['query'],
            },
          },
          {
            name: 'search_ndis_items',
            description:
              'Search support items by item number or text label.',
            parameters: {
              type: FunctionDeclarationSchemaType.OBJECT,
              properties: {
                query: {
                  type: FunctionDeclarationSchemaType.STRING,
                },
              },
              required: ['query'],
            },
          },
          {
            name: 'parse_schedule_details',
            description:
              'Parse natural language schedule text into a single assignment date and time range.',
            parameters: {
              type: FunctionDeclarationSchemaType.OBJECT,
              properties: {
                text: {
                  type: FunctionDeclarationSchemaType.STRING,
                },
              },
              required: ['text'],
            },
          },
          {
            name: 'create_assignment',
            description:
              'Create or update a CareNest assignment when employee, client, date, time range, and NDIS item are fully known.',
            parameters: {
              type: FunctionDeclarationSchemaType.OBJECT,
              properties: {
                employeeEmail: {
                  type: FunctionDeclarationSchemaType.STRING,
                },
                clientEmail: {
                  type: FunctionDeclarationSchemaType.STRING,
                },
                date: {
                  type: FunctionDeclarationSchemaType.STRING,
                },
                startTime: {
                  type: FunctionDeclarationSchemaType.STRING,
                },
                endTime: {
                  type: FunctionDeclarationSchemaType.STRING,
                },
                ndisItemNumber: {
                  type: FunctionDeclarationSchemaType.STRING,
                },
                breakValue: {
                  type: FunctionDeclarationSchemaType.STRING,
                },
                highIntensity: {
                  type: FunctionDeclarationSchemaType.BOOLEAN,
                },
              },
              required: [
                'employeeEmail',
                'clientEmail',
                'date',
                'startTime',
                'endTime',
                'ndisItemNumber',
              ],
            },
          },
        ],
      },
    ];
  }

  async _executeTool({ userContext, name, args }) {
    switch (name) {
      case 'search_employees':
        return this._searchEmployees(userContext.organizationId, args.query);
      case 'search_clients':
        return this._searchClients(userContext.organizationId, args.query);
      case 'resolve_ndis_support_item':
        return this._resolveNdisSupportItem(args.query);
      case 'search_ndis_items':
        return this._searchNdisItems(args.query);
      case 'parse_schedule_details':
        return this._parseScheduleDetails(args.text);
      case 'create_assignment':
        return this._createAssignment(args);
      default:
        return {
          success: false,
          error: `Unsupported tool: ${name}`,
        };
    }
  }

  async _searchEmployees(organizationId, rawQuery) {
    const query = this._cleanEntityName(rawQuery);
    if (!query) {
      return { success: true, matches: [] };
    }

    const regex = new RegExp(this._escapeRegExp(query), 'i');
    const candidates = (
      await User.find({
        organizationId,
        isActive: true,
        isDeleted: { $ne: true },
        $or: [
          { firstName: regex },
          { lastName: regex },
          { email: regex },
        ],
      })
        .select('firstName lastName email role roles')
        .limit(10)
        .lean()
    ).filter((candidate) => {
      const role = String(candidate.role || '').toLowerCase();
      const roles = Array.isArray(candidate.roles)
        ? candidate.roles.map((value) => String(value).toLowerCase())
        : [];
      return role !== 'client' && !roles.includes('client');
    });

    const ranked = this._rankEntityMatches({
      rawQuery: query,
      items: candidates.map((candidate) => ({
        id: candidate._id?.toString?.() || null,
        name: `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim(),
        email: candidate.email || '',
        firstName: candidate.firstName || '',
        lastName: candidate.lastName || '',
      })),
    });

    return {
      success: true,
      entityType: 'employee',
      matches: ranked.matches,
      primary: ranked.primary,
      confident: ranked.confident,
    };
  }

  async _searchClients(organizationId, rawQuery) {
    const query = this._cleanEntityName(rawQuery);
    if (!query) {
      return { success: true, matches: [] };
    }

    const regex = new RegExp(this._escapeRegExp(query), 'i');
    const candidates = await Client.find({
      organizationId,
      isActive: true,
      deletedAt: null,
      $or: [
        { clientFirstName: regex },
        { clientLastName: regex },
        { clientEmail: regex },
      ],
    })
      .select('clientFirstName clientLastName clientEmail')
      .limit(10)
      .lean();

    const ranked = this._rankEntityMatches({
      rawQuery: query,
      items: candidates.map((candidate) => ({
        id: candidate._id?.toString?.() || null,
        name: `${candidate.clientFirstName || ''} ${candidate.clientLastName || ''}`.trim(),
        email: candidate.clientEmail || '',
        firstName: candidate.clientFirstName || '',
        lastName: candidate.clientLastName || '',
      })),
    });

    return {
      success: true,
      entityType: 'client',
      matches: ranked.matches,
      primary: ranked.primary,
      confident: ranked.confident,
    };
  }

  async _resolveNdisSupportItem(rawQuery) {
    const result = await this._searchNdisItems(rawQuery);
    return {
      ...result,
      entityType: 'ndisItem',
      query: String(rawQuery || '').trim(),
      requiresClarification: !result.primary && result.matches.length > 0,
    };
  }

  async _searchNdisItems(rawQuery) {
    const query = this._cleanSupportItemQuery(rawQuery);
    if (!query) {
      return { success: true, matches: [] };
    }

    const numberVariants = this._getSupportItemNumberVariants(query);
    const exactNumber = numberVariants[0] || null;

    let items;
    if (exactNumber) {
      items = await SupportItem.find({
        supportItemNumber: { $in: numberVariants },
        isActive: true,
      })
        .limit(5)
        .lean();
    } else {
      const regex = new RegExp(this._escapeRegExp(query), 'i');
      const queryTokens = query
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2);
      const nameTokenAnd =
          queryTokens.length > 1
              ? [
                  {
                    $and: queryTokens.map((token) => ({
                      supportItemName: {
                        $regex: this._escapeRegExp(token),
                        $options: 'i',
                      },
                    })),
                  },
                ]
              : [];
      const descriptionTokenAnd =
          queryTokens.length > 1
              ? [
                  {
                    $and: queryTokens.map((token) => ({
                      description: {
                        $regex: this._escapeRegExp(token),
                        $options: 'i',
                      },
                    })),
                  },
                ]
              : [];
      items = await SupportItem.find({
        isActive: true,
        $or: [
          { supportItemNumber: regex },
          { supportItemName: regex },
          { description: regex },
          ...nameTokenAnd,
          ...descriptionTokenAnd,
        ],
      })
        .limit(10)
        .lean();
    }

    const ranked = items
      .map((item) => ({
        item: this._toVoiceNdisItem(item),
        score: this._scoreSupportItemMatch(query, item),
      }))
      .sort((a, b) => b.score - a.score);

    const matches = ranked.slice(0, 5).map((entry) => entry.item);
    const top = ranked[0];
    const next = ranked[1];

    return {
      success: true,
      entityType: 'ndisItem',
      matches,
      primary:
        top &&
        (exactNumber || !next || top.score - next.score >= 12 || top.score >= 110)
          ? top.item
          : null,
    };
  }

  _parseScheduleDetails(rawText) {
    const text = String(rawText || '').trim();
    const dateInfo = this._extractDateInfo(text);
    const timeInfo = this._extractTimeRange(text);

    return {
      success: true,
      date: dateInfo?.date || null,
      startTime: timeInfo?.startTime || null,
      endTime: timeInfo?.endTime || null,
      breakValue: text.toLowerCase().includes('with break') ? 'Yes' : 'No',
      highIntensity: text.toLowerCase().includes('high intensity'),
      missingFields: [
        ...(dateInfo?.date ? [] : ['date']),
        ...(timeInfo?.startTime && timeInfo?.endTime ? [] : ['timeRange']),
      ],
    };
  }

  async _createAssignment(args) {
    const employeeEmail = String(args.employeeEmail || '').trim().toLowerCase();
    const clientEmail = String(args.clientEmail || '').trim().toLowerCase();
    const date = String(args.date || '').trim();
    const startTime = this._normalizeTimeValue(args.startTime);
    const endTime = this._normalizeTimeValue(args.endTime);
    const ndisItemNumberVariants = this._getSupportItemNumberVariants(
      String(args.ndisItemNumber || '').trim()
    );
    const ndisItemNumber = ndisItemNumberVariants[0] || '';
    const breakValue =
      String(args.breakValue || '').trim() === 'Yes' ? 'Yes' : 'No';
    const highIntensity = args.highIntensity === true;

    if (
      !employeeEmail ||
      !clientEmail ||
      !date ||
      !startTime ||
      !endTime ||
      !ndisItemNumber
    ) {
      return {
        success: false,
        error: 'Missing required assignment fields.',
      };
    }

    const supportItem = await SupportItem.findOne({
      supportItemNumber: { $in: ndisItemNumberVariants },
      isActive: true,
    }).lean();
    if (!supportItem) {
      return {
        success: false,
        error: `Support item ${ndisItemNumber} was not found.`,
      };
    }

    const result = await clientService.assignClientToUser({
      userEmail: employeeEmail,
      clientEmail,
      dateList: [date],
      startTimeList: [startTime],
      endTimeList: [endTime],
      breakList: [breakValue],
      ndisItem: this._toVoiceNdisItem(supportItem),
      highIntensityList: [highIntensity],
      scheduleWithNdisItems: [
        {
          date,
          startTime,
          endTime,
          break: breakValue,
          highIntensity,
          ndisItem: this._toVoiceNdisItem(supportItem),
        },
      ],
    });

    return {
      success: true,
      assignmentId: result.assignmentId?.toString?.() || null,
      backendMessage: result.message || null,
      assignmentDraft: {
        employee: {
          email: employeeEmail,
        },
        client: {
          email: clientEmail,
        },
        schedule: {
          date,
          startTime,
          endTime,
          break: breakValue,
          highIntensity,
        },
        ndisItem: this._toVoiceNdisItem(supportItem),
      },
    };
  }

  _parseJsonResponse(text) {
    if (!text) {
      return null;
    }

    const fencedMatch = text.match(/```(?:json)?\s*([\s\S]+?)```/i);
    const candidate = fencedMatch ? fencedMatch[1].trim() : text.trim();

    try {
      return JSON.parse(candidate);
    } catch (_) {
      return null;
    }
  }

  _normalizeFinalResult({
    finalResult,
    pendingDraft,
    observedCandidates,
    toolCalls,
  }) {
    const baseDraft = this._normalizeDraft(pendingDraft);
    const modelDraft = this._normalizeDraft(finalResult.assignmentDraft);
    const mergedDraft = this._mergeDraft(baseDraft, modelDraft);
    const missingFields = Array.isArray(finalResult.missingFields)
      ? finalResult.missingFields.map((item) => String(item))
      : this._calculateMissingFields(mergedDraft);

    return {
      executionMode: 'agent',
      agentModel: this.modelName || DEFAULT_VOICE_AGENT_MODEL,
      toolCalls,
      status:
        finalResult.status === 'completed' && missingFields.length === 0
          ? 'completed'
          : 'pending',
      responseText:
        String(finalResult.responseText || '').trim() ||
        (missingFields.length > 0
          ? `I still need ${missingFields.join(', ')} to finish the assignment.`
          : 'Assignment completed.'),
      missingFields,
      suggestions: Array.isArray(finalResult.suggestions)
        ? finalResult.suggestions.map((item) => String(item)).slice(0, 4)
        : [],
      assignmentDraft: mergedDraft,
      assignmentId: finalResult.assignmentId || null,
      backendMessage: finalResult.backendMessage || null,
      candidates: observedCandidates,
    };
  }

  _normalizeDraft(draft = null) {
    const source = draft && typeof draft === 'object' ? draft : {};
    const employee =
      source.employee && typeof source.employee === 'object'
        ? source.employee
        : {};
    const client =
      source.client && typeof source.client === 'object'
        ? source.client
        : {};
    const schedule =
      source.schedule && typeof source.schedule === 'object'
        ? source.schedule
        : {};
    const ndisItem =
      source.ndisItem && typeof source.ndisItem === 'object'
        ? source.ndisItem
        : {};

    return {
      employee:
        employee.name || employee.email
          ? {
              name: employee.name || '',
              email: employee.email || '',
            }
          : null,
      client:
        client.name || client.email || client.id
          ? {
              id: client.id || null,
              name: client.name || '',
              email: client.email || '',
            }
          : null,
      schedule: {
        date: schedule.date || null,
        startTime: this._normalizeTimeValue(schedule.startTime) || null,
        endTime: this._normalizeTimeValue(schedule.endTime) || null,
        break: schedule.break === 'Yes' ? 'Yes' : 'No',
        highIntensity: schedule.highIntensity === true,
      },
      ndisItem:
        ndisItem.itemNumber || ndisItem.itemName
          ? {
              itemNumber: ndisItem.itemNumber || '',
              itemName: ndisItem.itemName || '',
              unit: ndisItem.unit || 'H',
            }
          : null,
    };
  }

  _mergeDraft(baseDraft, nextDraft) {
    return {
      employee: nextDraft.employee?.email || nextDraft.employee?.name
        ? {
            name: nextDraft.employee.name || baseDraft.employee?.name || '',
            email: nextDraft.employee.email || baseDraft.employee?.email || '',
          }
        : baseDraft.employee,
      client: nextDraft.client?.email || nextDraft.client?.name || nextDraft.client?.id
        ? {
            id: nextDraft.client.id || baseDraft.client?.id || null,
            name: nextDraft.client.name || baseDraft.client?.name || '',
            email: nextDraft.client.email || baseDraft.client?.email || '',
          }
        : baseDraft.client,
      schedule: {
        date: nextDraft.schedule?.date || baseDraft.schedule?.date || null,
        startTime:
          nextDraft.schedule?.startTime || baseDraft.schedule?.startTime || null,
        endTime:
          nextDraft.schedule?.endTime || baseDraft.schedule?.endTime || null,
        break: nextDraft.schedule?.break || baseDraft.schedule?.break || 'No',
        highIntensity:
          nextDraft.schedule?.highIntensity === true ||
          baseDraft.schedule?.highIntensity === true,
      },
      ndisItem:
        nextDraft.ndisItem?.itemNumber || nextDraft.ndisItem?.itemName
          ? {
              ...(baseDraft.ndisItem || {}),
              ...nextDraft.ndisItem,
            }
          : baseDraft.ndisItem,
    };
  }

  _calculateMissingFields(draft) {
    const missing = [];
    if (!draft.employee?.email) missing.push('employee');
    if (!draft.client?.email) missing.push('client');
    if (!draft.schedule?.date) missing.push('date');
    if (!draft.schedule?.startTime || !draft.schedule?.endTime) {
      missing.push('timeRange');
    }
    if (!draft.ndisItem?.itemNumber) missing.push('ndisItem');
    return missing;
  }

  _collectObservedCandidates(target, toolResult) {
    if (!toolResult || typeof toolResult !== 'object') {
      return;
    }

    if (
      !Array.isArray(toolResult.matches) ||
      toolResult.matches.length === 0
    ) {
      return;
    }

    if (toolResult.entityType === 'ndisItem') {
      target.ndisItems = toolResult.matches.slice(0, 5);
      return;
    }

    if (toolResult.entityType === 'client') {
      target.clients = toolResult.matches.slice(0, 5);
      return;
    }

    if (toolResult.entityType === 'employee') {
      target.employees = toolResult.matches.slice(0, 5);
      return;
    }

    const firstMatch = toolResult.matches[0];
    if (firstMatch.itemNumber) {
        target.ndisItems = toolResult.matches.slice(0, 5);
    } else if (firstMatch.email && firstMatch.id) {
      target.clients = toolResult.matches.slice(0, 5);
    } else if (firstMatch.email) {
      target.employees = toolResult.matches.slice(0, 5);
    }
  }

  _rankEntityMatches({ rawQuery, items }) {
    const ranked = items
      .map((item) => ({
        ...item,
        score: this._scoreEntityMatch(rawQuery, item),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

    const matches = ranked.slice(0, 5).map(({ score, ...item }) => item);
    const top = ranked[0];
    const next = ranked[1];

    return {
      matches,
      primary:
        top && (!next || top.score - next.score >= 15 || top.score >= 110)
          ? matches[0]
          : null,
      confident:
        !!top && (!next || top.score - next.score >= 15 || top.score >= 110),
    };
  }

  _scoreEntityMatch(rawQuery, item) {
    const normalizedQuery = this._normalizeSearchText(rawQuery);
    if (!normalizedQuery) return 0;

    const fullName = this._normalizeSearchText(item.name);
    const firstName = this._normalizeSearchText(item.firstName);
    const lastName = this._normalizeSearchText(item.lastName);
    const email = this._normalizeSearchText(item.email);
    const emailLocal = email.split('@')[0] || email;

    let score = 0;
    if (fullName === normalizedQuery) score = Math.max(score, 120);
    if (email === normalizedQuery || emailLocal === normalizedQuery) {
      score = Math.max(score, 115);
    }
    if (firstName === normalizedQuery || lastName === normalizedQuery) {
      score = Math.max(score, 108);
    }
    if (fullName.startsWith(normalizedQuery)) {
      score = Math.max(score, 96);
    }
    if (fullName.includes(normalizedQuery)) {
      score = Math.max(score, 88);
    }
    if (email.includes(normalizedQuery)) {
      score = Math.max(score, 82);
    }

    const queryTokens = normalizedQuery.split(' ').filter(Boolean);
    if (queryTokens.length > 1 && queryTokens.every((token) => fullName.includes(token))) {
      score = Math.max(score, 104);
    }

    return score;
  }

  _toVoiceNdisItem(item) {
    return {
      itemNumber: item.supportItemNumber || item.itemNumber || '',
      itemName:
        item.supportItemName || item.itemName || item.description || '',
      supportCategoryNumber: item.supportCategoryNumber || '',
      supportCategoryName: item.supportCategoryName || '',
      registrationGroupNumber: item.registrationGroupNumber || '',
      registrationGroupName: item.registrationGroupName || '',
      unit: item.unit || 'H',
      type: item.type || 'Price Limited Supports',
      isQuotable: !!item.isQuotable,
      supportPurposeId: item.supportPurposeId || '0',
      generalCategory: item.generalCategory || '',
      description: item.description || '',
      price: item.price || null,
    };
  }

  _scoreSupportItemMatch(rawQuery, item) {
    const normalizedQuery = this._normalizeSearchText(rawQuery);
    const number = this._normalizeSearchText(item.supportItemNumber || '');
    const name = this._normalizeSearchText(item.supportItemName || '');
    const description = this._normalizeSearchText(item.description || '');
    const queryTokens = normalizedQuery.split(' ').filter(Boolean);

    let score = 0;
    if (number === normalizedQuery) score = Math.max(score, 130);
    if (name === normalizedQuery) score = Math.max(score, 118);
    if (number.startsWith(normalizedQuery)) score = Math.max(score, 108);
    if (name.includes(normalizedQuery)) score = Math.max(score, 95);
    if (description.includes(normalizedQuery)) score = Math.max(score, 82);
    if (
      queryTokens.length > 1 &&
      queryTokens.every((token) => name.includes(token))
    ) {
      score = Math.max(score, 104);
    }
    if (
      queryTokens.length > 1 &&
      queryTokens.every((token) => description.includes(token))
    ) {
      score = Math.max(score, 90);
    }
    return score;
  }

  _cleanSupportItemQuery(rawValue) {
    return String(rawValue || '')
      .replace(/\b(with|using|for)\b/gi, ' ')
      .replace(/\b(ndis|support)\s+item\b/gi, ' ')
      .replace(/\bitem\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _cleanEntityName(value) {
    return String(value || '')
      .replace(
        /\b(employee|staff|worker|carer|client|participant|please|the)\b/gi,
        ''
      )
      .replace(/[.,]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _extractDateInfo(commandText) {
    const normalized = String(commandText || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    const baseDate = new Date();

    if (normalized.includes('day after tomorrow')) {
      return { date: this._toIsoDate(this._addDays(baseDate, 2)) };
    }
    if (normalized.includes('tomorrow')) {
      return { date: this._toIsoDate(this._addDays(baseDate, 1)) };
    }
    if (/\btoday\b/.test(normalized)) {
      return { date: this._toIsoDate(baseDate) };
    }

    const isoMatch = commandText.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    if (isoMatch?.[1]) {
      return { date: isoMatch[1] };
    }

    const shortDateMatch = commandText.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
    if (shortDateMatch) {
      const day = Number(shortDateMatch[1]);
      const month = Number(shortDateMatch[2]);
      const year = Number(shortDateMatch[3]);
      return { date: this._toIsoDate(new Date(year, month - 1, day)) };
    }

    const weekdays = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ];
    for (let index = 0; index < weekdays.length; index += 1) {
      const weekday = weekdays[index];
      if (
        normalized.includes(`next ${weekday}`) ||
        normalized.includes(`on ${weekday}`) ||
        normalized.endsWith(weekday)
      ) {
        return {
          date: this._toIsoDate(
            this._nextWeekday(
              baseDate,
              index,
              normalized.includes(`next ${weekday}`)
            )
          ),
        };
      }
    }

    return null;
  }

  _extractTimeRange(commandText) {
    const patterns = [
      /\bfrom\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)\s+(?:to|-)\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)\b/i,
      /\b([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)\s*(?:to|-)\s*([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)\b/i,
    ];

    for (const pattern of patterns) {
      const match = commandText.match(pattern);
      if (!match?.[1] || !match?.[2]) {
        continue;
      }

      const startTime = this._normalizeTimeValue(match[1]);
      const endTime = this._normalizeTimeValue(match[2]);
      if (startTime && endTime) {
        return { startTime, endTime };
      }
    }

    return null;
  }

  _normalizeTimeValue(rawTime) {
    if (!rawTime) {
      return null;
    }

    if (/^\d{2}:\d{2}$/.test(String(rawTime).trim())) {
      return String(rawTime).trim();
    }

    const match = String(rawTime || '')
      .trim()
      .toLowerCase()
      .match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);

    if (!match) {
      return null;
    }

    let hour = Number(match[1]);
    const minute = Number(match[2] || '0');
    const meridiem = match[3] || null;

    if (Number.isNaN(hour) || Number.isNaN(minute) || minute > 59) {
      return null;
    }

    if (meridiem === 'pm' && hour < 12) {
      hour += 12;
    }
    if (meridiem === 'am' && hour === 12) {
      hour = 0;
    }
    if (!meridiem && hour > 23) {
      return null;
    }

    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  _getSupportItemNumberVariants(rawValue) {
    const value = String(rawValue || '').trim().toUpperCase();
    if (!value) {
      return [];
    }

    const exactPattern =
      /^(\d{2})_(\d{3})_(\d{3,4})_([A-Z0-9]+)_([A-Z0-9]+(?:_T)?)$/i;
    const match = value.match(exactPattern);
    if (!match) {
      return [];
    }

    const normalized = [
      match[1],
      match[2],
      match[3].padStart(4, '0'),
      match[4],
      match[5],
    ].join('_');
    const compact = [
      match[1],
      match[2],
      String(Number(match[3])),
      match[4],
      match[5],
    ].join('_');

    return Array.from(new Set([normalized, value, compact])).filter(Boolean);
  }

  _normalizeSearchText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9@._\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  _addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  _nextWeekday(baseDate, weekdayIndex, forceNextWeek = false) {
    const result = new Date(baseDate);
    const current = result.getDay();
    let diff = weekdayIndex - current;
    if (diff < 0 || forceNextWeek) {
      diff += 7;
    }
    if (diff === 0 && !forceNextWeek) {
      return result;
    }
    result.setDate(result.getDate() + diff);
    return result;
  }

  _toIsoDate(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate())
      .toISOString()
      .split('T')[0];
  }
}

module.exports = new AssignmentVoiceAgentService();
