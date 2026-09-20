# Transport Security — Frontend ↔ Backend Encryption

Date: 2026-09-20/21. Status: implemented, verified, internal-testing build
`4.7.8+205→206` uploaded to Play; backend live on dev Cloud Run.
Companion evidence: `MITM_PINNING_VERIFICATION.md` + `mitm_flows_sanitized.json`
(same folder).

## 1. Threat model

NDIS participant PII (names, emails, invoices, client lists, auth tokens)
travels between the Flutter app and the Node backend. TLS alone trusts
~150 system CAs, so any *additionally* trusted CA (rogue Wi-Fi portal,
corporate proxy, malware-installed CA, malicious MDM profile) silently
decrypts everything. We demonstrated exactly this with mitmproxy: 26 API
flows fully readable, including a 972-char Firebase JWT and the App Check
token. The work below closes that hole in layers.

## 2. Layer overview

| # | Layer | Where enforced | What it stops |
|---|---|---|---|
| 1 | TLS/HTTPS in transit | Cloud Run edge + `https://` base URLs | Passive eavesdropping |
| 2 | Certificate pinning (GTS roots only) | Flutter (`pinned_http_client.dart`) | Rogue-CA MITM — fail closed |
| 3 | HTTPS-only base URLs | Flutter (`environment.dart`) | Accidental plaintext misconfiguration |
| 4 | HSTS (1y, subdomains, preload) | Backend (`app.js`) | Protocol-downgrade attacks |
| 5 | Plaintext rejection (426) | Backend (`requireHttps.js`) | Non-TLS traffic reaching the app |
| 6 | Firebase Auth + App Check | Existing, unchanged | Unauthorized callers |
| 7 | ChaCha20-Poly1305 field encryption | Flutter (`encrypt_decrypt.dart`) | Sensitive field readable at TLS terminators/logs |

## 3. Frontend changes (repo: frontend, commit `c9206ec`)

### 3.1 `lib/backend/pinned_http_client.dart` (NEW, ~120 lines)
CA-constrained HTTP client. Builds `SecurityContext(withTrustedRoots:
false)` loaded with **only the 4 Google Trust Services roots** (see §6),
so only GTS-chained certificates validate. `badCertificateCallback`
logs-and-rejects (never silently accepts).
`clientForBackendUrl(baseUrl, uri, {shared})` returns the pinned client
for the backend host, a standard system-trust client for anything else
(Firebase, CDNs). `shared: false` mints a fresh instance for callers that
`close()` their client (SSE streams).

### 3.2 `lib/backend/api_method.dart` (~100 call sites)
All `http.get/post/put/patch/delete/head` top-level calls rerouted
through thin `_get/_post/…` wrappers backed by `_clientFor(uri)`; the 4
`MultipartRequest.send()` sites use `_send(request)`. No request logic
changed. The two `EncryptDecrypt` call sites gained `await` (API is now
async). `http.Response.fromStream`, `MultipartFile`, type references
untouched.

### 3.3 `lib/app/shared/utils/encryption/encrypt_decrypt.dart`
Replaced hand-rolled ChaCha20 (fixed zero IV, no auth tag, 44-byte misuse
of a base64 string as key) with `cryptography: ^2.9.0`
(`pubspec.yaml`) `Chacha20.poly1305Aead()`. New blobs: `v2:` +
`base64url(nonce[12] ‖ ciphertext ‖ mac[16])`, key = `SHA-256(stored
secret)`. Pre-AEAD blobs still decrypt via a deprecated read-only
fallback (backend stores the field opaquely — no backend change needed).

### 3.4 `lib/config/environment.dart`
`checkTransportSecurity()`: release builds throw `StateError` on
non-local `http://` base URLs (localhost/loopback/RFC-1918/ULA still
allowed); debug builds log a warning. String-based host check — no
`dart:io`, web-safe.

### 3.5 `lib/app/features/security/views/api_usage_dashboard_view.dart`
SSE client now a fresh (closeable) pinned instance instead of a plain
`http.Client()`.

### 3.6 Tests (18 new, all passing)
- `test/app/shared/utils/encryption/encrypt_decrypt_test.dart` (8):
  round-trip, nonce freshness, tamper/wrong-key/truncation rejection,
  null handling, legacy-vector compat.
