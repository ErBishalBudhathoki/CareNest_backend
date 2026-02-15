const axios = require('axios');
const logger = require('../utils/logger');

// Integration configurations
const INTEGRATIONS = {
  xero: {
    name: 'Xero',
    authUrl: 'https://login.xero.com/identity/connect/authorize',
    tokenUrl: 'https://identity.xero.com/connect/token',
    apiUrl: 'https://api.xero.com/api.xro/2.0',
    scopes: ['accounting.transactions', 'accounting.contacts'],
  },
  myob: {
    name: 'MYOB',
    authUrl: 'https://secure.myob.com/oauth2/account/authorize',
    tokenUrl: 'https://secure.myob.com/oauth2/v1/authorize',
    apiUrl: 'https://api.myob.com/accountright',
    scopes: ['CompanyFile'],
  },
  quickbooks: {
    name: 'QuickBooks',
    authUrl: 'https://appcenter.intuit.com/connect/oauth2',
    tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    apiUrl: 'https://quickbooks.api.intuit.com/v3',
    scopes: ['com.intuit.quickbooks.accounting'],
  },
  googleCalendar: {
    name: 'Google Calendar',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    apiUrl: 'https://www.googleapis.com/calendar/v3',
    scopes: ['https://www.googleapis.com/auth/calendar'],
  },
  outlookCalendar: {
    name: 'Outlook Calendar',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    apiUrl: 'https://graph.microsoft.com/v1.0',
    scopes: ['Calendars.ReadWrite'],
  },
  slack: {
    name: 'Slack',
    authUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    apiUrl: 'https://slack.com/api',
    scopes: ['chat:write', 'channels:read'],
  },
  teams: {
    name: 'Microsoft Teams',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    apiUrl: 'https://graph.microsoft.com/v1.0',
    scopes: ['ChannelMessage.Send', 'Team.ReadBasic.All'],
  },
  stripe: {
    name: 'Stripe',
    authUrl: 'https://connect.stripe.com/oauth/authorize',
    tokenUrl: 'https://connect.stripe.com/oauth/token',
    apiUrl: 'https://api.stripe.com/v1',
    scopes: ['read_write'],
  },
};

/**
 * Get OAuth authorization URL
 */
