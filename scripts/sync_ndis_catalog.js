#!/usr/bin/env node

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const connectMongoose = require('../config/mongoose');
const ndisCatalogSyncService = require('../services/ndisCatalogSyncService');

async function run() {
  const force = process.argv.includes('--force');
  await connectMongoose();

  const result = await ndisCatalogSyncService.syncIfChanged({
    force,
    reason: force ? 'cli_force' : 'cli',
  });

  console.log(JSON.stringify(result, null, 2));
}

run()
  .then(async () => {
    await mongoose.connection.close();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('NDIS catalog sync failed:', error.message);
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
  });
