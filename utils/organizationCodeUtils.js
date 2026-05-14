const Organization = require('../models/Organization');

let backfillPromise = null;

function normalizeOrganizationCode(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized || null;
}

async function backfillLegacyOrganizationCodes() {
  if (!backfillPromise) {
    backfillPromise = (async () => {
      const organizations = await Organization.find(
        {
          $or: [
            { organizationCode: { $exists: false } },
            { organizationCode: null },
            { organizationCode: '' },
          ],
          code: { $exists: true, $type: 'string', $ne: '' },
        },
        { _id: 1, code: 1 }
      ).lean();

      if (!organizations.length) {
        return;
      }

      const operations = organizations
        .map((organization) => ({
          updateOne: {
            filter: { _id: organization._id },
            update: {
              $set: {
                organizationCode: normalizeOrganizationCode(organization.code),
              },
            },
          },
        }))
        .filter(
          (operation) => operation.updateOne.update.$set.organizationCode
        );

      if (!operations.length) {
        return;
      }

      await Organization.bulkWrite(operations, { ordered: false });
    })().catch((error) => {
      backfillPromise = null;
      throw error;
    });
  }

  await backfillPromise;
}

function getCanonicalOrganizationCode(organization) {
  return normalizeOrganizationCode(
    organization?.organizationCode || organization?.code
  );
}

module.exports = {
  backfillLegacyOrganizationCodes,
  getCanonicalOrganizationCode,
  normalizeOrganizationCode,
};
