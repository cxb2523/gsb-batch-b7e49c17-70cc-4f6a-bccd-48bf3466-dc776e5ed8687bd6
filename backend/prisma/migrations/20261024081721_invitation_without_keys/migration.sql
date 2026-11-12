/*
  Warnings:

  - You are about to drop the column `encryptedOrgKey` on the `invitation` table. All the data in the column will be lost.
  - You are about to drop the column `encryptedProjectKeys` on the `invitation` table. All the data in the column will be lost.

*/
-- An invitation cannot carry keys: the invitee has no public key yet, and invitations never
-- grant the workspace key. Grants start pending and are completed by a keyholder afterwards.
ALTER TABLE "invitation" DROP COLUMN "encryptedOrgKey",
DROP COLUMN "encryptedProjectKeys";
