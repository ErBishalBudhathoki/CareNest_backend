# Safe Migration Plan: Old Individual Secrets → Consolidated Secrets

## ⚠️ IMPORTANT: Delete Old Secrets ONLY AFTER Verification

**DO NOT** delete old secrets until you've confirmed the new consolidated approach works perfectly!

---

## Migration Timeline (Recommended)

### Phase 1: Setup & Upload (Day 1)
✅ Install dependencies  
✅ Upload consolidated secrets  
✅ Keep old secrets as backup  

### Phase 2: Deploy & Test (Day 2-3)
✅ Deploy to development  
✅ Test all functionality  
✅ Monitor logs for issues  
✅ Deploy to production (after dev testing)  

### Phase 3: Verify & Monitor (Day 4-7)
✅ Monitor production for 3-5 days  
✅ Confirm no issues  
✅ Verify cost reduction in billing  

### Phase 4: Cleanup (Day 8+)
✅ Run cleanup script  
✅ Delete old individual secrets  
✅ Celebrate cost savings! 🎉

---

## Step-by-Step Migration Guide

### Step 1: Verify Current Setup

```bash
# List current secrets in development
gcloud config set project invoice-660f3
gcloud secrets list

# List current secrets in production
gcloud config set project carenest-prod
gcloud secrets list
```

You should see 11 individual secrets per environment (22 total):
- `dev-mongodb-uri`, `dev-redis-url`, `dev-jwt-secret`, etc.
- `prod-mongodb-uri`, `prod-redis-url`, `prod-jwt-secret`, etc.

### Step 2: Upload Consolidated Secrets

```bash
cd backend

# Upload development secrets
gcloud auth login deverbishal331@gmail.com
npm run secrets:upload:dev

# Upload production secrets
gcloud auth login erbishalb331@gmail.com
npm run secrets:upload:prod
```

**Result**: You now have 24 secrets total:
- 11 old dev secrets ✓
- 1 new consolidated dev secret (`app-secrets-dev`) ✓
- 11 old prod secrets ✓
- 1 new consolidated prod secret (`app-secrets-prod`) ✓

**Cost at this point**: Still paying for 18 secrets (over free tier)

### Step 3: Deploy to Development

```bash
# Commit changes
git checkout dev
git add .
git commit -m "feat: implement consolidated secrets management"
git push origin dev
```

**What happens**:
- GitHub Actions deploys with new workflow
- Application uses `app-secrets-dev` consolidated secret
- Old individual secrets are **ignored** (still exist, just not used)

### Step 4: Test Development Thoroughly

```bash
# Check Cloud Run logs for secret loading
gcloud logs tail \
  --filter="resource.type=cloud_run_revision AND resource.labels.service_name=backend-dev" \
  --project=invoice-660f3 \
  --format=json | grep SecretLoader

# Look for:
# [SecretLoader] ✓ Loaded XX secrets from Secret Manager
```

**Test checklist**:
- [ ] Application starts successfully
- [ ] Database connection works (MongoDB)
- [ ] Cache connection works (Redis)
- [ ] Authentication works (JWT)
- [ ] Stripe payments work
- [ ] Email sending works
- [ ] Firebase works
- [ ] R2 storage works
- [ ] No errors in logs

**If ANY test fails**:
1. DO NOT proceed to production
2. DO NOT delete old secrets
3. Investigate and fix the issue
4. Old secrets are still there as backup

### Step 5: Deploy to Production (Only After Dev Works!)

```bash
# Merge to main
git checkout main
git merge dev
git push origin main
```

Monitor production deployment carefully.

### Step 6: Monitor Production (3-5 Days)

```bash
# Check production logs daily
gcloud logs tail \
  --filter="resource.type=cloud_run_revision" \
  --project=carenest-prod \
  --format=json | grep SecretLoader
```

**Monitor for**:
- Application errors
- Performance issues
- User-reported problems
- Billing changes

**If everything is good for 3-5 days**, proceed to cleanup.

### Step 7: Preview Cleanup (Dry Run)

Before deleting anything, see what would be deleted:

```bash
# Preview dev cleanup
npm run secrets:cleanup:dev -- --dry-run

# Preview prod cleanup
npm run secrets:cleanup:prod -- --dry-run
```

This shows you exactly what will be deleted without actually deleting.

### Step 8: Delete Old Development Secrets

```bash
# Cleanup development (REQUIRES CONFIRMATION)
npm run secrets:cleanup:dev
```

