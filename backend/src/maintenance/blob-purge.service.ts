import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

export const BLOB_PURGE_INTERVAL_NAME = 'blob-purge';

const PURGE_INTERVAL_MS = 30_000;
const CLAIM_BATCH_SIZE = 1000;
const CLAIM_LEASE_SECONDS = 300;
const MAX_BACKOFF_SECONDS = 3600;
const ERROR_LOG_AFTER_ATTEMPTS = 10;

interface ClaimedRow {
  id: string;
  objectKey: string;
  attempts: number;
}

/**
 * Removes stored objects after the database change that orphaned them has committed.
 *
 * Callers `enqueue` inside the transaction that deletes the rows, so an object is queued
 * if and only if its board is gone. The processor deletes objects in bulk and keeps any
 * row it could not delete, with its error and a backed-off retry time. Nothing is dropped
 * silently: a persistently failing row stays in the table and is logged as an error.
 */
@Injectable()
export class BlobPurgeService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BlobPurgeService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async enqueue(tx: Prisma.TransactionClient, objectKeys: string[]): Promise<void> {
    if (objectKeys.length === 0) return;
    await tx.pendingBlobDeletion.createMany({
      data: objectKeys.map((objectKey) => ({ objectKey })),
      skipDuplicates: true,
    });
  }

  onApplicationBootstrap(): void {
    void this.processDue().catch((err: unknown) =>
      this.logger.error(`Initial blob purge failed: ${errorMessage(err)}`),
    );
  }

  @Interval(BLOB_PURGE_INTERVAL_NAME, PURGE_INTERVAL_MS)
  async onTick(): Promise<void> {
    try {
      await this.processDue();
    } catch (err) {
      this.logger.error(`Blob purge failed: ${errorMessage(err)}`);
    }
  }

  /** Processes every row that is due now. Returns how many objects were deleted. */
  async processDue(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.drain();
    } finally {
      this.running = false;
    }
  }

  /** Works through the due rows one batch at a time; batches are deliberately sequential. */
  private async drain(deletedSoFar = 0): Promise<number> {
    const rows = await this.claimBatch();
    if (rows.length === 0) return deletedSoFar;
    return this.drain(deletedSoFar + (await this.purge(rows)));
  }

  /**
   * Claims due rows by pushing their retry time forward (a lease), in one statement.
   * SKIP LOCKED keeps two replicas from taking the same row, and no transaction stays
   * open during the storage request. If this process dies, the lease expires and the
   * rows become due again.
   */
  private claimBatch(): Promise<ClaimedRow[]> {
    return this.prisma.$queryRaw<ClaimedRow[]>`
      UPDATE "pending_blob_deletion"
      SET "nextAttemptAt" = now() + make_interval(secs => ${CLAIM_LEASE_SECONDS})
      WHERE "id" IN (
        SELECT "id" FROM "pending_blob_deletion"
        WHERE "nextAttemptAt" <= now()
        ORDER BY "nextAttemptAt"
        LIMIT ${CLAIM_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "objectKey", "attempts"`;
  }

  private async purge(rows: ClaimedRow[]): Promise<number> {
    const { failed } = await this.storage.deleteObjects(rows.map((row) => row.objectKey));

    const doneIds = rows.filter((row) => !failed.has(row.objectKey)).map((row) => row.id);
    if (doneIds.length > 0) {
      await this.prisma.pendingBlobDeletion.deleteMany({ where: { id: { in: doneIds } } });
    }

    await Promise.all(
      rows
        .filter((row) => failed.has(row.objectKey))
        .map((row) => this.recordFailure(row, failed.get(row.objectKey) ?? 'delete failed')),
    );

    return doneIds.length;
  }

  private async recordFailure(row: ClaimedRow, error: string): Promise<void> {
    const attempts = row.attempts + 1;
    if (attempts >= ERROR_LOG_AFTER_ATTEMPTS) {
      this.logger.error(
        `Stored object ${row.objectKey} still not deleted after ${attempts} attempts: ${error}`,
      );
    }
    await this.prisma.pendingBlobDeletion.update({
      where: { id: row.id },
      data: {
        attempts,
        lastError: error.slice(0, 500),
        nextAttemptAt: new Date(Date.now() + backoffSeconds(attempts) * 1000),
      },
    });
  }
}

function backoffSeconds(attempts: number): number {
  return Math.min(30 * 2 ** (attempts - 1), MAX_BACKOFF_SECONDS);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
