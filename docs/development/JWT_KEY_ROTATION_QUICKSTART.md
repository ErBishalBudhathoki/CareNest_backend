# JWT Key Rotation - Quick Start Guide

## TL;DR

Your app now has automatic JWT key rotation! Here's what you need to know:

## For Developers

### 1. Update Your .env File

Add these lines to your `.env`:

```bash
# JWT Key Rotation (Optional - these are defaults)
JWT_AUTO_ROTATION_ENABLED=true
JWT_ROTATION_INTERVAL_DAYS=30
JWT_KEY_LIFETIME_DAYS=90
```

### 2. Restart Your Server

```bash
npm start
```

That's it! The system will:
- ✅ Create an initial key from your existing `JWT_SECRET`
- ✅ Start automatic rotation every 30 days
- ✅ Keep your existing tokens working

## What Just Happened?

Your app can now:
1. **Automatically rotate JWT secrets** every 30 days (configurable)
2. **Keep old tokens valid** during rotation (zero downtime)
3. **Emergency rotate** if keys are compromised
4. **Monitor key health** via admin API

## Testing It Works

### Check Status (requires admin token)

```bash
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
     http://localhost:8080/api/admin/jwt-keys/status
```

Expected response:
```json
{
  "success": true,
  "data": {
    "activeKey": {
      "keyId": "key_1234567890",
      "daysUntilExpiry": 89,
      "algorithm": "HS256"
    },
    "automaticRotationEnabled": true,
    "initialized": true
  }
}
```

### List All Keys

```bash
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
     http://localhost:8080/api/admin/jwt-keys
```

## Common Tasks

### Manually Rotate Keys

```bash
curl -X POST \
     -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     http://localhost:8080/api/admin/jwt-keys/rotate
```

### Emergency Rotation (requires superadmin)

⚠️ **Warning**: This invalidates ALL existing tokens!

```bash
curl -X POST \
     -H "Authorization: Bearer YOUR_SUPERADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"reason": "Security incident"}' \
     http://localhost:8080/api/admin/jwt-keys/emergency-rotate
```

### Disable Automatic Rotation

In `.env`:
```bash
JWT_AUTO_ROTATION_ENABLED=false
```

Then restart server.

## Configuration Options

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_AUTO_ROTATION_ENABLED` | `true` | Enable/disable automatic rotation |
| `JWT_ROTATION_INTERVAL_DAYS` | `30` | How often to rotate (days) |
| `JWT_KEY_LIFETIME_DAYS` | `90` | How long keys stay valid (days) |

## For Frontend Developers

**No changes needed!** Your tokens will continue to work exactly as before. The rotation happens seamlessly on the backend.

## Troubleshooting

### "No active JWT secret found"

**Fix**: Restart your server. It will auto-create the initial key.

### Tokens stop working after emergency rotation

**Expected behavior**. Users need to log in again. This is the point of emergency rotation.

### Want to check if rotation is working?

Check server logs for:
```
[JWT Key Rotation] Rotation completed. New key: key_xxx
```

## Need More Details?

See the full documentation:
- **Complete Guide**: `docs/JWT_KEY_ROTATION.md`
- **Implementation Summary**: `docs/JWT_KEY_ROTATION_SUMMARY.md`

## Admin API Endpoints

All at `/api/admin/jwt-keys/*` (require admin auth):

- `GET /status` - Get rotation status
- `GET /` - List all keys
- `POST /rotate` - Manual rotation
- `POST /emergency-rotate` - Emergency rotation (superadmin only)
- `GET /health/check` - Health check

## Best Practices

1. **Rotate regularly**: Keep default 30-day rotation
2. **Monitor status**: Check weekly via API
3. **Test in staging first**: Before production
4. **Keep keys valid longer than rotation interval**: 3x is recommended
5. **Emergency rotation**: Only when keys compromised

## What If Something Goes Wrong?

The system has graceful fallback:
- If key rotation service fails → falls back to `JWT_SECRET`
- Your app keeps working!
- Check logs for issues
- Contact DevOps team

## Security Notes

- Keys are stored in MongoDB
- Admin endpoints require authentication
- Emergency rotation requires superadmin role
- All key operations are logged
- Complete audit trail maintained

---

**Questions?** Check the full docs or contact the development team.
