-- AlterTable
ALTER TABLE "user" ADD COLUMN "isAnonymous" BOOLEAN DEFAULT false;

-- AlterTable
ALTER TABLE "board" ADD COLUMN "payloadBytes" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "signup_attempt" (
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signup_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "signup_attempt_ip_createdAt_idx" ON "signup_attempt"("ip", "createdAt");
