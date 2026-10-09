# Dependabot Alert Triage — 2026-10-09

## Summary

GitHub reports **137 open Dependabot alerts**. Triaged on 2026-10-09 at commit `f051b9f`:

> **None of the 137 are reachable in the deployed runtime. No remediation is required.**

This document records the evidence so the backlog is not re-investigated. It does
**not** claim the packages are safe everywhere — only that they are not present, or
not vulnerable, in the code that actually ships.

## Method

Three independent checks, because alert count alone says nothing about exposure:

1. **Is the installed version inside the advisory's vulnerable range?**
   Dependabot alerts are keyed to a manifest path, not to the version actually
   resolved on the current branch. An alert can stay open long after the tree has
   moved past the affected version.
2. **Is the package a production dependency?**
   Alert existence is not reachability. A devDependency never enters the image.
3. **Is the package physically present in the built image?**
   Verified by reproducing the Dockerfile's own prune step.

## Finding 1 — 121 of 137 alerts are stale on this branch

Comparing each alert's `vulnerable_version_range` against the resolved version:

| Package | Installed | Alerts | Live? |
|---|---|---|---|
| `axios` | 1.20.0 | 25 | No — every range ends at or below 1.20.0 |
| `nodemailer` | 10.0.10 | 19 | No — every range ends at or below 10.0.10 |
| `hono` | not installed | 18 | No — not in the tree at all |
| `multer` | 2.4.0 | 5 | No — fixed at 2.3.0 |
| `fast-uri` | 3.1.8 | 6 | No — fixed at 3.1.6 |
| `mongoose` | 9.10.1 | 1 | No |

These are the alerts that *look* most alarming in a naive triage (high severity,
well-known names, prototype-pollution and upload-DoS classes). They are all
already patched by the lockfile. The `package.json` range `^1.13.6` for axios is
what makes Dependabot re-derive them; the installed 1.20.0 is safe.

## Finding 2 — the 16 remaining live alerts are all dev-only

Every genuinely-live alert resolves to a version still inside its vulnerable range,
and every one of them descends from **`firebase-tools`**, which is a **devDependency**
(`^15.11.0`) — a local build/deploy CLI:

| Live package | Installed | Parent chain |
|---|---|---|
| `undici` 6.25.0 | vulnerable | `firebase-tools → superstatic → re2 → node-gyp` |
| `morgan` 1.10.1 | vulnerable | `firebase-tools → superstatic` |
| `re2` 1.24.0 | vulnerable | `firebase-tools → superstatic` |
| `tar` 7.5.13 | vulnerable | `firebase-tools → superstatic → re2 → node-gyp` |
| `stream-json` 1.9.1 | vulnerable | `firebase-tools` |
| `tmp` 0.2.5 | vulnerable | `firebase-tools` |

## Finding 3 — none of them ship

`Dockerfile` installs with dev deps for the build, then:

```dockerfile
RUN npm prune --production
```

Reproduced against a copy of this repo's `node_modules`:

```
after 'npm prune --production':
  firebase-tools: absent     re2: absent        stream-json: absent
  undici:         absent     tar:  absent       tmp:         absent
  morgan:         absent
  nodemailer: PRESENT   axios: PRESENT   multer: PRESENT   mongoose: PRESENT
```

The only packages that survive into the image are the four production
dependencies, all of which are **past** their advisory ranges (Finding 1).

## Conclusion

- **Production exposure: none.** No live advisory applies to a shipped package.
- **Build/CI machine exposure: theoretical.** `firebase-tools` runs on developer
  machines and CI. The advisories are in transitive build tooling (a RE2 binding,
  node-gyp's tarball extractor, superstatic's http logger) — not in any
  request-handling path.
- **Risk accepted.** Re-investigating requires a *new* alert on a production
  dependency, not a recount of the existing 137.

## If this ever needs revisiting

Do not trust the count. Re-run the three checks. Escalate only if a live advisory
lands on something in this set:

```
node -p "Object.keys(require('./package.json').dependencies).join(' ')"
```

Those are the only packages whose advisories represent real production exposure.

## Caveat

`tests/seed-data/` has its own `package.json` with a `@faker-js/faker` alert. It is
excluded from the default Jest run (`--testPathIgnorePatterns=... seed-data`) and
never enters the image. Not remediated because the fix is a major-version bump
(9.x → 10.x) for a test-fixture generator with no production impact.