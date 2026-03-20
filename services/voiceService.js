const Client = require('../models/Client');
const ClientAssignment = require('../models/ClientAssignment');
const { Invoice } = require('../models/Invoice');
const NotificationHistory = require('../models/NotificationHistory');
const Organization = require('../models/Organization');
const VoiceCommand = require('../models/VoiceCommand');

const SUPPORTED_ROUTE_TARGETS = {
  admin_dashboard: 'admin_dashboard',
  client_list: 'client_list',
  invoice_list: 'invoice_list',
  schedule_dashboard: 'schedule_dashboard',
  notification_center: 'notification_center',
  voice_assistant: 'voice_assistant',
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

    const commandRecord = await VoiceCommand.create({
      userId: normalizedUser.userId,
      organizationId: normalizedUser.organizationId,
      commandText: safeCommandText,
      source: 'text',
      language,
      detectedIntent: execution.detectedIntent,
      parameters: execution.parameters,
      confidence: parsedIntent.confidence,
      executed: execution.executed,
      actionType: execution.actionType,
      responseText: execution.responseText,
      suggestedRoute: execution.suggestedRoute,
      suggestions: execution.suggestions,
      resultData: execution.resultData,
      nlpEntities: {
        intent: execution.detectedIntent,
        parameters: execution.parameters,
        confidence: parsedIntent.confidence,
      },
      success: execution.executed,
      processingTime: Date.now() - startedAt,
      errorMessage: execution.errorMessage || null,
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

    if (this._containsAny(normalized, ['help', 'what can you do', 'capabilities', 'supported commands'])) {
      return {
        detectedIntent: 'capabilities_help',
        parameters: {},
        confidence: 0.99,
      };
    }

    if (this._containsAny(normalized, ['mark all notifications as read', 'mark notifications as read', 'clear my notifications'])) {
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

    if (this._containsAny(normalized, ['schedule', 'shift', 'shifts', 'appointment', 'appointments'])) {
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
          responseText: 'Say or type a command related to this app, like "show today summary" or "open invoices".',
          suggestedRoute: SUPPORTED_ROUTE_TARGETS.voice_assistant,
          suggestions: this._defaultSuggestions(),
          resultData: null,
        };
      default:
        if (detectedIntent.startsWith('navigate_')) {
          return this._buildNavigationResponse(detectedIntent, parameters.targetRoute);
        }

        return {
          detectedIntent: 'unsupported_command',
          executed: false,
          actionType: 'unsupported',
          parameters: {
            originalCommand: commandText,
          },
          responseText:
              'That command is outside the supported in-app assistant scope. Try clients, schedule, invoices, notifications, dashboard, or navigation commands.',
          suggestedRoute: SUPPORTED_ROUTE_TARGETS.voice_assistant,
          suggestions: this._defaultSuggestions(),
          resultData: {
            supportedRoutes: Object.values(SUPPORTED_ROUTE_TARGETS),
          },
        };
    }
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

    const invoiceSummary = invoiceCounts.reduce(
      (acc, item) => {
        const key = item._id || 'unknown';
        acc[key] = item.count;
        return acc;
      },
      {}
    );

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
          .filter(
            (item) =>
              item.date >= todayStr &&
              item.date <= endDateStr
          )
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

    const summaryByStatus = aggregated.reduce(
      (acc, item) => {
        acc[item._id || 'unknown'] = {
          count: item.count,
          totalAmount: item.totalAmount,
          balanceDue: item.balanceDue,
        };
        return acc;
      },
      {}
    );

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

    const modifiedCount =
      result.modifiedCount ??
      result.nModified ??
      0;

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
          'I can help with this app only: dashboard summary, clients, schedule, invoices, notifications, and opening those screens.',
      suggestedRoute: SUPPORTED_ROUTE_TARGETS.voice_assistant,
      suggestions: this._defaultSuggestions(),
      resultData: {
        capabilities: [
          'Show dashboard summary',
          'Find a client by name or email',
          'Show today or upcoming schedule',
          'Show invoice summary, overdue, paid, or pending invoices',
          'Show unread notifications',
          'Mark notifications as read',
          'Open clients, invoices, schedule, notifications, or dashboard',
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
      suggestions: [
        'Open dashboard',
        'Show notifications',
      ],
      resultData: {
        reason: 'missing_organization_context',
      },
      errorMessage: 'Organization context missing.',
    };
  }

  _extractNavigationTarget(normalizedCommand) {
    const navigationWords = ['open', 'go to', 'show', 'take me to', 'navigate to'];
    const mentionsNavigation = navigationWords.some((word) => normalizedCommand.includes(word));
    if (!mentionsNavigation) {
      return null;
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

  _extractInvoiceFilter(normalizedCommand) {
    if (normalizedCommand.includes('overdue')) return 'overdue';
    if (normalizedCommand.includes('paid')) return 'paid';
    if (normalizedCommand.includes('pending') || normalizedCommand.includes('outstanding') || normalizedCommand.includes('unpaid')) {
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
      'Show today summary',
      'Find client John',
      'Show overdue invoices',
      'Show unread notifications',
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

  _formatVoiceCommand(record) {
    const parameters =
      this._mapToObject(record.parameters) ||
      this._mapToObject(record.nlpEntities?.parameters) ||
      {};
    const resultData = this._mapToObject(record.resultData) || record.resultData || null;
    const suggestions = Array.isArray(record.suggestions)
      ? record.suggestions
      : [];

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
