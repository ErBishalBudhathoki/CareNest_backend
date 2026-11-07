/**
 * Standard Invoicing <-> SIL billing boundary.
 *
 * CareNest has two independent billing pipelines:
 *   - "Invoice Operations" (standard): Client / Employee invoices built from
 *     ClientAssignment + WorkedTime, with a Shift fallback.
 *   - "Configuration & Finance -> SIL Management & NDIS Claiming": SIL
 *     invoices built from SILRosterOfCare / Shift, plus NDIS claim batches.
 *
 * A WorkedTime row saved against a SIL Shift carries `silShiftId` (or
 * `isIrregularSil`), and a materialised SIL Shift carries
 * `silRosterOfCareId`. Those rows are the SAME hours the SIL pipeline bills.
 * Without an explicit exclusion, a standard invoice run absorbs them and the
 * client is billed twice for one shift.
 *
 * Keep the exclusions here so every standard-billing query uses the identical
 * predicate and a regression test can assert the boundary.
 */

// `{ field: null }` matches both "absent" and "explicitly null" in MongoDB,
// which matters for legacy WorkedTime/Shift documents written before the SIL
// fields were added.
const STANDARD_WORKED_TIME_EXCLUSIONS = Object.freeze({
  silShiftId: null,
  isIrregularSil: { $ne: true },
});

const STANDARD_SHIFT_EXCLUSIONS = Object.freeze({
  silRosterOfCareId: null,
  isIrregularSil: { $ne: true },
});

/** True when a worked-time row belongs to the SIL pipeline. */
function isSilWorkedTime(row) {
  if (!row) return false;
  return Boolean(row.silShiftId) || row.isIrregularSil === true;
}

/** True when a shift belongs to the SIL pipeline. */
function isSilShift(shift) {
  if (!shift) return false;
  return Boolean(shift.silRosterOfCareId) || shift.isIrregularSil === true;
}

/**
 * Ids of SIL-tagged worked-time rows that the SIL pipeline CANNOT claim.
 *
 * `activeTimerController.js` stamps `silShiftId` from a best-effort overlap
 * lookup and `scripts/backfill_worked_time_shift_links.js` links legacy rows by
 * matching, so a link can point at a deleted shift or at a shift that was
 * never materialised from a SIL roster. `STANDARD_WORKED_TIME_EXCLUSIONS`
 * blindly drops every tagged row; without this recovery those hours would be
 * excluded from standard invoicing AND never billed by SIL — silent revenue
 * loss. Rows whose link resolves to a genuine SIL shift stay excluded, which
 * is what prevents double-billing.
 *
 * Pure function: the caller supplies the tagged rows and the resolved Shift
 * documents, so the boundary is unit-testable without a database.
 */
function findOrphanSilWorkedTimeIds(linkedRows = [], shifts = []) {
  const genuineShiftIds = new Set(
    shifts.filter(isSilShift).map((shift) => String(shift._id))
  );

  return linkedRows
    .filter((row) => {
      if (!row) return false;
      // Irregular SIL has no Shift document to resolve against; it is a valid
      // SIL billing signal on its own and must never be "recovered".
      if (row.isIrregularSil === true) return false;
      if (!row.silShiftId) return true;
      return !genuineShiftIds.has(String(row.silShiftId));
    })
    .map((row) => row._id)
    .filter(Boolean);
}

module.exports = {
  STANDARD_WORKED_TIME_EXCLUSIONS,
  STANDARD_SHIFT_EXCLUSIONS,
  isSilWorkedTime,
  isSilShift,
  findOrphanSilWorkedTimeIds,
};
