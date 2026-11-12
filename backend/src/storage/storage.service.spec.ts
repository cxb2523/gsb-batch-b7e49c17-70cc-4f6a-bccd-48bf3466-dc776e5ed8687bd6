import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import type { EnvConfig } from '../config/env.schema.js';
import { StorageService, defaultForcePathStyle } from './storage.service.js';

function firstCallArg(spy: { mock: { calls: unknown[][] } }, index: number): unknown {
  const call = spy.mock.calls[index];
  const [arg] = call ?? [];
  if (arg === undefined) {
    throw new Error(`expected call ${index}`);
  }
  return arg;
}

function commandKey(cmd: unknown): string | undefined {
  if (cmd instanceof PutObjectCommand || cmd instanceof GetObjectCommand) {
    return cmd.input.Key;
  }
  return undefined;
}

function deleteObjectsList(cmd: unknown): unknown {
  if (cmd instanceof DeleteObjectsCommand) {
    return cmd.input.Delete?.Objects;
  }
  return undefined;
}

describe('defaultForcePathStyle', () => {
  it.each([
    ['https://s3.eu-west-1.amazonaws.com', false],
    ['https://abc123.r2.cloudflarestorage.com', false],
    ['http://localhost:9000', true],
    ['https://s3.example.org', true],
    // The service name in the path or the query is not the host, so it does not count.
    ['https://s3.example.org/amazonaws.com', true],
    ['https://amazonaws.com.example.org', true],
    ['not a url', true],
  ])('%s -> path style %s', (endpoint, expected) => {
    expect(defaultForcePathStyle(endpoint)).toBe(expected);
  });

  it('assumes the SDK default (AWS) when no endpoint is set', () => {
    expect(defaultForcePathStyle(undefined)).toBe(false);
  });
});