- `test/config/url_resolution_test.dart` (+5): release accept/reject,
  local-host allowlist incl. 172.16/12 boundaries, debug warning.
- `test/backend/pinned_http_client_test.dart` (5): routing, instance
  sharing, closeable instances, case-insensitive hosts.

## 4. Backend changes (repo `CareNest_backend`, commit `91a87df`, dev branch)

Deployed to dev Cloud Run via workflow `Backend Deploy - Development
(Hybrid Secure)`, run `35515188558` (success). Live-verified:
`strict-transport-security: max-age=31536000; includeSubDomains; preload`
(old Helmet default was `15552000`, no preload — proves the new code
serves) and `/api/health` → 200.

### 4.1 `backend/app.js`
Explicit HSTS config + `requireHttps` wired immediately after Helmet,
before CORS/routes.

### 4.2 `backend/middleware/requireHttps.js` (NEW)
In `production` (`NODE_ENV`), rejects non-`req.secure` requests with 426
(`trust proxy` is set, so `X-Forwarded-Proto` is honoured). Exempts
`/health`, `/api/health` (platform probes hit the container over plain
HTTP). No-op elsewhere, so local dev is unaffected.

### 4.3 `backend/tests/middleware/requireHttps.test.js` (NEW, 5 tests)
Non-prod passthrough, prod accept/reject (426 + body), health exemptions,
missing-`req.secure` treated as insecure. Full backend suite: 179/179.

### 4.4 Deliberately unchanged
`server.js` still listens on plain HTTP — correct behind Cloud Run, which
terminates TLS at Google's edge. Terminating TLS in Node would be
redundant. MongoDB Atlas already uses `tls=true`.

## 5. MITM verification summary (full log in companion files)

Control (unpinned) through mitmproxy: login + full app use, 26 flows all
HTTP 200, fully readable (auth tokens, invoices, clients). Pinned:
every call fails `CERTIFICATE_VERIFY_FAILED`; logcat shows our
`TLS rejected for pinned host …` line; zero app flows reach HTTP.
Test-only proxy hooks lived in `lib/main_development.dart` during testing
and were **removed afterwards** (verified: zero references, analyze
clean) — production code has no proxy path.

## 6. Pinned roots, expiry, rotation

Embedded PEMs (sourced `https://pki.goog/roots.pem`, verified 2026-09-20
that the live `*.run.app` chain leaf → WR2 → GTS Root R1 validates):

- GTS Root R1 / R2 / R3 / R4 — self-signed, all `notAfter Jun 22 2036`.
- Leaf/intermediate rotation by Google needs **no action** (only roots
  are pinned).

Rollover procedure (if Google ever replaces a root): append the new root
PEM to `_gtsRootPems`, release, remove the retired root in a follow-up —
never ship a single fresh pin alone, or a bad pin bricks the app
(fail-closed by design). Suggested monitoring: annual calendar check of
root validity + an alert if backend TLS errors spike after a Google PKI
announcement.

## 7. Residual risks / not done

- Socket.io realtime cannot be pinned (no TLS hook in `socket_io_client`);
  covered by system-validated `wss://` + per-connection Firebase auth +
  App Check.
- No whole-payload E2E encryption (deliberately: breaks observability,
  huge key-management cost, negligible gain over TLS + pinning).
- Backend changes are live on **dev only**; prod deploy is a separate,
  explicit step (`main` branch workflow).
- Pre-existing, unrelated: 1 failing Flutter test
  (`payment_repository_test.dart`), analyze errors confined to
  untouchable `third_party/` example code.

## 8. Follow-up hardening (same session)

### 8.1 Dependencies — 19 vulns → 0
`npm audit fix` + `nodemailer 8→10` major (stable API surface, verified)
+ `qs ^6.16.0` override. Suite stays 211/211 green.

