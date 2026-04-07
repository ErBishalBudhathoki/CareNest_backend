const Organization = require('../models/Organization');

let backfillPromise = null;

function normalizeOrganizationCode(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized || null;
}

async function backfillLegacyOrganizationCodes() {
  if (!backfillPromise) {
    backfillPromise = Organization.updateMany(
      {
        $or: [
          { organizationCode: { $exists: false } },
          { organizationCode: null },
          { organizationCode: '' },
        ],
        code: { $exists: true, $type: 'string', $ne: '' },
      },
      [
        {
          $set: {
            organizationCode: {
              $toUpper: {
                $trim: {
                  input: '$code',
                },
              },
            },
          },
        },
      ]
    ).catch((error) => {
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
