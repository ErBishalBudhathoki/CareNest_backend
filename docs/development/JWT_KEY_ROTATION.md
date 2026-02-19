# JWT Key Rotation Implementation Guide

## Overview

This application now supports automatic JWT secret key rotation for enhanced security. The system maintains multiple keys simultaneously, allowing zero-downtime rotation while keeping existing tokens valid during a grace period.

## Key Features

- **Zero-Downtime Rotation**: Old tokens remain valid during transition
- **Automatic Rotation**: Keys rotate on a configurable schedule (default: 30 days)
- **Manual Control**: Admin API for emergency rotation and manual management
- **Graceful Fallback**: Falls back to `JWT_SECRET` if key rotation service fails
- **Audit Trail**: Complete history of all key rotations and changes

## Architecture

### Components

1. **JWTSecret Model** (`backend/models/JWTSecret.js`)
   - Stores multiple JWT secrets with metadata
   - Tracks key status (active, valid, revoked)
   - Manages key lifecycle and expiration

2. **Key Rotation Service** (`backend/services/jwtKeyRotationService.js`)
   - Handles automatic and manual rotation
   - Caches active keys for performance
   - Provides health monitoring

3. **JWT Helper** (`backend/utils/jwtHelper.js`)
   - Centralized token generation and verification
   - Automatically uses current active key
   - Supports multi-key verification

4. **Admin API** (`backend/routes/jwtKeyRotation.js`)
   - Endpoints for key management
   - Manual rotation triggers
   - Emergency rotation for security incidents

## Environment Variables

Add these to your `.env` file:

```bash
# Existing JWT configuration
JWT_SECRET=your-jwt-secret-key-here
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=30d

# New: JWT Key Rotation Configuration
JWT_AUTO_ROTATION_ENABLED=true          # Enable/disable automatic rotation (default: true)
JWT_ROTATION_INTERVAL_DAYS=30           # Rotation frequency in days (default: 30)
JWT_KEY_LIFETIME_DAYS=90                # How long keys remain valid (default: 90)
```

### Configuration Details

- **JWT_AUTO_ROTATION_ENABLED**: Set to `false` to disable automatic rotation
- **JWT_ROTATION_INTERVAL_DAYS**: How often to rotate keys (recommended: 30-90 days)
- **JWT_KEY_LIFETIME_DAYS**: Grace period for old keys (should be > rotation interval)

## Migration Guide

### Initial Setup

1. **Update Environment Variables**
   ```bash
   # Add to .env
   JWT_AUTO_ROTATION_ENABLED=true
   JWT_ROTATION_INTERVAL_DAYS=30
   JWT_KEY_LIFETIME_DAYS=90
   ```

2. **Restart Server**
   The system will automatically:
   - Create an initial key from your existing `JWT_SECRET`
   - Initialize the key rotation service
   - Start automatic rotation (if enabled)

3. **Verify Installation**
   ```bash
   # Check key rotation status
   curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
        http://localhost:8080/api/admin/jwt-keys/status
   ```

### For Existing Applications

**No action required for existing tokens!**

- The system automatically creates an initial key from your current `JWT_SECRET`
- All existing tokens will continue to work
- New tokens will be signed with the rotation-managed keys

## Admin API Endpoints

All endpoints require admin authentication (`Authorization: Bearer <token>`)

### Get Key Status
```bash
GET /api/admin/jwt-keys/status

Response:
{
  "success": true,
  "data": {
    "activeKey": {
      "keyId": "key_1234567890",
      "activatedAt": "2024-01-01T00:00:00.000Z",
      "expiresAt": "2024-04-01T00:00:00.000Z",
      "daysUntilExpiry": 45,
      "algorithm": "HS256"
    },
    "validKeysCount": 2,
    "revokedKeysCount": 1,
    "automaticRotationEnabled": true,
    "initialized": true
  }
}
```

### List All Keys
```bash
GET /api/admin/jwt-keys

Response:
{
  "success": true,
  "count": 3,
  "data": [
    {
      "keyId": "key_1234567890",
      "status": "active",
      "algorithm": "HS256",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "expiresAt": "2024-04-01T00:00:00.000Z"
    }
  ]
}
```

### Manual Rotation
```bash
POST /api/admin/jwt-keys/rotate
Content-Type: application/json

{
  "keyLifetimeDays": 90
}

Response:
{
  "success": true,
  "message": "Key rotation completed successfully",
  "data": {
    "newKeyId": "key_1234567891",
    "previousKeyId": "key_1234567890",
    "expiresAt": "2024-04-01T00:00:00.000Z"
  }
}
```

### Emergency Rotation
**Warning**: This revokes ALL existing keys and invalidates ALL tokens!

```bash
POST /api/admin/jwt-keys/emergency-rotate
Content-Type: application/json
Authorization: Bearer <SUPERADMIN_TOKEN>

{
  "reason": "Security incident - potential key compromise",
  "keyLifetimeDays": 90
}

Response:
{
  "success": true,
  "message": "Emergency rotation completed. All previous tokens invalidated.",
  "warning": "All previous tokens have been invalidated. Users must re-authenticate.",
  "data": {
    "newKeyId": "key_emergency_1234567892",
    "revokedKeysCount": 3
  }
}
```

