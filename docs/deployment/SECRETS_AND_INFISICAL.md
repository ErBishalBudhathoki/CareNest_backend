# Secret Management: How Secrets Flow Through the System

> **Last updated:** 2026-08-15
>
> This document explains where secrets live, which sources the different
> environments actually read from, and what is (and isn't) automated today.
> **No actual secret values or credentials appear in this document.**

---

## 1. The Short Answer

**No, the backend does not read from Infisical at runtime yet.**

- **Cloud Run** (dev + prod API) loads secrets from **Google Secret Manager** at
  startup, as one consolidated JSON blob per environment.
- **VPS Temporal workers** (Dokploy) receive secrets as plain environment
  variables defined inside the Dokploy app / compose file.
- **Infisical** is self-hosted on the VPS and currently holds the same secrets,
  but **nothing consumes Infisical directly at runtime today**.
- There is **no automatic, real-time push** from Infisical to anywhere else.
  The `.github/workflows/sync-gcp-secrets.yml` workflow (added 2026-08-15)
  introduces an *automated* Infisical → Secret Manager sync (daily + manual),
  but it has **not yet been run successfully for prod** (billing blocker).

---

## 2. Where Secrets Are Actually Stored

| Store | Location | Purpose |
|-------|----------|---------|
| **Infisical** | `https://secrets.bishalbudhathoki.com` (self-hosted on VPS) | Intended source of truth; secrets stored under `/backend` path, per environment (`dev`, `prod`) |
| **Google Secret Manager (dev)** | `app-secrets-dev` in project `invoice-660f3` | Read at runtime by the dev Cloud Run service |
| **Google Secret Manager (prod)** | `app-secrets-prod` in project `carenest-prods` | Read at runtime by the prod Cloud Run service |
| **Local file** | `backend/scripts/secrets.json` | Development fallback; also the *manual* upload source |
| **Dokploy app env** | VPS, per-application environment variables | Feeds the Temporal workers running on the VPS |

> The consolidated Secret Manager blobs hold **all** secrets for an environment
> in one JSON object (this is what `config/secretLoader.js` parses).

---

## 3. How Each Environment Actually Loads Secrets

### 3.1 Cloud Run (API — dev & prod)

1. Cloud Run sets `K_SERVICE` and `CONSOLIDATED_SECRET_NAME`.
2. `server.js` calls `loadSecrets()` from `config/secretLoader.js`.
3. `secretLoader.js` detects Cloud Run (`!!process.env.K_SERVICE`) and fetches
   `projects/{projectId}/secrets/{secretName}/versions/latest` via the
   Secret Manager client.
4. The payload is a flat JSON object; every key is applied to `process.env`.
5. Fallbacks in order: Secret Manager → `scripts/secrets.json` (local) →
   process environment.

Mapping (from `config/secretLoader.js`):

| `NODE_ENV` | Project | Secret name |
|------------|---------|-------------|
| `production` | `carenest-prods` | `app-secrets-prod` |
| `development` | `invoice-660f3` | `app-secrets-dev` |

The Cloud Run runtime service account must hold
`roles/secretmanager.secretAccessor` on the secret.

### 3.2 VPS Temporal Workers (Dokploy)

- Launched via `docker-compose.prod-worker.yml`
  (`command: ["node", "temporal-worker.js"]`).
- Secrets come from **Dokploy's per-application environment variables**, which
  are substituted as `${VAR}` before the stack deploys.
- `temporal-worker.js` also calls `dotenv.config()` with
  `.env.{NODE_ENV}`, so a checked-in `.env.development` / `.env.production`
  can supply values as well.
- **Infisical is not involved** in the worker path today. Wiring this up is a
  future step (e.g. wrapping the container command with `infisical run --`).

---

## 4. How Secrets Get In / Synced

### 4.1 Manual upload path (legacy, still used)

```bash
cd backend
npm run secrets:upload:dev    # pushes scripts/secrets.json -> app-secrets-dev
npm run secrets:upload:prod   # pushes scripts/secrets.json -> app-secrets-prod
```

These use `scripts/upload-secrets.js`, which reads `scripts/secrets.json` and
writes the whole environment's object as a new Secret Manager version.

### 4.2 Automated sync path (new — `sync-gcp-secrets.yml`)

Source of truth: **Infisical**.

- **Triggers:** `workflow_dispatch` (choose `dev`, `prod`, or `all`) and a
  nightly cron (`0 3 * * *`).
- **Flow (per environment, separate job):**
  1. Authenticate to Google Cloud via Workload Identity Federation
     (`WIF_PROVIDER` / `WIF_SERVICE_ACCOUNT` for dev,
     `PROD_WIF_PROVIDER` / `PROD_WIF_SERVICE_ACCOUNT` for prod).
  2. Login to Infisical using a **universal-auth machine identity**
     (`INFISICAL_CLIENT_ID` / `INFISICAL_CLIENT_SECRET` — stored as GitHub
     Actions secrets, **not** in the repo).
  3. `infisical export --env <env> --path /backend --format=json`
  4. Convert the exported list into a flat object:
     `jq 'map({key: .key, value: .value}) | from_entries'`
  5. `gcloud secrets versions add app-secrets-{dev,prod} --data-file=...`
- **IAM required:** the WIF service account needs
  `roles/secretmanager.admin` on its project to add versions.

> **Note:** the export command returns a *list* of `{key, value}` objects, not
> a flat map — the `jq` transform above is what produces the object shape that
> `secretLoader.js` expects (`JSON.parse(payload)` in `config/secretLoader.js`).

---

## 5. What Is Automated vs Manual (as of 2026-08-15)

| Source → Target | Automated? | Notes |
|-----------------|-----------|-------|
| Infisical → Secret Manager | **Workflow added, not yet green for prod** | Daily cron + manual trigger; **prod blocked by billing disabled on `carenest-prods`** |
| Local `secrets.json` → Secret Manager | Manual | `npm run secrets:upload:*` |
| Secret Manager → Cloud Run | Automatic at deploy/startup | Service reads `versions/latest` |
| Dokploy env → Temporal workers | Manual | Set in Dokploy UI / compose vars |
| Infisical → Dokploy workers | Not wired | Future: `infisical run --` wrapper |

---

## 6. Key Files

| File | Role |
|------|------|
| `config/secretLoader.js` | Runtime loader (Secret Manager → `process.env`) |
| `scripts/secrets.json` | Local/legacy source of truth |
| `scripts/upload-secrets.js` | Manual uploader to Secret Manager |
| `scripts/restore-individual-secrets.js` | Legacy: back to individual secrets |
| `.github/workflows/sync-gcp-secrets.yml` | Infisical → Secret Manager automation |
| `docker-compose.prod-worker.yml` | VPS Temporal worker + env wiring |
| `temporal-worker.js` | Worker entrypoint (dotenv + `process.env`) |

---

## 7. Operational Notes / Known Issues

1. **Prod billing is disabled.** `carenest-prods` reports
   `billingEnabled: false`, so `gcloud secrets versions add` fails with
   `BILLING_DISABLED`. Re-enable billing (and verify `app-secrets-prod`
   exists) before relying on the prod sync job.
2. **No real-time sync.** Changes in Infisical propagate only when the sync
   workflow runs (or you run the manual upload). For fast dev loops, run the
   workflow via `workflow_dispatch`.
3. **Cloud Run reads the secret at startup.** A new Secret Manager version
   does **not** hot-reload into a running service; the service must be
   redeployed/restarted to pick up the new `latest` version.
4. **Machine identity is scoped.** The Infisical universal-auth identity used
   by CI should be restricted to the `/backend` path and the needed
   environments, not granted admin over the whole Infisical project.
5. **Never commit real secrets.** Everything above keeps values out of the
   repo; secrets live in Infisical / Secret Manager / Dokploy, and credentials
   for automation live in GitHub Actions secrets.
