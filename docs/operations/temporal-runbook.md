# Temporal Runbook

Server: Oracle VPS, Docker Swarm (`docker-compose.prod-worker.yml`).
API path default: `temporal-direct.bishalbudhathoki.com:7236` (see
`core/TemporalManager.js`; supports mTLS via Secret-Manager volume mounts
and `TEMPORAL_TLS=false` plaintext). The worker container talks to the
server over the Docker bridge (`172.17.0.1:7237`, plaintext). Port 443
(Cloudflare) and direct external gRPC are firewalled — verify from the
VPS, not from laptops. Diagnostic: `node scripts/temporal-ping.js`.

## Task queues (never hardcode — use `TemporalManager.getTaskQueue()`)

| Queue | Environment |
|---|---|
| `default-dev` | dev (`invoice-660f3` / non-production) |
| `default-prod` | prod (`carenest-prods` / `NODE_ENV=production`) |

Stuck workflows on the bare `default` queue mean a starter bypassed the
helper — fix the starter, then terminate the stuck runs.

## Schedules (`scripts/register-temporal-schedules.js`)

| Schedule ID | Cron | Workflow |
|---|---|---|
| recurring-invoices-schedule | `0 0 * * *` | RecurringInvoiceCronWorkflow |
| recurring-expenses-schedule | `0 6 * * *` | RecurringExpenseCronWorkflow |
| overdue-reminders-schedule | `0 0 * * *` | OverdueRemindersCronWorkflow |
| dunning-schedule | `0 9 * * *` | DunningCronWorkflow |
| expense-reminders-schedule | `0 */6 * * *` | ExpenseRemindersCronWorkflow |
| timesheet-reminders-schedule | `0 * * * *` | TimesheetRemindersCronWorkflow |
| shift-reminders-schedule | `*/15 * * * *` | ShiftRemindersCronWorkflow |
| email-verification-schedule | `0 10 * * *` | EmailVerificationCronWorkflow |
| artifact-registry-cleanup-schedule | `0 2 * * 0` | CleanupArtifactRegistryWorkflow |
| invoice-ai-weekly-schedule | `0 0 * * 0` | InvoiceAICronWorkflow |
| jwt-rotation-check-schedule | `0 3 * * 1` | JwtRotationCheckWorkflow |
| ndis-catalog-sync-schedule | `0 4 * * *` | NdisCatalogSyncWorkflow |

Schedule IDs get a `-dev`/`-prod` suffix per environment. Registration
runs on worker startup when `REGISTER_TEMPORAL_SCHEDULES=true`.

## API-triggered workflows

| Workflow | Trigger | Idempotency |
|---|---|---|
| EmergencyNotificationWorkflow | emergency broadcast | `emergency-alert-<broadcast>-<user>` |
| authNotificationWorkflow | signup/reset/verify | per-email + timestamp |
| ShiftLifecycleWorkflow | shift.completed event | `shift-lifecycle-<shiftId>` REJECT_DUPLICATE |
| ShiftCancelWorkflow | shift.cancelled event | `shift-cancel-<shiftId>` REJECT_DUPLICATE |
| BulkInvoicesWorkflow | POST /bulk/generate-invoices?async=true | `bulk-invoices-<org>-<input-hash>` REJECT_DUPLICATE |
| SendInvoiceEmailWorkflow | invoice email send | `invoice-email-<hash>` REJECT_DUPLICATE |
| InvoiceProcessingWorkflow | shift saga child | `invoice-generation-<shiftId>` |

Job status: `GET /bulk/jobs/:workflowId` (org-scoped by embedded org).

## Adding a new workflow (checklist)

1. Activity in `temporal/activities/<area>.js` (plain JSON args only,
   explicit timeouts + retries).
2. Workflow in `temporal/workflows/<area>.js` + export in
   `temporal/workflows/index.js`.
3. Register activity in `temporal-worker.js`.
4. Schedule entry in `scripts/register-temporal-schedules.js` (cron) or
   `TemporalManager.startWorkflow` call site (API-triggered, deterministic
   workflowId for financial ops).
