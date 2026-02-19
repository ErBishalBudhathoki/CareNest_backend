const Redis = require('ioredis');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

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

async function resetAllLimits() {
  console.log('☢️  STARTING GLOBAL RATE LIMIT RESET (NUCLEAR OPTION) ☢️');
  
  let cursor = '0';
  let totalDeleted = 0;
  const pattern = 'rl:*'; // Matches ALL rate limit keys

  do {
    const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = result[0];
    const keys = result[1];

    if (keys.length > 0) {
      const deleted = await redis.del(keys);
      totalDeleted += deleted;
      console.log(`   Deleted ${deleted} keys...`);
    }
  } while (cursor !== '0');

  console.log(`\n🎉 DONE! Deleted a total of ${totalDeleted} rate limit keys.`);
  redis.quit();
}

redis.on('connect', () => {
  resetAllLimits().catch(err => {
    console.error('❌ Error:', err);
    redis.quit();
  });
});

redis.on('error', (err) => {
  console.error('❌ Redis Connection Error:', err.message);
  process.exit(1);
});
