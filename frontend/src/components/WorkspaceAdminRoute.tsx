import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { LoadingState } from '@/components/LoadingState';
import { useAccess } from '@/hooks/useAccess';

/**
 * Lets only a workspace Owner or Admin through. Everyone else is sent to the workspace's home with
 * a short explanation, so a guessed address never shows a screen the person cannot use.
 */
export function WorkspaceAdminRoute({ children }: { children: React.ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  const { isAdministrator, isLoading } = useAccess(slug);
  const isRefused = !isLoading && !isAdministrator;

  useEffect(() => {
    if (isRefused) toast.error('Only workspace owners and admins can open management.');
  }, [isRefused]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <LoadingState message="Loading..." />
      </div>
    );
  }
  if (isRefused) return <Navigate to={`/w/${slug}`} replace />;
  return children;
}
