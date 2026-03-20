const Client = require('../models/Client');
const ClientAssignment = require('../models/ClientAssignment');
const { Invoice } = require('../models/Invoice');
const NotificationHistory = require('../models/NotificationHistory');
const Organization = require('../models/Organization');
const SupportItem = require('../models/SupportItem');
const User = require('../models/User');
const VoiceCommand = require('../models/VoiceCommand');
const logger = require('../utils/logger');
const assignmentVoiceAgentService = require('./assignmentVoiceAgentService');
const clientService = require('./clientService');

const SUPPORTED_ROUTE_TARGETS = {
  admin_dashboard: 'admin_dashboard',
  client_list: 'client_list',
  invoice_list: 'invoice_list',
  schedule_dashboard: 'schedule_dashboard',
  notification_center: 'notification_center',
  voice_assistant: 'voice_assistant',
  assign_c2e: 'assign_c2e',
  assignment_schedule: 'assignment_schedule',
};

class VoiceService {
  async processText(userContext, commandText, language = 'en-US', context = {}) {
    const normalizedUser = this._normalizeUserContext(userContext);
    const safeCommandText = String(commandText || '').trim();
    const startedAt = Date.now();
    const parsedIntent = this._parseIntent(safeCommandText);
    const execution = await this._executeIntent(
      normalizedUser,
      parsedIntent,
      safeCommandText,
      context
    );
    const normalizedExecution = {
      executionMode: 'fallback_rule',
      agentModel: null,
      toolCalls: [],
      ...execution,
      toolCalls: Array.isArray(execution?.toolCalls) ? execution.toolCalls : [],
    };

    const commandRecord = await VoiceCommand.create({
      userId: normalizedUser.userId,
      organizationId: normalizedUser.organizationId,
      commandText: safeCommandText,
      source: 'text',
      language,
      detectedIntent: normalizedExecution.detectedIntent,
      parameters: normalizedExecution.parameters,
      confidence: parsedIntent.confidence,
      executed: normalizedExecution.executed,
      actionType: normalizedExecution.actionType,
      responseText: normalizedExecution.responseText,
      suggestedRoute: normalizedExecution.suggestedRoute,
      suggestions: normalizedExecution.suggestions,
      resultData: normalizedExecution.resultData,
      executionMode: normalizedExecution.executionMode,
      agentModel: normalizedExecution.agentModel,
      toolCalls: normalizedExecution.toolCalls,
      nlpEntities: {
        intent: normalizedExecution.detectedIntent,
        parameters: normalizedExecution.parameters,
        confidence: parsedIntent.confidence,
      },
      success: normalizedExecution.executed,
      processingTime: Date.now() - startedAt,
      errorMessage: normalizedExecution.errorMessage || null,
    });

    logger.info('Voice command processed', {
      userId: normalizedUser.userId,
      detectedIntent: normalizedExecution.detectedIntent,
      executionMode: normalizedExecution.executionMode,
      agentModel: normalizedExecution.agentModel,
      toolCalls: normalizedExecution.toolCalls,
      executed: normalizedExecution.executed,
    });

    return this._formatVoiceCommand(commandRecord.toObject());
  }

  async processAudio(userContext, audioData, language = 'en-US') {
    const normalizedUser = this._normalizeUserContext(userContext);

    const commandRecord = await VoiceCommand.create({
      userId: normalizedUser.userId,
      organizationId: normalizedUser.organizationId,
      commandText: '[voice input received]',
      source: 'voice',
      audioData,
      language,
      detectedIntent: 'audio_not_supported',
      parameters: {},
      confidence: 0.2,
      executed: false,
      actionType: 'unsupported',
      responseText:
        'Raw audio is not processed on the server. Use the in-app microphone to transcribe speech, then send the text command.',
      suggestedRoute: SUPPORTED_ROUTE_TARGETS.voice_assistant,
      suggestions: this._defaultSuggestions(),
      resultData: {
        reason: 'speech_to_text_is_handled_in_app',
      },
      nlpEntities: {
        intent: 'audio_not_supported',
        parameters: {},
        confidence: 0.2,
      },
      success: false,
      errorMessage: 'Audio transcription is not implemented on the backend.',
    });

    return this._formatVoiceCommand(commandRecord.toObject());
  }

