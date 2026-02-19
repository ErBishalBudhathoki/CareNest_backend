# GitHub Security Configuration

This document describes the security configuration for this repository.

## Branch Protection Rules

Configure these settings in GitHub: **Settings → Branches → Add branch protection rule**

### Main Branch Protection

| Setting | Value |
|---------|-------|
| Branch name pattern | `main` |
| Require a pull request before merging | ✅ |
| Require approvals | 1 |
| Dismiss stale PR approvals when new commits are pushed | ✅ |
| Require status checks to pass before merging | ✅ |
| Require branches to be up to date before merging | ✅ |
| Status checks required | `security-scan`, `test` |
| Require conversation resolution before merging | ✅ |
| Require linear history | ✅ |
| Include administrators | ✅ |
| Allow force pushes | ❌ |
| Allow deletions | ❌ |

### Dev Branch Protection

| Setting | Value |
|---------|-------|
| Branch name pattern | `dev` |
| Require a pull request before merging | ❌ |
| Require status checks to pass before merging | ✅ |
| Status checks required | `security-scan` |
| Allow force pushes | ❌ |
| Allow deletions | ❌ |

## Required Status Checks

- `security-scan` - Trivy vulnerability scan + TruffleHog secret scan
- `test` - Unit and integration tests

## Secrets Configuration

### GitHub Secrets Required

| Secret | Description |
|--------|-------------|
| `WIF_PROVIDER` | Workload Identity Federation provider |
| `WIF_SERVICE_ACCOUNT` | GCP service account email |

### Google Secret Manager Secrets

- `app-secrets-dev` - Development secrets (consolidated)
- `app-secrets-prod` - Production secrets (consolidated)

## Security Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `codeql.yml` | Push to main, weekly | Code analysis |
| `secret-scan.yml` | Push, PR, daily | Detect leaked secrets |
| `dependabot.yml` | Weekly | Dependency updates |

## Pre-commit Hooks

Pre-commit hooks scan for:
- MongoDB connection strings with credentials
- Firebase/Google API keys
- AWS access keys
- Stripe keys
- Generic secrets (password, token, api_key patterns)

### Bypass (Emergency Only)
```bash
git commit --no-verify
```

## Incident Response

1. Rotate compromised credentials immediately
2. Use `git filter-repo` to remove from history
3. Force push cleaned history
4. Update all services with new credentials
