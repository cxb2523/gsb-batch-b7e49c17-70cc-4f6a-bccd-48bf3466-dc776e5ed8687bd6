import { describe, it, expect } from 'vitest';
import { StorageService } from '../src/storage/storage.service.js';
import { ConfigService } from '@nestjs/config';
import type { EnvConfig } from '../src/config/env.schema.js';
import { randomBytes } from 'crypto';

/**
 * Cloud S3 Storage Integration Verification Suite (Cloudflare R2 / AWS S3)
 *
 * This test suite validates full binary round-trip upload, download, and deletion
 * against a live Cloudflare R2 or AWS S3 bucket when `TEST_CLOUD_S3=true` is set
 * and valid cloud S3 credentials are provided in the environment.
 *
 * When `TEST_CLOUD_S3` is not enabled, the suite is skipped cleanly so CI/CD
 * pipelines remain self-contained while developers can verify production cloud
 * credentials with `TEST_CLOUD_S3=true npm test`.
 */
const isCloudTestEnabled = process.env.TEST_CLOUD_S3 === 'true';

describe.skipIf(!isCloudTestEnabled)(
  'Cloud S3 Storage Integration (Cloudflare R2 / AWS S3)',
  () => {
    it('completes a binary round-trip against configured Cloud S3 when TEST_CLOUD_S3=true', async () => {
      const configMock = new ConfigService<EnvConfig, true>({
        S3_ENDPOINT: process.env.S3_ENDPOINT,
        S3_REGION: process.env.S3_REGION || 'auto',
        S3_BUCKET: process.env.S3_BUCKET,
        S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
        S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
        S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE === 'true',
      });

      const storageService = new StorageService(configMock);
      await storageService.onModuleInit();

      const isHealthy = await storageService.checkHealth();
      expect(isHealthy).toBe(true);

      const testBoardId = `cloud-test-${Date.now()}`;
      const originalPayload = randomBytes(256);

      // 1. Upload binary payload
      await storageService.uploadPayload(testBoardId, 1, originalPayload);

      // 2. Download and verify byte-for-byte integrity
      const downloadedPayload = await storageService.getPayload(testBoardId, 1);
      expect(downloadedPayload).not.toBeNull();
      expect(Buffer.compare(originalPayload, downloadedPayload!)).toBe(0);

      // 3. Delete payload
      const { failed } = await storageService.deletePayloads([
        { boardId: testBoardId, keyVersion: 1 },
      ]);
      expect(failed.size).toBe(0);

      // 4. Verify deletion returns null
      const afterDelete = await storageService.getPayload(testBoardId, 1);
      expect(afterDelete).toBeNull();
    });
  },
);