### Revoke Specific Key
```bash
POST /api/admin/jwt-keys/:keyId/revoke
Content-Type: application/json

{
  "reason": "Key no longer needed"
}
```

### Health Check
```bash
GET /api/admin/jwt-keys/health/check

Response:
{
  "success": true,
  "data": {
    "healthy": true,
    "issues": [],
    "warnings": [],
    "status": "OK",
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

## Security Considerations

### Key Storage

- **Database**: Keys are stored in MongoDB in the `jwt_secrets` collection
- **Production**: Consider encrypting the `secret` field at rest
- **Access Control**: Only superadmin users can perform emergency rotation

### Rotation Schedule

**Recommended settings:**
- **High Security**: Rotate every 7-14 days
- **Standard**: Rotate every 30 days (default)
- **Low Risk**: Rotate every 90 days

### Key Lifetime

- Set `JWT_KEY_LIFETIME_DAYS` > `JWT_ROTATION_INTERVAL_DAYS`
- Recommended: 3x the rotation interval
- Example: If rotating every 30 days, keep keys valid for 90 days

## Monitoring

### Health Checks

The system provides automatic health monitoring:

```javascript
const health = await keyRotationService.healthCheck();

if (!health.healthy) {
  // Alert: Key rotation system has issues
  console.error('Issues:', health.issues);
}

if (health.warnings.length > 0) {
  // Warning: Potential issues detected
  console.warn('Warnings:', health.warnings);
}
```

### Logging

All key rotation events are logged:

- Key rotation started/completed
- Emergency rotations
- Failed rotation attempts
- Key activation/revocation

Check logs for `[JWT Key Rotation]` entries.

### Metrics

Track these metrics in your monitoring system:

- Time since last rotation
- Number of valid keys
- Number of failed rotation attempts
- Token verification failures by key

## Troubleshooting

### Issue: Server Won't Start

**Error**: "No active JWT secret found"

**Solution**:
```bash
# Ensure JWT_SECRET is set in .env
JWT_SECRET=your-secret-key-here

# Check MongoDB connection
# The initial key is created automatically on first startup
```

### Issue: All Tokens Invalid

**Cause**: Emergency rotation was performed

**Solution**:
- Users must log in again to get new tokens
- This is expected behavior for emergency rotation
- Communicate with users before performing emergency rotation

### Issue: Rotation Service Unavailable

**Behavior**: System falls back to `JWT_SECRET` from environment

**Impact**: Tokens still work, but rotation is paused

**Solution**:
1. Check MongoDB connection
2. Review server logs for errors
3. Verify `jwt_secrets` collection is accessible
4. Restart server to reinitialize rotation service

### Issue: Tokens Failing Verification

**Check**:
1. Verify active key exists: `GET /api/admin/jwt-keys/status`
2. Check key expiration dates
3. Review server logs for verification errors
4. Ensure MongoDB has valid keys

**Fix**:
```bash
# Trigger manual rotation to create fresh keys
POST /api/admin/jwt-keys/rotate
```

## Best Practices

1. **Regular Monitoring**: Check rotation status weekly
2. **Backup Before Emergency Rotation**: Warn users before invalidating tokens
3. **Test in Staging**: Always test rotation in non-production first
4. **Key Lifetime**: Keep keys valid for at least 3x rotation interval
5. **Audit Trail**: Regularly review key rotation logs
6. **Emergency Procedure**: Document steps for emergency rotation
7. **User Communication**: Notify users if emergency rotation is needed

## Advanced Usage

### Programmatic Key Management

```javascript
const keyRotationService = require('./services/jwtKeyRotationService');

// Get rotation status
const status = await keyRotationService.getRotationStatus();

// Manual rotation
await keyRotationService.rotateKeys({
  rotationType: 'manual',
  createdBy: 'admin@example.com',
  keyLifetimeDays: 90
});

// Emergency rotation
await keyRotationService.emergencyRotation(
  'Security incident detected',
  { createdBy: 'security-team@example.com' }
);

// Health check
const health = await keyRotationService.healthCheck();
```

### Custom Token Generation

```javascript
const JWTHelper = require('./utils/jwtHelper');

// Generate token with rotation support
const token = await JWTHelper.generateToken({
  userId: user.id,
  email: user.email,
  roles: user.roles
});

// Verify token (tries all valid keys)
const decoded = await JWTHelper.verifyToken(token);
```

## Migration Timeline

### Week 1: Preparation
- Review documentation
- Update environment variables
- Test in development environment

### Week 2: Staging Deployment
- Deploy to staging
- Verify key rotation works
- Test admin API endpoints
- Monitor logs for issues

### Week 3: Production Deployment
- Deploy to production
- Monitor key rotation initialization
- Verify existing tokens still work
- Check first automatic rotation

### Week 4+: Ongoing
- Monitor rotation status
- Review logs regularly
- Adjust rotation interval if needed

## Support

For issues or questions:
1. Check server logs for `[JWT Key Rotation]` entries
2. Review health check endpoint
3. Contact development team with logs and error messages

## Changelog

### Version 1.0.0
- Initial JWT key rotation implementation
- Automatic rotation support
- Admin API for key management
- Zero-downtime rotation
- Emergency rotation capability
