# Consolidated Secrets Management - Complete Guide

## Overview

This system consolidates all application secrets into a single Secret Manager secret per environment, reducing Google Cloud costs from potentially $hundreds/month to **FREE** (within the free tier of 6 secrets).

## Architecture

### Secret Structure

```
Google Cloud Secret Manager (Free Tier: 6 secrets)
├── app-secrets-dev (invoice-660f3)      ← ALL dev secrets as JSON
├── app-secrets-prod (carenest-prod)     ← ALL prod secrets as JSON  
└── [4 more slots available for other secrets]
```

### How It Works

1. **Local Development**
   - Secrets loaded from `backend/secrets.json`
   - Automatically applied to `process.env`
   - No Google Cloud access needed

2. **Cloud Run (Production)**
   - Single secret (`APP_SECRETS`) mounted as environment variable
   - Application loads JSON at startup
   - All secrets applied to `process.env`

3. **CI/CD (GitHub Actions)**
   - Workflows deploy with `--update-secrets "APP_SECRETS=app-secrets-dev:latest"`
   - Simplified deployment scripts
   - No individual secret management

## Files Created

### 1. Upload Script
**File**: `backend/scripts/upload-secrets.js`

```bash
# Upload development secrets
npm run secrets:upload:dev

# Upload production secrets  
npm run secrets:upload:prod

# Upload both
npm run secrets:upload:all

# List versions
npm run secrets:list:dev
npm run secrets:list:prod
```

### 2. Runtime Loader
**File**: `backend/config/secretLoader.js`

Automatically loads secrets with fallback strategy:
1. Google Cloud Secret Manager (if in Cloud Run)
2. Local `secrets.json` file (if exists)
3. Process environment variables (fallback)

### 3. Secrets File
**File**: `backend/secrets.json` (already exists)

```json
{
  "development": {
    "MONGODB_URI": "...",
    "REDIS_URL": "...",
    // ... all other dev secrets
  },
  "production": {
    "MONGODB_URI": "...",
    "REDIS_URL": "...",
    // ... all other prod secrets
  }
}
```

⚠️ **Important**: This file is already in `.gitignore` - never commit it!

## Setup Instructions

### Step 1: Install Dependencies

```bash
cd backend
npm install @google-cloud/secret-manager
```

### Step 2: Authenticate with Google Cloud

```bash
# Development account
gcloud auth login deverbishal331@gmail.com
gcloud config set project invoice-660f3

# Upload dev secrets
npm run secrets:upload:dev

# Production account  
gcloud auth login erbishalb331@gmail.com
gcloud config set project carenest-prod

# Upload prod secrets
npm run secrets:upload:prod
```

### Step 3: Verify Secrets Uploaded

```bash
# Check development
gcloud secrets describe app-secrets-dev --project=invoice-660f3

# Check production
gcloud secrets describe app-secrets-prod --project=carenest-prod
```

### Step 4: Grant Cloud Run Access

The upload script automatically grants access, but verify:

```bash
# Development
gcloud secrets add-iam-policy-binding app-secrets-dev \
  --member="serviceAccount:invoice-660f3@appspot.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project=invoice-660f3

# Production
gcloud secrets add-iam-policy-binding app-secrets-prod \
  --member="serviceAccount:carenest-prod@appspot.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project=carenest-prod
```

### Step 5: Deploy

The GitHub Actions workflows are already updated. Just push:

```bash
# Test in development
git checkout dev
git add .
git commit -m "feat: implement consolidated secrets management"
git push origin dev

# After testing, deploy to production
git checkout main
git merge dev
git push origin main
```

## Cost Savings

### Before
```
Individual secrets: 22 total (11 per environment × 2 environments)
Cost: $0.06 per secret/month (after 6 free)
Monthly cost: 16 × $0.06 = $0.96/month
Annual cost: $11.52/year
Access costs: Potentially more with high traffic
```

### After
```
Consolidated secrets: 2 total (1 per environment)
Cost: $0 (within free tier of 6 secrets)
Monthly cost: $0
Annual cost: $0
Savings: 100%!
```

## Usage

### Local Development

No changes needed! The app automatically loads from `secrets.json`:

```bash
npm run dev
```

### Adding/Updating Secrets

