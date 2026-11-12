import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectsCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import type { EnvConfig } from '../config/env.schema.js';

const S3_DELETE_BATCH_SIZE = 1000;

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : '';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** S3 SDK errors carry a `$metadata.httpStatusCode`; narrow it without an assertion. */
function hasStatusCode(err: unknown, status: number): boolean {
  if (typeof err !== 'object' || err === null || !('$metadata' in err)) {
    return false;
  }
  const metadata = err.$metadata;
  return (
    typeof metadata === 'object' &&
    metadata !== null &&
    'httpStatusCode' in metadata &&
    metadata.httpStatusCode === status
  );
}

// Services that put the bucket in the host name (bucket.s3.region.amazonaws.com), not in the path.
const BUCKET_IN_HOST_SUFFIXES = ['.amazonaws.com', '.r2.cloudflarestorage.com'];

/**
 * What `S3_FORCE_PATH_STYLE` means when it is not set: self-hosted stores (RustFS, MinIO,
 * SeaweedFS) want the bucket in the path, AWS S3 and R2 want it in the host name, and the SDK's own
 * default endpoint (none configured) is AWS. Only the endpoint's host name is looked at.
 */
export function defaultForcePathStyle(endpoint: string | undefined): boolean {
  if (!endpoint) {
    return false;
  }
  try {
    const { hostname } = new URL(endpoint);
    return !BUCKET_IN_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
  } catch {
    // Not a URL: the SDK refuses it later with its own message, so the style does not matter.
    return true;
  }
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(configService: ConfigService<EnvConfig, true>) {
    const rawEndpoint = configService.get('S3_ENDPOINT', { infer: true });
    let endpoint = rawEndpoint && rawEndpoint.trim() !== '' ? rawEndpoint.trim() : undefined;

    // Self-healing: if legacy port 8333 is specified in local configs, remap to port 9000
    if (
      endpoint &&
      (endpoint === 'http://storage:8333' ||
        endpoint === 'http://localhost:8333' ||
        endpoint === 'http://127.0.0.1:8333')
    ) {
      const normalized = endpoint.replace(':8333', ':9000');
      this.logger.log(
        `Legacy port 8333 detected (${endpoint}). Auto-remapping to RustFS port 9000 (${normalized}).`,
      );
      endpoint = normalized;
    }

    const region = configService.get('S3_REGION', { infer: true });
    const accessKeyId = configService.get('S3_ACCESS_KEY_ID', { infer: true });
    const secretAccessKey = configService.get('S3_SECRET_ACCESS_KEY', { infer: true });
    this.bucket = configService.get('S3_BUCKET_NAME', { infer: true });

    // Respect S3_FORCE_PATH_STYLE, or work it out from the endpoint
    const forcePathStyle =
      configService.get('S3_FORCE_PATH_STYLE', { infer: true }) ?? defaultForcePathStyle(endpoint);

    this.s3 = new S3Client({
      ...(endpoint ? { endpoint } : {}),
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle,
    });
  }

  async onModuleInit() {
    await this.ensureBucketWithRetry(10, 1000);
  }

  async checkHealth(): Promise<boolean> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }

  getBoardPayloadKey(boardId: string, keyVersion: number): string {
    return `boards/${boardId}/v${keyVersion}.bin`;
  }

  getBoardFileKey(boardId: string, keyVersion: number, fileId: string): string {
    return `boards/${boardId}/v${keyVersion}/files/${fileId}.bin`;
  }

  private async ensureBucketWithRetry(retries = 10, delayMs = 1000): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.ensureBucketExists();
        this.logger.log(`S3 storage bucket "${this.bucket}" verified and ready.`);
        return;
      } catch (err) {
        if (attempt === retries) {
          this.logger.warn(
            `Could not verify or create bucket "${this.bucket}" after ${retries} attempts: ${errorMessage(err)}`,
          );
        } else {
          this.logger.debug(
            `Waiting for S3 storage to be ready (attempt ${attempt}/${retries}): ${errorMessage(err)}`,
          );
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }
  }

  private async ensureBucketExists() {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created S3 bucket: ${this.bucket}`);
      } catch (err) {
        const name = errorName(err);
        if (name === 'BucketAlreadyOwnedByYou' || name === 'BucketAlreadyExists') {
          this.logger.debug(`Bucket creation response: ${errorMessage(err)}`);
          return;
        }
        throw err;
      }
    }
  }

  /**
   * Upload an encrypted binary payload buffer to S3 for a board
   * @param boardId Board identifier
   * @param keyVersion Key version
   * @param data Binary Buffer
   */
  async uploadPayload(boardId: string, keyVersion: number, data: Buffer): Promise<void> {
    const key = this.getBoardPayloadKey(boardId, keyVersion);
    const contentType = 'application/octet-stream';
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: data,
          ContentType: contentType,
        }),
      );
    } catch (err) {
      if (errorName(err) === 'NoSuchBucket' || hasStatusCode(err, 404)) {
        this.logger.warn(
          `Bucket "${this.bucket}" not found on upload. Creating bucket and retrying...`,
        );
        await this.ensureBucketExists();
        await this.s3.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: data,
            ContentType: contentType,
          }),
        );
        return;
      }
      throw err;
    }
  }

  /**
   * Upload an encrypted file buffer to S3 for a board
   * @param boardId Board identifier
   * @param keyVersion Key version
   * @param fileId File identifier
   * @param data Binary Buffer
   */
  async uploadFile(
    boardId: string,
    keyVersion: number,
    fileId: string,
    data: Buffer,
  ): Promise<void> {
    const key = this.getBoardFileKey(boardId, keyVersion, fileId);
    const contentType = 'application/octet-stream';
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: data,
          ContentType: contentType,
        }),
      );
    } catch (err) {
      if (errorName(err) === 'NoSuchBucket' || hasStatusCode(err, 404)) {
        this.logger.warn(
          `Bucket "${this.bucket}" not found on upload. Creating bucket and retrying...`,
        );
        await this.ensureBucketExists();
        await this.s3.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: data,
            ContentType: contentType,
          }),
        );
        return;
      }
      throw err;
    }
  }

  /**
   * Fetch an encrypted binary payload buffer from S3 for a board
   * @param boardId Board identifier
   * @param keyVersion Key version
   * @returns Buffer or null if not found
   */
  async getPayload(boardId: string, keyVersion: number): Promise<Buffer | null> {
    const key = this.getBoardPayloadKey(boardId, keyVersion);
    try {
      const response = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );

      if (!response.Body) {
        return null;
      }

      // Convert stream to Buffer
      const byteArray = await response.Body.transformToByteArray();
      return Buffer.from(byteArray);
    } catch (err) {
      if (errorName(err) === 'NoSuchKey' || hasStatusCode(err, 404)) {
        return null;
      }
      this.logger.error(
        `Failed to fetch S3 payload for board ${boardId} v${keyVersion}: ${errorMessage(err)}`,
      );
      throw err;
    }
  }

  /**
   * Fetch an encrypted file buffer from S3 for a board
   * @param boardId Board identifier
   * @param keyVersion Key version
   * @param fileId File identifier
   * @returns Buffer or null if not found
   */
  async getFile(boardId: string, keyVersion: number, fileId: string): Promise<Buffer | null> {
    const key = this.getBoardFileKey(boardId, keyVersion, fileId);
    try {
      const response = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );

      if (!response.Body) {
        return null;
      }

      const byteArray = await response.Body.transformToByteArray();
      return Buffer.from(byteArray);
    } catch (err) {
      if (errorName(err) === 'NoSuchKey' || hasStatusCode(err, 404)) {
        return null;
      }
      this.logger.error(
        `Failed to fetch S3 file for board ${boardId} v${keyVersion} file ${fileId}: ${errorMessage(err)}`,
      );
      throw err;
    }
  }

  /** Whether the encrypted file exists at this key version, without downloading it. */
  async hasFile(boardId: string, keyVersion: number, fileId: string): Promise<boolean> {
    try {
      await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: this.getBoardFileKey(boardId, keyVersion, fileId),
        }),
      );
      return true;
    } catch (err) {
      if (errorName(err) === 'NotFound' || hasStatusCode(err, 404)) {
        return false;
      }
      throw err;
    }
  }

  /**
   * Delete stored S3 objects by their exact keys with as few requests as possible
   * (S3 accepts up to 1,000 keys per request). Deleting an object that is already
   * gone counts as success. Failures are reported per key, never swallowed.
   * @param keys Object keys to delete
   */
  async deleteObjects(keys: string[]): Promise<{ failed: Map<string, string> }> {
    const failed = new Map<string, string>();
    const chunks: string[][] = [];
    for (let i = 0; i < keys.length; i += S3_DELETE_BATCH_SIZE) {
      chunks.push(keys.slice(i, i + S3_DELETE_BATCH_SIZE));
    }

    await Promise.all(chunks.map((chunk) => this.deleteChunk(chunk, failed)));
    return { failed };
  }

  /**
   * Delete the stored objects of many boards with as few requests as possible
   * (S3 accepts up to 1,000 keys per request). Deleting an object that is already
   * gone counts as success. Failures are reported per board, never swallowed. The requests
   * for the chunks are sent together, so pass a bounded list (the purge queue passes at most
   * one chunk).
   * @param objects Board id and key version pairs
   */
  async deletePayloads(
    objects: Array<{ boardId: string; keyVersion: number }>,
  ): Promise<{ failed: Map<string, string> }> {
    const keyToRef = new Map(
      objects.map(({ boardId, keyVersion }) => [
        this.getBoardPayloadKey(boardId, keyVersion),
        StorageService.objectRef(boardId, keyVersion),
      ]),
    );

    const keys = Array.from(keyToRef.keys());
    const { failed: keyFailed } = await this.deleteObjects(keys);
    const failed = new Map<string, string>();
    for (const [key, reason] of keyFailed.entries()) {
      const ref = keyToRef.get(key) ?? key;
      failed.set(ref, reason);
    }
    return { failed };
  }

  private static objectRef(boardId: string, keyVersion: number): string {
    return `${boardId}:v${keyVersion}`;
  }

  private async deleteChunk(keys: string[], failed: Map<string, string>): Promise<void> {
    if (keys.length === 0) return;
    try {
      const response = await this.s3.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: {
            Objects: keys.map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
      for (const error of response.Errors ?? []) {
        if (error.Key) {
          failed.set(error.Key, error.Message ?? error.Code ?? 'delete failed');
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'delete request failed';
      for (const key of keys) {
        failed.set(key, message);
      }
    }
  }
}
