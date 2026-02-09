# Consolidated Secrets Management - Quick Start

## TL;DR

Save money on Google Cloud Secret Manager by consolidating all secrets into ONE secret per environment (instead of 11+ individual secrets).

**Before**: 22 secrets → $11.52/year  
**After**: 2 secrets → **$0/year** (free tier!)

## Quick Setup

### 1. Install Dependency

```bash
cd backend
npm install
```

### 2. Upload Secrets to Google Cloud

```bash
# Development (invoice-660f3)
gcloud auth login deverbishal331@gmail.com
npm run secrets:upload:dev

# Production (carenest-prod)
gcloud auth login erbishalb331@gmail.com  
npm run secrets:upload:prod
```

This creates:
- `app-secrets-dev` in `invoice-660f3` project
- `app-secrets-prod` in `carenest-prod` project

### 3. Deploy

```bash
# Push to dev branch
git add .
git commit -m "feat: consolidated secrets management"
git push origin dev

# After testing, merge to main for production
```

That's it! Your app now uses consolidated secrets automatically.

## What Changed

### GitHub Actions Workflows

**OLD** (11 individual secrets):
```yaml
--update-secrets "MONGODB_URI=dev-mongodb-uri:latest" \
--update-secrets "REDIS_URL=dev-redis-url:latest" \
--update-secrets "JWT_SECRET=dev-jwt-secret:latest" \
# ... 8 more secrets
```

**NEW** (1 consolidated secret):
```yaml
--update-secrets "APP_SECRETS=app-secrets-dev:latest" \
--set-env-vars "GCP_PROJECT_ID=invoice-660f3"
```

### Application Startup

The app now:
1. Loads consolidated secret from Secret Manager (in Cloud Run)
2. Falls back to `secrets.json` (local development)
3. Falls back to `.env` (legacy support)

## Files Created

1. **`backend/scripts/upload-secrets.js`** - Upload script
2. **`backend/config/secretLoader.js`** - Runtime loader
3. **Updated `backend/server.js`** - Loads secrets on startup
4. **Updated GitHub Actions** - Simplified deployments

## Available Commands

```bash
# Upload secrets
npm run secrets:upload:dev      # Upload development secrets
npm run secrets:upload:prod     # Upload production secrets
npm run secrets:upload:all      # Upload both

# List secret versions
npm run secrets:list:dev        # List dev secret versions
npm run secrets:list:prod       # List prod secret versions
```

## Updating Secrets

1. Edit `backend/secrets.json`
2. Run `npm run secrets:upload:all`
3. Push to trigger deployment (or manually restart Cloud Run)

## Local Development

No changes needed! The app automatically loads from `secrets.json`:

```bash
npm run dev  # Works exactly as before
```

## Verify It Works

Check application logs after deployment:

```bash
# Development
gcloud logs tail --filter="resource.type=cloud_run_revision" --project=invoice-660f3 --format=json | grep SecretLoader

# Look for:
# [SecretLoader] ✓ Loaded 47 secrets from Secret Manager
```

## Cost Savings Breakdown

### Before
| Item | Count | Cost |
|------|-------|------|
| Individual secrets | 22 | $0.96/month |
| Secret accesses | ~100k/month | ~$0.00 |
| **Total** | | **$0.96/month** |

### After  
| Item | Count | Cost |
|------|-------|------|
| Consolidated secrets | 2 | $0.00 (free tier) |
| Secret accesses | ~10k/month | ~$0.00 |
| **Total** | | **$0.00/month** |

**Annual Savings**: $11.52/year + reduced complexity!

## Troubleshooting

### Secrets won't upload

```bash
# Check authentication
gcloud auth list

# Re-authenticate if needed
gcloud auth login YOUR_EMAIL@gmail.com

# Set correct project
gcloud config set project invoice-660f3  # or carenest-prod
```

### App can't load secrets in Cloud Run

```bash
# Check secret exists
gcloud secrets describe app-secrets-dev --project=invoice-660f3

# Check permissions
gcloud secrets get-iam-policy app-secrets-dev --project=invoice-660f3

# View application logs
gcloud logs read --limit 50 --project=invoice-660f3
```

### Local development issues

```bash
# Verify secrets.json exists and is valid JSON
cat backend/secrets.json | jq .

# Check the app loads it
npm run dev
# Look for: [SecretLoader] ✓ Loaded XX secrets from local file
```

## Security Notes

- ✅ `secrets.json` is in `.gitignore` - never commit it!
- ✅ Secrets stay in Google Cloud Secret Manager
- ✅ Different secrets for dev/prod environments
- ✅ Automatic access control via IAM
- ✅ Version history for all changes

## Need More Details?

See comprehensive documentation:
- **Complete Guide**: `docs/CONSOLIDATED_SECRETS_GUIDE.md`
- **Workflow Updates**: `backend/.github-workflows-update.md`
- **Script Help**: `node scripts/upload-secrets.js help`

## Migration Checklist

- [x] Install `@google-cloud/secret-manager` dependency
- [ ] Upload dev secrets: `npm run secrets:upload:dev`
- [ ] Upload prod secrets: `npm run secrets:upload:prod`
- [ ] Test dev deployment (wait 24 hours)
- [ ] Test prod deployment (wait 3-5 days)
- [ ] Verify app loads secrets correctly
- [ ] **Delete old dev secrets**: `npm run secrets:cleanup:dev`
- [ ] Monitor dev for 24 hours
- [ ] **Delete old prod secrets**: `npm run secrets:cleanup:prod`
- [ ] Celebrate! 🎉 You're now at $0/year

## Deleting Old Individual Secrets

**⚠️ IMPORTANT**: Only delete old secrets AFTER verifying the new approach works!

### Safe Deletion Process

1. **Preview what will be deleted** (dry run):
   ```bash
   npm run secrets:cleanup:dev -- --dry-run
   npm run secrets:cleanup:prod -- --dry-run
   ```

2. **After testing for 24+ hours**, delete dev secrets:
   ```bash
   npm run secrets:cleanup:dev
   ```

3. **After testing for 3-5 days**, delete prod secrets:
   ```bash
   npm run secrets:cleanup:prod
   ```

### What Gets Deleted

**Development**: 11 individual secrets (`dev-mongodb-uri`, `dev-redis-url`, etc.)  
**Production**: 11 individual secrets (`prod-mongodb-uri`, `prod-redis-url`, etc.)

**Total savings**: From 22 secrets → 2 secrets = **100% cost reduction!**

See detailed migration plan: `docs/SECRETS_MIGRATION_PLAN.md`

## Support

**Questions?** Check the full guide in `docs/CONSOLIDATED_SECRETS_GUIDE.md`

**Issues?** Check Cloud Run logs: `gcloud logs tail --project=YOUR_PROJECT`

---

**Status**: ✅ Ready to deploy

**Next Step**: Run `npm run secrets:upload:all` to get started!
