import { Link, useNavigate } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { NewProjectForm } from '@/features/projects/components/NewProjectForm';
import { useUserOrganizations } from '@/features/workspaces/queries';
import type { Project } from '@/features/projects/schemas';
import type { Workspace } from '@/features/workspaces/schemas';

const SECTION_LINK =
  'px-2 py-1.5 text-ink-muted hover:text-ink hover:bg-surface-2 rounded-md transition-colors flex items-center justify-between font-sans';

interface ManagementSidebarProps {
  workspace: Workspace | null;
  currentSlug: string;
  projects: Project[];
  projectsTotal: number;
  membersTotal: number;
  canCreateProject: boolean;
  isCreatingProject: boolean;
  onToggleCreatingProject: () => void;
}

export function ManagementSidebar({
  workspace,
  currentSlug,
  projects,
  projectsTotal,
  membersTotal,
  canCreateProject,
  isCreatingProject,
  onToggleCreatingProject,
}: ManagementSidebarProps) {
  const navigate = useNavigate();
  const { data: workspaces = [] } = useUserOrganizations();

  return (
    <aside className="w-full lg:w-[244px] bg-surface border-r border-border p-4 lg:p-5 flex flex-col min-h-[calc(100vh-3.5rem)] sm:min-h-[calc(100vh-4rem)] z-20">
      <div className="flex flex-col lg:sticky lg:top-20">
        <div className="mb-5">
          <WorkspaceSwitcher
            currentWorkspace={workspace}
            workspaces={workspaces}
            onSelect={(org) => void navigate(`/w/${org.slug || org.id}/management`)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between px-1 mb-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted font-semibold">
              Projects
            </span>
            {canCreateProject && (
              <button
                onClick={onToggleCreatingProject}
                className="w-5 h-5 rounded-md hover:bg-brand-subtle text-ink-muted hover:text-ink flex items-center justify-center cursor-pointer font-bold text-sm transition-colors"
                title="New Project"
              >
                +
              </button>
            )}
          </div>

          {isCreatingProject && (
            <NewProjectForm
              workspace={workspace}
              variant="sidebar"
              onDone={onToggleCreatingProject}
            />
          )}

          <div className="flex flex-col gap-1">
            {projects.length === 0 ? (
              <div className="px-2.5 py-2 text-xs text-ink-subtle font-mono">
                No projects created yet.
              </div>
            ) : (
              projects.map((project) => (
                <Link
                  key={project.id}
                  to={`/w/${currentSlug}?project=${project.id}`}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs text-ink-muted hover:bg-surface-2 hover:text-ink transition-colors"
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <span className="text-xs text-brand">▦</span>
                    <span className="truncate">{project.name}</span>
                  </div>
                  <span className="font-mono text-[10px] text-ink-subtle ml-auto">
                    {String(project._count?.boards || 0).padStart(2, '0')}
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 mt-5">
          <div className="flex items-center justify-between px-1 mb-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted font-semibold">
              Settings
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <Link
              to={`/w/${currentSlug}/management`}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs bg-brand-subtle text-ink font-semibold transition-colors"
            >
              <div className="flex items-center gap-2.5 truncate">
                <Settings className="w-3.5 h-3.5 text-brand" />
                <span className="truncate">Management</span>
              </div>
            </Link>

            <div className="ml-4 pl-2.5 border-l border-border flex flex-col gap-0.5 mt-1 font-mono text-[11px]">
              <a href="#general" className={SECTION_LINK}>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-brand">▤</span>
                  <span>General details</span>
                </div>
              </a>
              <a href="#projects" className={SECTION_LINK}>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-brand">▦</span>
                  <span>Projects & access</span>
                </div>
                <span className="font-mono text-[10px] text-ink-subtle">{projectsTotal}</span>
              </a>
              <a href="#members" className={SECTION_LINK}>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-brand">♙</span>
                  <span>Members & roles</span>
                </div>
                <span className="font-mono text-[10px] text-ink-subtle">{membersTotal}</span>
              </a>
              <a
                href="#danger"
                className="px-2 py-1.5 text-danger hover:bg-danger-subtle rounded-md transition-colors flex items-center gap-2 font-sans"
              >
                <span className="font-mono text-xs">△</span>
                <span>Danger zone</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
