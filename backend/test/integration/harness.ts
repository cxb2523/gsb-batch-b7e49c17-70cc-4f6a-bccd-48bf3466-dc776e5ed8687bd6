import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { setupApp } from '../../src/app.setup.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { StorageService } from '../../src/storage/storage.service.js';
import { SchedulerRegistry } from '@nestjs/schedule';
import {
  BLOB_PURGE_INTERVAL_NAME,
  BlobPurgeService,
} from '../../src/maintenance/blob-purge.service.js';
import { DATA_CLEANUP_CRON_NAME } from '../../src/privacy/data-cleanup.service.js';

export class InMemoryStorageService {
  readonly objects = new Map<string, Buffer>();

  getBoardPayloadKey(boardId: string, keyVersion: number): string {
    return `boards/${boardId}/v${keyVersion}.bin`;
  }

  getBoardFileKey(boardId: string, keyVersion: number, fileId: string): string {
    return `boards/${boardId}/v${keyVersion}/files/${fileId}.bin`;
  }

  async onModuleInit(): Promise<void> {}

  async checkHealth(): Promise<boolean> {
    return true;
  }

  async uploadPayload(boardId: string, keyVersion: number, buffer: Buffer): Promise<void> {
    this.objects.set(this.getBoardPayloadKey(boardId, keyVersion), Buffer.from(buffer));
  }

  async uploadFile(
    boardId: string,
    keyVersion: number,
    fileId: string,
    buffer: Buffer,
  ): Promise<void> {
    this.objects.set(this.getBoardFileKey(boardId, keyVersion, fileId), Buffer.from(buffer));
  }

  async getPayload(boardId: string, keyVersion: number): Promise<Buffer | null> {
    const existing = this.objects.get(this.getBoardPayloadKey(boardId, keyVersion));
    return existing ? Buffer.from(existing) : null;
  }

  async getFile(boardId: string, keyVersion: number, fileId: string): Promise<Buffer | null> {
    const existing = this.objects.get(this.getBoardFileKey(boardId, keyVersion, fileId));
    return existing ? Buffer.from(existing) : null;
  }

  async hasFile(boardId: string, keyVersion: number, fileId: string): Promise<boolean> {
    return this.objects.has(this.getBoardFileKey(boardId, keyVersion, fileId));
  }

  /** Sizes of the bulk delete requests received, like the real service's S3 requests. */
  readonly deleteRequests: number[] = [];
  /** Board ids whose object deletion should fail, to exercise the retry path. */
  readonly failDeletesFor = new Set<string>();

  async deleteObjects(keys: string[]): Promise<{ failed: Map<string, string> }> {
    const failed = new Map<string, string>();
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000);
      this.deleteRequests.push(chunk.length);
      for (const key of chunk) {
        if (this.failDeletesFor.has(key)) {
          failed.set(key, 'simulated storage failure');
        } else {
          this.objects.delete(key);
        }
      }
    }
    return { failed };
  }

  async deletePayloads(
    objectsToDelete: Array<{ boardId: string; keyVersion: number }>,
  ): Promise<{ failed: Map<string, string> }> {
    const keys = objectsToDelete.map(({ boardId, keyVersion }) =>
      this.getBoardPayloadKey(boardId, keyVersion),
    );
    const { failed: keyFailed } = await this.deleteObjects(keys);
    const failed = new Map<string, string>();
    for (const { boardId, keyVersion } of objectsToDelete) {
      const key = this.getBoardPayloadKey(boardId, keyVersion);
      const ref = `${boardId}:v${keyVersion}`;
      if (this.failDeletesFor.has(ref) || this.failDeletesFor.has(boardId) || keyFailed.has(key)) {
        failed.set(ref, 'simulated storage failure');
      }
    }
    return { failed };
  }

  clear(): void {
    this.objects.clear();
    this.deleteRequests.length = 0;
    this.failDeletesFor.clear();
  }
}

export interface SignedInActor {
  cookie: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
}

export interface HarnessOptions {
  env?: Record<string, string>;
}

const DEFAULT_TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  AUTH_SECRET: 'integration-test-secret-with-at-least-32-chars!!',
  AUTH_URL: 'http://localhost:3000',
  FRONTEND_URL: 'http://localhost:5173',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'minioadmin',
  S3_SECRET_ACCESS_KEY: 'minioadminpassword',
  S3_BUCKET_NAME: 'canvhq-integration-test',
  S3_FORCE_PATH_STYLE: 'true',
  ENABLE_DEV_LOGIN: 'true',
  DEMO_MODE: 'false',
  RATE_LIMIT_ENABLED: 'false',
  RATE_LIMIT_TTL: '60',
  RATE_LIMIT_LIMIT: '100',
};

