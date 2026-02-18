# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |
| dev     | :white_check_mark: |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

1. **Do NOT** open a public issue
2. Email security reports to: [Add your security email]
3. Include the following:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 7 days
- **Fix Timeline**: Critical vulnerabilities within 14 days

## Security Best Practices

### For Contributors

1. **Never commit secrets** - Use environment variables
2. **Use `.env.example`** as a template, never commit actual `.env` files
3. **Run pre-commit hooks** - They scan for accidental secret commits
4. **Review PRs carefully** - Check for accidentally exposed credentials

### Secret Management

All secrets are managed through:
- **Development**: Google Secret Manager
- **CI/CD**: GitHub Secrets + Workload Identity Federation
- **Local Development**: `.env` files (never committed)

### Required Secrets

See `.env.example` for all required environment variables.

## Security Features

### Current Protections

- ✅ Pre-commit hooks for secret detection
- ✅ Trivy vulnerability scanning in CI/CD
- ✅ TruffleHog secret scanning in CI/CD
- ✅ Dependabot for dependency updates
- ✅ CodeQL for code analysis
- ✅ Workload Identity Federation (keyless auth)
- ✅ Secrets stored in Google Secret Manager
- ✅ SBOM (Software Bill of Materials) generation

### API Security

- Firebase Authentication required for all API endpoints
- Firebase App Check for mobile app attestation
- Rate limiting on all public endpoints
- JWT key rotation support
- Input validation on all endpoints

### Branch Protection

- Main branch requires PR reviews
- Status checks must pass before merge
- No force pushes to protected branches

## Incident Response

If a security incident occurs:

1. **Rotate compromised credentials immediately**
2. **Review git history for exposure**
3. **Use `git filter-repo` to remove secrets from history**
4. **Force push cleaned history**
5. **Update all affected services with new credentials**
