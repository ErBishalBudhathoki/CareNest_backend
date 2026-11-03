/**
 * Funding-type billing routing (Phase 6).
 * See docs/NDIS_DEPTH_ROADMAP.md section 5.5.
 *
 * Maps a participant's funding type to the billing artefact:
 *   - ndia_managed  -> Bulk Payment Request CSV (via NDIS claiming)
 *   - plan_managed  -> invoice PDF addressed to the plan manager
 *   - self_managed  -> invoice PDF addressed to the participant
 */

const ROUTES = {
  ndia_managed: { recipientType: 'ndia', artifact: 'claim_csv' },
  plan_managed: { recipientType: 'plan_manager', artifact: 'invoice_pdf' },
  self_managed: { recipientType: 'participant', artifact: 'invoice_pdf' },
  combination: { recipientType: 'participant', artifact: 'invoice_pdf' },
};

class BillingRoutingService {
  /**
   * @param {Object} input - { fundingType, planManagerStakeholderId? }
   * @returns {{ fundingType:string, recipientType:string, artifact:string,
   *            planManagerStakeholderId:string|null }}
   */
  resolveRoute(input = {}) {
    const fundingType = ROUTES[input.fundingType] ? input.fundingType : 'plan_managed';
    const route = ROUTES[fundingType];
    return {
      fundingType,
      recipientType: route.recipientType,
      artifact: route.artifact,
      planManagerStakeholderId: input.planManagerStakeholderId || null,
    };
  }

  /**
   * Build the additive `billing` block to stamp on an Invoice.
   * Includes `artifact` so consumers know what to produce (claim CSV vs PDF).
   * @param {Object} client - { fundingType, stakeholders? }
   * @returns {Object} billing block
   */
  buildInvoiceBilling(client = {}) {
    const planManagerId = this._planManagerId(client);
    const route = this.resolveRoute({
      fundingType: client.fundingType,
      planManagerStakeholderId: planManagerId,
    });
    return {
      fundingType: route.fundingType,
      recipientType: route.recipientType,
      artifact: route.artifact,
      planManagerStakeholderId: planManagerId,
    };
  }

  _planManagerId(client) {
    const links = Array.isArray(client.stakeholders) ? client.stakeholders : [];
    const pm = links.find((l) => l.role === 'plan_manager');
    return pm?.stakeholderId ? pm.stakeholderId.toString() : null;
  }

  /**
   * Milestone 7.3: Resolve the recipient details for automated invoice dispatch.
   * For plan_managed participants, queries the linked Stakeholder record with role 'plan_manager'.
   * For self_managed / participant-billed, resolves participant contact info.
   * For ndia_managed, sets NDIA routing recipient.
   *
   * @param {Object} client - Participant record { _id, organizationId, fundingType, clientFirstName, clientLastName, clientEmail, stakeholders? }
   * @returns {Promise<Object>} Recipient details { type, name, email, company?, phone?, stakeholderId? }
   */
  async resolveBillingRecipient(client = {}) {
    if (!client) {
      return { type: '', name: '', email: '' };
    }

    const Stakeholder = require('../models/Stakeholder');
    const fundingType = client.fundingType || 'plan_managed';

    if (fundingType === 'plan_managed') {
      const pmId = this._planManagerId(client);
      if (pmId) {
        try {
          const pm = await Stakeholder.findOne({
            _id: pmId,
            ...(client.organizationId ? { organizationId: client.organizationId } : {}),
            isActive: { $ne: false },
          }).lean();
          if (pm) {
            return {
              type: 'plan_manager',
              name: pm.name || '',
              email: pm.email || '',
              company: pm.company || '',
              phone: pm.phone || '',
              stakeholderId: pm._id,
            };
          }
        } catch (err) {
          // Non-fatal: fallback to participant details
        }
      }
    } else if (fundingType === 'ndia_managed') {
      return {
        type: 'ndia',
        name: 'National Disability Insurance Agency',
        email: '',
        company: 'NDIA',
        phone: '1800 800 110',
        ndisNumber: client.ndisNumber || '',
      };
    }

    // Default to participant (self_managed, combination, or unlinked plan_managed)
    const participantName =
      [client.clientFirstName, client.clientLastName].filter(Boolean).join(' ').trim() ||
      [client.firstName, client.lastName].filter(Boolean).join(' ').trim() ||
      client.name ||
      'Participant';
    const participantEmail = client.clientEmail || client.email || '';
    const participantPhone = client.clientPhone || client.phone || '';

    return {
      type: 'participant',
      name: participantName,
      email: participantEmail,
      company: '',
      phone: participantPhone,
      clientId: client._id ? client._id.toString() : null,
    };
  }

