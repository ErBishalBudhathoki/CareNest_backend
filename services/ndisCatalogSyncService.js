const crypto = require('crypto');
const {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { getDatabase } = require('../config/database');
const logger = require('../config/logger');

const SUPPORT_ITEMS_COLLECTION = 'support_items';
const SYNC_STATE_COLLECTION = 'reference_sync_state';
const AU_STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];

function parsePrice(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!normalized || normalized.toLowerCase() === 'nan') return null;
  const parsed = Number.parseFloat(normalized.replace(/[$,]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  return ['true', 'yes', 'y', '1'].includes(normalized);
}

function normalizeKey(objectKey) {
  return String(objectKey || '')
    .replace(/^\/+/, '')
    .trim();
}

async function bodyToString(body) {
  if (!body) return '';
  if (typeof body.transformToString === 'function') {
    return body.transformToString();
  }

  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function stripQuotes(value) {
  return String(value ?? '').replace(/^"+|"+$/g, '');
}

function firstNonNull(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') {
      return value;
    }
  }
  return null;
}

class NdisCatalogSyncService {
  _getConfig({ bucketOverride, keyOverride } = {}) {
    const provider = String(process.env.NDIS_CATALOG_PROVIDER || 'r2')
      .trim()
      .toLowerCase();
    const bucket =
      bucketOverride ||
      process.env.NDIS_CATALOG_BUCKET ||
      process.env.R2_BUCKET_NAME;
    const key = normalizeKey(
      keyOverride ||
        process.env.NDIS_CATALOG_OBJECT_KEY ||
        'ndis_support_items/ndis_support_items.json',
    );

    if (!bucket || !key) {
      throw new Error(
        'NDIS catalog sync requires NDIS_CATALOG_BUCKET and NDIS_CATALOG_OBJECT_KEY',
      );
    }

    if (provider === 'r2') {
      const accountId = process.env.R2_ACCOUNT_ID;
      const accessKeyId =
        process.env.NDIS_CATALOG_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID;
      const secretAccessKey =
        process.env.NDIS_CATALOG_SECRET_ACCESS_KEY ||
        process.env.R2_SECRET_ACCESS_KEY;

      if (!accountId || !accessKeyId || !secretAccessKey) {
        throw new Error(
          'R2 sync requires R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY',
        );
      }

      return {
        provider,
        bucket,
        key,
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        region: 'auto',
        forcePathStyle: false,
        accessKeyId,
        secretAccessKey,
      };
    }

    if (provider === 'gcs') {
      const accessKeyId =
        process.env.NDIS_CATALOG_ACCESS_KEY_ID ||
        process.env.GCS_HMAC_ACCESS_KEY_ID;
      const secretAccessKey =
        process.env.NDIS_CATALOG_SECRET_ACCESS_KEY ||
        process.env.GCS_HMAC_SECRET_ACCESS_KEY;

      if (!accessKeyId || !secretAccessKey) {
        throw new Error(
          'GCS sync via S3 API requires GCS_HMAC_ACCESS_KEY_ID and GCS_HMAC_SECRET_ACCESS_KEY',
        );
      }

      return {
        provider,
        bucket,
        key,
        endpoint: 'https://storage.googleapis.com',
        region: 'auto',
        forcePathStyle: true,
        accessKeyId,
        secretAccessKey,
      };
    }

    throw new Error(
      `Unsupported NDIS_CATALOG_PROVIDER: ${provider}. Use "r2" or "gcs".`,
    );
  }

