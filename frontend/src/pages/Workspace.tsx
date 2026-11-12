import { AppHeader } from '@/components/AppHeader';
import { WorkspaceSwitcher, type WorkspaceItem } from '@/components/WorkspaceSwitcher';
import { useState, useEffect, useMemo } from 'react';
import { authClient } from '@/lib/auth-client';
import { useNavigate, useParams, Link, useSearchParams } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { CommandPalette, type SearchableBoard } from '@/components/CommandPalette';
import { AuthenticatedFooter } from '@/components/AuthenticatedFooter';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ErrorState';
import { useAccess } from '@/hooks/useAccess';
import { toPage } from '@/features/pagination';
import { useUserOrganizations, useWorkspace } from '@/features/workspaces/queries';
import { useProjects } from '@/features/projects/queries';
import { useBoards } from '@/features/boards/queries';
import { useCreateProject } from '@/features/projects/hooks/useCreateProject';
import { useDueKeyRotation } from '@/features/projects/hooks/useDueKeyRotation';
import { useKeyRotation } from '@/features/workspaces/hooks/useKeyRotation';
import { ProjectMembersButton } from '@/features/projects/components/ProjectMembersButton';
import { RekeyBanner } from '@/features/boards/rekey/RekeyBanner';
import { useRekeyJob } from '@/features/boards/rekey/useRekeyJob';
import { ProjectList } from '@/features/projects/components/ProjectList';
import { PendingProjectAccess } from '@/features/projects/components/PendingProjectAccess';
import { useCreateCanvas } from '@/features/boards/hooks/useCreateCanvas';
import { CanvasList } from '@/features/boards/components/CanvasList';
import { CanvasSortMenu } from '@/features/boards/components/CanvasSortMenu';
import { DeleteCanvasDialog } from '@/features/boards/components/DeleteCanvasDialog';
import type { Project } from '@/features/projects/schemas';
import type { Board } from '@/features/boards/schemas';

const BOARDS_PER_PAGE = 20;
const DEFAULT_SORT = 'updated-desc';

const createdAtMs = (workspace: WorkspaceItem) =>
  workspace.createdAt ? new Date(workspace.createdAt).getTime() : 0;