exports.getAuthorizationUrl = async (integrationType, organizationId, redirectUri) => {
  const integration = INTEGRATIONS[integrationType];
  if (!integration) {
    throw new Error(`Unknown integration type: ${integrationType}`);
  }

  // Get organization to check for custom credentials
  const Organization = require('../models/Organization');
  const org = await Organization.findById(organizationId);
  
  let clientId;
  if (org?.integrations?.[integrationType]?.useCustomCredentials && 
      org.integrations[integrationType].customClientId) {
    // Use organization's custom credentials
    clientId = org.integrations[integrationType].customClientId;
    logger.info(`Using custom OAuth credentials for ${integrationType} (org: ${organizationId})`);
  } else {
    // Use global credentials from .env
    clientId = process.env[`${integrationType.toUpperCase()}_CLIENT_ID`];
    if (!clientId) {
      throw new Error(`Client ID not configured for ${integrationType}. Add to .env or configure custom credentials.`);
    }
  }

  const baseRedirectUri = redirectUri || process.env.INTEGRATION_REDIRECT_URI || 
    `${process.env.BASE_URL}/api/integrations/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: baseRedirectUri,
    response_type: 'code',
    scope: integration.scopes.join(' '),
    state: `${organizationId}:${integrationType}`,
  });

  return `${integration.authUrl}?${params.toString()}`;
};

/**
 * Exchange authorization code for tokens
 */
exports.exchangeCodeForTokens = async (integrationType, code, organizationId) => {
  const integration = INTEGRATIONS[integrationType];
  if (!integration) {
    throw new Error(`Unknown integration type: ${integrationType}`);
  }

  // Get organization to check for custom credentials
  const Organization = require('../models/Organization');
  const org = await Organization.findById(organizationId);
  
  let clientId, clientSecret;
  if (org?.integrations?.[integrationType]?.useCustomCredentials && 
      org.integrations[integrationType].customClientId &&
      org.integrations[integrationType].customClientSecret) {
    // Use organization's custom credentials
    clientId = org.integrations[integrationType].customClientId;
    clientSecret = org.integrations[integrationType].customClientSecret;
    logger.info(`Using custom OAuth credentials for token exchange (${integrationType}, org: ${organizationId})`);
  } else {
    // Use global credentials from .env
    clientId = process.env[`${integrationType.toUpperCase()}_CLIENT_ID`];
    clientSecret = process.env[`${integrationType.toUpperCase()}_CLIENT_SECRET`];
    
    if (!clientId || !clientSecret) {
      throw new Error(`OAuth credentials not configured for ${integrationType}. Add to .env or configure custom credentials.`);
    }
  }

  const redirectUri = process.env.INTEGRATION_REDIRECT_URI || 
    `${process.env.BASE_URL}/api/integrations/callback`;

  try {
    const response = await axios.post(integration.tokenUrl, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      expiresIn: response.data.expires_in,
      metadata: {
        tokenType: response.data.token_type,
        scope: response.data.scope,
      },
    };
  } catch (error) {
    logger.error(`Error exchanging code for tokens (${integrationType}):`, error.response?.data || error.message);
    throw new Error(`Failed to exchange authorization code: ${error.message}`);
  }
};

/**
 * Refresh access token
 */
exports.refreshAccessToken = async (integrationType, refreshToken) => {
  const integration = INTEGRATIONS[integrationType];
  if (!integration) {
    throw new Error(`Unknown integration type: ${integrationType}`);
  }

  const clientId = process.env[`${integrationType.toUpperCase()}_CLIENT_ID`];
  const clientSecret = process.env[`${integrationType.toUpperCase()}_CLIENT_SECRET`];

  try {
    const response = await axios.post(integration.tokenUrl, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token || refreshToken,
      expiresIn: response.data.expires_in,
    };
  } catch (error) {
    logger.error(`Error refreshing token (${integrationType}):`, error.response?.data || error.message);
    throw new Error(`Failed to refresh access token: ${error.message}`);
  }
};

/**
 * Test integration connection
 */
exports.testConnection = async (integrationType, integrationConfig) => {
  const integration = INTEGRATIONS[integrationType];
  if (!integration) {
    throw new Error(`Unknown integration type: ${integrationType}`);
  }

  try {
    let testEndpoint;
    let headers = {
      'Authorization': `Bearer ${integrationConfig.accessToken}`,
    };

    // Define test endpoints for each integration
    switch (integrationType) {
      case 'xero':
        testEndpoint = `${integration.apiUrl}/Organisation`;
        break;
      case 'myob':
        testEndpoint = `${integration.apiUrl}/Info`;
        break;
      case 'quickbooks':
        testEndpoint = `${integration.apiUrl}/company/${integrationConfig.metadata?.companyId}/companyinfo`;
        break;
      case 'googleCalendar':
        testEndpoint = `${integration.apiUrl}/users/me/calendarList`;
        break;
      case 'outlookCalendar':
      case 'teams':
        testEndpoint = `${integration.apiUrl}/me`;
        break;
      case 'slack':
        testEndpoint = `${integration.apiUrl}/auth.test`;
        break;
      case 'stripe':
        testEndpoint = `${integration.apiUrl}/account`;
        headers['Authorization'] = `Bearer ${integrationConfig.apiKey || integrationConfig.accessToken}`;
        break;
      default:
        throw new Error(`Test not implemented for ${integrationType}`);
    }

    const response = await axios.get(testEndpoint, { headers });

    return {
      connected: true,
      message: `Successfully connected to ${integration.name}`,
      data: response.data,
    };
  } catch (error) {
    logger.error(`Error testing connection (${integrationType}):`, error.response?.data || error.message);
    return {
      connected: false,
      message: `Failed to connect to ${integration.name}`,
      error: error.message,
    };
  }
};

/**
 * Sync data with integration
 */
exports.syncData = async (integrationType, organizationId, integrationConfig, options = {}) => {
  const integration = INTEGRATIONS[integrationType];
  if (!integration) {
    throw new Error(`Unknown integration type: ${integrationType}`);
  }

  logger.info(`Starting sync for ${integrationType} (org: ${organizationId})`);

  try {
    let syncResult = {
      recordsSynced: 0,
      errors: [],
    };

    // Implement specific sync logic for each integration
    switch (integrationType) {
      case 'xero':
        syncResult = await syncXeroData(organizationId, integrationConfig, options);
        break;
      case 'myob':
        syncResult = await syncMyobData(organizationId, integrationConfig, options);
        break;
      case 'quickbooks':
        syncResult = await syncQuickBooksData(organizationId, integrationConfig, options);
        break;
      case 'googleCalendar':
        syncResult = await syncGoogleCalendarData(organizationId, integrationConfig, options);
        break;
      case 'outlookCalendar':
        syncResult = await syncOutlookCalendarData(organizationId, integrationConfig, options);
        break;
      case 'slack':
        syncResult = await syncSlackData(organizationId, integrationConfig, options);
        break;
      case 'teams':
        syncResult = await syncTeamsData(organizationId, integrationConfig, options);
        break;
      case 'stripe':
        syncResult = await syncStripeData(organizationId, integrationConfig, options);
        break;
      default:
        throw new Error(`Sync not implemented for ${integrationType}`);
    }

    logger.info(`Sync completed for ${integrationType}: ${syncResult.recordsSynced} records`);
    return syncResult;
  } catch (error) {
    logger.error(`Error syncing ${integrationType}:`, error);
    throw error;
  }
};

/**
 * Handle webhook from integration
 */
exports.handleWebhook = async (integrationType, payload) => {
  logger.info(`Processing webhook for ${integrationType}`);

  try {
    switch (integrationType) {
      case 'stripe':
        await handleStripeWebhook(payload);
        break;
      case 'slack':
        await handleSlackWebhook(payload);
        break;
      case 'xero':
        await handleXeroWebhook(payload);
        break;
      default:
        logger.warn(`Webhook handler not implemented for ${integrationType}`);
    }
  } catch (error) {
    logger.error(`Error handling webhook for ${integrationType}:`, error);
    throw error;
  }
};

// ==================== INTEGRATION-SPECIFIC SYNC FUNCTIONS ====================

async function syncXeroData(organizationId, config, options) {
  const Organization = require('../models/Organization');
  const Invoice = require('../models/Invoice');
  
  try {
    const headers = {
      'Authorization': `Bearer ${config.accessToken}`,
      'xero-tenant-id': config.metadata?.tenantId,
      'Accept': 'application/json',
    };

    let recordsSynced = 0;
    const errors = [];

    // 1. Sync invoices from Xero to local database
    if (options.syncInvoices !== false) {
      try {
        const response = await axios.get(
          `${INTEGRATIONS.xero.apiUrl}/Invoices`,
          { 
            headers,
            params: {
              where: config.lastSync ? `UpdatedDateUTC >= DateTime(${config.lastSync.toISOString()})` : undefined,
            }
          }
        );

        const xeroInvoices = response.data.Invoices || [];
        
        for (const xeroInvoice of xeroInvoices) {
          try {
            // Update or create local invoice
            await Invoice.findOneAndUpdate(
              { xeroInvoiceId: xeroInvoice.InvoiceID },
              {
                xeroInvoiceId: xeroInvoice.InvoiceID,
                invoiceNumber: xeroInvoice.InvoiceNumber,
                status: xeroInvoice.Status.toLowerCase(),
                total: xeroInvoice.Total,
                amountDue: xeroInvoice.AmountDue,
                amountPaid: xeroInvoice.AmountPaid,
                dueDate: xeroInvoice.DueDate,
                organizationId,
                syncedFromXero: true,
                lastXeroSync: new Date(),
              },
              { upsert: true, new: true }
            );
            recordsSynced++;
          } catch (err) {
            errors.push(`Failed to sync invoice ${xeroInvoice.InvoiceNumber}: ${err.message}`);
          }
        }
      } catch (err) {
        errors.push(`Failed to fetch Xero invoices: ${err.message}`);
      }
    }

    // 2. Push local invoices to Xero
    if (options.pushInvoices) {
      try {
        const localInvoices = await Invoice.find({
          organizationId,
          xeroInvoiceId: { $exists: false },
          status: { $in: ['draft', 'sent'] },
        }).limit(50);

        for (const invoice of localInvoices) {
          try {
            const xeroInvoiceData = {
              Type: 'ACCREC',
              Contact: {
                Name: invoice.clientName || 'Unknown Client',
              },
              LineItems: invoice.lineItems?.map(item => ({
                Description: item.description,
                Quantity: item.quantity || 1,
                UnitAmount: item.unitPrice || 0,
                AccountCode: '200', // Default sales account
              })) || [],
              Date: invoice.invoiceDate || new Date(),
              DueDate: invoice.dueDate,
              Status: invoice.status === 'sent' ? 'SUBMITTED' : 'DRAFT',
            };

            const response = await axios.post(
              `${INTEGRATIONS.xero.apiUrl}/Invoices`,
              { Invoices: [xeroInvoiceData] },
              { headers }
            );

            if (response.data.Invoices?.[0]) {
              await Invoice.findByIdAndUpdate(invoice._id, {
                xeroInvoiceId: response.data.Invoices[0].InvoiceID,
                syncedToXero: true,
              });
              recordsSynced++;
            }
          } catch (err) {
            errors.push(`Failed to push invoice ${invoice.invoiceNumber}: ${err.message}`);
          }
        }
      } catch (err) {
        errors.push(`Failed to push invoices to Xero: ${err.message}`);
      }
    }

    return {
      recordsSynced,
      errors,
      message: `Synced ${recordsSynced} records with ${errors.length} errors`,
    };
  } catch (error) {
    logger.error('Xero sync error:', error);
    throw error;
  }
}

async function syncMyobData(organizationId, config, options) {
  // TODO: Implement MYOB sync logic
  return { recordsSynced: 0, message: 'MYOB sync not yet implemented' };
}

async function syncQuickBooksData(organizationId, config, options) {
  // TODO: Implement QuickBooks sync logic
  return { recordsSynced: 0, message: 'QuickBooks sync not yet implemented' };
}

async function syncGoogleCalendarData(organizationId, config, options) {
  const Appointment = require('../models/Appointment');
  
  try {
    const headers = {
      'Authorization': `Bearer ${config.accessToken}`,
      'Accept': 'application/json',
    };

    let recordsSynced = 0;
    const errors = [];

    // 1. Sync events from Google Calendar to appointments
    if (options.syncFromCalendar !== false) {
      try {
        const calendarId = config.metadata?.calendarId || 'primary';
        const timeMin = config.lastSync 
          ? new Date(config.lastSync).toISOString()
          : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

        const response = await axios.get(
          `${INTEGRATIONS.googleCalendar.apiUrl}/calendars/${calendarId}/events`,
          {
            headers,
            params: {
              timeMin,
              singleEvents: true,
              orderBy: 'startTime',
            },
          }
        );

        const events = response.data.items || [];

        for (const event of events) {
          try {
            if (!event.start?.dateTime) continue; // Skip all-day events

            await Appointment.findOneAndUpdate(
              { googleEventId: event.id },
              {
                googleEventId: event.id,
                title: event.summary,
                description: event.description,
                startTime: new Date(event.start.dateTime),
                endTime: new Date(event.end.dateTime),
                location: event.location,
                organizationId,
                syncedFromGoogle: true,
                lastGoogleSync: new Date(),
              },
              { upsert: true, new: true }
            );
            recordsSynced++;
          } catch (err) {
            errors.push(`Failed to sync event ${event.summary}: ${err.message}`);
          }
        }
      } catch (err) {
        errors.push(`Failed to fetch Google Calendar events: ${err.message}`);
      }
    }

    // 2. Push appointments to Google Calendar
    if (options.pushToCalendar) {
      try {
        const appointments = await Appointment.find({
          organizationId,
          googleEventId: { $exists: false },
          startTime: { $gte: new Date() },
        }).limit(50);

        const calendarId = config.metadata?.calendarId || 'primary';

        for (const appointment of appointments) {
          try {
            const eventData = {
              summary: appointment.title || 'Appointment',
              description: appointment.description,
              start: {
                dateTime: appointment.startTime.toISOString(),
                timeZone: 'Australia/Sydney',
              },
              end: {
                dateTime: appointment.endTime.toISOString(),
                timeZone: 'Australia/Sydney',
              },
              location: appointment.location,
            };

            const response = await axios.post(
              `${INTEGRATIONS.googleCalendar.apiUrl}/calendars/${calendarId}/events`,
              eventData,
              { headers }
            );

            await Appointment.findByIdAndUpdate(appointment._id, {
              googleEventId: response.data.id,
              syncedToGoogle: true,
            });
            recordsSynced++;
          } catch (err) {
            errors.push(`Failed to push appointment ${appointment.title}: ${err.message}`);
          }
        }
      } catch (err) {
        errors.push(`Failed to push appointments to Google Calendar: ${err.message}`);
      }
    }

    return {
      recordsSynced,
      errors,
      message: `Synced ${recordsSynced} records with ${errors.length} errors`,
    };
  } catch (error) {
    logger.error('Google Calendar sync error:', error);
    throw error;
  }
}

async function syncOutlookCalendarData(organizationId, config, options) {
  // TODO: Implement Outlook Calendar sync logic
  return { recordsSynced: 0, message: 'Outlook Calendar sync not yet implemented' };
}

async function syncSlackData(organizationId, config, options) {
  try {
    const headers = {
      'Authorization': `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
    };

    let recordsSynced = 0;
    const errors = [];

    // Send notification to Slack channel
    if (options.message) {
      try {
        const channelId = config.metadata?.channelId || config.metadata?.defaultChannel;
        
        if (!channelId) {
          throw new Error('No Slack channel configured');
        }

        const response = await axios.post(
          `${INTEGRATIONS.slack.apiUrl}/chat.postMessage`,
          {
            channel: channelId,
            text: options.message,
            blocks: options.blocks || undefined,
          },
          { headers }
        );

        if (response.data.ok) {
          recordsSynced++;
        } else {
          errors.push(`Slack API error: ${response.data.error}`);
        }
      } catch (err) {
        errors.push(`Failed to send Slack message: ${err.message}`);
      }
    }

    // Get channel list for configuration
    if (options.getChannels) {
      try {
        const response = await axios.get(
          `${INTEGRATIONS.slack.apiUrl}/conversations.list`,
          { headers }
        );

        return {
          recordsSynced,
          errors,
          channels: response.data.channels,
          message: `Retrieved ${response.data.channels?.length || 0} channels`,
        };
      } catch (err) {
        errors.push(`Failed to fetch Slack channels: ${err.message}`);
      }
    }

    return {
      recordsSynced,
      errors,
      message: `Sent ${recordsSynced} messages with ${errors.length} errors`,
    };
  } catch (error) {
    logger.error('Slack sync error:', error);
    throw error;
  }
}

