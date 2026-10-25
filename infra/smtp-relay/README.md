# sendpulse-relay — SMTP → SendPulse REST relay

A tiny Python (aiosmtpd) service that listens for SMTP connections and relays
each message to SendPulse's REST API (`POST /smtp/emails`). It sits between
**Listmonk** (the transactional/campaign mailer) and **SendPulse**:

```
Listmonk (SMTP outbound = sendpulse-relay:587) → sendpulse-relay → SendPulse API → recipient
```

## Where it runs

- **Deployed on the VPS** (Oracle Cloud, Dokploy host) at
  `/home/ubuntu/services/smtp-relay/` — a standalone `docker compose` project
  (NOT a Dokploy-managed app).
- This directory is the **git-tracked copy** so the source never lives only on
  the VPS again. Keep it in sync with what is deployed.

## Deploy / rebuild

```bash
cd /home/ubuntu/services/smtp-relay
SENDPULSE_CLIENT_ID=... SENDPULSE_CLIENT_SECRET=... \
  docker compose up -d --build
```

The real `SENDPULSE_CLIENT_ID` / `SENDPULSE_CLIENT_SECRET` live only on the VPS
(they are **not** committed to git — see `docker-compose.yml`).

## Critical fixes — do not regress

1. **`html` must be Base64-encoded** (`relay.py`, `send_via_sendpulse`).
   SendPulse's `/smtp/emails` schema states `html` is "encoded in Base64".
   Posting raw HTML is *accepted with 200 OK but silently dropped* — the email
   then arrives text-only (or completely empty when there is no text part).
   Proven with A/B tests against the live API (raw = 636 bytes stored vs
   base64 = 1599 bytes stored). If this is ever reverted, emails go back to
   arriving with an empty body.

2. **From display name is forced to `CareNest`** (`relay.py`).
   The relay already forces `from_email = VERIFIED_SENDER`; it now forces the
   display name too, otherwise Gmail shows the upstream MTA's default
   ("listmonk") instead of "CareNest".

## Related backend fix

`services/listmonkService.js` sends an `altbody` (plain-text alternative) with
every Listmonk `/tx` call. That guarantees a text part always exists as a
fallback, complementing this relay's base64-HTML handling.

## Verification

- `docker logs sendpulse-relay` → "SendPulse OAuth: OK", "Successfully relayed:
  Sent: <id>".
- Query `GET /smtp/emails/{id}` (SendPulse API) — the stored `total_size` for a
  message with HTML should be in the thousands of bytes; a few hundred means
  the HTML was dropped.
