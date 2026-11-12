import { useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Pagination } from '@/components/Pagination';
import type { PageInfo } from '@/features/pagination';
import { useInvalidateUserMetrics } from '@/features/user/queries';
import { deleteProject } from '@/features/projects/api';
import { useProjectMemberPages } from '@/features/projects/hooks/useProjectMemberPages';
import { NewProjectForm } from '@/features/projects/components/NewProjectForm';
import { ProjectAccessModal } from '@/features/projects/components/ProjectAccessModal';
import { ProjectRow } from '@/features/projects/components/ProjectRow';
import {
  DeleteTargetDialog,
  type DeleteTarget,
} from '@/features/workspaces/components/DeleteTargetDialog';
import { useWorkspaceInvalidation } from '@/features/workspaces/hooks/useWorkspaceInvalidation';
import type { Project } from '@/features/projects/schemas';
import type { Workspace } from '@/features/workspaces/schemas';
import type { WorkspaceMember } from '@/features/members/schemas';

interface ProjectsSectionProps {
  workspace: Workspace;
  projects: Project[];
  pagination: PageInfo;
  onPrevPage: () => void;
  onNextPage: () => void;
  workspaceMembers: WorkspaceMember[];
  can: (action: string, subject: string) => boolean;
  isAdministrator: boolean;
  projectRoles: Record<string, string> | undefined;
  isCreating: boolean;
  onToggleCreating: () => void;
  runRotation: (projectIds: string[]) => Promise<void>;
}

export function ProjectsSection({
  workspace,
  projects,
  pagination,
  onPrevPage,
  onNextPage,
  workspaceMembers,
  can,
  isAdministrator,
  projectRoles,
  isCreating,
  onToggleCreating,
  runRotation,
}: ProjectsSectionProps) {
  const { invalidateProjects } = useWorkspaceInvalidation(workspace.id);
  const invalidateUserMetrics = useInvalidateUserMetrics();
  const [accessProjectId, setAccessProjectId] = useState<string | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<DeleteTarget | null>(null);

  const accessProject = projects.find((p) => p.id === accessProjectId) ?? null;
  const access = useProjectMemberPages(workspace.id, accessProjectId);
  const accessMembers = access.members;

  const owners = workspaceMembers.filter((m) => m.role === 'owner');
  const ownerCount = owners.length > 0 ? owners.length : isAdministrator ? 1 : 0;

  /** The count shown on "Manage Access": the server's tally, or what the open dialog has loaded. */
  const accessCount = (project: Project) => {
    const loaded = accessProjectId === project.id ? accessMembers : [];
    const explicitNonOwners = loaded.filter(
      (pm) => !owners.some((o) => o.userId === pm.userId),
    ).length;
    return Math.max(project._count?.members || 0, ownerCount + explicitNonOwners, 1);
  };

  const roleLabel = (project: Project) =>
    isAdministrator ? 'Admin · all projects' : (projectRoles?.[project.id] ?? '');

  const openAccess = (projectId: string) => {
    setAccessProjectId(projectId);
    access.restart();
  };

  const askToDelete = (project: Project) =>
    setProjectToDelete({
      type: 'project',
      id: project.id,
      title: project.name,
      description: 'All canvas data and project settings will be permanently removed.',
    });

  const confirmDelete = async (target: DeleteTarget) => {
    await deleteProject(workspace.id, target.id);
    invalidateProjects();
    invalidateUserMetrics();
    toast.success('Project deleted');
  };

  return (
    <div
      id="projects"
      className="scroll-mt-24 sm:scroll-mt-28 bg-white rounded-2xl border border-border shadow-xs p-6 flex flex-col gap-4"
    >
      <div className="flex items-center justify-between border-b border-border-subtle pb-3.5">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-brand-subtle text-brand flex items-center justify-center font-bold text-xs">
            ▦
          </div>
          <h2 className="text-sm font-bold text-ink">Projects & Access Control</h2>
          <span className="font-mono text-[11px] text-ink-muted font-normal">
            ({pagination.total})
          </span>
        </div>
        {can('create', 'Project') && (
          <button
            onClick={onToggleCreating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-2 hover:bg-surface-2-hover text-ink rounded-lg text-xs font-semibold transition-colors cursor-pointer border border-border"
          >
            <Plus className="w-3.5 h-3.5 text-brand" />
            <span>New Project</span>
          </button>
        )}
      </div>

      {isCreating && (
        <NewProjectForm workspace={workspace} variant="section" onDone={onToggleCreating} />
      )}

      <div className="flex flex-col divide-y divide-border-subtle">
        {projects.length === 0 ? (
          <div className="py-6 text-center text-xs text-ink-subtle font-mono">
            No projects in this workspace yet. Create one above.
          </div>
        ) : (
          projects.map((project) => (
            <ProjectRow
              key={project.id}
              workspaceId={workspace.id}
              project={project}
              accessCount={accessCount(project)}
              roleLabel={roleLabel(project)}
              canRename={can('update', 'Project')}
              canDelete={can('delete', 'Project')}
              onManageAccess={() => openAccess(project.id)}
              onDelete={() => askToDelete(project)}
            />
          ))
        )}
      </div>

      <Pagination
        page={pagination.page}
        limit={pagination.limit}
        total={pagination.total}
        hasPrevPage={pagination.hasPrevPage}
        hasNextPage={pagination.hasNextPage}
        onPrev={onPrevPage}
        onNext={onNextPage}
        entityName="PROJECTS"
      />

      {accessProject && (
        <ProjectAccessModal
          workspace={workspace}
          project={accessProject}
          members={accessMembers}
          pagination={access.pagination}
          onPrevPage={access.previous}
          onNextPage={access.next}
          canManage={can('manage', 'ProjectMember')}
          runRotation={runRotation}
          onClose={() => setAccessProjectId(null)}
        />
      )}

      <DeleteTargetDialog
        target={projectToDelete}
        onClose={() => setProjectToDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
