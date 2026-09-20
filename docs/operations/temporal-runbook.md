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

## Retired (2026-09)

`cron_backup/*`, `backend/workers/*`, root `recurring_expense_scheduler.js`
deleted (no launch points; superseded above). BullMQ path in
`core/QueueManager.js` deprecated (disabled on Cloud Run).

## Deferred (sized, not started)

- Audit export streaming (`GET /api/audit/export` builds up to 10k rows
  inline; admin-only + rate-limited + capped — revisit if exports time
  out in practice).
- assign-shifts / send-messages async variants (single-query today;
  apply the bulk-job pattern if batch sizes grow).
- `cryptoHelpers.sendOtpEmail` dead export (superseded by
  authNotificationWorkflow) — remove after confirming no dynamic callers.
- Biometric app lock (`local_auth` — new dependency, needs approval).
