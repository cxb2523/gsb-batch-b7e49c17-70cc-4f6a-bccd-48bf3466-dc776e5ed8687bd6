-- Project key rotation: a due flag, a history chain of older project keys, and versioned
-- pending-deletion rows so the purge removes exactly the object it was queued with.

-- DropIndex
DROP INDEX "pending_blob_deletion_boardId_key";

-- AlterTable
ALTER TABLE "pending_blob_deletion" ADD COLUMN     "keyVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "project" ADD COLUMN     "keyRotationDue" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "project_key_history" (
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_key_history_pkey" PRIMARY KEY ("projectId","version")
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_blob_deletion_boardId_keyVersion_key" ON "pending_blob_deletion"("boardId", "keyVersion");

-- AddForeignKey
ALTER TABLE "project_key_history" ADD CONSTRAINT "project_key_history_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_key_history" ADD CONSTRAINT "project_key_history_version_check" CHECK ("version" >= 1);
