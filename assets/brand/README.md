# CareNest brand assets

## `carenest-mark.png`

The mark rendered at the top of every transactional email (64 px, above the
`CareNest` wordmark). Derived from the app icon at `assets/icons/app_icon.png`
(1024×1024) by downscaling to 192×192 — 3× the 64 px display size, so it stays
crisp on high-DPI screens. RGB, no alpha: the tile background is part of the mark.

This file is **not** read from disk at send time. Emails reference the copy
hosted next to the mail infrastructure:

```
https://listmonk.bishalbudhathoki.com/uploads/carenest-mark.png
```

Override with `EMAIL_LOGO_URL` if the asset ever moves.

## Why Listmonk hosts it

The Listmonk instance is already public, brand-neutral, and shared by both the
dev and prod senders, so one URL works everywhere. Media is served straight off
a bind mount on the VPS:

| | |
|---|---|
| Host directory | `/home/ubuntu/services/listmonk/data/uploads/` |
| Container path | `/listmonk/uploads` |
| Public URL | `https://listmonk.bishalbudhathoki.com/uploads/<file>` |

## Updating the hosted copy

```bash
scp -i ~/.ssh/hermes_oci_key backend/assets/brand/carenest-mark.png \
  ubuntu@140.238.197.220:/tmp/carenest-mark.png

ssh -i ~/.ssh/hermes_oci_key ubuntu@140.238.197.220 \
  'sudo cp /tmp/carenest-mark.png /home/ubuntu/services/listmonk/data/uploads/ && \
   sudo chmod 644 /home/ubuntu/services/listmonk/data/uploads/carenest-mark.png'

# verify byte-for-byte
curl -s https://listmonk.bishalbudhathoki.com/uploads/carenest-mark.png | shasum -a 256
```

The directory is owned by `root` because the Listmonk container writes to it as
root, hence `sudo`. Serving is static — a matching row in the media table is not
required, so no upload through the admin UI is needed.

## Fallback

Emails keep the text wordmark beneath the logo. Clients that block remote images
(the Gmail default for unknown senders) still show `CareNest`.
