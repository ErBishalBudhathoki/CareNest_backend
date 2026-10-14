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
}

module.exports = new BillingRoutingService();
