# CareNest brand assets

## `carenest-mark.png`

The mark rendered at the top of every transactional email (64 px, above the
`CareNest` wordmark). Source art: `assets/icons/ic_launcher_foreground_clean.png`
(1540×1540), the app icon — a teal tile with three cream figures.

Two adjustments were made when building the email copy at 192×192 (3× the 64 px
display size, so it stays crisp on high-DPI screens):

1. **White chip behind the tile.** The teal tile (`#1F637A`) against the email
   header (`#1A3BA0`) is only ~1.4:1 contrast, so the logo would melt into the
   header. A 12 px white rounded chip at 192 px (4 px at display size) keeps the
   mark legible without changing the header colour.
2. **Rounded clip.** The icon's own corners are rounded at ~19.5%; the asset is
   clipped to a matching radius so the transparent corners show the chip rather
   than the blue header.

The exported PNG keeps alpha only outside the chip's rounded corners. At display
size the client's `border-radius: 14px` on the `<img>` (22% of 64 px) matches the
chip's 44/192 radius.

Regenerate from the app icon (macOS, no extra dependencies):

```bash
swift infra/brand/make-email-mark.swift   # writes assets/brand/carenest-mark.png
```

## Hosting

This file is **not** read from disk at send time. Emails reference a copy hosted
next to the mail infrastructure:

```
https://listmonk.bishalbudhathoki.com/uploads/carenest-mark-v2.png
```

Override with `EMAIL_LOGO_URL` if the asset ever moves.

The filename is **versioned**. Uploads are served through Cloudflare with
`cache-control: max-age=14400`, and Gmail proxies remote images on its own
schedule, so overwriting a stable filename keeps showing the previous art for
hours. Bump `-v2` → `-v3` when the art changes, publish the new file, and leave
the old one in place so mail that was already delivered still resolves.

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
  ubuntu@140.238.197.220:/tmp/carenest-mark-v2.png

ssh -i ~/.ssh/hermes_oci_key ubuntu@140.238.197.220 \
  'sudo cp /tmp/carenest-mark-v2.png /home/ubuntu/services/listmonk/data/uploads/ && \
   sudo chmod 644 /home/ubuntu/services/listmonk/data/uploads/carenest-mark-v2.png'

# verify byte-for-byte (a new filename bypasses the Cloudflare cache, so this
# must be a MISS on the first request)
curl -s https://listmonk.bishalbudhathoki.com/uploads/carenest-mark-v2.png | shasum -a 256
```

The directory is owned by `root` because the Listmonk container writes to it as
root, hence `sudo`. Serving is static — a matching row in the media table is not
required, so no upload through the admin UI is needed (and the admin media
upload currently returns `500` on this instance anyway).

## Fallback

Emails keep the text wordmark beneath the logo. Clients that block remote images
(the Gmail default for unknown senders) still show `CareNest`.