1. **Edit `backend/secrets.json`**
   ```json
   {
     "development": {
       "NEW_API_KEY": "dev-key-123",
       // ... other secrets
     },
     "production": {
       "NEW_API_KEY": "prod-key-456",
       // ... other secrets
     }
   }
   ```

2. **Upload to Secret Manager**
   ```bash
   npm run secrets:upload:all
   ```

3. **Redeploy**
   - Push to trigger GitHub Actions deployment
   - Or manually restart Cloud Run service:
     ```bash
     gcloud run services update backend-dev --region australia-southeast1 --project invoice-660f3
     ```

### Accessing Secrets in Code

Secrets are automatically loaded into `process.env`:

```javascript
// Before (still works)
const mongoUri = process.env.MONGODB_URI;

// After (also works, with helper)
const { getSecret } = require('./config/secretLoader');
const mongoUri = getSecret('MONGODB_URI');
```

## Secrets Included

The consolidated secret contains all environment variables from `secrets.json`:

### Development (`app-secrets-dev`)
- Database: `MONGODB_URI`, `DB_NAME`
- Cache: `REDIS_URL`
- Auth: `JWT_SECRET`, `JWT_EXPIRES_IN`
- Firebase: All `FIREBASE_*` credentials
- Email: `SMTP_*`, `APP_PASSWORD`
- Storage: `R2_*` credentials
- Payment: `STRIPE_*` credentials
- Security: Password policies, rate limits
- Monitoring: `GF_*` Grafana credentials
- And 30+ more...

### Production (`app-secrets-prod`)
- Same structure as development
- Production-specific values

## Security Best Practices

✅ **DO:**
- Keep `secrets.json` in `.gitignore` (already configured)
- Use Secret Manager for all sensitive data
- Rotate secrets regularly
- Review access logs in Google Cloud Console
- Use different secrets for dev/prod

❌ **DON'T:**
- Commit `secrets.json` to Git
- Share secrets via email/chat
- Use production secrets in development
- Log secret values
- Hardcode secrets in code

## Troubleshooting

### Secrets won't load in Cloud Run

**Check:**
```bash
# 1. Verify secret exists
gcloud secrets describe app-secrets-dev --project=invoice-660f3

# 2. Check permissions
gcloud secrets get-iam-policy app-secrets-dev --project=invoice-660f3

# 3. View Cloud Run logs
gcloud logs read --limit 50 --filter="resource.type=cloud_run_revision AND resource.labels.service_name=backend-dev" --project=invoice-660f3
```

**Look for:**
```
[SecretLoader] Loading secrets for environment: production
[SecretLoader] Running in Cloud Run: true
[SecretLoader] ✓ Loaded 47 secrets from Secret Manager
```

### Secrets upload fails

**Error**: "Permission denied"
```bash
# Solution: Ensure you're authenticated with correct account
gcloud auth list
gcloud auth login YOUR_EMAIL@gmail.com
```

**Error**: "Secret already exists"
```bash
# This is OK! Script automatically creates new version
# No action needed
```

### Application crashes on startup

**Check logs:**
```bash
# Development
gcloud logs tail --filter="resource.type=cloud_run_revision" --project=invoice-660f3

# Production  
gcloud logs tail --filter="resource.type=cloud_run_revision" --project=carenest-prod
```

**Common issues:**
1. Missing `GCP_PROJECT_ID` environment variable
2. Secret Manager API not enabled
3. Insufficient permissions
4. Invalid JSON in secret

### Local development not loading secrets

**Check:**
```bash
# 1. Verify file exists
ls -la backend/secrets.json

# 2. Verify valid JSON
cat backend/secrets.json | jq .

# 3. Check file permissions
chmod 600 backend/secrets.json
```

## Monitoring

### View Secret Access Logs

```bash
# Development
gcloud logging read "resource.type=secret_manager_secret AND resource.labels.secret_id=app-secrets-dev" \
  --limit 20 \
  --project=invoice-660f3

# Production
gcloud logging read "resource.type=secret_manager_secret AND resource.labels.secret_id=app-secrets-prod" \
  --limit 20 \
  --project=carenest-prod
```

### Check Secret Versions

```bash
# List all versions
npm run secrets:list:dev
npm run secrets:list:prod

# Or directly with gcloud
gcloud secrets versions list app-secrets-dev --project=invoice-660f3
gcloud secrets versions list app-secrets-prod --project=carenest-prod
```