async function syncTeamsData(organizationId, config, options) {
  // TODO: Implement Teams sync logic
  return { recordsSynced: 0, message: 'Teams sync not yet implemented' };
}

async function syncStripeData(organizationId, config, options) {
  const Invoice = require('../models/Invoice');
  const stripe = require('stripe')(config.apiKey || process.env.STRIPE_SECRET_KEY);
  
  try {
    let recordsSynced = 0;
    const errors = [];

    // 1. Sync payment intents
    if (options.syncPayments !== false) {
      try {
        const lastSyncTimestamp = config.lastSync 
          ? Math.floor(new Date(config.lastSync).getTime() / 1000)
          : Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000); // Last 30 days

        const paymentIntents = await stripe.paymentIntents.list({
          limit: 100,
          created: { gte: lastSyncTimestamp },
        });

        for (const payment of paymentIntents.data) {
          try {
            if (payment.metadata?.invoiceId) {
              const updateData = {
                stripePaymentId: payment.id,
                paymentStatus: payment.status === 'succeeded' ? 'paid' : 
                               payment.status === 'processing' ? 'processing' : 'pending',
              };

              if (payment.status === 'succeeded') {
                updateData.paidAt = new Date(payment.created * 1000);
                updateData.amountPaid = payment.amount / 100; // Convert from cents
              }

              await Invoice.findByIdAndUpdate(
                payment.metadata.invoiceId,
                updateData
              );
              recordsSynced++;
            }
          } catch (err) {
            errors.push(`Failed to sync payment ${payment.id}: ${err.message}`);
          }
        }
      } catch (err) {
        errors.push(`Failed to fetch Stripe payments: ${err.message}`);
      }
    }

    // 2. Sync customers
    if (options.syncCustomers) {
      try {
        const customers = await stripe.customers.list({ limit: 100 });
        // Store customer IDs in metadata for future use
        recordsSynced += customers.data.length;
      } catch (err) {
        errors.push(`Failed to sync Stripe customers: ${err.message}`);
      }
    }

    // 3. Create payment intents for unpaid invoices
    if (options.createPaymentIntents) {
      try {
        const unpaidInvoices = await Invoice.find({
          organizationId,
          paymentStatus: { $in: ['pending', 'unpaid'] },
          stripePaymentId: { $exists: false },
          total: { $gt: 0 },
        }).limit(20);

        for (const invoice of unpaidInvoices) {
          try {
            const paymentIntent = await stripe.paymentIntents.create({
              amount: Math.round(invoice.total * 100), // Convert to cents
              currency: invoice.currency || 'aud',
              metadata: {
                invoiceId: invoice._id.toString(),
                invoiceNumber: invoice.invoiceNumber,
                organizationId: organizationId.toString(),
              },
              description: `Invoice ${invoice.invoiceNumber}`,
            });

            await Invoice.findByIdAndUpdate(invoice._id, {
              stripePaymentId: paymentIntent.id,
              stripeClientSecret: paymentIntent.client_secret,
            });
            recordsSynced++;
          } catch (err) {
            errors.push(`Failed to create payment intent for invoice ${invoice.invoiceNumber}: ${err.message}`);
          }
        }
      } catch (err) {
        errors.push(`Failed to create payment intents: ${err.message}`);
      }
    }

    return {
      recordsSynced,
      errors,
      message: `Synced ${recordsSynced} records with ${errors.length} errors`,
    };
  } catch (error) {
    logger.error('Stripe sync error:', error);
    throw error;
  }
}

