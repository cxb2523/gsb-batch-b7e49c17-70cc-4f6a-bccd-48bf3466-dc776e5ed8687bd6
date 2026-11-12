-- AlterTable
ALTER TABLE "board" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "board_file" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_file_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "board_file_boardId_fileId_key" ON "board_file"("boardId", "fileId");

-- CreateIndex
CREATE INDEX "board_file_boardId_idx" ON "board_file"("boardId");

-- AddForeignKey
ALTER TABLE "board_file" ADD CONSTRAINT "board_file_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PendingBlobDeletion: Generalize to carry the full object key
ALTER TABLE "pending_blob_deletion" ADD COLUMN "objectKey" TEXT;

UPDATE "pending_blob_deletion" SET "objectKey" = 'boards/' || "boardId" || '/v' || "keyVersion" || '.bin' WHERE "objectKey" IS NULL;

ALTER TABLE "pending_blob_deletion" ALTER COLUMN "objectKey" SET NOT NULL;

CREATE UNIQUE INDEX "pending_blob_deletion_objectKey_key" ON "pending_blob_deletion"("objectKey");

DROP INDEX IF EXISTS "pending_blob_deletion_boardId_keyVersion_key";

ALTER TABLE "pending_blob_deletion" DROP COLUMN "boardId", DROP COLUMN "keyVersion";
