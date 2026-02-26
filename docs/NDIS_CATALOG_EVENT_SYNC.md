# NDIS Catalog Event-Driven Sync

This backend supports automatic sync from object storage into MongoDB `support_items`.

## Endpoint

- `POST /webhooks/ndis-catalog`
- Mounted before JSON parsing, so HMAC signatures can be verified on raw payload.

## Auth Options

Set one of these:

- `NDIS_CATALOG_WEBHOOK_TOKEN`:
  - accepted via `Authorization: Bearer <token>`
  - or `x-ndis-webhook-token: <token>`
  - or query param `?token=<token>`
- `NDIS_CATALOG_WEBHOOK_SECRET`:
  - accepted via `x-ndis-signature: sha256=<hex>`
  - signature is HMAC-SHA256 over raw request body

## Storage Config

Set:

- `NDIS_CATALOG_PROVIDER=r2` or `gcs`
- `NDIS_CATALOG_BUCKET=...`
- `NDIS_CATALOG_OBJECT_KEY=ndis_support_items/NDIS.csv`
- Optional: `NDIS_CATALOG_WATCH_PREFIX=ndis_support_items/`
- Optional: `NDIS_CATALOG_ACCESS_SYNC_MIN_INTERVAL_MS=1000` (set `0` to check every access)

## Cloudflare R2 (event-driven)

R2 emits events to Queue. Use a Worker consumer to POST to backend webhook.

Example Worker consumer:

```js
export default {
  async queue(batch, env) {
    for (const msg of batch.messages) {
      await fetch(`${env.BACKEND_WEBHOOK_URL}?token=${encodeURIComponent(env.NDIS_WEBHOOK_TOKEN)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(msg.body),
      });
      msg.ack();
    }
  },
};
```

Worker env:

- `BACKEND_WEBHOOK_URL=https://<your-backend>/webhooks/ndis-catalog`
- `NDIS_WEBHOOK_TOKEN=<same as NDIS_CATALOG_WEBHOOK_TOKEN>`

## Google Cloud Storage (event-driven)

Recommended flow:

1. Enable Pub/Sub notifications for bucket.
2. Create push subscription to:
   - `https://<your-backend>/webhooks/ndis-catalog?token=<NDIS_CATALOG_WEBHOOK_TOKEN>`
3. Push payload is accepted (Pub/Sub envelope + base64 data).

### GCS setup commands (no Cloudflare Worker)

```bash
# 1) Variables
export PROJECT_ID="your-gcp-project-id"
export PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
export BUCKET="your-gcs-bucket"
export TOPIC="ndis-catalog-events"
export SUB="ndis-catalog-events-push"
export WEBHOOK_URL="https://<your-backend>/webhooks/ndis-catalog?token=<NDIS_CATALOG_WEBHOOK_TOKEN>"

# 2) Enable APIs
gcloud services enable storage.googleapis.com pubsub.googleapis.com --project="$PROJECT_ID"

# 3) Create topic
gcloud pubsub topics create "$TOPIC" --project="$PROJECT_ID"

# 4) Allow Cloud Storage service agent to publish to topic
gcloud pubsub topics add-iam-policy-binding "$TOPIC" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gs-project-accounts.iam.gserviceaccount.com" \
  --role="roles/pubsub.publisher" \
  --project="$PROJECT_ID"

# 5) Add notification on bucket prefix
gcloud storage buckets notifications create "gs://$BUCKET" \
  --topic="$TOPIC" \
  --payload-format=json \
  --event-types=OBJECT_FINALIZE,OBJECT_METADATA_UPDATE \
  --object-prefix=ndis_support_items/

# 6) Create push subscription to backend webhook
gcloud pubsub subscriptions create "$SUB" \
  --topic="$TOPIC" \
  --push-endpoint="$WEBHOOK_URL" \
  --ack-deadline=20 \
  --project="$PROJECT_ID"
```

### Backend read access to GCS object (required)

This sync service reads the catalog object through GCS S3 interoperability keys.

1. Create/choose a service account for NDIS catalog reads.
2. Grant it bucket read access (`roles/storage.objectViewer`) on your catalog bucket.
3. Create HMAC keys for that service account.
4. Set backend env:

```env
NDIS_CATALOG_PROVIDER=gcs
NDIS_CATALOG_BUCKET=<your-gcs-bucket>
NDIS_CATALOG_OBJECT_KEY=ndis_support_items/NDIS.csv
NDIS_CATALOG_WATCH_PREFIX=ndis_support_items/
NDIS_CATALOG_ACCESS_SYNC_MIN_INTERVAL_MS=1000
GCS_HMAC_ACCESS_KEY_ID=<hmac-access-id>
GCS_HMAC_SECRET_ACCESS_KEY=<hmac-secret>
```

## What happens on webhook

1. Backend extracts changed object info (R2/GCS/custom payload shapes).
2. Validates event bucket/key against configured target or watch prefix.
3. Downloads changed CSV object from storage.
4. Bulk upserts into `support_items`.
5. Marks missing previously managed items as inactive.
6. Stores sync state (`reference_sync_state`) with ETag/hash for idempotency.

## Manual commands

- `npm run ndis:sync`
- `npm run ndis:sync:force`
