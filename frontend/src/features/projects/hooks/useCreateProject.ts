import { toast } from 'sonner';
import { useSession } from '@/lib/auth-client';
import { useKeyContext } from '@/context/KeyContext';
import { provisionProjectKeys, resolveOrgKey } from '@/lib/keys';
import { errorMessage } from '@/lib/errors';
import { nameProblem, thingName } from '@/lib/names';
import { useInvalidateUserMetrics } from '@/features/user/queries';
import { createProject } from '@/features/projects/api';
import { useWorkspaceInvalidation } from '@/features/workspaces/hooks/useWorkspaceInvalidation';
import type { Workspace } from '@/features/workspaces/schemas';
import type { Project } from '@/features/projects/schemas';

/**
 * Creates a project with its keys in one step: the browser wraps the project key first, and if
 * that fails nothing is sent. Resolves the created project, or null after telling the user why not.
 */
export function useCreateProject(workspace: Workspace | null) {
  const { data: session } = useSession();
  const { privateKey, publicKeySpki } = useKeyContext();
  const { invalidateProjects } = useWorkspaceInvalidation(workspace?.id);
  const invalidateUserMetrics = useInvalidateUserMetrics();

  return async (name: string): Promise<Project | null> => {
    // Before any key is made: a name that will be refused should not cost a key generation.
    const problem = nameProblem(thingName('Project name'), name);
    if (problem) {
      toast.error(problem);
      return null;
    }

    const userId = session?.user?.id;
    const workspaceKeyVersion = workspace?.keyVersion;
    if (!workspace || !userId || workspaceKeyVersion === undefined) {
      toast.error('The workspace key version is unavailable. Reload and try again.');
      return null;
    }

    let keys;
    try {
      const orgKey = await resolveOrgKey(workspace.encryptedOrgKey, privateKey, {
        workspaceId: workspace.id,
        userId,
        workspaceKeyVersion,
      });
      keys = await provisionProjectKeys({
        orgKey,
        workspaceId: workspace.id,
        workspaceKeyVersion,
        projectId: crypto.randomUUID(),
        userId,
        publicKeySpki,
        projectName: name,
      });
    } catch (keyErr) {
      toast.error(
        `Encryption is unavailable, nothing was created. ${
          errorMessage(keyErr) ?? 'The project key could not be wrapped.'
        }`,
      );
      return null;
    }

    let created: Project;
    try {
      created = await createProject(workspace.id, {
        id: keys.id,
        name: keys.name,
        encryptedProjectKey: keys.encryptedProjectKey,
        creatorEncryptedProjectKey: keys.creatorEncryptedProjectKey,
      });
    } catch (err) {
      toast.error(errorMessage(err) ?? 'The project could not be created.');
      return null;
    }

    invalidateProjects();
    invalidateUserMetrics();
    return created;
  };
}