  _createClient(config) {
    return new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  getCatalogTarget() {
    const config = this._getConfig();
    const key = normalizeKey(config.key);
    const keyDirectory = key.includes('/') ? `${key.split('/').slice(0, -1).join('/')}/` : '';
    const watchPrefix = normalizeKey(
      process.env.NDIS_CATALOG_WATCH_PREFIX || keyDirectory || key,
    );

    return {
      provider: config.provider,
      bucket: config.bucket,
      key,
      watchPrefix,
    };
  }

  _toSupportItemDocument(rawItem, sourceMetadata) {
    const supportItemNumber = String(
      firstNonNull(
        rawItem['Support Item Number'],
        rawItem.supportItemNumber,
        rawItem.itemNumber,
      ) ?? '',
    ).trim();

    if (!supportItemNumber) {
      return null;
    }

    const supportItemName = String(
      firstNonNull(rawItem['Support Item Name'], rawItem.supportItemName) ?? '',
    ).trim();
    const supportCategoryNumber = String(
      firstNonNull(
        rawItem['Support Category Number'],
        rawItem.supportCategoryNumber,
        rawItem.supportCategory?.number,
      ) ?? '',
    ).trim();
    const supportCategoryName = String(
      firstNonNull(
        rawItem['Support Category Name'],
        rawItem.supportCategoryName,
        rawItem.supportCategory?.name,
      ) ?? '',
    ).trim();

    const registrationGroupNumber = String(
      firstNonNull(
        rawItem['Registration Group Number'],
        rawItem.registrationGroupNumber,
        rawItem.registrationGroup?.number,
      ) ?? '',
    ).trim();
    const registrationGroupName = String(
      firstNonNull(
        rawItem['Registration Group Name'],
        rawItem.registrationGroupName,
        rawItem.registrationGroup?.name,
      ) ?? '',
    ).trim();

    const standardCaps = {};
    for (const state of AU_STATES) {
      standardCaps[state] = parsePrice(
        firstNonNull(rawItem[` ${state} `], rawItem[state]),
      );
    }

    const p01 = parsePrice(firstNonNull(rawItem.P01, rawItem.p01));
    const p02 = parsePrice(firstNonNull(rawItem.P02, rawItem.p02));
    const fallbackHighIntensity = p02 ?? p01;
    const highIntensityCaps = {};
    for (const state of AU_STATES) {
      highIntensityCaps[state] = parsePrice(rawItem[`HI_${state}`]);
      if (highIntensityCaps[state] === null && fallbackHighIntensity !== null) {
        highIntensityCaps[state] = fallbackHighIntensity;
      }
    }

    const defaultPrice = firstNonNull(
      standardCaps.NSW,
      standardCaps.VIC,
      standardCaps.QLD,
      standardCaps.ACT,
      standardCaps.SA,
      standardCaps.WA,
      standardCaps.TAS,
      standardCaps.NT,
      parsePrice(rawItem.price),
    );

    const unit = String(firstNonNull(rawItem.Unit, rawItem.unit) ?? 'H').trim();
    const supportType = String(
      firstNonNull(rawItem.Type, rawItem.supportType, rawItem.type) ??
        'Price Limited Supports',
    ).trim();

    return {
      supportItemNumber,
      supportItemName,
      description: supportItemName,
      supportCategory: {
        number: supportCategoryNumber,
        name: supportCategoryName,
      },
      registrationGroup: {
        number: registrationGroupNumber,
        name: registrationGroupName,
      },
      supportCategoryNumber,
      supportCategoryName,
      registrationGroupNumber,
      registrationGroupName,
      unit,
      supportType,
      quoteRequired: parseBoolean(
        firstNonNull(rawItem.Quote, rawItem.quoteRequired, rawItem.isQuotable),
      ),
      price: defaultPrice ?? 0,
      priceCaps: {
        standard: standardCaps,
        highIntensity: highIntensityCaps,
      },
      rules: {
        allowNonFaceToFace: parseBoolean(
          rawItem['Non-Face-to-Face Support Provision'],
        ),
        allowProviderTravel: parseBoolean(rawItem['Provider Travel']),
        allowShortNoticeCancellation: parseBoolean(
          rawItem['Short Notice Cancellations.'],
        ),
        ndiaRequiresQuote: parseBoolean(rawItem['NDIA Requested Reports']),
        isIrregularSupport: parseBoolean(rawItem['Irregular SIL Supports']),
      },
      managedByCatalog: true,
      isActive: true,
      sourceMetadata,
      updatedAt: new Date(),
    };
  }

  async syncIfChanged({
    force = false,
    reason = 'manual',
    objectKey,
    bucket,
  } = {}) {
    const config = this._getConfig({
      keyOverride: objectKey,
      bucketOverride: bucket,
    });
    const db = await getDatabase();
    const syncStateCollection = db.collection(SYNC_STATE_COLLECTION);
    const supportItemsCollection = db.collection(SUPPORT_ITEMS_COLLECTION);
    const syncStateId = `ndis_catalog:${config.provider}:${config.bucket}:${config.key}`;

    const client = this._createClient(config);
    const head = await client.send(
      new HeadObjectCommand({
        Bucket: config.bucket,
        Key: config.key,
      }),
    );

    const remoteEtag = stripQuotes(head.ETag);
    const remoteLastModified = head.LastModified
      ? new Date(head.LastModified)
      : null;

    const previousState = await syncStateCollection.findOne({ _id: syncStateId });
    if (
      !force &&
      previousState &&
      previousState.etag === remoteEtag &&
      previousState.lastModified &&
      remoteLastModified &&
      new Date(previousState.lastModified).getTime() ===
        remoteLastModified.getTime()
    ) {
      return {
        success: true,
        changed: false,
        skipped: true,
        message: 'NDIS catalog unchanged; sync skipped',
        source: {
          provider: config.provider,
          bucket: config.bucket,
          key: config.key,
          etag: remoteEtag,
          lastModified: remoteLastModified,
        },
      };
    }

    const objectResponse = await client.send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: config.key,
      }),
    );
    const jsonPayload = await bodyToString(objectResponse.Body);
    const payloadHash = crypto
      .createHash('sha256')
      .update(jsonPayload)
      .digest('hex');

    let parsed;
    try {
      parsed = JSON.parse(jsonPayload);
    } catch (error) {
      throw new Error(`Invalid NDIS catalog JSON: ${error.message}`);
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('NDIS catalog must be a non-empty JSON array');
    }

    const sourceMetadata = {
      provider: config.provider,
      bucket: config.bucket,
      key: config.key,
      etag: remoteEtag,
      lastModified: remoteLastModified,
      payloadHash,
      syncedAt: new Date(),
      syncReason: reason,
    };

    const normalizedDocs = parsed
      .map((row) => this._toSupportItemDocument(row, sourceMetadata))
      .filter(Boolean);

    if (normalizedDocs.length === 0) {
      throw new Error('No valid support items found in NDIS catalog payload');
    }

    const bulkOps = normalizedDocs.map((doc) => ({
      updateOne: {
        filter: { supportItemNumber: doc.supportItemNumber },
        update: {
          $set: doc,
          $setOnInsert: { createdAt: new Date() },
        },
        upsert: true,
      },
    }));

    const bulkResult = await supportItemsCollection.bulkWrite(bulkOps, {
      ordered: false,
    });

    const activeNumbers = normalizedDocs.map((doc) => doc.supportItemNumber);
    const deactivated = await supportItemsCollection.updateMany(
      {
        managedByCatalog: true,
        supportItemNumber: { $nin: activeNumbers },
        isActive: true,
      },
      {
        $set: {
          isActive: false,
          updatedAt: new Date(),
          deactivatedAt: new Date(),
          deactivatedReason: 'missing_from_latest_catalog',
        },
      },
    );

    await syncStateCollection.updateOne(
      { _id: syncStateId },
      {
        $set: {
          provider: config.provider,
          bucket: config.bucket,
          key: config.key,
          etag: remoteEtag,
          lastModified: remoteLastModified,
          payloadHash,
          itemCount: normalizedDocs.length,
          lastSyncedAt: new Date(),
          lastSyncReason: reason,
        },
      },
      { upsert: true },
    );

    const result = {
      success: true,
      changed: true,
      skipped: false,
      source: {
        provider: config.provider,
        bucket: config.bucket,
        key: config.key,
        etag: remoteEtag,
        lastModified: remoteLastModified,
      },
      totals: {
        parsed: parsed.length,
        valid: normalizedDocs.length,
        matched: bulkResult.matchedCount ?? 0,
        modified: bulkResult.modifiedCount ?? 0,
        upserted: bulkResult.upsertedCount ?? 0,
        deactivated: deactivated.modifiedCount ?? 0,
      },
    };

    logger.info('NDIS catalog synced successfully', result);
    return result;
  }
}

module.exports = new NdisCatalogSyncService();
