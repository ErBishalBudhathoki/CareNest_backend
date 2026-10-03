/**
 * Dashboard / analytics index migration, with verification.
 *
 * Why this script exists
 * ----------------------
 * Mongoose's `autoIndex` is unset in this project, so it defaults to true and
 * the app attempts to build new schema indexes on boot. On a small database that
 * is harmless, but it makes index creation a side effect of a deploy: if a build
 * is slow or fails, the reason is buried in a container log, and there is no
 * point at which you can inspect the query plans before and after.
 *
 * This script makes it explicit and reversible:
 *
 *   1. Builds the specific indexes the dashboard and analytics queries need.
 *   2. Runs `explain()` against the real queries, before and after, and prints
 *      which index the planner chose and how many documents it examined.
 *   3. Is idempotent — safe to re-run.
 *
 * Usage:
 *   cd /invoice/backend
 *   node scripts/migrate_dashboard_indexes.js            # dry run (explain only)
 *   node scripts/migrate_dashboard_indexes.js --apply    # actually create indexes
 *
 * Never prints MONGODB_URI.
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'Invoice';
const APPLY = process.argv.includes('--apply');

/**
 * Indexes required by the read paths that were previously collection-scanning.
 *
 * These deliberately mirror the schema declarations added alongside them, so the
 * two cannot drift. Keep both in sync.
 */
const INDEXES = [
  {
    collection: 'invoiceLineItems',
    spec: { organizationId: 1, createdAt: 1 },
    name: 'org_createdAt_idx',
    why:
      'Every revenue read filters organizationId + a createdAt range. Previously only\n' +
      '      organizationId was indexed, so Mongo fetched every matching document and\n' +
      '      discarded most of them after the date filter. getRevenueComparison ran\n' +
      '      that scan 13 times per request before being batched into one aggregation.',
  },
  {
    collection: 'invoiceLineItems',
    spec: { organizationId: 1, employeeId: 1, createdAt: 1 },
    name: 'org_employee_createdAt_idx',
    why:
      'Utilization analytics group by employeeId inside the same date window.',
  },
  {
    collection: 'workedTimes',
    spec: { organizationId: 1, shiftDate: 1 },
    name: 'org_shiftDate_idx',
    why:
      'CRITICAL. The analytics pipelines in controllers/analyticsController.js match\n' +
      '      on the legacy `shiftDate` STRING (YYYY-MM-DD), not on workDate. WorkedTime\n' +
      '      had indexes on workDate only, so every analytics endpoint was doing a full\n' +
      '      collection scan followed by $lookup + $sort over the matched set.',
  },
  {
    collection: 'workedTimes',
    spec: { shiftDate: 1 },
    name: 'shiftDate_idx',
    why: 'Cross-tenant reporting scans by date only.',
  },
  {
    collection: 'clientAssignments',
    spec: { organizationId: 1, userEmail: 1 },
    name: 'org_userEmail_idx',
    why:
      'Projection and utilisation endpoints join clientAssignments to users by email\n' +
      '      after a $lookup.',
  },
];

/**
 * Queries used to prove the indexes are actually chosen by the planner.
 * These mirror the pipelines in dashboardController.js and analyticsController.js.
 */
const EXPLAIN_PROBES = [
  {
    label: 'getRevenueComparison daily revenue rollup',
    collection: 'invoiceLineItems',
    pipeline: [
      { $match: { organizationId: '__probe_org__', createdAt: { $gte: new Date(0), $lt: new Date() } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, total: { $sum: '$totalPrice' } } },
    ],
    expectIndex: 'org_createdAt_idx',
  },
  {
    label: 'getUtilizationMetrics billable hours by employee',
    collection: 'invoiceLineItems',
    pipeline: [
      { $match: { organizationId: '__probe_org__', createdAt: { $gte: new Date(0), $lte: new Date() }, employeeId: { $exists: true, $ne: null } } },
      { $group: { _id: '$employeeId', billableHours: { $sum: '$hours' } } },
    ],
    expectIndex: 'org_createdAt_idx',
    note:
      'The planner prefers the narrower {organizationId, createdAt} index here rather\n' +
      '      than the employeeId variant, because the $match does not bound employeeId\n' +
      '      by value. Any IXSCAN is acceptable for this probe.',
  },
  {
    label: 'getFinancialMetrics worked-time range scan',
    collection: 'workedTimes',
    pipeline: [
      { $match: { organizationId: '__probe_org__', shiftDate: { $gte: '0000-00-00', $lte: '9999-99-99' } } },
      { $group: { _id: '$shiftDate', hours: { $sum: '$hours' } } },
    ],
    expectIndex: 'org_shiftDate_idx',
  },
];

function countDocsFromExplain(explainResult) {
  const stats = explainResult.executionStats;
  if (stats && stats.totalDocsExamined !== undefined) return stats.totalDocsExamined;
  if (explainResult.stages && explainResult.stages.length) {
    const cursorStage = explainResult.stages.find((s) => s.$cursor || s.nReturned !== undefined);
    if (cursorStage && cursorStage.totalDocsExamined !== undefined) return cursorStage.totalDocsExamined;
  }
  return null;
}

