#!/usr/bin/env node
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Refuse to run unless DEMO_MODE=true
if (process.env.DEMO_MODE !== 'true') {
  console.error('[demo-wipe] Refused: DEMO_MODE is not "true". This script only runs in demo mode.');
  process.exit(1);
}

// Module resolution that works both in container (/app/node_modules) and repo root
async function loadDependency(name) {
  try {
    return await import(name);
  } catch {
    const backendRequire = createRequire(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../backend/package.json'),
    );
    return await import(backendRequire.resolve(name));
  }
}

const pgModule = await loadDependency('pg');
const Client = pgModule.Client || pgModule.default?.Client || pgModule.default;

const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = await loadDependency(
  '@aws-sdk/client-s3',
);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('[demo-wipe] Error: DATABASE_URL is required.');
  process.exit(1);
}

const s3BucketName = process.env.S3_BUCKET_NAME;
const s3AccessKeyId = process.env.S3_ACCESS_KEY_ID;
const s3SecretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const s3Endpoint = process.env.S3_ENDPOINT;
const s3Region = process.env.S3_REGION || 'us-east-1';
const s3ForcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true' || process.env.S3_FORCE_PATH_STYLE === true;

if (!s3BucketName || !s3AccessKeyId || !s3SecretAccessKey) {
  console.error('[demo-wipe] Error: S3_BUCKET_NAME, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY are required.');
  process.exit(1);
}

async function wipeDatabase() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const res = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name != '_prisma_migrations';
    `);

    const tables = res.rows.map((r) => `"${r.table_name}"`);
    if (tables.length > 0) {
      await client.query(`TRUNCATE TABLE ${tables.join(', ')} CASCADE;`);
    }
    console.log(`[demo-wipe] Truncated ${tables.length} tables in public schema.`);
    return tables.length;
  } finally {
    await client.end();
  }
}

async function wipeS3() {
  const s3 = new S3Client({
    region: s3Region,
    endpoint: s3Endpoint || undefined,
    forcePathStyle: s3ForcePathStyle,
    credentials: {
      accessKeyId: s3AccessKeyId,
      secretAccessKey: s3SecretAccessKey,
    },
  });

  let totalDeleted = 0;
  let continuationToken = undefined;

  do {
    const listRes = await s3.send(
      new ListObjectsV2Command({
        Bucket: s3BucketName,
        ContinuationToken: continuationToken,
      }),
    );

    const objects = (listRes.Contents || [])
      .map((o) => ({ Key: o.Key }))
      .filter((o) => typeof o.Key === 'string');

    if (objects.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: s3BucketName,
          Delete: { Objects: objects },
        }),
      );
      totalDeleted += objects.length;
    }

    continuationToken = listRes.NextContinuationToken;
  } while (continuationToken);

  console.log(`[demo-wipe] Deleted ${totalDeleted} objects in bucket ${s3BucketName}.`);
  return totalDeleted;
}

async function main() {
  console.log('[demo-wipe] Starting nightly demo wipe...');
  await wipeDatabase();
  await wipeS3();
  console.log('[demo-wipe] Demo wipe completed successfully.');
}

main().catch((err) => {
  console.error('[demo-wipe] Fatal wipe error:', err);
  process.exit(1);
});
