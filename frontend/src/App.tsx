import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { Terms } from './pages/Terms';
import { Security } from './pages/Security';
import { Privacy } from './pages/Privacy';
import { Docs } from './pages/Docs';
import { Workspace } from './pages/Workspace';
import { WorkspaceManagement } from './pages/WorkspaceManagement';
import { WorkspaceOnboarding } from './pages/WorkspaceOnboarding';
import { SetupPassphrase } from './pages/SetupPassphrase';
import { Profile } from './pages/Profile';
import { InviteAccept } from './pages/InviteAccept';
import { NotFound } from './pages/NotFound';
import { Button } from './components/ui/button';
import { LoadingState } from './components/LoadingState';
import { DemoBanner } from './components/DemoBanner';
import { WorkspaceAdminRoute } from './components/WorkspaceAdminRoute';
import { NotificationUpdates } from './features/notifications/components/NotificationUpdates';
import { useSession, authClient } from './lib/auth-client';
import { KeyProvider, useKeyContext } from './context/KeyContext';
import { useEffect, useState, lazy, Suspense } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/query-client';
import { Toaster } from 'sonner';

const BoardCanvas = lazy(() =>
  import('./pages/BoardCanvas').then((m) => ({ default: m.BoardCanvas })),
);
const PublicBoardView = lazy(() =>
  import('./pages/PublicBoardView').then((m) => ({ default: m.PublicBoardView })),
);

function ScreenLoading({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-screen">
      <LoadingState message={message} />
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { data: session, isPending, error } = useSession();
  const { isInitialized, isLoading: isKeyLoading, keyLoadError, retryKeyLoad } = useKeyContext();
  const location = useLocation();

  // Key loading only matters once there is a session; without one the page is public.
  if (isPending || (isKeyLoading && Boolean(session))) {
    return <ScreenLoading message="Loading..." />;
  }
  const errorStatus =
    typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
  if (!session && error && errorStatus !== 401) {
    return (
      <div className="flex items-center justify-center h-screen font-mono text-xs">
        Connecting...
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;

  // An unknown key state is never treated as ready: the account could be uninitialised.
  if (keyLoadError || isInitialized === null) {
    return (
      <div className="bg-paper min-h-screen flex flex-col items-center justify-center gap-3 px-6 text-center font-sans text-ink">
        <p className="text-base font-bold">
          {keyLoadError ?? 'Could not load your encryption status.'}
        </p>
        <p className="max-w-sm text-xs text-ink-muted leading-relaxed">
          Your account's encryption details could not be fetched, so this page cannot be opened
          safely yet. Check your connection and try again.
        </p>
        <Button type="button" onClick={retryKeyLoad} className="px-4 py-2 text-xs font-semibold">
          Retry
        </Button>
      </div>
    );
  }

  // Passphrase first: nothing else happens until the account has an identity key.
  if (!isInitialized && location.pathname !== '/setup-passphrase') {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/setup-passphrase?next=${encodeURIComponent(next)}`} replace />;
  }

  return (
    <>
      <DemoBanner />
      {children}
    </>
  );
}

function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();
  if (isPending) return <ScreenLoading message="Loading..." />;
  if (session) return <Navigate to="/workspace" replace />;
  return <>{children}</>;
}

function WorkspaceResolver() {
  const [target, setTarget] = useState<string | null>(null);
  const { isInitialized, isLoading: isKeyLoading } = useKeyContext();

  useEffect(() => {
    if (isKeyLoading) return;
    void authClient.organization.list().then(({ data }) => {
      if (!data || data.length === 0) {
        setTarget('/create-workspace');
      } else if (isInitialized === false) {
        setTarget('/setup-passphrase');
      } else {
        const sorted = [...data].sort((a, b) => {
          const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return timeA - timeB;
        });
        const oldest = sorted[0];
        if (oldest) {
          setTarget(`/w/${oldest.slug || oldest.id}`);
        }
      }
    });
  }, [isInitialized, isKeyLoading]);

  if (!target) return <ScreenLoading message="Loading..." />;
  return <Navigate to={target} replace />;
}

import { useAnalytics } from '@/lib/analytics';

function LegacyBoardRedirect() {
  const { slug, boardId } = useParams<{ slug: string; boardId: string }>();
  return <Navigate to={`/w/${slug}/canvas/${boardId}`} replace />;
}

function App() {
  useAnalytics();

  return (
    <QueryClientProvider client={queryClient}>
      <KeyProvider>
        <NotificationUpdates />
        <Routes>
          <Route
            path="/"
            element={
              <PublicOnlyRoute>
                <Landing />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/login"
            element={
              <PublicOnlyRoute>
                <Login />
              </PublicOnlyRoute>
            }
          />
          <Route path="/signup" element={<Navigate to="/login" replace />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/security" element={<Security />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/docs/:slug" element={<Docs />} />
          <Route
            path="/create-workspace"
            element={
              <ProtectedRoute>
                <WorkspaceOnboarding />
              </ProtectedRoute>
            }
          />
          <Route
            path="/setup-passphrase"
            element={
              <ProtectedRoute>
                <SetupPassphrase />
              </ProtectedRoute>
            }
          />
          <Route
            path="/workspace"
            element={
              <ProtectedRoute>
                <WorkspaceResolver />
              </ProtectedRoute>
            }
          />
          <Route
            path="/workspaces"
            element={
              <ProtectedRoute>
                <WorkspaceResolver />
              </ProtectedRoute>
            }
          />
          <Route
            path="/w"
            element={
              <ProtectedRoute>
                <WorkspaceResolver />
              </ProtectedRoute>
            }
          />
          <Route
            path="/w/:slug"
            element={
              <ProtectedRoute>
                <Workspace />
              </ProtectedRoute>
            }
          />
          <Route
            path="/w/:slug/management"
            element={
              <ProtectedRoute>
                <WorkspaceAdminRoute>
                  <WorkspaceManagement />
                </WorkspaceAdminRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            }
          />
          <Route path="/invite/:inviteId" element={<InviteAccept />} />
          <Route
            path="/share/:token"
            element={
              <Suspense fallback={<ScreenLoading message="Loading canvas..." />}>
                <PublicBoardView />
              </Suspense>
            }
          />
          <Route
            path="/w/:slug/canvas/:boardId"
            element={
              <ProtectedRoute>
                <Suspense fallback={<ScreenLoading message="Loading canvas..." />}>
                  <BoardCanvas />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route path="/w/:slug/board/:boardId" element={<LegacyBoardRedirect />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <Toaster position="bottom-right" richColors theme="light" closeButton />
      </KeyProvider>
    </QueryClientProvider>
  );
}

export default App;
