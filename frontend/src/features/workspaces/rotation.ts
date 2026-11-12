import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  KeyServiceError,
  rotateDueProjects,
  rotateWorkspaceKey,
  type RotationProject,
} from '@/lib/keys';
import { errorMessage } from '@/lib/errors';

/**
 * Ids of the projects whose key the server flagged for rotation after an access change, or null
 * when the response carries no rotation list at all (nothing to re-key).
 */
export function rotationDueIds(result: unknown): string[] | null {
  if (typeof result !== 'object' || result === null || !('rotationDue' in result)) return null;
  const { rotationDue } = result;
  return Array.isArray(rotationDue)
    ? rotationDue.filter((id): id is string => typeof id === 'string')
    : null;
}

/** The projects that should rotate, in the shape the key service expects. */
export function toRotationProjects<
  T extends {
    id: string;
    keyVersion?: number | null | undefined;
    encryptedProjectKey?: string | null | undefined;
  },
>(projects: T[], isDue: (project: T) => boolean): RotationProject[] {
  return projects.flatMap((project) =>
    isDue(project) && typeof project.keyVersion === 'number'
      ? [
          {
            id: project.id,
            keyVersion: project.keyVersion,
            keyRotationDue: true,
            encryptedProjectKey: project.encryptedProjectKey ?? null,
          },
        ]
      : [],
  );
}

interface RotationRun {
  workspace: { id: string; keyVersion: number; encryptedOrgKey: string | null };
  /** Rotate the workspace key before the projects. */
  rotateWorkspace: boolean;
  projects: RotationProject[];
  privateKey: CryptoKey | null;
  userId: string;
  queryClient: QueryClient;
  /**
   * Queries to refetch after the workspace key changed, and after any project key changed. A
   * project key change also puts that project's boards on the re-key queue.
   */
  invalidate: { workspace: QueryKey; projects: QueryKey; rekeyQueue: QueryKey };
  /** Receives a progress label while rotating and null once finished. */
  onProgress: (label: string | null) => void;
}

/**
 * Re-keys the workspace (when asked) and then the given projects. The workspace key rotates first
 * because project keys are wrapped under it, so the projects continue with the keys it re-wrapped.
 * Failures are reported with a toast and progress is always cleared; nothing is thrown.
 */
export async function rotateWorkspaceThenProjects(run: RotationRun): Promise<void> {
  const { workspace, projects, privateKey, userId, queryClient, invalidate, onProgress } = run;
  let workspaceVersion = workspace.keyVersion;
  let encryptedOrgKey = workspace.encryptedOrgKey;
  let activeProjects = projects;

  try {
    if (run.rotateWorkspace) {
      onProgress('Securing workspace…');
      try {
        const rotated = await rotateWorkspaceKey({ workspace, privateKey, userId });
        workspaceVersion = rotated.keyVersion;
        if (rotated.newEncryptedOrgKey) {
          encryptedOrgKey = rotated.newEncryptedOrgKey;
        }
        if (rotated.rewrappedProjects) {
          const rewrapped = new Map(
            rotated.rewrappedProjects.map((p) => [p.id, p.encryptedProjectKey]),
          );
          activeProjects = activeProjects.map((p) => ({
            ...p,
            encryptedProjectKey: rewrapped.get(p.id) ?? p.encryptedProjectKey ?? null,
          }));
        }
        void queryClient.invalidateQueries({ queryKey: invalidate.workspace });
        void queryClient.invalidateQueries({ queryKey: invalidate.projects });
        void queryClient.invalidateQueries({ queryKey: invalidate.rekeyQueue });
      } catch (error) {
        toast.error(
          error instanceof KeyServiceError
            ? `Could not secure workspace. ${error.message}`
            : 'Could not secure workspace.',
        );
        return;
      }
    }

    if (activeProjects.length === 0) return;

    onProgress(`Securing 1 of ${activeProjects.length} projects…`);
    try {
      const result = await rotateDueProjects({
        projects: activeProjects,
        workspace: { id: workspace.id, keyVersion: workspaceVersion, encryptedOrgKey },
        privateKey,
        userId,
        onProgress: (done, total) =>
          onProgress(`Securing ${Math.min(done + 1, total)} of ${total} projects…`),
      });
      if (result.failed) {
        toast.error(`Could not secure every project. ${result.failed}`);
      }
      if (result.rotated.length > 0) {
        void queryClient.invalidateQueries({ queryKey: invalidate.projects });
        void queryClient.invalidateQueries({ queryKey: invalidate.rekeyQueue });
      }
    } catch (error) {
      toast.error(`Could not secure every project. ${errorMessage(error) ?? ''}`.trim());
    }
  } finally {
    onProgress(null);
  }
}
