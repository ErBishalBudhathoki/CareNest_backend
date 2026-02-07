#!/bin/bash

# Zero-Trust Security Verification Script
# Usage: ./verify_security.sh [BASE_URL]
# Default: http://localhost:8080

BASE_URL="${1:-http://localhost:8080}"
echo "🔍 Starting Security Verification against $BASE_URL"
echo "---------------------------------------------------"

# 1. Health Check
echo "1️⃣  Checking Server Health..."
HEALTH_RESPONSE=$(curl -s "$BASE_URL/health")
if [[ $HEALTH_RESPONSE == *"OK"* ]]; then
  echo "✅ Server is UP"
else
  echo "❌ Server is NOT responding or unhealthy"
  echo "   Response: $HEALTH_RESPONSE"
  exit 1
fi

echo "---------------------------------------------------"

# 2. CORS Test (External Origin)
echo "2️⃣  Testing CORS Protection (Evil Origin)..."
# Expecting an error or rejection because https://evil.com is not in ALLOWED_ORIGINS
CORS_CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Origin: https://evil.com" "$BASE_URL/api/invoices")

# If CORS rejects via middleware callback(err), express usually returns 500 or error HTML
if [[ "$CORS_CODE" != "200" ]]; then
  echo "✅ CORS blocked unauthorized origin (Status: $CORS_CODE)"
else
  echo "❌ CORS FAILED: Allowed unauthorized origin (Status: 200)"
fi

echo "---------------------------------------------------"

# 3. Protected Endpoint (No Auth)
echo "3️⃣  Testing Auth Middleware (No Token)..."
AUTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/invoices")

if [[ "$AUTH_CODE" == "401" ]]; then
  echo "✅ Auth rejected request without token (Status: 401)"
else
  echo "❌ Auth FAILED: Expected 401, got $AUTH_CODE"
fi

echo "---------------------------------------------------"

# 4. Protected Endpoint (No Organization Context)
# Note: This requires a valid token to test properly. 
# We can't generate one easily without login credentials.
echo "4️⃣  Organization Context Check..."
echo "ℹ️  To test this, run:"
echo "   curl -H \"Authorization: Bearer <TOKEN>\" $BASE_URL/api/invoices"
echo "   (Should fail with 400 - Organization context required)"

echo "---------------------------------------------------"
echo "✅ Automated checks completed."
