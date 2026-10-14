/**
 * Date and time helper functions
 */

/**
 * Canonical user-facing date format for the whole application: Australian
 * DD/MM/YYYY. Use this for anything a human reads (UI payloads, emails, PDFs,
 * CSV exports). Do NOT feed these strings to `new Date()` directly — Node parses
 * a slash date as US MM/DD/YYYY. Always use `parseDisplayDate` instead.
 */
const DISPLAY_DATE_FORMAT = 'DD/MM/YYYY';

/**
 * Date format used in the NDIS Bulk Payment Request (BPR) CSV.
 * Kept as a single constant so it can be changed in one place.
 */
const BPR_DATE_FORMAT = 'DD/MM/YYYY';

/** Regex a {@link formatBprDate} string must match. Keep in sync with BPR_DATE_FORMAT. */
const BPR_DATE_PATTERN = /^\d{2}\/\d{2}\/\d{4}$/;

/**
 * Get current timestamp in ISO format
 * @returns {string} Current timestamp
 */
function getCurrentTimestamp() {
  return new Date().toISOString();
}

/**
 * Get current date in YYYY-MM-DD format
 * @returns {string} Current date
 */
function getCurrentDate() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Format date to Australian format (DD/MM/YYYY)
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted date
 */
function formatDateAU(date) {
  const d = new Date(date);
  if (isNaN(d.getTime())) {
    return '';
  }
  
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year = d.getFullYear();
  
  return `${day}/${month}/${year}`;
}

/**
 * Format a date as the canonical display format (DD/MM/YYYY).
 * Alias of {@link formatDateAU} kept for readability at call sites that care
 * about the canonical format rather than the locale name.
 * @param {Date|string} date
 * @returns {string} e.g. "01/04/2026", or '' when invalid
 */
function formatDisplayDate(date) {
  return formatDateAU(date);
}

/**
 * Strictly parse a DD/MM/YYYY (or D/M/YYYY) string into a local-midnight Date.
 *
 * Unlike `new Date(str)`, this never interprets a slash date as US MM/DD/YYYY.
 * Also accepts an ISO date/datetime string and a Date instance for convenience.
 *
 * @param {Date|string|null} value
 * @returns {Date|null} local-midnight Date, or null when unparseable
 */
function parseDisplayDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== 'string') return null;

  const s = value.trim();
  if (!s) return null;

  // ISO date or datetime (e.g. 2026-04-01 or 2026-04-01T00:00:00Z).
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Australian DD/MM/YYYY (day first) — never MM/DD.
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const month = parseInt(dmy[2], 10);
    const year = parseInt(dmy[3], 10);
    const d = new Date(year, month - 1, day);
    // Reject rollover (e.g. 31/02/2026 → 03/03/2026).
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
      return null;
    }
    return d;
  }

  return null;
}

/**
 * Tolerant, unambiguous date parser for stored date strings.
 *
 * Slash dates are ALWAYS read day-first (DD/MM/YYYY) — the app's canonical
 * order — so `01/04/2026` is 1 April, never 4 January. Legacy ISO dates
 * (`YYYY-MM-DD`) are still accepted, which lets existing rows keep working
 * after the storage format moved to DD/MM/YYYY.
 *
 * Use this instead of `new Date(str)` for any stored date string.
 *
 * @param {Date|string|null} value
 * @returns {Date|null}
 */
function parseFlexibleDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== 'string') return null;

  const s = value.trim();
  if (!s) return null;

  // ISO date / datetime (unambiguous, year first).
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Slash or hyphen date with a 4-digit year → day-first.
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
      return null;
    }
    return d;
  }

  const fallback = new Date(s);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

/**
 * Normalise any stored date string to the canonical display format
 * (DD/MM/YYYY). Returns '' when the value cannot be parsed.
 *
 * DISPLAY ONLY. Do not persist the result: the DB and the API transport keep
 * dates in ISO `YYYY-MM-DD` so that (a) Mongo lexicographic range queries and
 * indexes stay valid and (b) Dart's `DateTime.parse` / `DateTime.tryParse`
 * keep working. Convert to DD/MM/YYYY at the presentation boundary.
 *
 * @param {Date|string|null} value
 * @returns {string}
 */
function normalizeToDisplayDate(value) {
  const d = parseFlexibleDate(value);
  return d ? formatDateAU(d) : '';
}

/**
 * Normalise any date input to the canonical *storage / transport* key:
 * ISO `YYYY-MM-DD`. Day-first input (DD/MM/YYYY, DD-MM-YYYY) is read as
 * day-first, never as US MM/DD. Returns '' when the value cannot be parsed.
 *
 * Use this on the write path so stored date strings are always sortable and
 * parseable by every reader (Mongo range queries, Dart DateTime.parse, etc.).
 *
 * @param {Date|string|null} value
 * @returns {string} e.g. "2026-04-01", or '' when invalid
 */
