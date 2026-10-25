# Project Mandates

## Branch Management
- **Never delete the `dev` branch.** This branch is used for development builds on Google Cloud and must persist at all times.
- Always use the `--no-delete-branch` (or avoid the `--delete-branch` flag in `gh pr merge`) when merging PRs from `dev`.

## Deployment
- `dev` branch -> Google Cloud Development Build (REDACTED_EMAIL / dev branch)
- `main` branch -> Google Cloud Production Build (budhathokib085@gmail.com / main branch)

## Authorship
- **Commit Name**: Always use "Er Bishal Budhathoki".
- **Commit Email**: Always use `REDACTED_EMAIL` for all branches.
- **GitHub Username**: `ErBishalBudhathoki`.

## Listmonk Rules
- **Transactional Templates**: Custom transactional templates (type tx) must use `{{ .Tx.Data.body | Safe }}` to render the HTML payload sent via the /tx endpoint. Listmonk compiles tx templates with Go's `html/template`, so without `| Safe` the payload is escaped and the recipient sees literal markup. `listmonkService.ensureTxTemplate()` repairs a template that is missing this expression; a template without it sends an empty body while still returning HTTP 200.
- **Template Selection**: `LISTMONK_TEMPLATE_ID` must reference a template of type `tx`. Listmonk seeds id 1 as "Default campaign template", and `/tx` rejects campaign ids with `400 template 1 not found` — every send fails, and the Temporal activity retries until it gives up. `listmonkService.ensureTxTemplate()` resolves a usable tx template (and creates one if none exists), but never rewrites a campaign template.
- **Subscriber State**: Backend flows must execute emailService.addSubscriber() before invoking Listmonk, and sends set `subscriber_mode: fallback` so recipients that are not registered subscribers (accounts predating that call) are still delivered instead of being dropped with a 400.
- **Unified Branding**: All outgoing emails must be processed through _wrapCareNestEmail() in listmonkService.js to ensure consistent branding, structure, and safe HTML rendering before being dispatched to Listmonk.

