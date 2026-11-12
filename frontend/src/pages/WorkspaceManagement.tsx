import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { AppHeader } from '@/components/AppHeader';
import { AuthenticatedFooter } from '@/components/AuthenticatedFooter';
import { CommandPalette, type SearchableBoard } from '@/components/CommandPalette';
import { ErrorState } from '@/components/ErrorState';
import { useAccess } from '@/hooks/useAccess';
import { useSession } from '@/lib/auth-client';
import { toPage } from '@/features/pagination';
import { useWorkspace } from '@/features/workspaces/queries';
import { useProjects } from '@/features/projects/queries';
import { useWorkspaceMembers, useWorkspaceInvitations } from '@/features/members/queries';
import { useBoards } from '@/features/boards/queries';
import { ManagementSidebar } from '@/features/workspaces/components/ManagementSidebar';
import { WorkspaceDangerZone } from '@/features/workspaces/components/WorkspaceDangerZone';
import { WorkspaceDetailsSection } from '@/features/workspaces/components/WorkspaceDetailsSection';
import { useKeyRotation } from '@/features/workspaces/hooks/useKeyRotation';
import { ProjectsSection } from '@/features/projects/components/ProjectsSection';
import { MembersSection } from '@/features/members/components/MembersSection';
import type { Project } from '@/features/projects/schemas';
import type { WorkspaceMember } from '@/features/members/schemas';

const PAGE_SIZE = 20;