// ==================== WEBHOOK HANDLERS ====================

async function handleStripeWebhook(payload) {
  const Invoice = require('../models/Invoice');
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  
  try {
    logger.info('Stripe webhook received:', payload.type);

    switch (payload.type) {
      case 'payment_intent.succeeded':
        const paymentIntent = payload.data.object;
        if (paymentIntent.metadata?.invoiceId) {
          await Invoice.findByIdAndUpdate(paymentIntent.metadata.invoiceId, {
            paymentStatus: 'paid',
            paidAt: new Date(paymentIntent.created * 1000),
            amountPaid: paymentIntent.amount / 100,
            stripePaymentId: paymentIntent.id,
          });
          logger.info(`Invoice ${paymentIntent.metadata.invoiceId} marked as paid`);
        }
        break;

      case 'payment_intent.payment_failed':
        const failedPayment = payload.data.object;
        if (failedPayment.metadata?.invoiceId) {
          await Invoice.findByIdAndUpdate(failedPayment.metadata.invoiceId, {
            paymentStatus: 'failed',
            paymentError: failedPayment.last_payment_error?.message,
          });
          logger.warn(`Payment failed for invoice ${failedPayment.metadata.invoiceId}`);
        }
        break;

      case 'charge.refunded':
        const refund = payload.data.object;
        if (refund.metadata?.invoiceId) {
          await Invoice.findByIdAndUpdate(refund.metadata.invoiceId, {
            paymentStatus: 'refunded',
            refundedAt: new Date(),
            refundAmount: refund.amount_refunded / 100,
          });
          logger.info(`Invoice ${refund.metadata.invoiceId} refunded`);
        }
        break;

      case 'customer.created':
      case 'customer.updated':
        // Store customer information for future use
        logger.info(`Stripe customer ${payload.data.object.id} ${payload.type.split('.')[1]}`);
        break;

      default:
        logger.info(`Unhandled Stripe webhook type: ${payload.type}`);
    }
  } catch (error) {
    logger.error('Error handling Stripe webhook:', error);
    throw error;
  }
}

