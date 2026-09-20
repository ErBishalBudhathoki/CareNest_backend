/**
 * Parallel Temporal smoke test — fires every worker workflow concurrently
 * and reports pass/fail per workflow.
 *
 * MUST run where the Temporal server is reachable (VPS/Dokploy host or a
 * tunnelled laptop — external gRPC is firewalled). Uses the dev task queue
 * unless the env resolves to prod.
 *
 * SAFETY: cron workflows only process DUE data (idempotent re-runs), but
 * bulk/email/saga paths WRITE. Defaults are net-zero or skipped:
 *   - shift saga runs lifecycle + cancel as a pair (row created then voided)
 *   - bulk + invoice-email are OPT-IN (need real dev appointment IDs /
 *     a controlled inbox) — skipped otherwise
 *   - push/auth/onboarding notification workflows are NEVER fired here
 *     (they would spam real devices); trigger those individually instead
 *
 * Usage:
 *   node scripts/temporal-smoke.js --confirm [--only=cron,saga]
 *     [--org-id=...] [--appointment-ids=a,b --email-to=you@x.com]
 *     [--api-base=https://... --id-token=...] [--timeout-ms=600000]
 *     [--dry-run]
 *
 * --confirm is REQUIRED for live runs (cron workflows act on real data:
 * create invoices/expenses, send reminders). Double-check your env
 * (FIREBASE_PROJECT_ID / NODE_ENV) targets dev before confirming.
 */
const TemporalManager = require('../core/TemporalManager');
const logger = require('../config/logger');