export function WorkspaceManagement() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { data: session } = useSession();
  const { can, isAdministrator, projectRoles } = useAccess(slug);

  const { data: workspace = null, isError: workspaceFailed } = useWorkspace(slug);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isCommandOpen, setIsCommandOpen] = useState(false);

  const [projectsPage, setProjectsPage] = useState(1);
  const projectsQuery = useProjects(workspace?.id, { page: projectsPage, limit: PAGE_SIZE });
  const { items: projects, pagination: projectsPagination } = toPage<Project>(
    projectsQuery.data,
    projectsPage,
  );

  const [membersPage, setMembersPage] = useState(1);
  const membersQuery = useWorkspaceMembers(workspace?.id, { page: membersPage, limit: PAGE_SIZE });
  const { items: pageMembers, pagination: membersPagination } = toPage<WorkspaceMember>(
    membersQuery.data,
    membersPage,
  );
  const members = Array.from(new Map(pageMembers.map((m) => [m.userId || m.id, m])).values());
  const { data: invitations = [] } = useWorkspaceInvitations(workspace?.id);

  const { data: boardsResult } = useBoards(workspace?.id);
  const searchableBoards: SearchableBoard[] = toPage(boardsResult).items.map((b) => ({
    id: b.id,
    title: b.title,
    projectName: b.project?.name,
    updatedAt: typeof b.updatedAt === 'string' ? b.updatedAt : undefined,
  }));

  const { rotationProgress, runRotation } = useKeyRotation({
    workspace,
    projects,
    isAdministrator,
  });

  useEffect(() => {
    if (workspaceFailed) void navigate('/create-workspace');
  }, [workspaceFailed, navigate]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const currentSlug = workspace?.slug || slug || 'workspace';
  const totalBoards =
    workspace?._count?.boards ?? projects.reduce((sum, p) => sum + (p._count?.boards || 0), 0);
  const loadFailed = projectsQuery.isError || membersQuery.isError;

  const toggleCreatingProject = () => setIsCreatingProject((open) => !open);

  return (
    <div className="bg-paper min-h-screen text-ink font-sans antialiased flex flex-col justify-between selection:bg-ink selection:text-white">
      <AppHeader
        currentSlug={currentSlug}
        activeTab="management"
        onOpenCommandPalette={() => setIsCommandOpen(true)}
      />

      <div className="pt-14 sm:pt-16 flex-1 flex flex-col w-full max-w-[94rem] mx-auto">
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[244px_minmax(0,1fr)] min-h-[calc(100vh-3.5rem)] sm:min-h-[calc(100vh-4rem)]">
          <ManagementSidebar
            workspace={workspace}
            currentSlug={currentSlug}
            projects={projects}
            projectsTotal={projectsPagination.total}
            membersTotal={membersPagination.total}
            canCreateProject={can('create', 'Project')}
            isCreatingProject={isCreatingProject}
            onToggleCreatingProject={toggleCreatingProject}
          />

          <main className="p-6 md:p-10 flex-1 flex flex-col gap-8 min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted font-semibold mb-1">
                  Management console · Workspace configuration
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-ink">
                  Workspace Management
                </h1>
                <p className="text-xs text-ink-muted mt-1">
                  A well-kept workspace. Manage your space, projects, and the people who can access
                  them.
                </p>
              </div>

              <Link
                to={`/w/${currentSlug}`}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-paper border border-border text-xs font-semibold text-ink rounded-xl shadow-2xs transition-colors self-start shrink-0 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5 text-brand" />
                <span>Back to Projects</span>
              </Link>
            </div>

            {rotationProgress && (
              <div className="p-3.5 bg-warning-subtle border border-warning-border rounded-2xl text-warning text-xs flex items-center gap-2.5">
                <span className="w-1.5 h-1.5 rounded-full bg-warning-amber animate-pulse" />
                <span>{rotationProgress}</span>
              </div>
            )}

            {loadFailed && (
              <ErrorState
                title="Could not load this workspace"
                message="The projects or members could not be loaded."
                onRetry={() => {
                  void projectsQuery.refetch();
                  void membersQuery.refetch();
                }}
              />
            )}

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_280px] gap-6 items-start">
              <div className="flex flex-col gap-6 min-w-0">
                {workspace && (
                  <>
                    <WorkspaceDetailsSection
                      workspace={workspace}
                      canUpdate={can('update', 'Workspace')}
                    />
                    <ProjectsSection
                      workspace={workspace}
                      projects={projects}
                      pagination={projectsPagination}
                      onPrevPage={() => setProjectsPage((p) => Math.max(1, p - 1))}
                      onNextPage={() => setProjectsPage((p) => p + 1)}
                      workspaceMembers={members}
                      can={can}
                      isAdministrator={isAdministrator}
                      projectRoles={projectRoles}
                      isCreating={isCreatingProject}
                      onToggleCreating={toggleCreatingProject}
                      runRotation={runRotation}
                    />
                    <MembersSection
                      workspace={workspace}
                      members={members}
                      pagination={membersPagination}
                      onPrevPage={() => setMembersPage((p) => Math.max(1, p - 1))}
                      onNextPage={() => setMembersPage((p) => p + 1)}
                      invitations={invitations}
                      projects={projects}
                      currentUserId={session?.user?.id}
                      can={can}
                      runRotation={runRotation}
                    />
                    <WorkspaceDangerZone
                      workspace={workspace}
                      canDelete={can('delete', 'Workspace')}
                      projectCount={projectsPagination.total}
                      boardCount={totalBoards}
                    />
                  </>
                )}
              </div>

              <aside className="flex flex-col gap-5">
                <div className="bg-brand-subtle border border-metric-card-border rounded-2xl p-5 shadow-2xs">
                  <div className="w-9 h-9 rounded-xl bg-white text-brand-metric flex items-center justify-center font-bold text-base shadow-2xs mb-3">
                    ✳
                  </div>
                  <h3 className="text-sm font-bold text-ink mb-1.5">A little more clarity.</h3>
                  <p className="text-xs text-brand-metric-text leading-relaxed">
                    Keep project names recognizable, access intentional, and your workspace easy to
                    navigate as the team grows.
                  </p>
                </div>

                <div className="bg-surface-2 border border-metric-card-neutral-border rounded-2xl p-5 shadow-2xs">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-ink-muted font-semibold mb-1">
                    A NOTE ON PRIVACY
                  </div>
                  <h3 className="text-sm font-bold text-ink mb-1.5">Your keys stay yours.</h3>
                  <p className="text-xs text-ink-muted leading-relaxed">
                    Security information remains visible and understandable, without turning the
                    interface into a wall of technical labels.
                  </p>
                </div>
              </aside>
            </div>
          </main>
        </div>
      </div>

      <CommandPalette
        isOpen={isCommandOpen}
        onClose={() => setIsCommandOpen(false)}
        boards={searchableBoards}
        onSelectBoard={(boardId) => {
          void navigate(`/w/${currentSlug}/canvas/${boardId}`);
        }}
      />

      <AuthenticatedFooter />
    </div>
  );
}