### 8.2 BOLA audit — holes found and fixed
- **31 care-intelligence endpoints were unauthenticated and org-unbound**
  (any caller could pull any client's AI reports/risks/plans).
  Fixed: router-level auth + membership + per-resource ownership; a second
  param/body org-confusion bug found by its own test and fixed.
- Appointment email IDOR (`loadAppointments/:any-email`) → self-or-admin;
  org assignment listing → membership-checked; conversation list no longer
  unions the requested userId (self-tokens only, admin override); user
  photo endpoint → self/admin/same-org.
- 21 adversarial tests (401/403/200 matrix).

### 8.3 Subscription enforcement
Found dormant: both gates short-circuit unless `ENTITLEMENT_GATE=true`,
set nowhere in repo files — but **already `true` in the dev GSM secret**,
and the dev org is `active`, so dev enforces correctly today.
Added `/api/care-intelligence` to blocked prefixes (direct AI spend).
Prod enablement requires verifying prod org statuses first — do NOT flip
prod blind (see §9).

### 8.4 File access (incl. R2 custom domain)
Live setup found: R2 public dev URL is disabled, but the bucket is served
**publicly via custom domain `assets.bishalbudhathoki.com`** (custom
domains cannot carry auth — anyone holding a URL downloads the file).
- Express `/uploads`: `logos/` stays public; everything else needs a
  bearer token (5 tests). Flutter sends Firebase headers via the new
  `AuthedNetworkImage` / `AuthedCacheManager` (backend hosts only).
- R2 emitters (profile photos, certifications) now return **authenticated
  proxy URLs** (`/api/files/download`), never raw R2 URLs.
- **Logos stay public by design** (login screens, pre-login views): new
  endpoint `GET /api/files/public?url=` streams only `logos/`-prefixed
  keys (anything else → 400, rate-limited). No *user* auth needed, but
  the global App Check gate still applies, so only genuine app installs
  can fetch (verified live: no token → `MISSING_APP_CHECK_TOKEN`). Logo
  uploads now return that form. Invoice emails attach PDFs (no external
  images) and training content URLs are external links — both unaffected.
- The proxy allowlists the custom domain and normalizes virtual-hosted /
  path-style / custom-domain key forms, so legacy rows keep working
  *through auth*. Migration script
  `scripts/migrateR2UrlsToApiHost.js` rewrites them to the API-host form;
  dry-run on dev: **0 legacy rows** (dev's single receipt is already
  API-host form).
- Verified 2026-09-21 after owner disabled public access: custom domain
  returns **401 anonymous**; credentialed S3 API unaffected (`HeadObject`
  on bogus key → `NotFound`, proving keys + bucket work).

### 8.5 Mobile hardening (no new packages)
Android `FLAG_SECURE` + root detection channel; iOS app-switcher blur +
jailbreak channel; `DeviceSecurity` service with warn-only startup check
in both flavors.

## 9. Operator runbook (human steps, not code)

### 9.1 R2 privatization (Cloudflare dashboard → R2 → bucket)
Was: public dev URL off, but `assets.bishalbudhathoki.com` served the
bucket publicly with no auth. **Done by owner 2026-09-21** — verified:
custom domain returns 401 anonymous; credentialed S3 API unaffected.
1. (Prod only, if needed) Dry-run `scripts/migrateR2UrlsToApiHost.js`
   against prod; apply with `APPLY=true` to convert any remaining
   custom-domain rows to API-host form (dev needed nothing).
2. Disable public access on the prod bucket when it goes live (same
   dashboard toggle; custom-domain serving stops with it).
3. Verify: unauthenticated `curl` to a former
   `assets.bishalbudhathoki.com/<key>` URL must fail; in-app
   images/receipts/photos still load (authed proxy); org logos still
   load (public `/api/files/public` for R2 logos, `/uploads/logos`
   for local).
4. Later cleanup (optional): remove the custom-domain binding/DNS once
   step 3 has baked in with no 404 reports.

### 9.2 Prod subscription enforcement
1. In the prod `Invoice` database, confirm every paying org has
   `subscription.status` in (`active`, `billing_retry`, `grace`).
2. Only then set `ENTITLEMENT_GATE=true` for the prod service (via
   Infisical/GSM prod secret — note the daily Infisical→GSM sync
   overwrites direct GSM edits, so make the change at the source).
3. Unpaid orgs will then receive 402 `SUBSCRIPTION_REQUIRED` on blocked
   groups (invoices, payroll, earnings, AI, …). Monitor the
   `Blocked unpaid access` warn logs after flipping.

### 9.3 Prod code rollout (when ready)
1. Backend: merge `dev` → `main` (triggers the prod deploy workflow).
   Re-verify live: HSTS header values + `/api/health` 200.
2. Frontend: production release flow (separate from the internal-testing
   script) with a production backend URL; confirm cert pinning against
   the prod host (same GTS roots) and smoke-test login, invoices, and
   image loading on a release build.
