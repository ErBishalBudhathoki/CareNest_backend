# Internal Keep-Alive Service for Render Platform

## Overview

The Internal Keep-Alive Service prevents Render's free tier from spinning down the server due to inactivity by automatically pinging the health endpoint every 10 minutes.

## How It Works

### Automatic Detection & Activation
- **Service**: `utils/keepAlive.js`
- **Activation**: Automatically enabled when `NODE_ENV=production` and running on Render
- **URL**: Uses `https://more-than-invoice.onrender.com` as default production URL
- **Mechanism**: Self-pings the `/health` endpoint every 10 minutes
- **Detection**: Automatically detects Render environment

### Key Features
- ✅ **Zero Configuration**: Works automatically in production
- ✅ **Minimal Resource Usage**: Single HTTP request every 10 minutes
- ✅ **Smart Timing**: 3-minute initial delay, then regular 10-minute intervals
- ✅ **Comprehensive Logging**: Detailed logs for monitoring
- ✅ **Graceful Shutdown**: Proper cleanup on server shutdown
- ✅ **Error Handling**: Robust error handling and timeout management

## Configuration

### Environment Variables (Render automatically sets these)
```bash
NODE_ENV=production
RENDER_EXTERNAL_URL=https://more-than-invoice.onrender.com
RENDER_SERVICE_ID=srv-xxxxxxxxxxxxx
RENDER=true
```

### Automatic Settings
```javascript
{
  interval: 10 * 60 * 1000,  // 10 minutes
  initialDelay: 3 * 60 * 1000, // 3 minutes
  timeout: 30000,  // 30 seconds
  enabled: production && render_platform
}
```

## Startup Process

### Development Mode
```
🔄 Keep-alive service disabled in development mode
```

### Production Mode (Render)
```
🟢 Production mode: Secure logging enabled
🔒 Sensitive data logging disabled
🔄 Keep-alive service initialized for Render platform
🌐 Production URL: Environment variable (BACKEND_URL)
```

### After 3 Minutes
```
🔄 Keep-alive service starting ping routine
🔄 Keep-alive service started successfully
```

## Monitoring

### Health Endpoint Enhancement
The `/health` endpoint includes keep-alive status in production:

```json
{
  "status": "OK",
  "timestamp": "2025-09-10T12:00:00.000Z",
  "environment": "production",
  "uptime": 3600,
  "keepAlive": {
    "enabled": true,
    "serverUrl": "$BACKEND_URL (from environment)",
    "interval": 600000,
    "running": true
  },
  "services": {
    "mongodb": "connected",
    "firebase": "initialized"
  }
}
```

### Ping Logs (Production)
```json
{
  "level": "info",
  "message": "Keep-alive ping successful",
  "statusCode": 200,
  "serverStatus": "OK",
  "uptime": "45 minutes",
  "timestamp": "2025-09-10T12:00:00.000Z"
}
```

## Testing

### Check Production Health
```bash
# Test production endpoint
npm run health-check

# Or direct curl with environment variable
curl $BACKEND_URL/health
```

### Local Testing
```bash
# Test local server
npm run health-check:local

# Or direct curl
curl http://localhost:8080/health
```

## Deployment to Render

### 1. Push to GitHub
```bash
git add .
git commit -m "Add internal keep-alive service for Render platform"
git push origin main
```

### 2. Render Configuration
- **Build Command**: `npm install`
- **Start Command**: `npm run prod`
- **Health Check Path**: `/health`
- **Environment**: Production

### 3. Environment Variables (Set in Render Dashboard)
```bash
NODE_ENV=production
SERVERLESS=false
PORT=8080
BACKEND_URL=https://more-than-invoice.onrender.com
PRODUCTION_URL=https://more-than-invoice.onrender.com
RENDER_EXTERNAL_URL=https://more-than-invoice.onrender.com
MONGODB_URI=your_mongodb_connection_string
# ... other environment variables
```

## Expected Behavior

### After Deployment
1. 🚀 Server starts on Render
2. 🔄 Keep-alive service initializes automatically
3. ⏰ 3-minute wait for server to be fully accessible
4. 🎯 First ping attempt to `/health` endpoint
5. 🔁 Regular pings every 10 minutes thereafter
6. 🚫 Server never spins down due to inactivity

### Ping Schedule
- **First ping**: 3 minutes after server start
- **Subsequent pings**: Every 10 minutes
- **Ping target**: `$BACKEND_URL/health` (e.g., `https://more-than-invoice.onrender.com/health`)
- **Expected response**: 200 OK with health data

## Troubleshooting

### Service Not Starting
1. Check environment: `NODE_ENV` should be "production"
2. Verify Render detection in logs
3. Look for initialization message in startup logs

### Pings Failing
1. Check server accessibility: `curl $BACKEND_URL/health` (or direct URL)
2. Verify URL is correct in logs
3. Check for network or DNS issues

### Server Still Spinning Down
1. Verify ping frequency in application logs
2. Ensure pings are successful (200 OK responses)
3. Check Render service status

## Performance Impact

### Resource Usage
- **Memory**: ~2KB additional
- **CPU**: Negligible
- **Network**: ~2KB every 10 minutes
- **Logs**: ~1 log entry per ping

### Benefits
- ✅ Prevents cold starts (0-30 second delays)
- ✅ Maintains database connections
- ✅ Preserves application state
- ✅ Better user experience
- ✅ No external dependencies

## Security

### Request Headers
```javascript
{
  'User-Agent': 'KeepAlive-Service/1.0',
  'X-Keep-Alive': 'internal',
  'X-Service': 'more-than-invoice-backend'
}
```

### Security Benefits
- Uses existing public `/health` endpoint
- No additional attack surface
- Internal to the application
- Follows secure logging practices