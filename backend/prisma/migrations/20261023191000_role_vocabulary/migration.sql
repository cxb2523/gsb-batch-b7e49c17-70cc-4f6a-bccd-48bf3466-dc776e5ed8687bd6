-- The role vocabulary is enforced by the database, not only by the application.
-- Owner is workspace-only; invitations may only grant a project role.
ALTER TABLE "member" ADD CONSTRAINT "member_role_check" CHECK ("role" IN ('owner', 'admin', 'editor', 'viewer'));
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_role_check" CHECK ("role" IS NULL OR "role" IN ('editor', 'viewer'));
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_role_check" CHECK ("role" IN ('admin', 'editor', 'viewer'));
