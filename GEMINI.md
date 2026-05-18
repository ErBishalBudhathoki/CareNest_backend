# Project Mandates

## Branch Management
- **Never delete the `dev` branch.** This branch is used for development builds on Google Cloud and must persist at all times.
- Always use the `--no-delete-branch` (or avoid the `--delete-branch` flag in `gh pr merge`) when merging PRs from `dev`.

## Deployment
- `dev` branch -> Google Cloud Development Build (deverbishal331@gmail.com / dev branch)
- `main` branch -> Google Cloud Production Build (budhathokib085@gmail.com / main branch)

## Authorship
- **Commit Name**: Always use "Er Bishal Budhathoki".
- **Commit Email**: Always use `deverbishal331@gmail.com` for all branches.
- **GitHub Username**: `ErBishalBudhathoki`.

## Listmonk Rules
- **Transactional Templates**: Custom transactional templates (type tx) must use {{ .Tx.Data.body }} to render custom HTML payload sent via the /tx endpoint. Do not use the safe pipe.
- **Subscriber State**: The /tx API endpoint requires the recipient to be a registered subscriber. Backend flows must always execute emailService.addSubscriber() before invoking Listmonk to send transactional notifications.
- **Unified Branding**: All outgoing emails must be processed through _wrapCareNestEmail() in listmonkService.js to ensure consistent branding, structure, and safe HTML rendering before being dispatched to Listmonk.