**What happens**:
1. Script verifies consolidated secret exists
2. Script finds all old individual secrets
3. Shows you the list
4. Asks for confirmation
5. Deletes each secret one by one

**Expected output**:
```
Pre-Cleanup Checklist
======================
✓ Consolidated secret app-secrets-dev verified
✓ Found 11 old secrets to delete:
  - dev-mongodb-uri
  - dev-redis-url
  ...
  
⚠️  WARNING: This will PERMANENTLY delete these secrets!
Are you sure you want to delete these secrets? (yes/no): yes

Deleting secrets...
✓ Deleted: dev-mongodb-uri
✓ Deleted: dev-redis-url
...
Successfully deleted: 11
```

### Step 9: Monitor After Dev Cleanup

Wait 24 hours and monitor development:

```bash
# Check if dev still works
curl https://YOUR-DEV-URL/api/health
```

**If dev works fine**, proceed to production cleanup.

### Step 10: Delete Old Production Secrets

```bash
# Cleanup production (EXTRA CONFIRMATION REQUIRED)
npm run secrets:cleanup:prod
```

**Extra safety for production**:
- Requires typing "DELETE PRODUCTION SECRETS" to confirm
- Only proceed if you're 100% confident

### Step 11: Verify Final State

```bash
# Development
gcloud secrets list --project=invoice-660f3
# Should only show: app-secrets-dev

# Production
gcloud secrets list --project=carenest-prod
# Should only show: app-secrets-prod
```

**Final count**: 2 secrets total (within free tier!)

---

## Pre-Cleanup Checklist

Before running the cleanup script, verify:

### Development
- [ ] `app-secrets-dev` exists in Secret Manager
- [ ] Application deployed with new workflow
- [ ] Application running without errors
- [ ] Logs show: `[SecretLoader] ✓ Loaded XX secrets from Secret Manager`
- [ ] All features tested and working
- [ ] No errors for at least 24 hours

### Production
- [ ] `app-secrets-prod` exists in Secret Manager
- [ ] Application deployed with new workflow
- [ ] Application running without errors
- [ ] Logs show: `[SecretLoader] ✓ Loaded XX secrets from Secret Manager`
- [ ] All features tested and working
- [ ] No errors for at least 3-5 days
- [ ] Users report no issues

---

## Verification Commands

### Check Consolidated Secret Exists

```bash
# Development
gcloud secrets describe app-secrets-dev --project=invoice-660f3

# Production
gcloud secrets describe app-secrets-prod --project=carenest-prod
```

### Check Application Logs

```bash
# Development
gcloud logs read \
  --limit 100 \
  --filter='resource.type=cloud_run_revision AND resource.labels.service_name=backend-dev AND textPayload=~"SecretLoader"' \
  --project=invoice-660f3

# Production
gcloud logs read \
  --limit 100 \
  --filter='resource.type=cloud_run_revision AND textPayload=~"SecretLoader"' \
  --project=carenest-prod
```

### Check Old Secrets Still Exist

```bash
# Before cleanup - should see 11 old secrets
gcloud secrets list --project=invoice-660f3 | grep "^dev-"

# After cleanup - should see nothing
gcloud secrets list --project=invoice-660f3 | grep "^dev-"
```

---

## Rollback Plan (If Something Goes Wrong)

### If You Haven't Deleted Old Secrets Yet
1. Revert GitHub Actions workflows to old version
2. Redeploy application
3. Old secrets still work!

### If You Already Deleted Old Secrets
**This is why we wait 3-5 days before cleanup!**

If you deleted secrets prematurely:
1. Re-upload from `secrets.json`:
   ```bash
   # Extract individual secrets from secrets.json and upload
   # (You'd need to create a script for this)
   ```

2. Or restore from Secret Manager version history:
   ```bash
   # Secrets aren't truly deleted for 30 days
   gcloud secrets undelete SECRET_NAME --project=PROJECT_ID
   ```

---

## What Gets Deleted

### Development (11 secrets)
```
dev-mongodb-uri
dev-redis-url
dev-jwt-secret
dev-stripe-secret
dev-stripe-webhook
dev-smtp-password
dev-app-password
dev-r2-access-key
dev-r2-secret
dev-firebase-private-key
dev-firebase-private-key-id
```