async function handleSlackWebhook(payload) {
  try {
    logger.info('Slack webhook received:', payload.type);

    switch (payload.type) {
      case 'url_verification':
        // Slack sends this to verify the webhook URL
        return { challenge: payload.challenge };

      case 'event_callback':
        const event = payload.event;
        
        switch (event.type) {
          case 'message':
            // Handle incoming messages if needed
            logger.info(`Slack message received: ${event.text}`);
            break;

          case 'app_mention':
            // Handle app mentions
            logger.info(`App mentioned in Slack: ${event.text}`);
            break;

          default:
            logger.info(`Unhandled Slack event type: ${event.type}`);
        }
        break;

      default:
        logger.info(`Unhandled Slack webhook type: ${payload.type}`);
    }
  } catch (error) {
    logger.error('Error handling Slack webhook:', error);
    throw error;
  }
}

async function handleXeroWebhook(payload) {
  const Invoice = require('../models/Invoice');
  
  try {
    logger.info('Xero webhook received:', payload.events?.length || 0, 'events');

    if (!payload.events || !Array.isArray(payload.events)) {
      return;
    }

    for (const event of payload.events) {
      try {
        switch (event.eventType) {
          case 'UPDATE':
          case 'CREATE':
            if (event.eventCategory === 'INVOICE') {
              // Fetch the updated invoice from Xero and sync
              logger.info(`Xero invoice ${event.eventType}: ${event.resourceId}`);
              
              // Trigger a sync for this specific invoice
              // This would need the organization's access token
              // For now, just log it
            }
            break;

          case 'DELETE':
            if (event.eventCategory === 'INVOICE') {
              // Mark invoice as deleted or remove sync
              await Invoice.findOneAndUpdate(
                { xeroInvoiceId: event.resourceId },
                { 
                  xeroDeleted: true,
                  lastXeroSync: new Date(),
                }
              );
              logger.info(`Xero invoice deleted: ${event.resourceId}`);
            }
            break;

          default:
            logger.info(`Unhandled Xero event type: ${event.eventType}`);
        }
      } catch (err) {
        logger.error(`Error processing Xero event ${event.eventType}:`, err);
      }
    }
  } catch (error) {
    logger.error('Error handling Xero webhook:', error);
    throw error;
  }
}

module.exports = exports;