export function Workspace() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const [searchParams, setSearchParams] = useSearchParams();
  const targetProjectId = searchParams.get('project');
  const sortBy = searchParams.get('sort') || DEFAULT_SORT;
  const boardPage = parseInt(searchParams.get('page') || '1', 10);

  const { data: workspace } = useWorkspace(slug);
  const workspaceId = workspace?.id;

  // Workspaces for the switcher dropdown, oldest first.
  const { data: organizations, isSuccess, isFetching } = useUserOrganizations();
  // Redirect only on a fresh answer: a cached list can predate a workspace the user just created.
  const organizationsLoaded = isSuccess && !isFetching;
  const workspaces: WorkspaceItem[] = useMemo(
    () => [...(organizations ?? [])].sort((a, b) => createdAtMs(a) - createdAtMs(b)),
    [organizations],
  );
  const currentWorkspace: WorkspaceItem | null = workspace
    ? {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        ...(workspace.currentUserRole ? { role: workspace.currentUserRole } : {}),
        encryptedOrgKey: workspace.encryptedOrgKey ?? null,
        ...(typeof workspace.keyVersion === 'number' ? { keyVersion: workspace.keyVersion } : {}),
        ...(typeof workspace.keyRotationDue === 'boolean'
          ? { keyRotationDue: workspace.keyRotationDue }
          : {}),
      }
    : null;
  const currentSlug = currentWorkspace?.slug || slug || 'workspace';

  const projectsQuery = useProjects(workspaceId);
  const projects: Project[] = toPage(projectsQuery.data).items;
  const activeProject: Project | null =
    (targetProjectId
      ? projects.find(
          (p) => p.id === targetProjectId || p.name.toLowerCase() === targetProjectId.toLowerCase(),
        )
      : undefined) ??
    projects[0] ??
    null;
  const isPendingProject = activeProject?.keyStatus === 'pending';

  const { can: canAction, isAdministrator } = useAccess(currentSlug, activeProject?.id);

  const boardsQuery = useBoards(
    workspaceId,
    activeProject?.id
      ? { projectId: activeProject.id, sort: sortBy, page: boardPage, limit: BOARDS_PER_PAGE }
      : undefined,
    Boolean(workspaceId && activeProject?.id && !isPendingProject),
  );
  const { items: boards, pagination: boardPagination } = toPage(
    boardsQuery.data,
    1,
    BOARDS_PER_PAGE,
  );

  // Every board of the workspace, for the Command+K palette.
  const { data: allBoardsData } = useBoards(workspaceId, undefined, Boolean(workspaceId));
  const searchableBoards: SearchableBoard[] = toPage(allBoardsData).items.map((b) => ({
    id: b.id,
    title: b.title,
    ...(b.project?.name ? { projectName: b.project.name } : {}),
    ...(b.updatedAt ? { updatedAt: String(b.updatedAt) } : {}),
  }));

  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [boardToDelete, setBoardToDelete] = useState<Board | null>(null);

  const createProject = useCreateProject(workspace ?? null);
  const { create: createCanvas, isCreating: isCreatingCanvas } = useCreateCanvas(
    workspace,
    activeProject,
    currentSlug,
  );
  const dueRotationProgress = useDueKeyRotation({
    workspace,
    workspaceSlug: slug ?? '',
    projects,
    isAdministrator,
  });
  // The re-key an Owner or Admin starts by removing someone in the access dialog.
  const { rotationProgress: manualRotationProgress, runRotation } = useKeyRotation({
    workspace: workspace ?? null,
    projects,
    isAdministrator,
  });
  const rotationProgress = dueRotationProgress ?? manualRotationProgress;

  const rekeyJob = useRekeyJob({ workspaceId, isAdministrator });

  // Load the user's workspaces, oldest first, and keep the route pointing at one of them.
  useEffect(() => {
    if (!organizationsLoaded) return;
    if (workspaces.length === 0) {
      void navigate('/create-workspace');
      return;
    }

    const matchingOrg = slug
      ? workspaces.find((org) => org.slug === slug || org.id === slug)
      : undefined;
    if (matchingOrg) {
      // Best-effort: the route and the workspace query already decide what is shown.
      void authClient.organization.setActive({ organizationId: matchingOrg.id }).catch(() => {});
      return;
    }
    // No slug, or a slug that is not one of the user's workspaces: use the oldest.
    const oldest = workspaces[0];
    if (oldest) {
      void navigate(`/w/${oldest.slug || oldest.id}`, { replace: true });
    }
  }, [organizationsLoaded, workspaces, slug, navigate]);

  // Global Command+K shortcut.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const updateSearchParams = (update: (params: URLSearchParams) => void, replace = false) => {
    const params = new URLSearchParams(searchParams);
    update(params);
    setSearchParams(params, replace ? { replace: true } : undefined);
  };

  const handleSortChange = (newSort: string) =>
    updateSearchParams((params) => {
      if (newSort !== DEFAULT_SORT) params.set('sort', newSort);
      else params.delete('sort');
      params.delete('page');
    }, true);

  const handlePageChange = (newPage: number) =>
    updateSearchParams((params) => {
      if (newPage >= 2) params.set('page', String(newPage));
      else params.delete('page');
    }, true);

  const handleSelectProject = (project: Project) =>
    updateSearchParams((params) => {
      params.set('project', project.id);
      params.delete('page');
    });

  const handleCreateProject = async (name: string) => {
    const created = await createProject(name);
    if (created) handleSelectProject(created);
    return created !== null;
  };

  const handleOpenBoard = (boardId: string) => {
    void navigate(`/w/${currentSlug}/canvas/${boardId}`);
  };

  const canCreateCanvas = Boolean(activeProject) && canAction('create', 'Board');
  const canManageMembers = Boolean(activeProject) && canAction('manage', 'ProjectMember');

  return (
    <div className="bg-paper min-h-screen text-ink font-sans antialiased flex flex-col justify-between selection:bg-ink selection:text-white">
      <AppHeader
        currentSlug={currentSlug}
        activeTab="projects"
        onOpenCommandPalette={() => setIsCommandOpen(true)}
        rotationProgress={rotationProgress}
      />

      <div className="pt-14 sm:pt-16 flex-1 flex flex-col w-full max-w-[94rem] mx-auto">
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[244px_minmax(0,1fr)] min-h-[calc(100vh-3.5rem)] sm:min-h-[calc(100vh-4rem)]">
          <aside className="w-full lg:w-[244px] bg-surface border-r border-border p-4 lg:p-5 flex flex-col min-h-[calc(100vh-3.5rem)] sm:min-h-[calc(100vh-4rem)] z-20">
            <div className="flex flex-col lg:sticky lg:top-20">
              <div className="mb-5">
                <WorkspaceSwitcher currentWorkspace={currentWorkspace} workspaces={workspaces} />
              </div>

              <ProjectList
                projects={projects}
                activeProjectId={activeProject?.id}
                activeProjectCanvasCount={boardPagination.total}
                canCreate={canAction('create', 'Project')}
                onSelect={handleSelectProject}
                onCreate={handleCreateProject}
              />

              {isAdministrator && (
                <div className="flex flex-col gap-1.5 mt-5">
                  <div className="flex items-center justify-between px-1 mb-1">
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted font-semibold">
                      Settings
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Link
                      to={`/w/${currentSlug}/management`}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs text-ink-muted hover:bg-surface-2 hover:text-ink transition-colors"
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <Settings className="w-3.5 h-3.5 text-brand" />
                        <span className="truncate">Management</span>
                      </div>
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </aside>

          <main className="p-6 md:p-10 flex-1 flex flex-col justify-between min-w-0">
            <div>
              <RekeyBanner job={rekeyJob} />
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-2">
                <div>
                  {activeProject?.name && (
                    <div className="mb-2">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-semibold tracking-wide bg-brand-subtle border border-brand-border text-brand-strong">
                        <span className="w-1.5 h-1.5 rounded-full bg-brand" />
                        <span>{activeProject.name}</span>
                        <h1 className="sr-only">{activeProject.name}</h1>
                      </span>
                    </div>
                  )}
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-ink">
                    Make room for ideas.
                  </h2>
                  <p className="text-xs sm:text-sm text-ink-muted mt-1">
                    Your canvases, gathered in one place.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <CanvasSortMenu value={sortBy} onChange={handleSortChange} />
                  {canManageMembers && workspace && activeProject && !isPendingProject && (
                    <ProjectMembersButton
                      workspace={workspace}
                      project={activeProject}
                      runRotation={runRotation}
                    />
                  )}
                  {canCreateCanvas && !isPendingProject && (
                    <Button
                      onClick={() => void createCanvas()}
                      disabled={isCreatingCanvas}
                      size="sm"
                      className="gap-1.5 hover:-translate-y-0.5"
                    >
                      <span>＋</span>
                      <span>{isCreatingCanvas ? 'Creating...' : 'New Canvas'}</span>
                    </Button>
                  )}
                </div>
              </div>

              {projectsQuery.isError ? (
                <ErrorState
                  message="The projects could not be loaded."
                  onRetry={() => void projectsQuery.refetch()}
                />
              ) : isPendingProject ? (
                <PendingProjectAccess />
              ) : boardsQuery.isError ? (
                <ErrorState
                  message="The canvases could not be loaded."
                  onRetry={() => void boardsQuery.refetch()}
                />
              ) : (
                <CanvasList
                  boards={boards}
                  pagination={boardPagination}
                  projectName={activeProject?.name || 'Board'}
                  canvasLinkBase={`${window.location.origin}/w/${currentSlug}`}
                  canCreate={canCreateCanvas}
                  canDelete={canAction('delete', 'Board')}
                  isCreating={isCreatingCanvas}
                  onCreate={() => void createCanvas()}
                  onOpen={handleOpenBoard}
                  onRequestDelete={setBoardToDelete}
                  onPageChange={handlePageChange}
                />
              )}
            </div>
          </main>
        </div>
      </div>

      {boardToDelete && workspaceId && (
        <DeleteCanvasDialog
          workspaceId={workspaceId}
          board={boardToDelete}
          onClose={() => setBoardToDelete(null)}
        />
      )}

      <AuthenticatedFooter />

      <CommandPalette
        isOpen={isCommandOpen}
        onClose={() => setIsCommandOpen(false)}
        boards={searchableBoards}
        onSelectBoard={handleOpenBoard}
      />
    </div>
  );
}
