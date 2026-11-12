import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createIntegrationHarness, type IntegrationHarness } from './harness.js';

const run = promisify(execFile);
const scriptPath = path.resolve(process.cwd(), '../scripts/demo-wipe.mjs');

// The local object store from `docker compose up -d storage` (RustFS). The bucket is a throwaway
// created here, never the one the dev stack uses.
const s3Settings = {
  endpoint: process.env.TEST_S3_ENDPOINT ?? 'http://127.0.0.1:9000',
  accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID ?? 'minioadmin',
  secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY ?? 'minioadminpassword',
};

describe('scripts/demo-wipe.mjs against a scratch database and bucket', () => {
  let harness: IntegrationHarness | undefined;
  let bucket: string | undefined;
  const s3 = new S3Client({
    region: 'us-east-1',
    endpoint: s3Settings.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: s3Settings.accessKeyId,
      secretAccessKey: s3Settings.secretAccessKey,
    },
  });

  afterEach(async () => {
    if (bucket) {
      const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
      const objects = (listed.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
      if (objects.length > 0) {
        await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }));
      }
      await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
      bucket = undefined;
    }
    await harness?.close();
    harness = undefined;
  });

  it('empties every table except the migration history, and the bucket', async () => {
    harness = await createIntegrationHarness();
    await harness.resetDatabase();
    const owner = await harness.signIn('wipe-owner');
    const workspace = await harness.seedWorkspace({ name: 'Doomed' });
    await harness.seedMember({
      organizationId: workspace.id,
      userId: owner.user.id,
      role: 'owner',
    });
    const migrationsBefore = await harness.prisma.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) FROM _prisma_migrations`;

    bucket = `canvhq-wipe-test-${randomBytes(4).toString('hex')}`;
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    const keys = ['boards/a/v1.bin', `boards/${randomUUID()}/v1/files/f.bin`];
    await Promise.all(
      keys.map((Key) =>
        s3.send(new PutObjectCommand({ Bucket: bucket, Key, Body: Buffer.from('x') })),
      ),
    );

    await run('node', [scriptPath], {
      env: {
        ...process.env,
        DEMO_MODE: 'true',
        S3_BUCKET_NAME: bucket,
        S3_ENDPOINT: s3Settings.endpoint,
        S3_ACCESS_KEY_ID: s3Settings.accessKeyId,
        S3_SECRET_ACCESS_KEY: s3Settings.secretAccessKey,
        S3_FORCE_PATH_STYLE: 'true',
      },
    });

    expect(await harness.prisma.user.count()).toBe(0);
    expect(await harness.prisma.organization.count()).toBe(0);
    expect(await harness.prisma.member.count()).toBe(0);
    const migrationsAfter = await harness.prisma.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) FROM _prisma_migrations`;
    expect(migrationsAfter[0]?.count).toBe(migrationsBefore[0]?.count);
    expect(migrationsAfter[0]?.count).toBeGreaterThan(0n);
    const left = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
    expect(left.KeyCount ?? 0).toBe(0);
  });
});