  /**
   * Resolve line-item level funding route for combination-funded participants (Milestone 3.4).
   *
   * Under NDIS combination funding rules:
   *  - Core & SIL supports (Category 01, 04) are typically NDIA-managed (artifact: claim_csv).
   *  - Support Coordination & Capacity Building (Category 07, 14, 15) are typically Plan-managed (artifact: invoice_pdf).
   *  - Consumables and client-paid items (Category 03) are Self-managed (artifact: invoice_pdf).
   *
   * @param {Object} params
   * @param {string} params.supportItemNumber - e.g. "01_011_0107_1_1" or "15_056_0128_1_3"
   * @param {string} [params.fundingType] - Client funding type
   * @param {Array} [params.planCategories] - Client plan category envelopes
   * @returns {{ fundingRoute: string, recipientType: string, artifact: string, category: string }}
   */
  resolveLineItemRoute({ supportItemNumber, fundingType, planCategories = [] } = {}) {
    const overallFunding = String(fundingType || 'plan_managed').toLowerCase();
    if (overallFunding !== 'combination') {
      const route = this.resolveRoute({ fundingType: overallFunding });
      return {
        fundingRoute: route.fundingType,
        recipientType: route.recipientType,
        artifact: route.artifact,
        category: (supportItemNumber || '').split('_')[0] || '01',
      };
    }

    const category = (supportItemNumber || '').split('_')[0] || '01';

    // Check if participant's plan specifies explicit category funding
    const matchedCategory = (planCategories || []).find(
      (c) => String(c.categoryNumber || '').trim() === category,
    );
    if (matchedCategory && matchedCategory.fundingType && ROUTES[matchedCategory.fundingType]) {
      const explicitRoute = ROUTES[matchedCategory.fundingType];
      return {
        fundingRoute: matchedCategory.fundingType,
        recipientType: explicitRoute.recipientType,
        artifact: explicitRoute.artifact,
        category,
      };
    }

    // Default NDIS combination category routing
    if (category === '01' || category === '04') {
      // Core / SIL Daily Living -> NDIA Managed
      return {
        fundingRoute: 'ndia_managed',
        recipientType: 'ndia',
        artifact: 'claim_csv',
        category,
      };
    } else if (category === '07' || category === '14' || category === '15') {
      // Support Coordination & Therapy -> Plan Managed
      return {
        fundingRoute: 'plan_managed',
        recipientType: 'plan_manager',
        artifact: 'invoice_pdf',
        category,
      };
    } else {
      // Consumables / Other -> Self Managed
      return {
        fundingRoute: 'self_managed',
        recipientType: 'participant',
        artifact: 'invoice_pdf',
        category,
      };
    }
  }

  /**
   * Split a mixed line-item collection by funding route (Milestone 3.4).
   *
   * @param {Array<Object>} lineItems - Array of invoice line items
   * @param {Object} client - Participant record { fundingType, plan?, stakeholders? }
   * @returns {{ hasMixedRoutes: boolean, routes: Object.<string, Array<Object>> }}
   */
  splitLineItemsByRoute(lineItems = [], client = {}) {
    const routes = {
      ndia_managed: [],
      plan_managed: [],
      self_managed: [],
    };

    const planCategories = client.plan?.categories || [];

    for (const item of lineItems) {
      const supportNumber = item.supportItemNumber || item.itemNumber || '';
      const resolved = this.resolveLineItemRoute({
        supportItemNumber: supportNumber,
        fundingType: client.fundingType,
        planCategories,
      });

      const stampedItem = {
        ...item,
        fundingRoute: resolved.fundingRoute,
      };

      if (routes[resolved.fundingRoute]) {
        routes[resolved.fundingRoute].push(stampedItem);
      } else {
        routes.plan_managed.push(stampedItem);
      }
    }

    const activeRoutes = Object.keys(routes).filter((k) => routes[k].length > 0);
    const hasMixedRoutes = activeRoutes.length > 1;

    return {
      hasMixedRoutes,
      activeRoutes,
      routes,
    };
  }
}

module.exports = new BillingRoutingService();