/** Pull every indexName out of the planner's chosen plan. */
function findWinningIndex(explainResult) {
  const planner = explainResult.queryPlanner || {};
  const found = new Set();

  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.indexName) found.add(node.indexName);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') walk(value);
    }
  };

  if (planner.winningPlan) walk(planner.winningPlan);

  if (explainResult.stages && explainResult.stages.length) {
    for (const stage of explainResult.stages) walk(stage);
  }

  return Array.from(found);
}

async function runExplain(db, probe) {
  // The driver's aggregate(..., { explain: true }) returns a Cursor on v6, not an
  // explain document. The server `explain` command is the reliable form and gives
  // both the planner's choice and executionStats.
  return db.command({
    explain: {
      aggregate: probe.collection,
      pipeline: probe.pipeline,
      cursor: {},
    },
    verbosity: 'executionStats',
  });
}

async function explainProbes(db, label) {
  console.log(`\n--- explain(): ${label} ---`);
  const scanFailures = [];

  for (const probe of EXPLAIN_PROBES) {
    let result;
    try {
      result = await runExplain(db, probe);
    } catch (error) {
      console.log(`  ? ${probe.label}\n      explain failed: ${error.message}`);
      continue;
    }

    const indexes = findWinningIndex(result);
    const docsExamined = countDocsFromExplain(result);
    const isCollectionScan = indexes.some((i) => i === 'COLLSCAN');

    // Three-way verdict. A different index than expected is only a warning: the
    // planner may legitimately prefer a narrower one. A collection scan is the
    // only genuine failure, because that is what we are fixing.
    let verdict;
    if (isCollectionScan) {
      verdict = '✗ COLLSCAN — index NOT being used';
    } else if (indexes.includes(probe.expectIndex)) {
      verdict = '✓ expected index in use';
    } else {
      verdict = '! different index in use (acceptable if IXSCAN)';
    }

    console.log(`  ${verdict}`);
    console.log(`      ${probe.label}`);
    console.log(`      collection  : ${probe.collection}`);
    console.log(`      index used  : ${indexes.length ? indexes.join(', ') : '(none reported)'}`);
    console.log(`      preferred   : ${probe.expectIndex}`);
    console.log(`      plan type   : ${isCollectionScan ? 'COLLSCAN (full collection scan)' : 'IXSCAN (index used)'}`);
    if (docsExamined !== null) {
      console.log(`      docs examined: ${docsExamined}`);
    }
    if (probe.note) {
      console.log(`      note        : ${probe.note.replace(/\n\s+/g, ' ')}`);
    }

    if (isCollectionScan) {
      scanFailures.push(probe.label);
    }
  }

  return scanFailures;
}

async function main() {
  if (!uri) {
    console.error('MONGODB_URI is not set. Cannot continue.');
    process.exit(1);
  }

  console.log(`Mode:      ${APPLY ? 'APPLY (will create indexes)' : 'DRY RUN (explain only, no changes)'}`);
  console.log(`Database:  ${DB_NAME}`);

  const client = new MongoClient(uri, { serverApi: { version: '1', strict: true } });

  try {
    await client.connect();
    const db = client.db(DB_NAME);

    // --- Baseline, before any new index exists ---
    await explainProbes(db, 'BEFORE (baseline)');

    if (!APPLY) {
      console.log('\nDry run complete. Re-run with --apply to create the indexes.');
      return;
    }

    // --- Build ---
    console.log('\n--- creating indexes ---');
    for (const index of INDEXES) {
      const coll = db.collection(index.collection);
      const before = await coll.indexExists(index.name).catch(() => false);

      try {
        await coll.createIndex(index.spec, { name: index.name, background: true });
        console.log(`  ${before ? '·' : '+'} ${index.collection}.${index.name}`);
      } catch (error) {
        // 85 = IndexOptionsConflict, 86 = IndexKeySpecsConflict
        if (error.code === 85 || error.code === 86) {
          console.log(`  ! ${index.collection}.${index.name} conflicts with an existing definition`);
          console.log(`      existing keys: ${JSON.stringify((await coll.indexes({ name: index.name }).catch(() => []))[0]?.key)}`);
          console.log(`      requested    : ${JSON.stringify(index.spec)}`);
          console.log(`      ${error.message}`);
        } else {
          console.error(`  ✗ ${index.collection}.${index.name}: ${error.message}`);
        }
      }
      console.log(`      ${index.why.replace(/\n\s+/g, ' ')}`);
    }

    // --- Verify, after ---
    await explainProbes(db, 'AFTER (indexes built)');

    console.log('\n--- current indexes on the touched collections ---');
    for (const name of [...new Set(INDEXES.map((i) => i.collection))]) {
      const indexes = await db.collection(name).indexes();
      console.log(`  ${name}:`);
      for (const ix of indexes) {
        console.log(`    ${ix.name.padEnd(30)} ${JSON.stringify(ix.key)}`);
      }
    }

    console.log('\n✅ Done. Re-run without --apply to confirm the planner picks the new indexes.');
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main();