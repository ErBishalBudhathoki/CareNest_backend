const Redis = require('ioredis');
const path = require('path');
// Load env from the backend root directory (one level up from scripts)
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Initialize Redis connection
const redisConfig = process.env.REDIS_URL || {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
};

let redis;
if (typeof redisConfig === 'string') {
  redis = new Redis(redisConfig);
} else {
  redis = new Redis(redisConfig);
}

const targetEmail = process.argv[2];

if (!targetEmail) {
  console.error('❌ Error: Please provide an email address.');
  console.log('Usage: node scripts/force_reset_limit.js <email>');
  process.exit(1);
}

async function resetLimits() {
  console.log(`🔍 Checking limits for: ${targetEmail}...`);

  const types = ['login', 'register', 'verify', 'forgot', 'reset', 'resend'];
  let totalDeleted = 0;

  for (const type of types) {
    const key = `rl:${type}:${targetEmail}`;
    
    // Check if key exists
    const exists = await redis.exists(key);
    
    if (exists) {
      // Delete the key
      await redis.del(key);
      console.log(`   ✅ Cleared limit for type: ${type} (Key: ${key})`);
      totalDeleted++;
    }
  }

  // Also try clearing by IP just in case (fallback keys)
  // We can't know the exact IP easily, but we can scan for keys related to this user if we want to be thorough,
  // or just ask the user for their IP.
  // Ideally, if the keyGenerator logic works, it should be using email.
  // But if previous attempts failed before email was parsed, it might be under IP.
  
  // SCAN for any keys that might be related (risky in prod, but safe for specific patterns)
  // Let's just log a warning about IP blocking.
  console.log(`\nℹ️  Note: If you are still blocked, check if your IP is blocked.`);
  console.log(`   Rate limits can fall back to IP address if email wasn't provided in the request body.`);

  if (totalDeleted > 0) {
    console.log(`\n🎉 Successfully cleared ${totalDeleted} rate limit records for ${targetEmail}`);
  } else {
    console.log(`\nℹ️  No active rate limits found for ${targetEmail}`);
  }

  redis.quit();
}

redis.on('connect', () => {
  resetLimits().catch(err => {
    console.error('❌ Error:', err);
    redis.quit();
  });
});

redis.on('error', (err) => {
  console.error('❌ Redis Connection Error:', err.message);
  process.exit(1);
});