  async getHistory(userContext, { limit = 20, page = 1 } = {}) {
    const normalizedUser = this._normalizeUserContext(userContext);
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const safePage = Math.max(Number(page) || 1, 1);
    const skip = (safePage - 1) * safeLimit;

    const history = await VoiceCommand.find({ userId: normalizedUser.userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean();

    return history.map((item) => this._formatVoiceCommand(item));
  }

  _normalizeUserContext(userContext) {
    const userId =
      userContext?.id ||
      userContext?.userId ||
      userContext?._id ||
      userContext?.sub;

    if (!userId) {
      throw new Error('Authenticated user context is required for voice commands.');
    }

    return {
      userId: userId.toString(),
      email: userContext?.email || '',
      organizationId: userContext?.organizationId || null,
      role:
        userContext?.role ||
        (Array.isArray(userContext?.roles) && userContext.roles.length > 0
          ? userContext.roles[0]
          : 'user'),
    };
  }

  _parseIntent(commandText) {
    const normalized = String(commandText || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalized) {
      return {
        detectedIntent: 'empty_command',
        parameters: {},
        confidence: 0.1,
      };
    }

    if (
      this._containsAny(normalized, [
        'help',
        'what can you do',
        'capabilities',
        'supported commands',
      ])
    ) {
      return {
        detectedIntent: 'capabilities_help',
        parameters: {},
        confidence: 0.99,
      };
    }

    if (this._looksLikeAssignmentCommand(normalized)) {
      return {
        detectedIntent: 'assignment_manage',
        parameters: this._extractAssignmentParameters(commandText),
        confidence: 0.95,
      };
    }

    if (
      this._containsAny(normalized, [
        'mark all notifications as read',
        'mark notifications as read',
        'clear my notifications',
      ])
    ) {
      return {
        detectedIntent: 'mark_notifications_read',
        parameters: {},
        confidence: 0.97,
      };
    }

    const navigationTarget = this._extractNavigationTarget(normalized);
    if (navigationTarget) {
      return {
        detectedIntent: `navigate_${navigationTarget}`,
        parameters: { targetRoute: navigationTarget },
        confidence: 0.96,
      };
    }

    if (this._containsAny(normalized, ['notification', 'notifications', 'alerts'])) {
      return {
        detectedIntent: 'notification_summary',
        parameters: {},
        confidence: 0.94,
      };
    }

    if (this._containsAny(normalized, ['invoice', 'invoices', 'billing', 'payment'])) {
      return {
        detectedIntent: 'invoice_summary',
        parameters: {
          filter: this._extractInvoiceFilter(normalized),
        },
        confidence: 0.93,
      };
    }

    if (this._containsAny(normalized, ['client', 'clients'])) {
      return {
        detectedIntent: 'client_lookup',
        parameters: {
          searchTerm: this._extractClientSearchTerm(commandText),
        },
        confidence: 0.92,
      };
    }

    if (
      this._containsAny(normalized, [
        'schedule',
        'shift',
        'shifts',
        'appointment',
        'appointments',
      ])
    ) {
      return {
        detectedIntent: 'schedule_overview',
        parameters: {
          range: normalized.includes('today') ? 'today' : 'upcoming',
        },
        confidence: 0.92,
      };
    }

    if (this._containsAny(normalized, ['dashboard', 'summary', 'overview', 'status'])) {
      return {
        detectedIntent: 'dashboard_summary',
        parameters: {},
        confidence: 0.9,
      };
    }

    return {
      detectedIntent: 'unsupported_command',
      parameters: {},
      confidence: 0.2,
    };
  }

  async _executeIntent(userContext, parsedIntent, commandText) {
    const { detectedIntent, parameters } = parsedIntent;

    switch (detectedIntent) {
      case 'capabilities_help':
        return this._buildHelpResponse();
      case 'assignment_manage':
        return this._handleAssignmentIntent(userContext, parameters, commandText);
      case 'dashboard_summary':
        return this._getDashboardSummary(userContext);
      case 'client_lookup':
        return this._getClientLookup(userContext, parameters.searchTerm);
      case 'schedule_overview':
        return this._getScheduleOverview(userContext, parameters.range);
      case 'invoice_summary':
        return this._getInvoiceSummary(userContext, parameters.filter);
      case 'notification_summary':
        return this._getNotificationSummary(userContext);
      case 'mark_notifications_read':
        return this._markNotificationsRead(userContext);
      case 'empty_command':
        return {
          detectedIntent,
          executed: false,
          actionType: 'unsupported',
          parameters: {},
          responseText:
            'Say or type a command related to this app, like "show today summary", "open invoices", or "assign Pratiksha to Harry tomorrow from 9 to 11".',
          suggestedRoute: SUPPORTED_ROUTE_TARGETS.voice_assistant,
          suggestions: this._defaultSuggestions(),
          resultData: null,
        };
      default:
        if (detectedIntent.startsWith('navigate_')) {
          return this._buildNavigationResponse(detectedIntent, parameters.targetRoute);
        }

        const pendingDraft = await this._getPendingAssignmentDraft(userContext);
        if (pendingDraft) {
          return this._handleAssignmentIntent(
            userContext,
            this._extractAssignmentParameters(commandText),
            commandText,
            pendingDraft
          );
        }

        return {
          detectedIntent: 'unsupported_command',
          executed: false,
          actionType: 'unsupported',
          parameters: {
            originalCommand: commandText,
          },
          responseText:
            'That command is outside the supported in-app assistant scope. Try assignments, clients, schedule, invoices, notifications, dashboard, or navigation commands.',
          suggestedRoute: SUPPORTED_ROUTE_TARGETS.voice_assistant,
          suggestions: this._defaultSuggestions(),
          resultData: {
            supportedRoutes: Object.values(SUPPORTED_ROUTE_TARGETS),
          },
        };
    }
  }

  async _handleAssignmentIntent(
    userContext,
    extractedParameters = {},
    commandText = '',
    pendingDraft = null
  ) {
    const organizationId = userContext.organizationId;
    if (!organizationId) {
      return this._missingOrganizationResponse('assignment_manage');
    }

    const resolvedPendingDraft =
      pendingDraft || (await this._getPendingAssignmentDraft(userContext));

    const agentResult = await assignmentVoiceAgentService.processCommand({
      userContext,
      commandText,
      pendingDraft: resolvedPendingDraft,
    });
    if (agentResult) {
      return this._mapAgentAssignmentResult(agentResult, organizationId);
    }

    try {
      const extracted = {
        ...this._extractAssignmentParameters(commandText),
        ...this._mapToObject(extractedParameters),
      };
      const draft = this._initializeAssignmentDraft(resolvedPendingDraft);
      const actorResolution = await this._resolveAssignmentActors(
        organizationId,
        extracted,
        draft
      );

      if (actorResolution.employee) {
        draft.employee = actorResolution.employee;
      }
      if (actorResolution.client) {
        draft.client = actorResolution.client;
      }

      if (extracted.date) {
        draft.schedule.date = extracted.date;
      }
      if (extracted.startTime) {
        draft.schedule.startTime = extracted.startTime;
      }
      if (extracted.endTime) {
        draft.schedule.endTime = extracted.endTime;
      }
      if (typeof extracted.highIntensity === 'boolean') {
        draft.schedule.highIntensity = extracted.highIntensity;
      }
      if (extracted.breakValue) {
        draft.schedule.break = extracted.breakValue;
      }

      const supportResolution = await this._resolveSupportItem(extracted, draft.ndisItem);
      if (supportResolution.primary) {
        draft.ndisItem = supportResolution.primary;
      }

      const missingFields = this._getAssignmentMissingFields(draft);
      const routeTarget =
        draft.employee && draft.client
          ? SUPPORTED_ROUTE_TARGETS.assignment_schedule
          : SUPPORTED_ROUTE_TARGETS.assign_c2e;

      if (missingFields.length > 0) {
        return this._buildPendingAssignmentResponse({
          draft,
          missingFields,
          routeTarget,
          organizationId,
          actorResolution,
          supportResolution,
        });
      }

      const assignmentResult = await this._createAssignmentFromDraft(draft);
      const employeeName = draft.employee?.name || draft.employee?.email || 'employee';
      const clientName = draft.client?.name || draft.client?.email || 'client';
      const ndisLabel =
        draft.ndisItem?.itemNumber && draft.ndisItem?.itemName
          ? `${draft.ndisItem.itemNumber} - ${draft.ndisItem.itemName}`
          : draft.ndisItem?.itemNumber || draft.ndisItem?.itemName || 'selected NDIS item';

      return {
        detectedIntent: 'assignment_manage',
        executed: true,
        actionType: 'mutation',
        parameters: {
          employeeEmail: draft.employee.email,
          clientEmail: draft.client.email,
          date: draft.schedule.date,
          startTime: draft.schedule.startTime,
          endTime: draft.schedule.endTime,
          ndisItemNumber: draft.ndisItem?.itemNumber || null,
        },
        responseText:
          `Assigned ${employeeName} to ${clientName} on ${draft.schedule.date} from ${draft.schedule.startTime} to ${draft.schedule.endTime} with ${ndisLabel}.`,
        suggestedRoute: SUPPORTED_ROUTE_TARGETS.schedule_dashboard,
        suggestions: [
          'Open schedule',
          'Assign another client',
          'Show today schedule',
        ],
        resultData: {
          status: 'completed',
          assignmentId: assignmentResult.assignmentId?.toString?.() || null,
          backendMessage: assignmentResult.message || null,
          assignmentDraft: draft,
          navigationContext: this._buildAssignmentNavigationContext(
            draft,
            organizationId
          ),
        },
      };
    } catch (error) {
      return {
        detectedIntent: 'assignment_manage',
        executed: false,
        actionType: 'unsupported',
        parameters: {
          originalCommand: commandText,
        },
        responseText:
          'I could not complete that assignment in the app yet. Please review the assignment flow and try again.',
        suggestedRoute: SUPPORTED_ROUTE_TARGETS.assign_c2e,
        suggestions: [
          'Open assignment',
          'Assign Pratiksha to Harry tomorrow from 9 to 11',
          'With NDIS item 01_001_0107_1_1',
        ],
        resultData: {
          status: 'error',
          assignmentDraft: this._initializeAssignmentDraft(resolvedPendingDraft),
        },
        errorMessage: error.message || 'Assignment processing failed.',
      };
    }
  }

  _mapAgentAssignmentResult(agentResult, organizationId) {
    const draft = this._initializeAssignmentDraft(agentResult.assignmentDraft);
    const missingFields = Array.isArray(agentResult.missingFields)
      ? agentResult.missingFields
      : this._getAssignmentMissingFields(draft);
    const candidateNdisItems = Array.isArray(agentResult.candidates?.ndisItems)
      ? agentResult.candidates.ndisItems
      : [];

    if (agentResult.status === 'completed' && missingFields.length === 0) {
      const employeeName = draft.employee?.name || draft.employee?.email || 'employee';
      const clientName = draft.client?.name || draft.client?.email || 'client';
      const ndisLabel =
        draft.ndisItem?.itemNumber && draft.ndisItem?.itemName
          ? `${draft.ndisItem.itemNumber} - ${draft.ndisItem.itemName}`
          : draft.ndisItem?.itemNumber || draft.ndisItem?.itemName || 'selected NDIS item';

      return {
        detectedIntent: 'assignment_manage',
        executed: true,
        actionType: 'mutation',
        parameters: {
          employeeEmail: draft.employee?.email || null,
          clientEmail: draft.client?.email || null,
          date: draft.schedule?.date || null,
          startTime: draft.schedule?.startTime || null,
          endTime: draft.schedule?.endTime || null,
          ndisItemNumber: draft.ndisItem?.itemNumber || null,
        },
        responseText:
          String(agentResult.responseText || '').trim() ||
          `Assigned ${employeeName} to ${clientName} on ${draft.schedule.date} from ${draft.schedule.startTime} to ${draft.schedule.endTime} with ${ndisLabel}.`,
        suggestedRoute: SUPPORTED_ROUTE_TARGETS.schedule_dashboard,
        suggestions: Array.isArray(agentResult.suggestions)
          ? agentResult.suggestions
          : ['Open schedule', 'Assign another client', 'Show today schedule'],
        resultData: {
          status: 'completed',
          assignmentId: agentResult.assignmentId || null,
          backendMessage: agentResult.backendMessage || null,
          assignmentDraft: draft,
          navigationContext: this._buildAssignmentNavigationContext(
            draft,
            organizationId
          ),
          candidates: agentResult.candidates || null,
        },
        executionMode: agentResult.executionMode || 'agent',
        agentModel: agentResult.agentModel || null,
        toolCalls: agentResult.toolCalls || [],
      };
    }

    const routeTarget =
      draft.employee && draft.client
        ? SUPPORTED_ROUTE_TARGETS.assignment_schedule
        : SUPPORTED_ROUTE_TARGETS.assign_c2e;
    const shouldClarifyInAssistant = this._shouldClarifyInAssistant({
      missingFields,
      candidateNdisItems,
    });

    return {
      detectedIntent: 'assignment_manage',
      executed: false,
      actionType: shouldClarifyInAssistant ? 'clarify' : 'navigate',
      parameters: {
        missingFields,
        employeeEmail: draft.employee?.email || null,
        clientEmail: draft.client?.email || null,
      },
      responseText:
        String(agentResult.responseText || '').trim() ||
        `I still need ${this._humanizeMissingFields(missingFields)} to finish the assignment.`,
      suggestedRoute: shouldClarifyInAssistant
        ? SUPPORTED_ROUTE_TARGETS.voice_assistant
        : routeTarget,
      suggestions: Array.isArray(agentResult.suggestions)
        ? this._mergeAssignmentSuggestions(
            agentResult.suggestions,
            candidateNdisItems
          )
        : this._buildAssignmentSuggestions(missingFields, draft),
      resultData: {
        status: 'pending',
        missingFields,
        assignmentDraft: draft,
        candidates: agentResult.candidates || {
          employees: [],
          clients: [],
          ndisItems: [],
        },
        navigationContext: this._buildAssignmentNavigationContext(
          draft,
          organizationId
        ),
      },
      executionMode: agentResult.executionMode || 'agent',
      agentModel: agentResult.agentModel || null,
      toolCalls: agentResult.toolCalls || [],
    };
  }

  async _getPendingAssignmentDraft(userContext) {
    const recentCommands = await VoiceCommand.find({ userId: userContext.userId })
      .sort({ createdAt: -1 })
      .limit(6)
      .lean();

    for (const record of recentCommands) {
      if (record.detectedIntent !== 'assignment_manage') {
        continue;
      }

      const resultData = this._mapToObject(record.resultData) || {};
      const status = resultData.status || null;
      if (status === 'completed') {
        return null;
      }

      if (status !== 'pending') {
        continue;
      }

      const createdAt = record.createdAt ? new Date(record.createdAt).getTime() : 0;
      if (!createdAt || Date.now() - createdAt > 30 * 60 * 1000) {
        return null;
      }

      return this._initializeAssignmentDraft(resultData.assignmentDraft);
    }

    return null;
  }

  _initializeAssignmentDraft(draft = null) {
    const source = this._mapToObject(draft) || {};
    const schedule = this._mapToObject(source.schedule) || {};

    return {
      employee: source.employee
        ? {
            name: source.employee.name || '',
            email: source.employee.email || '',
          }
        : null,
      client: source.client
        ? {
            id: source.client.id || null,
            name: source.client.name || '',
            email: source.client.email || '',
          }
        : null,
      schedule: {
        date: schedule.date || null,
        startTime: schedule.startTime || null,
        endTime: schedule.endTime || null,
        break: schedule.break || 'No',
        highIntensity: !!schedule.highIntensity,
      },
      ndisItem: source.ndisItem ? { ...source.ndisItem } : null,
    };
  }

  async _resolveAssignmentActors(organizationId, extracted, existingDraft) {
    const result = {
      employee: existingDraft.employee,
      client: existingDraft.client,
      candidates: {
        employees: [],
        clients: [],
      },
    };

    if (extracted.explicitEmployeeName) {
      const employeeResolution = await this._resolveEmployeeCandidate(
        organizationId,
        extracted.explicitEmployeeName
      );
      if (employeeResolution.primary) {
        result.employee = employeeResolution.primary;
      }
      result.candidates.employees = employeeResolution.matches;
    }

    if (extracted.explicitClientName) {
      const clientResolution = await this._resolveClientCandidate(
        organizationId,
        extracted.explicitClientName
      );
      if (clientResolution.primary) {
        result.client = clientResolution.primary;
      }
      result.candidates.clients = clientResolution.matches;
    }

    if (
      !extracted.explicitEmployeeName &&
      !extracted.explicitClientName &&
      extracted.leftPersonName &&
      extracted.rightPersonName
    ) {
      const [
        leftEmployeeResolution,
        rightEmployeeResolution,
        leftClientResolution,
        rightClientResolution,
      ] = await Promise.all([
        this._resolveEmployeeCandidate(organizationId, extracted.leftPersonName),
        this._resolveEmployeeCandidate(organizationId, extracted.rightPersonName),
        this._resolveClientCandidate(organizationId, extracted.leftPersonName),
        this._resolveClientCandidate(organizationId, extracted.rightPersonName),
      ]);

      const leftToRightConfidence =
        (leftEmployeeResolution.confident ? 1 : 0) +
        (rightClientResolution.confident ? 1 : 0);
      const rightToLeftConfidence =
        (rightEmployeeResolution.confident ? 1 : 0) +
        (leftClientResolution.confident ? 1 : 0);

      if (leftToRightConfidence > rightToLeftConfidence && leftToRightConfidence > 0) {
        result.employee = leftEmployeeResolution.primary || result.employee;
        result.client = rightClientResolution.primary || result.client;
      } else if (
        rightToLeftConfidence > leftToRightConfidence &&
        rightToLeftConfidence > 0
      ) {
        result.employee = rightEmployeeResolution.primary || result.employee;
        result.client = leftClientResolution.primary || result.client;
      } else {
        if (!result.employee && leftEmployeeResolution.confident) {
          result.employee = leftEmployeeResolution.primary;
        } else if (!result.employee && rightEmployeeResolution.confident) {
          result.employee = rightEmployeeResolution.primary;
        }

        if (!result.client && leftClientResolution.confident) {
          result.client = leftClientResolution.primary;
        } else if (!result.client && rightClientResolution.confident) {
          result.client = rightClientResolution.primary;
        }
      }

      result.candidates.employees = this._dedupeCandidateList([
        ...leftEmployeeResolution.matches,
        ...rightEmployeeResolution.matches,
      ]);
      result.candidates.clients = this._dedupeCandidateList([
        ...leftClientResolution.matches,
        ...rightClientResolution.matches,
      ]);
    }

    return result;
  }

  async _resolveEmployeeCandidate(organizationId, rawName) {
    const query = this._cleanEntityName(rawName);
    if (!query) {
      return { primary: null, matches: [], confident: false };
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

    return this._rankEntityMatches({
      rawQuery: query,
      items: candidates.map((candidate) => ({
        id: candidate._id?.toString?.() || null,
        name: `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim(),
        email: candidate.email || '',
        firstName: candidate.firstName || '',
        lastName: candidate.lastName || '',
      })),
    });
  }

  async _resolveClientCandidate(organizationId, rawName) {
    const query = this._cleanEntityName(rawName);
    if (!query) {
      return { primary: null, matches: [], confident: false };
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

    return this._rankEntityMatches({
      rawQuery: query,
      items: candidates.map((candidate) => ({
        id: candidate._id?.toString?.() || null,
        name: `${candidate.clientFirstName || ''} ${candidate.clientLastName || ''}`.trim(),
        email: candidate.clientEmail || '',
        firstName: candidate.clientFirstName || '',
        lastName: candidate.clientLastName || '',
      })),
    });
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
    const confident =
      !!top &&
      (!next || top.score - next.score >= 15 || top.score >= 110);

    return {
      primary: confident && top ? matches[0] : null,
      matches,
      confident,
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

  async _resolveSupportItem(extracted, currentItem = null) {
    const query = extracted.ndisItemNumber || extracted.ndisQuery || null;
    if (!query) {
      return {
        primary: currentItem || null,
        matches: currentItem ? [currentItem] : [],
        confident: !!currentItem,
      };
    }

    const exactNumberVariants = extracted.ndisItemNumber
      ? this._getSupportItemNumberVariants(extracted.ndisItemNumber)
      : [];
    const exactNumber = exactNumberVariants[0] || null;

    let items;
    if (exactNumber) {
      items = await SupportItem.find({
        supportItemNumber: { $in: exactNumberVariants },
        isActive: true,
      })
        .limit(5)
        .lean();
    } else {
      const regex = new RegExp(this._escapeRegExp(query), 'i');
      items = await SupportItem.find({
        isActive: true,
        $or: [
          { supportItemNumber: regex },
          { supportItemName: regex },
          { description: regex },
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
      .filter((entry) => entry.score > 0 || exactNumber)
      .sort((a, b) => b.score - a.score);

    const matches = ranked.slice(0, 5).map((entry) => entry.item);
    const top = ranked[0];
    const next = ranked[1];
    const confident =
      !!top &&
      (!!exactNumber || !next || top.score - next.score >= 12 || top.score >= 110);

    return {
      primary: confident && top ? top.item : currentItem,
      matches,
      confident,
    };
  }

  _toVoiceNdisItem(item) {
    return {
      itemNumber: item.supportItemNumber,
      itemName: item.supportItemName || item.description || item.supportItemNumber,
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

    let score = 0;
    if (number === normalizedQuery) score = Math.max(score, 130);
    if (name === normalizedQuery) score = Math.max(score, 118);
    if (number.startsWith(normalizedQuery)) score = Math.max(score, 108);
    if (name.includes(normalizedQuery)) score = Math.max(score, 95);
    if (description.includes(normalizedQuery)) score = Math.max(score, 82);
    return score;
  }

  _getAssignmentMissingFields(draft) {
    const missing = [];
    if (!draft.employee?.email) missing.push('employee');
    if (!draft.client?.email) missing.push('client');
    if (!draft.schedule.date) missing.push('date');
    if (!draft.schedule.startTime || !draft.schedule.endTime) missing.push('timeRange');
    if (!draft.ndisItem?.itemNumber) missing.push('ndisItem');
    return missing;
  }

  _buildPendingAssignmentResponse({
    draft,
    missingFields,
    routeTarget,
    organizationId,
    actorResolution,
    supportResolution,
  }) {
    const completedParts = [];
    if (draft.employee?.name) {
      completedParts.push(`employee ${draft.employee.name}`);
    }
    if (draft.client?.name) {
      completedParts.push(`client ${draft.client.name}`);
    }
    if (draft.schedule.date) {
      completedParts.push(`date ${draft.schedule.date}`);
    }
    if (draft.schedule.startTime && draft.schedule.endTime) {
      completedParts.push(
        `time ${draft.schedule.startTime}-${draft.schedule.endTime}`
      );
    }
    if (draft.ndisItem?.itemNumber) {
      completedParts.push(
        `NDIS item ${draft.ndisItem.itemNumber}${
          draft.ndisItem.itemName ? ` (${draft.ndisItem.itemName})` : ''
        }`
      );
    }

    const responseParts = [];
    if (completedParts.length > 0) {
      responseParts.push(`I have ${completedParts.join(', ')}.`);
    }
    responseParts.push(
      `I still need ${this._humanizeMissingFields(missingFields)} to finish the assignment.`
    );
    const candidateNdisItems = Array.isArray(supportResolution?.matches)
      ? supportResolution.matches
      : [];
    const shouldClarifyInAssistant = this._shouldClarifyInAssistant({
      missingFields,
      candidateNdisItems,
    });

    return {
      detectedIntent: 'assignment_manage',
      executed: false,
      actionType: shouldClarifyInAssistant ? 'clarify' : 'navigate',
      parameters: {
        missingFields,
        employeeEmail: draft.employee?.email || null,
        clientEmail: draft.client?.email || null,
      },
      responseText: responseParts.join(' '),
      suggestedRoute: shouldClarifyInAssistant
        ? SUPPORTED_ROUTE_TARGETS.voice_assistant
        : routeTarget,
      suggestions: shouldClarifyInAssistant
        ? this._mergeAssignmentSuggestions([], candidateNdisItems)
        : this._buildAssignmentSuggestions(missingFields, draft),
      resultData: {
        status: 'pending',
        missingFields,
        assignmentDraft: draft,
        candidates: {
          employees: actorResolution?.candidates?.employees || [],
          clients: actorResolution?.candidates?.clients || [],
          ndisItems: candidateNdisItems,
        },
        navigationContext: this._buildAssignmentNavigationContext(
          draft,
          organizationId || null
        ),
      },
    };
  }

  _buildAssignmentSuggestions(missingFields, draft) {
    const suggestions = [];

    if (missingFields.includes('employee') || missingFields.includes('client')) {
      suggestions.push('Open assignment');
    }
    if (missingFields.includes('date') || missingFields.includes('timeRange')) {
      suggestions.push('Tomorrow from 9:00 to 11:00');
    }
    if (missingFields.includes('ndisItem')) {
      suggestions.push('With NDIS item 01_001_0107_1_1');
    }
    if (draft.employee?.name && draft.client?.name) {
      suggestions.push(
        `Assign ${draft.employee.name} to ${draft.client.name}`
      );
    }

    return suggestions.slice(0, 4);
  }

  _shouldClarifyInAssistant({ missingFields = [], candidateNdisItems = [] }) {
    return (
      missingFields.length === 1 &&
      missingFields[0] === 'ndisItem' &&
      Array.isArray(candidateNdisItems) &&
      candidateNdisItems.length > 1
    );
  }

  _mergeAssignmentSuggestions(existingSuggestions = [], candidateNdisItems = []) {
    const suggestions = Array.isArray(existingSuggestions)
      ? existingSuggestions.map((item) => String(item))
      : [];

    for (const item of candidateNdisItems) {
      const itemNumber = item?.itemNumber?.toString().trim() || '';
      const itemName = item?.itemName?.toString().trim() || '';
      if (!itemNumber) {
        continue;
      }

      const suggestion = itemName.isNotEmpty
        ? `Use ${itemNumber} ${itemName}`
        : `Use NDIS item ${itemNumber}`;
      if (!suggestions.includes(suggestion)) {
        suggestions.push(suggestion);
      }
    }

    return suggestions.slice(0, 5);
  }

  _buildAssignmentNavigationContext(draft, organizationId) {
    const context = {
      organizationId: organizationId || null,
    };

    if (draft.employee?.email) {
      context.userEmail = draft.employee.email;
      context.userName = draft.employee.name || '';
    }
    if (draft.client?.email) {
      context.clientEmail = draft.client.email;
      context.clientName = draft.client.name || '';
    }
    if (draft.client?.id) {
      context.clientId = draft.client.id;
    }
    if (draft.schedule?.date) {
      context.date = draft.schedule.date;
    }
    if (draft.schedule?.startTime) {
      context.startTime = draft.schedule.startTime;
    }
    if (draft.schedule?.endTime) {
      context.endTime = draft.schedule.endTime;
    }
    if (draft.schedule?.break) {
      context.breakValue = draft.schedule.break;
    }
    if (typeof draft.schedule?.highIntensity === 'boolean') {
      context.highIntensity = draft.schedule.highIntensity;
    }
    if (draft.ndisItem) {
      context.ndisItem = draft.ndisItem;
    }

    return context;
  }

  _humanizeMissingFields(fields) {
    const labels = fields.map((field) => {
      if (field === 'timeRange') return 'a time range';
      if (field === 'ndisItem') return 'an NDIS item';
      return `a ${field}`;
    });

    if (labels.length <= 1) {
      return labels[0] || 'more assignment details';
    }

    return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  }

  async _createAssignmentFromDraft(draft) {
    const scheduleEntry = {
      date: draft.schedule.date,
      startTime: draft.schedule.startTime,
      endTime: draft.schedule.endTime,
      break: draft.schedule.break || 'No',
      highIntensity: !!draft.schedule.highIntensity,
      ndisItem: draft.ndisItem,
    };

    return clientService.assignClientToUser({
      userEmail: draft.employee.email,
      clientEmail: draft.client.email,
      dateList: [scheduleEntry.date],
      startTimeList: [scheduleEntry.startTime],
      endTimeList: [scheduleEntry.endTime],
      breakList: [scheduleEntry.break],
      ndisItem: draft.ndisItem,
      highIntensityList: [scheduleEntry.highIntensity],
      scheduleWithNdisItems: [scheduleEntry],
    });
  }

  async _getDashboardSummary(userContext) {
    const organizationId = userContext.organizationId;
    if (!organizationId) {
      return this._missingOrganizationResponse('dashboard_summary');
    }

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const orgName = await this._getOrganizationName(organizationId);

    const [appointmentsToday, activeClients, invoiceCounts, unreadNotifications] =
      await Promise.all([
        ClientAssignment.countDocuments({
          organizationId,
          isActive: true,
          'schedule.date': todayStr,
        }),
        Client.countDocuments({
          organizationId,
          isActive: true,
          deletedAt: null,
        }),
        Invoice.aggregate([
          {
            $match: {
              organizationId,
              'deletion.isDeleted': { $ne: true },
            },
          },
          {
            $group: {
              _id: '$payment.status',
              count: { $sum: 1 },
            },
          },
        ]),
        NotificationHistory.countDocuments({
          userId: userContext.userId,
          status: { $ne: 'read' },
        }),
      ]);

    const invoiceSummary = invoiceCounts.reduce((acc, item) => {
      const key = item._id || 'unknown';
      acc[key] = item.count;
      return acc;
    }, {});

    return {
      detectedIntent: 'dashboard_summary',
      executed: true,
      actionType: 'query',
      parameters: {},
      responseText:
        `Today in ${orgName || 'your organization'}: ${appointmentsToday} scheduled appointments, ${activeClients} active clients, and ${unreadNotifications} unread notifications.`,
      suggestedRoute: SUPPORTED_ROUTE_TARGETS.admin_dashboard,
      suggestions: [
        'Open schedule dashboard',
        'Show overdue invoices',
        'Show unread notifications',
      ],
      resultData: {
        organizationName: orgName,
        appointmentsToday,
        activeClients,
        unreadNotifications,
        invoiceSummary,
      },
    };
  }

  async _getClientLookup(userContext, searchTerm) {
    const organizationId = userContext.organizationId;
    if (!organizationId) {
      return this._missingOrganizationResponse('client_lookup');
    }

    const filters = {
      organizationId,
      isActive: true,
      deletedAt: null,
    };

    if (searchTerm) {
      const regex = new RegExp(this._escapeRegExp(searchTerm), 'i');
      filters.$or = [
        { clientFirstName: regex },
        { clientLastName: regex },
        { clientEmail: regex },
        { clientPhone: regex },
      ];
    }

    const clients = await Client.find(filters)
      .sort({ clientLastName: 1, clientFirstName: 1 })
      .limit(5)
      .lean();

    const summaries = clients.map((client) => ({
      id: client._id.toString(),
      name: `${client.clientFirstName} ${client.clientLastName}`.trim(),
      email: client.clientEmail,
      phone: client.clientPhone,
      city: client.clientCity,
      activated: !!client.isActivated,
    }));

    return {
      detectedIntent: 'client_lookup',
      executed: true,
      actionType: 'query',
      parameters: searchTerm ? { searchTerm } : {},
      responseText:
        summaries.length > 0
          ? `I found ${summaries.length} client${summaries.length == 1 ? '' : 's'}${searchTerm ? ` matching "${searchTerm}"` : ''}.`
          : `I could not find any active clients${searchTerm ? ` matching "${searchTerm}"` : ''}.`,
      suggestedRoute: SUPPORTED_ROUTE_TARGETS.client_list,
      suggestions: [
        'Open clients',
        'Show today schedule',
        'Show invoice summary',
      ],
      resultData: {
        searchTerm,
        totalMatches: summaries.length,
        clients: summaries,
      },
    };
  }

  async _getScheduleOverview(userContext, range = 'upcoming') {
    const organizationId = userContext.organizationId;
    if (!organizationId) {
      return this._missingOrganizationResponse('schedule_overview');
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + (range === 'today' ? 0 : 7));
    const endDateStr = endDate.toISOString().split('T')[0];

    const assignments = await ClientAssignment.find({
      organizationId,
      isActive: true,
      'schedule.date': {
        $gte: todayStr,
        $lte: endDateStr,
      },
    })
      .populate('clientId', 'clientFirstName clientLastName clientEmail')
      .lean();

    const upcoming = assignments
      .flatMap((assignment) =>
        (assignment.schedule || [])
          .filter((item) => item.date >= todayStr && item.date <= endDateStr)
          .map((item) => ({
            date: item.date,
            startTime: item.startTime,
            endTime: item.endTime,
            employeeEmail: assignment.userEmail,
            clientEmail: assignment.clientEmail,
            clientName: this._resolveClientName(
              assignment.clientId,
              assignment.clientEmail
            ),
          }))
      )
      .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`))
      .slice(0, 5);

    return {
      detectedIntent: 'schedule_overview',
      executed: true,
      actionType: 'query',
      parameters: { range },
      responseText:
        upcoming.length > 0
          ? `I found ${upcoming.length} ${range === 'today' ? 'schedule item' : 'upcoming shift'}${upcoming.length == 1 ? '' : 's'} in the app.`
          : `There are no ${range === 'today' ? 'schedule items for today' : 'upcoming shifts in the next 7 days'}.`,
      suggestedRoute: SUPPORTED_ROUTE_TARGETS.schedule_dashboard,
      suggestions: [
        'Open schedule',
        'Show dashboard summary',
        'Show clients',
      ],
      resultData: {
        range,
        totalItems: upcoming.length,
        items: upcoming,
      },
    };
  }

  async _getInvoiceSummary(userContext, filter = 'all') {
    const organizationId = userContext.organizationId;
    if (!organizationId) {
      return this._missingOrganizationResponse('invoice_summary');
    }

    const now = new Date();
    const query = {
      organizationId,
      'deletion.isDeleted': { $ne: true },
    };

    if (filter === 'overdue') {
      query.$or = [
        { 'payment.status': 'overdue' },
        {
          'financialSummary.dueDate': { $lt: now },
          'payment.status': { $nin: ['paid', 'cancelled', 'refunded'] },
        },
      ];
    } else if (filter === 'paid') {
      query['payment.status'] = 'paid';
    } else if (filter === 'pending') {
      query['payment.status'] = { $in: ['pending', 'partial'] };
    } else if (filter === 'draft') {
      query['workflow.status'] = 'draft';
    }

    const [invoices, aggregated] = await Promise.all([
      Invoice.find(query)
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      Invoice.aggregate([
        {
          $match: {
            organizationId,
            'deletion.isDeleted': { $ne: true },
          },
        },
        {
          $group: {
            _id: '$payment.status',
            count: { $sum: 1 },
            totalAmount: {
              $sum: {
                $ifNull: ['$financialSummary.totalAmount', 0],
              },
            },
            balanceDue: {
              $sum: {
                $ifNull: ['$payment.balanceDue', 0],
              },
            },
          },
        },
      ]),
    ]);

    const summaryByStatus = aggregated.reduce((acc, item) => {
      acc[item._id || 'unknown'] = {
        count: item.count,
        totalAmount: item.totalAmount,
        balanceDue: item.balanceDue,
      };
      return acc;
    }, {});

    const invoiceItems = invoices.map((invoice) => ({
      id: invoice._id.toString(),
      invoiceNumber: invoice.invoiceNumber,
      clientName: invoice.clientName || invoice.clientEmail || 'Unknown client',
      paymentStatus: invoice.payment?.status || 'unknown',
      workflowStatus: invoice.workflow?.status || 'unknown',
      totalAmount: invoice.financialSummary?.totalAmount || 0,
      balanceDue: invoice.payment?.balanceDue || 0,
      dueDate: invoice.financialSummary?.dueDate || null,
    }));

    return {
      detectedIntent: 'invoice_summary',
      executed: true,
      actionType: 'query',
      parameters: { filter },
      responseText:
        invoiceItems.length > 0
          ? `I found ${invoiceItems.length} ${filter === 'all' ? 'recent' : filter} invoice${invoiceItems.length == 1 ? '' : 's'} in the app.`
          : `There are no ${filter === 'all' ? 'recent' : filter} invoices to show.`,
      suggestedRoute: SUPPORTED_ROUTE_TARGETS.invoice_list,
      suggestions: [
        'Open invoices',
        'Show dashboard summary',
        'Show overdue invoices',
      ],
      resultData: {
        filter,
        invoices: invoiceItems,
        summaryByStatus,
      },
    };
  }

  async _getNotificationSummary(userContext) {
    const notifications = await NotificationHistory.find({
      userId: userContext.userId,
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const unreadCount = await NotificationHistory.countDocuments({
      userId: userContext.userId,
      status: { $ne: 'read' },
    });

    const items = notifications.map((item) => ({
      id: item._id.toString(),
      title: item.title,
      body: item.body,
      type: item.type,
      status: item.status,
      createdAt: item.createdAt,
    }));

    return {
      detectedIntent: 'notification_summary',
      executed: true,
      actionType: 'query',
      parameters: {},
      responseText:
        unreadCount > 0
          ? `You have ${unreadCount} unread notification${unreadCount == 1 ? '' : 's'} in the app.`
          : 'You have no unread notifications in the app.',
      suggestedRoute: SUPPORTED_ROUTE_TARGETS.notification_center,
      suggestions: [
        'Open notifications',
        'Mark notifications as read',
        'Show dashboard summary',
      ],
      resultData: {
        unreadCount,
        notifications: items,
      },
    };
  }

  async _markNotificationsRead(userContext) {
    const now = new Date();
    const result = await NotificationHistory.updateMany(
      {
        userId: userContext.userId,
        status: { $ne: 'read' },
      },
      {
        $set: {
          status: 'read',
          readAt: now,
        },
      }
    );

    const modifiedCount = result.modifiedCount ?? result.nModified ?? 0;

    return {
      detectedIntent: 'mark_notifications_read',
      executed: true,
      actionType: 'mutation',
      parameters: {},
      responseText:
        modifiedCount > 0
          ? `Marked ${modifiedCount} notification${modifiedCount == 1 ? '' : 's'} as read.`
          : 'There were no unread notifications to mark as read.',
      suggestedRoute: SUPPORTED_ROUTE_TARGETS.notification_center,
      suggestions: [
        'Open notifications',
        'Show unread notifications',
        'Show today summary',
      ],
      resultData: {
        markedCount: modifiedCount,
      },
    };
  }

  _buildHelpResponse() {
    return {
      detectedIntent: 'capabilities_help',
      executed: true,
      actionType: 'help',
      parameters: {},
      responseText:
        'I can help with this app only: assignments, dashboard summary, clients, schedule, invoices, notifications, and opening those screens.',
      suggestedRoute: SUPPORTED_ROUTE_TARGETS.voice_assistant,
      suggestions: this._defaultSuggestions(),
      resultData: {
        capabilities: [
          'Assign an employee to a client and collect missing schedule or NDIS details',
          'Show dashboard summary',
          'Find a client by name or email',
          'Show today or upcoming schedule',
          'Show invoice summary, overdue, paid, or pending invoices',
          'Show unread notifications',
          'Mark notifications as read',
          'Open assignment, clients, invoices, schedule, notifications, or dashboard',
        ],
      },
    };
  }

  _buildNavigationResponse(intent, targetRoute) {
    const responseByRoute = {
      [SUPPORTED_ROUTE_TARGETS.admin_dashboard]: 'Opening the admin dashboard.',
      [SUPPORTED_ROUTE_TARGETS.client_list]: 'Opening the client list.',
      [SUPPORTED_ROUTE_TARGETS.invoice_list]: 'Opening invoices.',
      [SUPPORTED_ROUTE_TARGETS.schedule_dashboard]: 'Opening the schedule dashboard.',
      [SUPPORTED_ROUTE_TARGETS.notification_center]: 'Opening notifications.',
      [SUPPORTED_ROUTE_TARGETS.assign_c2e]: 'Opening the assignment flow.',
      [SUPPORTED_ROUTE_TARGETS.assignment_schedule]:
        'Opening the assignment schedule screen.',
      [SUPPORTED_ROUTE_TARGETS.voice_assistant]: 'Staying in the voice assistant.',
    };

    return {
      detectedIntent: intent,
      executed: true,
      actionType: 'navigate',
      parameters: { targetRoute },
      responseText:
        responseByRoute[targetRoute] || 'Opening the requested screen.',
      suggestedRoute: targetRoute,
      suggestions: this._defaultSuggestions(),
      resultData: {
        targetRoute,
      },
    };
  }

  _missingOrganizationResponse(detectedIntent) {
    return {
      detectedIntent,
      executed: false,
      actionType: 'unsupported',
      parameters: {},
      responseText:
        'This command needs an organization context from the app. Please log in again or switch to an organization first.',
      suggestedRoute: SUPPORTED_ROUTE_TARGETS.admin_dashboard,
      suggestions: ['Open dashboard', 'Show notifications'],
      resultData: {
        reason: 'missing_organization_context',
      },
      errorMessage: 'Organization context missing.',
    };
  }

  _looksLikeAssignmentCommand(normalizedCommand) {
    return /\b(assign|allocate|reassign|assignment)\b/.test(normalizedCommand);
  }

  _extractNavigationTarget(normalizedCommand) {
    const navigationWords = ['open', 'go to', 'show', 'take me to', 'navigate to'];
    const mentionsNavigation = navigationWords.some((word) =>
      normalizedCommand.includes(word)
    );
    if (!mentionsNavigation) {
      return null;
    }

    if (this._containsAny(normalizedCommand, ['assignment', 'assign client'])) {
      return SUPPORTED_ROUTE_TARGETS.assign_c2e;
    }
    if (this._containsAny(normalizedCommand, ['client list', 'clients'])) {
      return SUPPORTED_ROUTE_TARGETS.client_list;
    }
    if (this._containsAny(normalizedCommand, ['invoice', 'invoices'])) {
      return SUPPORTED_ROUTE_TARGETS.invoice_list;
    }
    if (this._containsAny(normalizedCommand, ['schedule', 'shifts', 'appointments'])) {
      return SUPPORTED_ROUTE_TARGETS.schedule_dashboard;
    }
    if (this._containsAny(normalizedCommand, ['notification', 'notifications', 'alerts'])) {
      return SUPPORTED_ROUTE_TARGETS.notification_center;
    }
    if (this._containsAny(normalizedCommand, ['dashboard', 'home'])) {
      return SUPPORTED_ROUTE_TARGETS.admin_dashboard;
    }

    return null;
  }

  _extractAssignmentParameters(commandText) {
    const raw = String(commandText || '').trim();
    const normalized = raw.toLowerCase().replace(/\s+/g, ' ').trim();
    const pair = this._extractAssignmentPair(raw);
    const dateInfo = this._extractDateInfo(raw);
    const timeInfo = this._extractTimeRange(raw);
    const ndisInfo = this._extractNdisInfo(raw);

    return {
      explicitEmployeeName: this._extractLabeledName(raw, [
        'employee',
        'staff',
        'worker',
        'carer',
      ]),
      explicitClientName: this._extractLabeledName(raw, [
        'client',
        'participant',
      ]),
      leftPersonName: pair?.left || null,
      rightPersonName: pair?.right || null,
      date: dateInfo?.date || null,
      startTime: timeInfo?.startTime || null,
      endTime: timeInfo?.endTime || null,
      ndisQuery: ndisInfo?.query || null,
      ndisItemNumber: ndisInfo?.itemNumber || null,
      highIntensity: normalized.includes('high intensity') ? true : null,
      breakValue: normalized.includes('with break') ? 'Yes' : null,
    };
  }

  _extractLabeledName(commandText, labels) {
    for (const label of labels) {
      const regex = new RegExp(
        `\\b${this._escapeRegExp(label)}\\s+(.+?)(?=\\s+(?:to|on|today|tomorrow|next|from|with|using)\\b|$)`,
        'i'
      );
      const match = commandText.match(regex);
      if (match?.[1]) {
        return this._cleanEntityName(match[1]);
      }
    }

    return null;
  }

  _extractAssignmentPair(commandText) {
    const match = commandText.match(
      /\bassign\b\s+(.+?)\s+\bto\b\s+(.+?)(?=\s+(?:on|today|tomorrow|day after tomorrow|next|from|with|using)\b|$)/i
    );

    if (!match?.[1] || !match?.[2]) {
      return null;
    }

    return {
      left: this._cleanEntityName(match[1]),
      right: this._cleanEntityName(match[2]),
    };
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
          date: this._toIsoDate(this._nextWeekday(baseDate, index, normalized.includes(`next ${weekday}`))),
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

  _extractNdisInfo(commandText) {
    const itemNumberMatch = commandText.match(
      /\b(\d{2}_\d{3}_\d{4}_[a-z0-9]+_[a-z0-9]+(?:_t)?)\b/i
    );
    if (itemNumberMatch?.[1]) {
      return {
        itemNumber: itemNumberMatch[1].toUpperCase(),
        query: itemNumberMatch[1],
      };
    }

    const labelMatch = commandText.match(
      /\b(?:with|using)?\s*(?:ndis|support)\s+item\s+(.+?)(?=\s+(?:on|today|tomorrow|next|from)\b|$)/i
    );
    if (labelMatch?.[1]) {
      const query = labelMatch[1].trim();
      return {
        itemNumber: null,
        query,
      };
    }

    return null;
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

  _extractInvoiceFilter(normalizedCommand) {
    if (normalizedCommand.includes('overdue')) return 'overdue';
    if (normalizedCommand.includes('paid')) return 'paid';
    if (
      normalizedCommand.includes('pending') ||
      normalizedCommand.includes('outstanding') ||
      normalizedCommand.includes('unpaid')
    ) {
      return 'pending';
    }
    if (normalizedCommand.includes('draft')) return 'draft';
    return 'all';
  }

  _extractClientSearchTerm(commandText) {
    const raw = String(commandText || '').trim();
    const match = raw.match(/client(?:s)?(?: named| called)?\s+(.+)$/i);
    if (match && match[1]) {
      return match[1].trim();
    }

    const cleaned = raw
      .replace(/\b(find|search|lookup|look up|show|open)\b/gi, '')
      .replace(/\bclient(?:s)?\b/gi, '')
      .trim();

    return cleaned || null;
  }

  _containsAny(text, fragments) {
    return fragments.some((fragment) => text.includes(fragment));
  }

  _defaultSuggestions() {
    return [
      'Assign Pratiksha to Harry',
      'Show today summary',
      'Find client John',
      'Show overdue invoices',
      'Open schedule',
    ];
  }

  _resolveClientName(clientRef, fallbackEmail) {
    if (clientRef && typeof clientRef === 'object') {
      const firstName = clientRef.clientFirstName || '';
      const lastName = clientRef.clientLastName || '';
      const fullName = `${firstName} ${lastName}`.trim();
      if (fullName) {
        return fullName;
      }
      if (clientRef.clientEmail) {
        return clientRef.clientEmail;
      }
    }

    return fallbackEmail || 'Unknown client';
  }

  async _getOrganizationName(organizationId) {
    if (!organizationId) return null;

    const organization = await Organization.findById(organizationId)
      .select('organizationName businessName name')
      .lean()
      .catch(() => null);

    return (
      organization?.organizationName ||
      organization?.businessName ||
      organization?.name ||
      null
    );
  }

  _escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  _normalizeSearchText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9@._\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _dedupeCandidateList(items) {
    const seen = new Set();
    const results = [];

    for (const item of items) {
      const key = `${item.id || ''}:${item.email || ''}:${item.name || ''}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      results.push(item);
    }

    return results.slice(0, 5);
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

  _formatVoiceCommand(record) {
    const parameters =
      this._mapToObject(record.parameters) ||
      this._mapToObject(record.nlpEntities?.parameters) ||
      {};
    const resultData = this._mapToObject(record.resultData) || record.resultData || null;
    const suggestions = Array.isArray(record.suggestions) ? record.suggestions : [];

    return {
      id: record.id || record._id?.toString?.() || null,
      userId: record.userId?.toString?.() || record.userId || '',
      organizationId:
        record.organizationId?.toString?.() || record.organizationId || null,
      commandText: record.commandText || '',
      detectedIntent:
        record.detectedIntent || record.nlpEntities?.intent || 'unknown',
      parameters,
      confidence:
        typeof record.confidence === 'number'
          ? record.confidence
          : typeof record.nlpEntities?.confidence === 'number'
            ? record.nlpEntities.confidence
            : 0,
      executed:
        typeof record.executed === 'boolean'
          ? record.executed
          : !!record.success,
      createdAt: record.createdAt
        ? new Date(record.createdAt).toISOString()
        : new Date().toISOString(),
      responseText: record.responseText || '',
      actionType: record.actionType || 'unsupported',
      suggestedRoute: record.suggestedRoute || null,
      suggestions,
      resultData,
      executionMode: record.executionMode || 'fallback_rule',
      agentModel: record.agentModel || null,
      toolCalls: Array.isArray(record.toolCalls) ? record.toolCalls : [],
      source: record.source || (record.audioData ? 'voice' : 'text'),
      language: record.language || 'en-US',
      errorMessage: record.errorMessage || null,
    };
  }

  _mapToObject(value) {
    if (!value) return null;
    if (value instanceof Map) {
      return Object.fromEntries(value.entries());
    }
    if (typeof value.toObject === 'function') {
      return value.toObject();
    }
    return value;
  }
}

module.exports = new VoiceService();
