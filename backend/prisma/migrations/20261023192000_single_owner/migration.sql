-- Exactly one Owner per workspace. Prisma cannot model a partial unique index, so this is
-- written by hand; ownership changes always go through the transfer primitive, which demotes
-- the old Owner before promoting the new one.
CREATE UNIQUE INDEX "member_one_owner_per_workspace" ON "member" ("organizationId") WHERE "role" = 'owner';