5. Unit tests (activity logic + registration + route behavior).
6. Observe first run in Temporal UI before retiring any legacy path.

## Parallel smoke test (`scripts/temporal-smoke.js`)

Fires every worker workflow concurrently and reports pass/fail. Must run
where Temporal is reachable (VPS/Dokploy host or tunnelled laptop).

```bash
node scripts/temporal-smoke.js --dry-run            # print plan only
node scripts/temporal-smoke.js --confirm             # 12 cron workflows
node scripts/temporal-smoke.js --confirm --only=cron,saga --org-id=<dev-org>
node scripts/temporal-smoke.js --confirm --only=bulk --org-id=<o> --appointment-ids=<a,b>
node scripts/temporal-smoke.js --confirm --only=email --email-to=<controlled-inbox>
```

Safety: `--confirm` required for live runs; cron acts on real (dev) data.
Saga runs lifecycle + cancel as a net-zero pair. Bulk/email are opt-in
(real invoices/emails). Push/auth/onboarding notifications are never
fired here (would spam real devices) — trigger those individually.

## Retired (2026-09)

`cron_backup/*`, `backend/workers/*`, root `recurring_expense_scheduler.js`
deleted (no launch points; superseded above). BullMQ path in
`core/QueueManager.js` deprecated (disabled on Cloud Run).

## Deployment (Dokploy, Oracle VPS)

- The dev and prod workers are separate Dokploy applications building the
  backend repo (`dev` branch → dev worker). **Auto-deploy on push is ON** —
  pushing `dev` rebuilds and recreates the worker container automatically.
- A rebuild (not a restart) is required for code changes; restarts reuse
  the old image. Manual path: app → Deployments → Redeploy with rebuild.
- After redeploy, expect in the worker log: all 12
  `Successfully updated schedule …-dev` lines (including
  `recurring-expenses`, `jwt-rotation-check`, `ndis-catalog-sync`),
  workflow bundle growth, and `state: 'RUNNING'` on the env queue.
- Rollout order for backend changes: worker first (new activities must
  exist before API starters invoke them), then Cloud Run API.
- Verified live 2026-09-20: clean startup, all schedules registered,
  executions firing on cadence (shift reminders every 15 min, expense +
  timesheet ticks at :00).

## Incident log

- **2026-09-20 — expense/timesheet reminders silently sending nothing.**
  Symptom in worker log: `TypeError: admin.messaging is not a function`,
  `Reminders sent: 0`. Root cause: firebase-admin v12 removed the
  `admin.messaging()` namespace API; both reminder services called it.
  Fix: route through the shared `config/firebase.getMessaging()` sender
  (same as notification activities). Regression test:
  `tests/middleware/expenseReminderDelivery.test.js`.
- **2026-09-20 — external gRPC unreachable.** TCP/TLS to the VPS succeed
  but handshakes stall from outside (firewall allowlists worker hosts).
  Not an outage: verify from the VPS (worker logs, Temporal UI,
  `temporal-ping.js` run on a host with access).
- **2026-09 — stuck-workflow risk.** Starters hardcoded task queue
  `'default'`, which no worker polls. Fixed centrally:
  `TemporalManager.getTaskQueue()` is the only allowed resolution;
  `temporalManager.test.js` pins dev/prod mapping. Stuck runs found on
  `default` should be terminated after fixing the starter.

## Deferred (sized, not started)

- Audit export streaming (`GET /api/audit/export` builds up to 10k rows
  inline; admin-only + rate-limited + capped — revisit if exports time
  out in practice).
- assign-shifts / send-messages async variants (single-query today;
  apply the bulk-job pattern if batch sizes grow).
- `cryptoHelpers.sendOtpEmail` dead export (superseded by
  authNotificationWorkflow) — remove after confirming no dynamic callers.
- Biometric app lock (`local_auth` — new dependency, needs approval).