function normalizeToIsoDate(value) {
  const pad = (n) => String(n).padStart(2, '0');

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  if (typeof value !== 'string') return '';

  const s = value.trim();
  if (!s) return '';

  // Already ISO — return the date part verbatim (UTC-safe, no re-parse).
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const d = parseFlexibleDate(s);
  if (!d) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Format a date for the NDIS BPR CSV (see {@link BPR_DATE_FORMAT}).
 *
 * Service dates are date-only values stored at UTC midnight, so this reads the
 * UTC calendar parts to avoid a timezone shift.
 * @param {Date|string} value
 * @returns {string}
 */
function formatBprDate(value) {
  const d = value instanceof Date ? value : parseDisplayDate(value) || new Date(value);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Format date to ISO format (YYYY-MM-DD)
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted date
 */
function formatDateISO(date) {
  const d = new Date(date);
  if (isNaN(d.getTime())) {
    return '';
  }
  
  return d.toISOString().split('T')[0];
}

/**
 * Format datetime to readable format
 * @param {Date|string} date - Date to format
 * @param {Object} options - Formatting options
 * @returns {string} Formatted datetime
 */
function formatDateTime(date, options = {}) {
  const {
    includeTime = true,
    includeSeconds = false,
    timezone = 'Australia/Sydney'
  } = options;
  
  const d = new Date(date);
  if (isNaN(d.getTime())) {
    return '';
  }
  
  const formatOptions = {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  };
  
  if (includeTime) {
    formatOptions.hour = '2-digit';
    formatOptions.minute = '2-digit';
    formatOptions.hour12 = true;
    
    if (includeSeconds) {
      formatOptions.second = '2-digit';
    }
  }
  
  return d.toLocaleString('en-AU', formatOptions);
}

/**
 * Add days to a date
 * @param {Date|string} date - Base date
 * @param {number} days - Number of days to add
 * @returns {Date} New date
 */
function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Add months to a date
 * @param {Date|string} date - Base date
 * @param {number} months - Number of months to add
 * @returns {Date} New date
 */
function addMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * Add years to a date
 * @param {Date|string} date - Base date
 * @param {number} years - Number of years to add
 * @returns {Date} New date
 */
function addYears(date, years) {
  const result = new Date(date);
  result.setFullYear(result.getFullYear() + years);
  return result;
}

/**
 * Get start of day
 * @param {Date|string} date - Date
 * @returns {Date} Start of day
 */
function startOfDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Get end of day
 * @param {Date|string} date - Date
 * @returns {Date} End of day
 */
function endOfDay(date) {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

/**
 * Get start of month
 * @param {Date|string} date - Date
 * @returns {Date} Start of month
 */
function startOfMonth(date) {
  const result = new Date(date);
  result.setDate(1);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Get end of month
 * @param {Date|string} date - Date
 * @returns {Date} End of month
 */
function endOfMonth(date) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + 1, 0);
  result.setHours(23, 59, 59, 999);
  return result;
}

/**
 * Calculate difference between two dates in days
 * @param {Date|string} date1 - First date
 * @param {Date|string} date2 - Second date
 * @returns {number} Difference in days
 */
function daysDifference(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const timeDiff = Math.abs(d2.getTime() - d1.getTime());
  return Math.ceil(timeDiff / (1000 * 3600 * 24));
}

/**
 * Check if date is today
 * @param {Date|string} date - Date to check
 * @returns {boolean} True if date is today
 */
function isToday(date) {
  const today = new Date();
  const checkDate = new Date(date);
  
  return today.getDate() === checkDate.getDate() &&
         today.getMonth() === checkDate.getMonth() &&
         today.getFullYear() === checkDate.getFullYear();
}

/**
 * Check if date is in the past
 * @param {Date|string} date - Date to check
 * @returns {boolean} True if date is in the past
 */
function isPast(date) {
  return new Date(date) < new Date();
}

/**
 * Check if date is in the future
 * @param {Date|string} date - Date to check
 * @returns {boolean} True if date is in the future
 */
function isFuture(date) {
  return new Date(date) > new Date();
}

/**
 * Get age from birth date
 * @param {Date|string} birthDate - Birth date
 * @returns {number} Age in years
 */
function getAge(birthDate) {
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  
  return age;
}

/**
 * Parse date from various formats
 * @param {string} dateString - Date string to parse
 * @returns {Date|null} Parsed date or null if invalid
 */
function parseDate(dateString) {
  if (!dateString) {
    return null;
  }
  
  // Try different date formats
  const formats = [
    // ISO format
    /^(\d{4})-(\d{2})-(\d{2})$/,
    // Australian format DD/MM/YYYY
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    // US format MM/DD/YYYY
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
  ];
  
  // Try ISO format first
  let match = dateString.match(formats[0]);
  if (match) {
    return new Date(dateString);
  }
  
  // Try DD/MM/YYYY format
  match = dateString.match(formats[1]);
  if (match) {
    const [, day, month, year] = match;
    return new Date(year, month - 1, day);
  }
  
  // Try standard Date parsing
  const date = new Date(dateString);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Get financial year for a given date (July 1 - June 30)
 * @param {Date|string} date - Date
 * @returns {string} Financial year (e.g., "2023-24")
 */
function getFinancialYear(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth();
  
  if (month >= 6) { // July onwards
    return `${year}-${(year + 1).toString().slice(-2)}`;
  } else { // January to June
    return `${year - 1}-${year.toString().slice(-2)}`;
  }
}

/**
 * Get quarter for a given date
 * @param {Date|string} date - Date
 * @returns {number} Quarter (1-4)
 */
function getQuarter(date) {
  const month = new Date(date).getMonth();
  return Math.floor(month / 3) + 1;
}

/**
 * Format duration in milliseconds to human readable format
 * @param {number} milliseconds - Duration in milliseconds
 * @returns {string} Formatted duration
 */
function formatDuration(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

module.exports = {
  DISPLAY_DATE_FORMAT,
  BPR_DATE_FORMAT,
  BPR_DATE_PATTERN,
  getCurrentTimestamp,
  getCurrentDate,
  formatDateAU,
  formatDisplayDate,
  parseDisplayDate,
  parseFlexibleDate,
  normalizeToDisplayDate,
  normalizeToIsoDate,
  formatBprDate,
  formatDateISO,
  formatDateTime,
  addDays,
  addMonths,
  addYears,
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  daysDifference,
  isToday,
  isPast,
  isFuture,
  getAge,
  parseDate,
  getFinancialYear,
  getQuarter,
  formatDuration
};