### Production (11 secrets)
```
prod-mongodb-uri
prod-redis-url
prod-jwt-secret
prod-stripe-secret
prod-stripe-webhook
prod-smtp-password
prod-app-password
prod-r2-access-key
prod-r2-secret
prod-firebase-private-key
prod-firebase-private-key-id
```

---

## Cost Impact Timeline

| Phase | Secrets Count | Monthly Cost | Status |
|-------|---------------|--------------|---------|
| **Before Migration** | 22 (11×2) | $0.96 | 😞 Paying |
| **During Migration** | 24 (22+2) | $1.08 | 😬 Temporarily higher |
| **After Dev Cleanup** | 13 (11+1+1) | $0.42 | 😊 Reduced |
| **After Full Cleanup** | 2 (1+1) | **$0.00** | 🎉 **FREE!** |

**Important**: Migration temporarily increases costs by ~$0.12/month. This lasts only until you delete old secrets (ideally within 1-2 weeks).

---

## Emergency Procedures

### If Production Breaks After Cleanup

1. **Immediately stop the cleanup script** if still running
2. **Check application logs** for specific error
3. **Verify consolidated secret** is accessible
4. **Re-upload consolidated secret** if needed:
   ```bash
   npm run secrets:upload:prod
   ```
5. **Restart Cloud Run** to pick up changes:
   ```bash
   gcloud run services update backend-prod --region australia-southeast1
   ```

### If You Need to Restore a Deleted Secret

Deleted secrets go to "soft delete" for 30 days:

```bash
# List deleted secrets
gcloud secrets list --show-deleted --project=PROJECT_ID

# Restore a deleted secret
gcloud secrets undelete SECRET_NAME --project=PROJECT_ID
```

---

## Recommended Timeline Summary

| Day | Action | Time Required |
|-----|--------|---------------|
| **Day 1** | Upload consolidated secrets | 10 minutes |
| **Day 2** | Deploy to dev, test | 2-3 hours |
| **Day 3** | Monitor dev | 30 minutes |
| **Day 4** | Deploy to prod | 1 hour |
| **Day 5-7** | Monitor prod carefully | 30 min/day |
| **Day 8** | Cleanup dev secrets | 10 minutes |
| **Day 9** | Monitor post-cleanup | 30 minutes |
| **Day 10** | Cleanup prod secrets | 10 minutes |
| **Day 11+** | Monitor, celebrate savings! | 🎉 |

**Total time investment**: ~8-10 hours over 10 days  
**Annual savings**: $11.52/year  
**Bonus**: Simpler infrastructure, easier maintenance

---

## Quick Commands Reference

```bash
# Upload secrets
npm run secrets:upload:dev
npm run secrets:upload:prod

# Preview cleanup (dry run)
npm run secrets:cleanup:dev -- --dry-run
npm run secrets:cleanup:prod -- --dry-run

# Actually cleanup (with confirmation)
npm run secrets:cleanup:dev
npm run secrets:cleanup:prod

# Check logs
gcloud logs tail --filter="SecretLoader" --project=invoice-660f3
gcloud logs tail --filter="SecretLoader" --project=carenest-prod

# List secrets
gcloud secrets list --project=invoice-660f3
gcloud secrets list --project=carenest-prod
```

---

## Final Checklist Before Cleanup

Print this and check off each item:

### Development Cleanup
- [ ] Consolidated secret uploaded successfully
- [ ] Application deployed with new workflow  
- [ ] Application running for 24+ hours
- [ ] No errors in logs
- [ ] All features tested manually
- [ ] Automated tests pass (if any)
- [ ] Ran dry-run cleanup script
- [ ] Reviewed list of secrets to be deleted
- [ ] Have backup of `secrets.json` file

### Production Cleanup  
- [ ] Development cleanup completed successfully
- [ ] Consolidated secret uploaded to prod
- [ ] Application deployed to prod
- [ ] Application running for 3-5 days
- [ ] Zero production errors
- [ ] Zero user complaints
- [ ] All critical features verified
- [ ] Ran dry-run cleanup script for prod
- [ ] Reviewed list of secrets to be deleted
- [ ] Scheduled cleanup during low-traffic period
- [ ] Have rollback plan ready

---

## Need Help?

- **Dry run first**: Always use `--dry-run` flag to preview
- **Monitor closely**: Check logs frequently
- **Wait longer if unsure**: Better safe than sorry
- **Keep backups**: `secrets.json` is your backup

**Remember**: The old secrets aren't costing you much (only ~$1/month), so there's no rush. Take your time and be thorough!