describe('StorageService', () => {
  let configServiceMock: ConfigService<EnvConfig, true>;
  // `send` is overloaded, which makes vitest type its stub's response as `void`.
  const stubS3Send = (response: object) =>
    vi.spyOn(S3Client.prototype, 'send').mockResolvedValue(response as never);

  beforeEach(() => {
    const configValues: Record<string, string | boolean | undefined> = {
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY_ID: 'minioadmin',
      S3_SECRET_ACCESS_KEY: 'minioadminpassword',
      S3_BUCKET_NAME: 'canvhq-boards',
      S3_FORCE_PATH_STYLE: true,
    };
    configServiceMock = {
      get: vi.fn((key: string) => configValues[key]),
    } as unknown as ConfigService<EnvConfig, true>;
  });

  it('retries bucket verification at startup until the bucket exists', async () => {
    vi.useFakeTimers();
    const service = new StorageService(configServiceMock);
    const sendSpy = vi.spyOn(S3Client.prototype, 'send');

    // Attempt 1: HeadBucket fails (S3 not ready), CreateBucket fails (S3 not ready)
    // Attempt 2: HeadBucket fails (404), CreateBucket succeeds
    sendSpy
      .mockImplementationOnce(() => Promise.reject(new Error('ECONNREFUSED')))
      .mockImplementationOnce(() => Promise.reject(new Error('ECONNREFUSED')))
      .mockImplementationOnce(() =>
        Promise.reject(Object.assign(new Error('NotFound'), { name: 'NotFound' })),
      )
      .mockImplementationOnce(() => Promise.resolve(undefined));

    const initPromise = service.onModuleInit();
    await vi.runAllTimersAsync();
    await initPromise;
    vi.useRealTimers();

    expect(sendSpy).toHaveBeenCalledTimes(4);
    expect(firstCallArg(sendSpy, 0)).toBeInstanceOf(HeadBucketCommand);
    expect(firstCallArg(sendSpy, 1)).toBeInstanceOf(CreateBucketCommand);
    expect(firstCallArg(sendSpy, 2)).toBeInstanceOf(HeadBucketCommand);
    expect(firstCallArg(sendSpy, 3)).toBeInstanceOf(CreateBucketCommand);
  });

  it('creates the bucket and retries when uploadPayload encounters NoSuchBucket', async () => {
    const service = new StorageService(configServiceMock);
    const sendSpy = vi.spyOn(S3Client.prototype, 'send');

    const noSuchBucketError = Object.assign(new Error('The specified bucket does not exist'), {
      name: 'NoSuchBucket',
      $metadata: { httpStatusCode: 404 },
    });

    // 1. First PutObject fails with NoSuchBucket
    // 2. ensureBucketExists -> HeadBucket fails with 404
    // 3. ensureBucketExists -> CreateBucket succeeds
    // 4. Retry PutObject succeeds
    sendSpy
      .mockImplementationOnce(() => Promise.reject(noSuchBucketError))
      .mockImplementationOnce(() => Promise.reject(noSuchBucketError))
      .mockImplementationOnce(() => Promise.resolve(undefined))
      .mockImplementationOnce(() => Promise.resolve(undefined));

    const payload = Buffer.from('encrypted-board-data');
    const result = await service.uploadPayload('b1', 1, payload);

    expect(result).toBeUndefined();
    expect(sendSpy).toHaveBeenCalledTimes(4);
    expect(firstCallArg(sendSpy, 0)).toBeInstanceOf(PutObjectCommand);
    expect(commandKey(firstCallArg(sendSpy, 0))).toBe('boards/b1/v1.bin');
    expect(firstCallArg(sendSpy, 1)).toBeInstanceOf(HeadBucketCommand);
    expect(firstCallArg(sendSpy, 2)).toBeInstanceOf(CreateBucketCommand);
    expect(firstCallArg(sendSpy, 3)).toBeInstanceOf(PutObjectCommand);
    expect(commandKey(firstCallArg(sendSpy, 3))).toBe('boards/b1/v1.bin');
  });

  it('derives the storage key internally from boardId and version and exposes no free-form key', async () => {
    const service = new StorageService(configServiceMock);
    const sendSpy = vi.spyOn(S3Client.prototype, 'send');

    sendSpy
      .mockImplementationOnce(() => Promise.resolve(undefined))
      .mockImplementationOnce(() =>
        Promise.resolve({
          Body: { transformToByteArray: async () => new Uint8Array(Buffer.from('cipher')) },
        }),
      )
      .mockImplementationOnce(() => Promise.resolve({}));

    await service.uploadPayload('board-abc', 1, Buffer.from('cipher'));
    const fetched = await service.getPayload('board-abc', 1);
    const { failed } = await service.deletePayloads([{ boardId: 'board-abc', keyVersion: 1 }]);

    expect(failed.size).toBe(0);
    expect(fetched).toEqual(Buffer.from('cipher'));
    expect(firstCallArg(sendSpy, 0)).toBeInstanceOf(PutObjectCommand);
    expect(commandKey(firstCallArg(sendSpy, 0))).toBe('boards/board-abc/v1.bin');
    expect(firstCallArg(sendSpy, 1)).toBeInstanceOf(GetObjectCommand);
    expect(commandKey(firstCallArg(sendSpy, 1))).toBe('boards/board-abc/v1.bin');
    expect(firstCallArg(sendSpy, 2)).toBeInstanceOf(DeleteObjectsCommand);
    expect(deleteObjectsList(firstCallArg(sendSpy, 2))).toEqual([
      { Key: 'boards/board-abc/v1.bin' },
    ]);
  });

  describe('deletePayloads', () => {
    it('deletes in requests of at most 1,000 keys', async () => {
      const service = new StorageService(configServiceMock);
      const sendSpy = stubS3Send({});
      const objects = Array.from({ length: 2500 }, (_, index) => ({
        boardId: `board-${index}`,
        keyVersion: 1,
      }));

      const { failed } = await service.deletePayloads(objects);

      expect(failed.size).toBe(0);
      const sizes = sendSpy.mock.calls.map(([command]) =>
        command instanceof DeleteObjectsCommand ? command.input.Delete?.Objects?.length : undefined,
      );
      expect(sizes).toEqual([1000, 1000, 500]);
    });

    it('reports boards whose object S3 refused to delete, and keeps going', async () => {
      const service = new StorageService(configServiceMock);
      stubS3Send({
        Errors: [{ Key: 'boards/b2/v1.bin', Code: 'AccessDenied', Message: 'denied' }],
      });

      const { failed } = await service.deletePayloads([
        { boardId: 'b1', keyVersion: 1 },
        { boardId: 'b2', keyVersion: 1 },
        { boardId: 'b3', keyVersion: 1 },
      ]);

      expect([...failed.keys()]).toEqual(['b2:v1']);
      expect(failed.get('b2:v1')).toBe('denied');
    });

    it('marks the whole request as failed, instead of throwing, when S3 is unreachable', async () => {
      const service = new StorageService(configServiceMock);
      vi.spyOn(S3Client.prototype, 'send').mockRejectedValue(new Error('ECONNREFUSED'));

      const { failed } = await service.deletePayloads([
        { boardId: 'b1', keyVersion: 1 },
        { boardId: 'b2', keyVersion: 1 },
      ]);

      expect([...failed.keys()].sort()).toEqual(['b1:v1', 'b2:v1']);
      expect(failed.get('b1:v1')).toBe('ECONNREFUSED');
    });
  });

  describe('files and direct object deletion', () => {
    it('constructs correct payload and file keys', () => {
      const service = new StorageService(configServiceMock);
      expect(service.getBoardPayloadKey('board-1', 2)).toBe('boards/board-1/v2.bin');
      expect(service.getBoardFileKey('board-1', 2, 'file-99')).toBe(
        'boards/board-1/v2/files/file-99.bin',
      );
    });

    it('uploads and fetches file buffers', async () => {
      const service = new StorageService(configServiceMock);
      const sendSpy = vi.spyOn(S3Client.prototype, 'send');
      const fileData = Buffer.from('file-bytes');

      sendSpy
        .mockImplementationOnce(() => Promise.resolve(undefined))
        .mockImplementationOnce(() =>
          Promise.resolve({
            Body: { transformToByteArray: async () => new Uint8Array(fileData) },
          }),
        );

      await service.uploadFile('b1', 1, 'f1', fileData);
      const result = await service.getFile('b1', 1, 'f1');

      expect(result).toEqual(fileData);
      const putCmd = sendSpy.mock.calls[0]?.[0];
      expect(putCmd).toBeInstanceOf(PutObjectCommand);
      if (putCmd instanceof PutObjectCommand) {
        expect(putCmd.input.Key).toBe('boards/b1/v1/files/f1.bin');
      }
      const getCmd = sendSpy.mock.calls[1]?.[0];
      expect(getCmd).toBeInstanceOf(GetObjectCommand);
      if (getCmd instanceof GetObjectCommand) {
        expect(getCmd.input.Key).toBe('boards/b1/v1/files/f1.bin');
      }
    });

    it('returns null when getFile encounters NoSuchKey', async () => {
      const service = new StorageService(configServiceMock);
      vi.spyOn(S3Client.prototype, 'send').mockRejectedValue(
        Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }),
      );

      const result = await service.getFile('b1', 1, 'f-missing');
      expect(result).toBeNull();
    });

    it('deletes objects directly by key via deleteObjects', async () => {
      const service = new StorageService(configServiceMock);
      stubS3Send({
        Errors: [{ Key: 'boards/b1/v1.bin', Code: 'AccessDenied', Message: 'denied' }],
      });

      const { failed } = await service.deleteObjects(['boards/b1/v1.bin', 'boards/b2/v1.bin']);
      expect(failed.size).toBe(1);
      expect(failed.get('boards/b1/v1.bin')).toBe('denied');
    });
  });
});
