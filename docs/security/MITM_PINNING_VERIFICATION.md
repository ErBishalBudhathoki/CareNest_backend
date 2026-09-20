# MITM / Certificate-Pinning Verification — Transport Encryption Proof

Date: 2026-09-20. Backend target: dev Cloud Run
(`backend-dev-406509736623.australia-southeast1.run.app`, project `invoice-660f3`).
Companion data: `mitm_flows_sanitized.json` (26 flows, tokens/PII redacted).

## Setup

- Intercept proxy: mitmproxy 12.2.3 on Mac LAN IP `192.168.0.119:8080`,
  CA (`CN=mitmproxy`) installed in the Pixel 7a user credential store.
- Flutter quirk found during testing: Dart's `HttpClient` ignores the
  Android Wi-Fi proxy, so test builds were given a temporary,
  define-gated `HttpOverrides.global` hook (`TEST_PROXY_HOST`,
  `TEST_MITM_CA_B64`) in `lib/main_development.dart`. The hook was
  **removed after testing** — production code has no proxy path.
- Control APK: pre-pinning code + test hook only.
- Pinned APK: GTS-roots-only trust store (`lib/backend/pinned_http_client.dart`).

## Result

| Build | Observation | Verdict |
|---|---|---|
| Control (unpinned) | Login + full app usage succeed through the proxy. All 26 API flows return HTTP 200 with **fully readable plaintext**: `Authorization: Bearer <972-char Firebase JWT>`, `X-Firebase-AppCheck` (941 chars), login sync, invoices + stats, businesses, org clients, payment connect-status, user list, user photos. | **Interception proven.** TLS alone does not stop a trusted-CA MITM. |
| Pinned | Every API call fails: `HandshakeException … CERTIFICATE_VERIFY_FAILED: unable to get local issuer certificate`. Logcat: `TLS rejected for pinned host backend-dev-…run.app:443 (/CN=*.a.run.app)` from `PinnedHttpClient.badCertificateCallback`. Zero app flows reach HTTP in the proxy. | **Fail-closed proven.** Only a GTS-chained certificate is accepted. |

## Test-harness lessons (kept for future re-tests)

1. Dart ignores the OS Wi-Fi proxy — builds need the `HttpOverrides` hook.
2. Dart's TLS does not read Android's user credential store — the proxy CA
   must be injected into the test build's `SecurityContext`, and
   `setTrustedCertificatesBytes` requires **PEM or PKCS#12** (raw DER fails
   with `BAD_PKCS12_DATA`).
3. The pinned client's explicit GTS-only `SecurityContext` must never
   receive the test CA — enforced by only touching null-context clients.

## Follow-ups landed separately

- ChaCha20-Poly1305 field encryption, HTTPS-only base-URL enforcement,
  explicit HSTS + production plaintext rejection (`requireHttps`, 426).
