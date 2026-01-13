/**
 * Bank details validators
 * Simple middleware to validate payloads without external deps.
 */

function validateBankDetailsPayload(req, res, next) {
  const {
    userEmail,
    organizationId,
    bankName,
    accountName,
    bsb,
    accountNumber,
    useAdminBankDetails,
  } = req.body || {};

  const errors = [];
  if (!userEmail || typeof userEmail !== 'string') errors.push('Invalid or missing userEmail');
  if (!organizationId || typeof organizationId !== 'string') errors.push('Invalid or missing organizationId');
  if (!bankName || typeof bankName !== 'string') errors.push('Invalid or missing bankName');
  if (!accountName || typeof accountName !== 'string') errors.push('Invalid or missing accountName');

  const bsbRegex = /^\d{3}-\d{3}$/;
  if (!bsb || !bsbRegex.test(bsb)) errors.push('BSB must be in format XXX-XXX');

  const accRegex = /^\d{6,10}$/;
  if (!accountNumber || !accRegex.test(accountNumber)) errors.push('Account number must be 6-10 digits');

  // Optional preference flag; if provided, must be boolean
  if (typeof useAdminBankDetails !== 'undefined' && typeof useAdminBankDetails !== 'boolean') {
    errors.push('useAdminBankDetails must be a boolean');
  }

  if (errors.length) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors });
  }

  next();
}

function validateBankDetailsQuery(req, res, next) {
  const { userEmail, organizationId } = req.query || {};
  const errors = [];
  if (!userEmail || typeof userEmail !== 'string') errors.push('Invalid or missing userEmail');
  if (!organizationId || typeof organizationId !== 'string') errors.push('Invalid or missing organizationId');

  if (errors.length) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors });
  }
  next();
}

module.exports = {
  validateBankDetailsPayload,
  validateBankDetailsQuery,
};