export async function createIntegrationHarness(options: HarnessOptions = {}) {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set. Run integration tests via `pnpm -C backend test:integration` so globalSetup provisions a test database.',
    );
  }

  const mergedEnv: Record<string, string> = {
    ...DEFAULT_TEST_ENV,
    ...options.env,
  };

  const previousEnv = new Map<string, string | undefined>();

  const optionalEnvKeys = [
    'FIRST_ACCOUNT_EMAIL',
    'OPERATOR_NAME',
    'OPERATOR_CONTACT',
    'UMAMI_WEBSITE_ID',
    'UMAMI_HOST_URL',
  ];
  for (const key of optionalEnvKeys) {
    if (!options.env || !(key in options.env)) {
      previousEnv.set(key, process.env[key]);
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(mergedEnv)) {
    previousEnv.set(key, process.env[key]);
    process.env[key] = value;
  }

  const storage = new InMemoryStorageService();
  const { AppModule } = await import('../../src/app.module.js');
  const { validateEnv } = await import('../../src/config/env.schema.js');
  const { ConfigService } = await import('@nestjs/config');

  const validatedConfig = validateEnv(process.env);
  const configService = new ConfigService(validatedConfig);

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(StorageService)
    .useValue(storage)
    .overrideProvider(ConfigService)
    .useValue(configService)
    .compile();

  const app: INestApplication = moduleFixture.createNestApplication();
  setupApp(app);
  await app.init();

  // Tests decide when queued objects are purged, so the background timer must not race them.
  app.get(SchedulerRegistry).deleteInterval(BLOB_PURGE_INTERVAL_NAME);
  try {
    app.get(SchedulerRegistry).deleteCronJob(DATA_CLEANUP_CRON_NAME);
  } catch {
    // Cron job not registered or already removed
  }

  const prisma = app.get(PrismaService);
  const purge = app.get(BlobPurgeService);

  async function signIn(emailPrefixOrEmail: string, name?: string): Promise<SignedInActor> {
    const email = emailPrefixOrEmail.includes('@')
      ? emailPrefixOrEmail
      : `${emailPrefixOrEmail}@local.com`;

    const res = await request(app.getHttpServer())
      .post('/api/auth/dev-login')
      .send({ email, name: name ?? emailPrefixOrEmail });

    if (res.status !== 200 && res.status !== 201) {
      throw new Error(
        `dev-login failed for ${email} with status ${res.status}: ${JSON.stringify(res.body)}`,
      );
    }

    const rawSetCookie = res.headers['set-cookie'];
    const cookieList = Array.isArray(rawSetCookie)
      ? rawSetCookie
      : rawSetCookie
        ? [rawSetCookie]
        : [];
    const cookie = cookieList.map((c) => c.split(';')[0]).join('; ');

    return {
      cookie,
      user: res.body.user,
    };
  }

  async function resetDatabase(): Promise<void> {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "signup_attempt", "pending_blob_deletion", "board", "project_member", "project", "invitation", "member", "organization", "session", "account", "verification", "user" RESTART IDENTITY CASCADE`,
    );
    storage.clear();
  }

  async function seedWorkspace(params: { id?: string; name: string; slug?: string }) {
    const id = params.id ?? randomUUID();
    const slug =
      params.slug ?? `${params.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${id.slice(0, 6)}`;
    return prisma.organization.create({
      data: {
        id,
        name: params.name,
        slug,
        createdAt: new Date(),
      },
    });
  }

  async function seedMember(params: {
    id?: string;
    organizationId: string;
    userId: string;
    role: 'owner' | 'admin' | 'editor' | 'viewer';
    encryptedOrgKey?: string | null;
  }) {
    return prisma.member.create({
      data: {
        id: params.id ?? randomUUID(),
        organizationId: params.organizationId,
        userId: params.userId,
        role: params.role,
        encryptedOrgKey: params.encryptedOrgKey ?? null,
        createdAt: new Date(),
      },
    });
  }

  async function seedProject(params: {
    id?: string;
    organizationId: string;
    name: string;
    encryptedProjectKey?: string | null;
  }) {
    return prisma.project.create({
      data: {
        id: params.id ?? randomUUID(),
        organizationId: params.organizationId,
        name: params.name,
        encryptedProjectKey: params.encryptedProjectKey ?? null,
      },
    });
  }

  async function seedProjectMember(params: {
    id?: string;
    projectId: string;
    userId: string;
    role?: 'admin' | 'editor' | 'viewer';
    encryptedProjectKey?: string | null;
  }) {
    return prisma.projectMember.create({
      data: {
        id: params.id ?? randomUUID(),
        projectId: params.projectId,
        userId: params.userId,
        role: params.role ?? 'editor',
        encryptedProjectKey: params.encryptedProjectKey ?? null,
      },
    });
  }

  async function seedBoard(params: {
    id?: string;
    projectId: string;
    title: string;
    payload?: Buffer;
    hasPayload?: boolean;
    encryptedBoardKey?: string | null;
    keyVersion?: number;
    isPublic?: boolean;
    publicShareToken?: string | null;
  }) {
    const id = params.id ?? randomUUID();
    const keyVersion = params.keyVersion ?? 1;
    let hasPayload = params.hasPayload ?? false;
    if (params.payload) {
      hasPayload = true;
      await storage.uploadPayload(id, keyVersion, params.payload);
    }

    return prisma.board.create({
      data: {
        id,
        projectId: params.projectId,
        title: params.title,
        hasPayload,
        encryptedBoardKey: params.encryptedBoardKey ?? null,
        keyVersion,
        isPublic: params.isPublic ?? false,
        publicShareToken: params.publicShareToken ?? null,
      },
    });
  }

  async function close(): Promise<void> {
    await app.close();
    for (const [key, prev] of previousEnv.entries()) {
      if (prev === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prev;
      }
    }
  }

  return {
    app,
    prisma,
    storage,
    purge,
    request: () => request(app.getHttpServer()),
    signIn,
    resetDatabase,
    seedWorkspace,
    seedMember,
    seedProject,
    seedProjectMember,
    seedBoard,
    close,
  };
}

export type IntegrationHarness = Awaited<ReturnType<typeof createIntegrationHarness>>;