const GROUPS = {
  cron: [
    'RecurringInvoiceCronWorkflow',
    'RecurringExpenseCronWorkflow',
    'OverdueRemindersCronWorkflow',
    'DunningCronWorkflow',
    'ExpenseRemindersCronWorkflow',
    'TimesheetRemindersCronWorkflow',
    'ShiftRemindersCronWorkflow',
    'EmailVerificationCronWorkflow',
    'CleanupArtifactRegistryWorkflow',
    'InvoiceAICronWorkflow',
    'JwtRotationCheckWorkflow',
    'NdisCatalogSyncWorkflow',
  ],
  saga: ['ShiftLifecycleWorkflow', 'ShiftCancelWorkflow'],
  bulk: ['BulkInvoicesWorkflow'],
  email: ['SendInvoiceEmailWorkflow'],
};

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)(=(.*))?$/);
    if (match) out[match[1]] = match[3] === undefined ? true : match[3];
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitClosed(client, workflowId, timeoutMs, pollMs = 5000) {
  const handle = client.workflow.getHandle(workflowId);
  const startedAt = Date.now();
  for (;;) {
    const desc = await handle.describe();
    const status = String((desc.status && desc.status.name) || desc.status || '');
    if (
      ['COMPLETED', 'FAILED', 'TIMED_OUT', 'TERMINATED', 'CANCELED', 'CANCELLED'].includes(
        status,
      )
    ) {
      let result = null;
      let error = null;
      try {
        result = status === 'COMPLETED' ? await handle.result() : null;
      } catch (err) {
        error = err.message;
      }
      return { status, result, error, durationMs: Date.now() - startedAt };
    }
    if (Date.now() - startedAt > timeoutMs) {
      return { status: `TIMEOUT waiting (${status})`, result: null, error: 'poll timeout', durationMs: Date.now() - startedAt };
    }
    await sleep(pollMs);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const only = String(args.only || 'cron,saga')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const timeoutMs = Number(args['timeout-ms']) || 600000;
  const dryRun = Boolean(args['dry-run']);
  const ts = Date.now();
  const orgId = args['org-id'] || null;

  const plan = [];
  if (only.includes('cron')) {
    for (const name of GROUPS.cron) {
      plan.push({ name, workflowId: `smoke-${ts}-${name}`, args: name === 'JwtRotationCheckWorkflow' ? [{ maxKeyAgeDays: 30 }] : name === 'NdisCatalogSyncWorkflow' ? [{ reason: 'smoke' }] : [] });
    }
  }
  if (only.includes('saga')) {
    if (!orgId) {
      console.log('saga group needs --org-id (dev org); skipping saga.');
    } else {
      const shiftId = `smoke-${ts}`;
      plan.push({
        name: 'ShiftLifecycleWorkflow',
        workflowId: `smoke-shift-lifecycle-${ts}`,
        args: [
          {
            shift: {
              id: shiftId,
              employeeEmail: 'smoke@example.com',
              clientEmail: 'smoke-client@example.com',
              startTime: new Date().toISOString(),
              endTime: new Date().toISOString(),
              breakDuration: 0,
              organizationId: orgId,
            },
          },
        ],
      });
      plan.push({
        name: 'ShiftCancelWorkflow',
        workflowId: `smoke-shift-cancel-${ts}`,
        args: [{ shiftId, organizationId: orgId }],
        after: 'ShiftLifecycleWorkflow',
      });
    }
  }
  if (only.includes('bulk')) {
    const ids = String(args['appointment-ids'] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!orgId || !ids.length) {
      console.log('bulk group needs --org-id + --appointment-ids (creates REAL dev invoices); skipping.');
    } else {
      plan.push({
        name: 'BulkInvoicesWorkflow',
        workflowId: `smoke-bulk-${ts}`,
        args: [{ appointmentIds: ids, organizationId: orgId, groupByClient: false }],
      });
    }
  }
  if (only.includes('email')) {
    if (!args['email-to']) {
      console.log('email group needs --email-to (controlled inbox); skipping.');
    } else {
      const pdfBase64 = Buffer.from('%PDF-1.4 smoke test').toString('base64');
      plan.push({
        name: 'SendInvoiceEmailWorkflow',
        workflowId: `smoke-email-${ts}`,
        args: [
          {
            to: args['email-to'],
            subject: 'Temporal smoke test — ignore',
            text: 'Smoke test email, safe to ignore.',
            pdfBase64,
            fileName: 'smoke.pdf',
          },
        ],
      });
    }
  }

  console.log(`plan (${plan.length} workflows, taskQueue=${dryRun ? '?' : TemporalManager.getTaskQueue()}):`);
  for (const p of plan) console.log(`  - ${p.name} [${p.workflowId}]${p.after ? ` (after ${p.after})` : ''}`);
  if (dryRun || !plan.length) return;

  if (!args.confirm) {
    console.log('\nREFUSING live run without --confirm: cron workflows act on real');
    console.log('data (invoices, reminders, emails). Re-run with --confirm after');
    console.log(`checking env targets dev (queue would be: ${TemporalManager.getTaskQueue()}).`);
    return;
  }

  const client = await TemporalManager.getClient();
  const taskQueue = TemporalManager.getTaskQueue();
  const started = new Map();

  // Start everything in parallel (saga-cancel waits for lifecycle first).
  const sagaCancel = plan.find((p) => p.after);
  const firstWave = plan.filter((p) => p !== sagaCancel);
  const startOne = async (p) => {
    try {
      await client.workflow.start(p.name, {
        taskQueue,
        workflowId: p.workflowId,
        args: p.args,
      });
      started.set(p.workflowId, p);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  console.log('\nstarting first wave in parallel...');
  const firstResults = await Promise.all(firstWave.map(startOne));
  firstWave.forEach((p, i) => {
    if (!firstResults[i].ok) console.log(`  START FAILED ${p.name}: ${firstResults[i].error}`);
  });

  if (sagaCancel) {
    const lifecycle = plan.find((p) => p.name === 'ShiftLifecycleWorkflow');
    console.log('waiting for lifecycle before cancel...');
    const w = await waitClosed(client, lifecycle.workflowId, timeoutMs);
    console.log(`  lifecycle: ${w.status} (${w.durationMs}ms)`);
    const r = await startOne(sagaCancel);
    console.log(r.ok ? '  cancel started' : `  cancel START FAILED: ${r.error}`);
  }

  console.log('\npolling all to close...');
  const outcomes = [];
  await Promise.all(
    [...started.keys()].map(async (workflowId) => {
      const p = started.get(workflowId);
      // Already-closed workflows return immediately.
      const w = await waitClosed(client, workflowId, timeoutMs);
      outcomes.push({ name: p.name, workflowId, ...w });
    }),
  );

  console.log('\n== smoke results ==');
  let failed = 0;
  for (const o of outcomes) {
    const pass = o.status === 'COMPLETED';
    if (!pass) failed += 1;
    console.log(
      `${pass ? 'PASS' : 'FAIL'}  ${o.name}  ${o.status}  ${o.durationMs}ms` +
        (o.error ? `  err=${String(o.error).slice(0, 120)}` : ''),
    );
  }
  // Optional API-path check for bulk (needs a dev Firebase ID token).
  if (args['api-base'] && args['id-token'] && only.includes('bulk')) {
    console.log('\nAPI-path bulk check skipped in-script: POST <api-base>/api/bulk/generate-invoices?async=true with your token, then GET /api/bulk/jobs/:id.');
  }
  await TemporalManager.close();
  if (failed) {
    console.log(`\n${failed} workflow(s) did not complete — inspect in Temporal UI.`);
    process.exitCode = 1;
  } else {
    console.log('\nAll smoke workflows completed.');
  }
}

main().catch((err) => {
  console.error('SMOKE_FAILED:', err.message);
  process.exitCode = 1;
});
