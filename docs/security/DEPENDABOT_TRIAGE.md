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
   Verified by extracting every `package.json` from the deployed artifact.

## Finding 1 — 121 of 137 alerts are stale on this branch

Comparing each alert's `vulnerable_version_range` against the resolved version:

| Package | Installed | Alerts | Live? |
|---|---|---|---|
| `axios` | 1.20.0 | 25 | No — every range ends at or below 1.20.0 |
| `nodemailer` | 10.0.10 | 19 | No — every range ends at or below 10.0.10 |
| `hono` | 4.13.8 (transitive) | 18 | No — above every advisory range |
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

**Verified against the deployed artifact** (revision `f6a6b8c`), not a
reproduction. Every `package.json` under `/app/node_modules` was extracted from
the real image and each of the 534 packages checked against its advisory range:

```
alert packages present in image: 18
of those, actually vulnerable:  0
```

The packages that survive are all past their advisory ranges. The vulnerable
transitive build tooling from Finding 2 (`undici`, `morgan`, `re2`, `tar`,
`stream-json`, `tmp`, `firebase-tools`) is **absent entirely**.

One nuance worth recording, because the earlier version of this document got it
wrong: **`hono` is present in the image.** It is not a direct dependency and does
not appear in `package.json` at all — it arrives transitively via
`@google-cloud/vertexai → @google/genai → @modelcontextprotocol/sdk → @hono/node-server`.
The earlier draft described it as "not in the tree at all", which was false. It
ships as `hono@4.13.8`, which is above every advisory range, so the conclusion
holds — but only by version, not by absence.

To re-run:

```bash
gcloud auth configure-docker australia-southeast1-docker.pkg.dev
IMG=$(gcloud run services describe backend-dev --region=australia-southeast1 \
  --format="value(spec.template.spec.containers[0].image)")
docker run --rm --platform linux/amd64 --entrypoint node "$IMG" -e '
  const fs=require("fs"),path=require("path");
  const out=[];const scan=d=>{let es=[];try{es=fs.readdirSync(d,{withFileTypes:true})}catch(e){return}
    for(const e of es){if(!e.isDirectory())continue;
      if(e.name.startsWith("@")){scan(path.join(d,e.name));continue}
      try{const j=JSON.parse(fs.readFileSync(path.join(d,e.name,"package.json"),"utf8"));
        out.push(j.name+"@"+(j.version||"?"))}catch(err){}}};
  scan("/app/node_modules");process.stdout.write(out.join("\n")+"\n")' > /tmp/img.txt
# then check each name@version against the ranges from:
# gh api /repos/ErBishalBudhathoki/CareNest_backend/dependabot/alerts?state=open --paginate
```

Note the pull must be `--platform linux/amd64` on Apple Silicon, or it fails with
a confusing manifest-list error rather than anything about permissions.

## Conclusion

- **Production exposure: none.** No live advisory applies to a shipped package.
- **Build/CI machine exposure: theoretical.** `firebase-tools` runs on developer
  machines and CI. The advisories are in transitive build tooling (a RE2 binding,
  node-gyp's tarball extractor, superstatic's http logger) — not in any
  request-handling path.
- **Risk accepted.** Re-investigating requires a *new* alert on a production
  dependency, not a recount of the existing 137.

## If this ever needs revisiting

Do not trust the count, and do not trust an absence argument — `hono` proved a
package can ship without appearing in `package.json` at all. Check the image
contents directly. Escalate only if a live advisory lands on something in this
set:

```
node -p "Object.keys(require('./package.json').dependencies).join(' ')"
```

Those are the only packages whose advisories represent real production exposure.

## Caveat

`tests/seed-data/` has its own `package.json` with a `@faker-js/faker` alert. It is
excluded from the default Jest run (`--testPathIgnorePatterns=... seed-data`) and
never enters the image. Not remediated because the fix is a major-version bump
(9.x → 10.x) for a test-fixture generator with no production impact.

## Correction, 2026-10-09 (later)

Two claims made in the same conversation were wrong, recorded here so they are
not inherited as fact:

1. **"Reachable axios / nodemailer / multer issues."** Not reachable. All three
   are past their advisory ranges; see Finding 1.
2. **"`logPeriodicHealthMetrics` / `logPeriodicErrorMetrics` are exported but
   never called, so the periodic health logs have never emitted."** False. Both
   are called from `setInterval` (`middleware/systemHealth.js:197`,
   `middleware/errorTracking.js:279`), each `unref()`'d and guarded against the
   test environment. They *are* emitting. The claim came from grepping for
   call sites without noticing the `setInterval` on the preceding lines, and
   from querying Cloud Logging on `textPayload` while the log lines are written
   as structured `jsonPayload`. A `jsonPayload.message="Business Event"` query
   shows a `system_health_snapshot` every five minutes with uptime, memory, CPU,
   error rate and request counts. Both packages stay out of the image regardless
   (Finding 3), so the dependency conclusion above is unaffected.

The lesson worth carrying: both errors were made while triaging from summaries
rather than from the code, and both survived because the surrounding claims
sounded plausible. Re-check the source before repeating either.

## Correction 3, 2026-10-09 — the "missing permission" was a Docker auth error

A fourth wrong claim, made while closing Finding 3 properly: that pulling the
image required an IAM grant. It did not.

`deverbishal331@gmail.com` already held `roles/owner` on `invoice-660f3`, which
subsumes `roles/artifactregistry.reader`. The pull failed with:

> `denied: Unauthenticated request. Unauthenticated requests do not have
> permission "artifactregistry.repositories.downloadArtifacts"`

That wording was the whole answer. IAM denial says *permission denied*;
*unauthenticated* means Docker presented no credentials at all. The cause was
that `~/.docker/config.json` had no entry for
`australia-southeast1-docker.pkg.dev`. The fix was local configuration, not
access:

```bash
gcloud auth configure-docker australia-southeast1-docker.pkg.dev
```

A `roles/artifactregistry.reader` binding was added on this basis. It is
redundant with `owner` and can be removed:

```bash
gcloud projects remove-iam-policy-binding invoice-660f3 \
  --member="user:deverbishal331@gmail.com" \
  --role="roles/artifactregistry.reader"
```

Leaving it changes nothing functionally; removing it just avoids implying that
this account's registry access comes from a narrow role it does not rely on.

Fourth time, same failure mode: diagnosing from an error message's trailing
clause instead of reading the whole message. When a GCP command reports a denied
permission, first confirm the request was actually *authenticated*.

## Separately worth noting

`deverbishal331@gmail.com` holds `roles/owner` on the dev project. That is
consistent with `AGENTS.md` designating it the development account, and it is
why no registry grant was ever needed — but it does mean every operation this
session performed on the project ran with full control, not a scoped role.
Worth knowing when reasoning about blast radius.