/**
 * Time-value helpers shared by payroll/invoice code.
 *
 * Worked time is stored as `"HH:mm:ss"`, but legacy rows and the temporal
 * saga have written numbers. Every consumer must accept both.
 */

/**
 * Convert a worked-time value into decimal hours.
 *
 * @param {string|number|null|undefined} value - "HH:mm:ss", numeric hours, or a numeric string.
 * @returns {number} Decimal hours (0 for unparseable input).
 */
function parseDurationToHours(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  const text = String(value).trim();
  if (!text) return 0;

  // Plain numeric hours (legacy/temporal rows).
  if (/^\d+(\.\d+)?$/.test(text)) return parseFloat(text);

  const parts = text.split(':').map(Number);
  if (parts.length < 2 || parts.some((part) => !Number.isFinite(part))) return 0;

  const [hours, minutes, seconds = 0] = parts;
  return hours + minutes / 60 + seconds / 3600;
}

/**
 * Convert seconds into `"HH:mm:ss"` (hours are not capped at 24).
 *
 * @param {number} totalSeconds
 * @returns {string}
 */
function formatDurationFromSeconds(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

module.exports = {
  parseDurationToHours,
  formatDurationFromSeconds,
};
