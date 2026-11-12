-- A person was taken off one project. The list of kinds is closed, so the CHECK grows with it.
ALTER TABLE "notification" DROP CONSTRAINT "notification_kind_check";
ALTER TABLE "notification" ADD CONSTRAINT "notification_kind_check"
    CHECK ("kind" IN ('invitation_accepted', 'access_granted', 'role_changed', 'project_role_changed', 'removed_from_project', 'removed_from_workspace'));
