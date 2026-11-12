-- AlterTable
ALTER TABLE "board" ADD COLUMN     "keyVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "keyVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "project" ADD COLUMN     "keyVersion" INTEGER NOT NULL DEFAULT 1;

-- Key versions are positive integers. Losing or lowering one would make every wrapped key
-- and payload unreadable, so the database enforces the floor as well as the application.
ALTER TABLE "organization" ADD CONSTRAINT "organization_key_version_check" CHECK ("keyVersion" >= 1);
ALTER TABLE "project" ADD CONSTRAINT "project_key_version_check" CHECK ("keyVersion" >= 1);
ALTER TABLE "board" ADD CONSTRAINT "board_key_version_check" CHECK ("keyVersion" >= 1);
