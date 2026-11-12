import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProjectAccessModal } from '@/features/projects/components/ProjectAccessModal';
import { useProjectMemberPages } from '@/features/projects/hooks/useProjectMemberPages';
import type { Project } from '@/features/projects/schemas';
import type { Workspace } from '@/features/workspaces/schemas';

interface ProjectMembersButtonProps {
  workspace: Workspace;
  project: Project;
  runRotation: (projectIds: string[]) => Promise<void>;
}

/**
 * "Add members" inside a project, opening the same access dialog as Workspace Management. The
 * page decides who sees it (whoever may manage this project's members); it is never rendered for
 * anyone else.
 */
export function ProjectMembersButton({
  workspace,
  project,
  runRotation,
}: ProjectMembersButtonProps) {
  const [open, setOpen] = useState(false);
  const access = useProjectMemberPages(workspace.id, open ? project.id : null);

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        className="gap-1.5"
        onClick={() => {
          access.restart();
          setOpen(true);
        }}
      >
        <UserPlus className="w-3.5 h-3.5 text-brand" />
        <span>Add members</span>
      </Button>

      {open && (
        <ProjectAccessModal
          workspace={workspace}
          project={project}
          members={access.members}
          pagination={access.pagination}
          onPrevPage={access.previous}
          onNextPage={access.next}
          canManage
          runRotation={runRotation}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
