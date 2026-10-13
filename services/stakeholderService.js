const Stakeholder = require('../models/Stakeholder');
const Client = require('../models/Client');
const logger = require('../config/logger');

/**
 * Multi-stakeholder CRM operations (Phase 5).
 * See docs/NDIS_DEPTH_ROADMAP.md section 4.
 */
class StakeholderService {
  async listStakeholders(organizationId, { type, active } = {}) {
    const filter = { organizationId };
    if (type) filter.type = type;
    if (active !== undefined) filter.isActive = active;
    return Stakeholder.find(filter).sort({ name: 1 });
  }

  async getStakeholder(organizationId, id) {
    return Stakeholder.findOne({ _id: id, organizationId });
  }

  async createStakeholder(organizationId, data, actor = '') {
    const stakeholder = await Stakeholder.create({
      organizationId,
      type: data.type || 'other',
      name: data.name,
      email: data.email || '',
      phone: data.phone || '',
      company: data.company || '',
      abn: data.abn || '',
      linkedUserEmail: data.linkedUserEmail || '',
      permissions: data.permissions || {},
      notes: data.notes || '',
      isActive: data.isActive !== false,
      createdBy: actor,
      updatedBy: actor,
    });

    logger.business('Stakeholder Created', {
      event: 'stakeholder_created',
      organizationId,
      stakeholderId: stakeholder._id.toString(),
      type: stakeholder.type,
    });

    return stakeholder;
  }

  async updateStakeholder(organizationId, id, data, actor = '') {
    const update = { updatedBy: actor };
    const fields = [
      'type',
      'name',
      'email',
      'phone',
      'company',
      'abn',
      'linkedUserEmail',
      'permissions',
      'notes',
      'isActive',
    ];
    for (const f of fields) {
      if (data[f] !== undefined) update[f] = data[f];
    }
    return Stakeholder.findOneAndUpdate({ _id: id, organizationId }, update, {
      new: true,
      runValidators: true,
    });
  }

  async deactivateStakeholder(organizationId, id, actor = '') {
    return Stakeholder.findOneAndUpdate(
      { _id: id, organizationId },
      { isActive: false, updatedBy: actor },
      { new: true },
    );
  }

  /**
   * Link a stakeholder to a client (idempotent). Optionally mark primary and
   * set the client's funding type.
   */
  async linkToClient(organizationId, clientId, { stakeholderId, role, isPrimary, fundingType }, actor = '') {
    const [stakeholder, client] = await Promise.all([
      Stakeholder.findOne({ _id: stakeholderId, organizationId }),
      Client.findOne({ _id: clientId, organizationId }),
    ]);

    if (!stakeholder) {
      const err = new Error('Stakeholder not found.');
      err.statusCode = 404;
      throw err;
    }
    if (!client) {
      const err = new Error('Client not found.');
      err.statusCode = 404;
      throw err;
    }

    const effectiveRole = role || stakeholder.type;
    const existing = (client.stakeholders || []).filter(
      (s) => s.stakeholderId && s.stakeholderId.toString() !== stakeholderId.toString(),
    );

    existing.push({
      stakeholderId: stakeholder._id,
      role: effectiveRole,
      isPrimary: !!isPrimary,
    });

    client.stakeholders = existing;
    if (fundingType) client.fundingType = fundingType;
    await client.save();

    logger.business('Stakeholder Linked', {
      event: 'stakeholder_linked',
      organizationId,
      stakeholderId: String(stakeholderId),
      clientId: String(clientId),
      role: effectiveRole,
    });

    return client;
  }

  async unlinkFromClient(organizationId, clientId, stakeholderId) {
    const client = await Client.findOne({ _id: clientId, organizationId });
    if (!client) return null;

    client.stakeholders = (client.stakeholders || []).filter(
      (s) => !s.stakeholderId || s.stakeholderId.toString() !== stakeholderId.toString(),
    );
    await client.save();
    return client;
  }

  /**
   * Return the client's linked stakeholders with populated details.
   */
  async getClientCareTeam(organizationId, clientId) {
    const client = await Client.findOne({ _id: clientId, organizationId });
    if (!client) return null;

    const links = client.stakeholders || [];
    const ids = links.map((l) => l.stakeholderId).filter(Boolean);
    const stakeholders = ids.length
      ? await Stakeholder.find({ _id: { $in: ids }, organizationId })
      : [];
    const byId = new Map(stakeholders.map((s) => [s._id.toString(), s]));

    const careTeam = links
      .map((link) => {
        const stakeholder = link.stakeholderId
          ? byId.get(link.stakeholderId.toString())
          : null;
        if (!stakeholder) return null;
        return {
          linkRole: link.role,
          isPrimary: !!link.isPrimary,
          stakeholder,
        };
      })
      .filter(Boolean);

    return { clientId: client._id.toString(), fundingType: client.fundingType, careTeam };
  }
}

module.exports = new StakeholderService();