## Migration from Old Approach

If you previously had individual secrets in Secret Manager:

### 1. Verify New Secrets Work

Deploy and test the application with consolidated secrets first.

### 2. Clean Up Old Secrets

```bash
# Preview what will be deleted (Dry Run)
npm run secrets:cleanup:dev -- --dry-run
npm run secrets:cleanup:prod -- --dry-run

# Delete old individual secrets (AFTER verifying new approach works!)
# Development secrets
npm run secrets:cleanup:dev

# Production secrets (requires extra confirmation)
npm run secrets:cleanup:prod
```

### 3. Update GitHub Secrets

You can now remove individual secret environment variables from GitHub repository settings, as they're no longer needed in the workflows.

## Hybrid Mode (Legacy Support)

If your Cloud Run service still has bindings to individual secrets (causing deployments to fail if they are missing), you can use the restoration script to recreate them.

### Restore Individual Secrets

This creates individual secrets (e.g., `MONGODB_URI`, `REDIS_URL`) from your consolidated `secrets.json` file.

```bash
# Restore Development Secrets
npm run secrets:restore:dev

# Restore Production Secrets
npm run secrets:restore:prod
```

This is useful if you are in a transitional state where Cloud Run expects old secrets but you want to manage them via the consolidated file.

## Advanced Usage

### Rotate All Secrets

```bash
# 1. Update secrets.json with new values
vim backend/secrets.json

# 2. Upload new version
npm run secrets:upload:all

# 3. Restart Cloud Run services (picks up latest version)
gcloud run services update backend-dev --region australia-southeast1 --project invoice-660f3
gcloud run services update backend-prod --region australia-southeast1 --project carenest-prod
```

### Emergency Secret Rotation

```bash
# 1. Update compromised secret in secrets.json
# 2. Upload immediately
npm run secrets:upload:prod

# 3. Force immediate deployment
gcloud run deploy backend-prod \
  --image australia-southeast1-docker.pkg.dev/carenest-prod/backend-repo/backend-prod:latest \
  --region australia-southeast1 \
  --update-secrets "APP_SECRETS=app-secrets-prod:latest" \
  --project carenest-prod
```

### Access Secret Programmatically

```javascript
const { secretLoader, getSecret } = require('./config/secretLoader');

// Get specific secret
const jwtSecret = getSecret('JWT_SECRET', 'default-value');

// Check if secret exists
if (secretLoader.has('STRIPE_SECRET_KEY')) {
  // ... use Stripe
}

// Get summary (safe for logging)
console.log(secretLoader.getSummary());
// {
//   environment: 'production',
//   isCloudRun: true,
//   secretCount: 47,
//   loaded: true,
//   secretKeys: ['ADMIN_EMAIL', 'APP_PASSWORD', ...]
// }
```

## FAQ

**Q: Can I still use `.env` files?**  
A: Yes! The loader falls back to `process.env`, so `.env` files still work for local overrides.

**Q: What happens if Secret Manager is down?**  
A: The app falls back to environment variables. In Cloud Run, you should set critical env vars directly as backup.

**Q: How do I share secrets with team members?**  
A: Grant them access to the Secret Manager secret:
```bash
gcloud secrets add-iam-policy-binding app-secrets-dev \
  --member="user:teammate@gmail.com" \
  --role="roles/secretmanager.secretAccessor"
```

**Q: Can I use different secrets for different services?**  
A: Yes! Create additional consolidated secrets (you have 6 free slots). Example: `app-secrets-frontend`, `app-secrets-worker`, etc.

**Q: Does this work with other cloud providers?**  
A: The Secret Manager loader is Google Cloud specific, but you can create similar loaders for AWS Secrets Manager or Azure Key Vault.

## Support

- **Documentation**: This file
- **Script Help**: `node scripts/upload-secrets.js help`
- **Google Cloud Docs**: https://cloud.google.com/secret-manager/docs
- **Issues**: Check Cloud Run logs first

## Summary

✅ **Zero-cost** secrets management (within free tier)  
✅ **Simple** to maintain (one file = one secret)  
✅ **Secure** (secrets stay in Secret Manager)  
✅ **Fast** to deploy (no complex configurations)  
✅ **Flexible** (works locally and in cloud)  

You now have enterprise-grade secrets management at no cost!
