-- CreateTable
CREATE TABLE "pending_blob_deletion" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_blob_deletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_blob_deletion_boardId_key" ON "pending_blob_deletion"("boardId");

-- CreateIndex
CREATE INDEX "pending_blob_deletion_nextAttemptAt_idx" ON "pending_blob_deletion"("nextAttemptAt");
