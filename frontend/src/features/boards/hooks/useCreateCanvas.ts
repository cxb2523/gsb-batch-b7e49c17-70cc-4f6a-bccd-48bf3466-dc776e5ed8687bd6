import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useSession } from '@/lib/auth-client';
import { useKeyContext } from '@/context/KeyContext';
import { provisionBoardKeys, resolveProjectKey } from '@/lib/keys';
import { errorMessage } from '@/lib/errors';
import type { Project } from '@/features/projects/schemas';
import type { Workspace } from '@/features/workspaces/schemas';
import { createBoard } from '../api';
import { boardKeys } from '../keys';

/** Creates an untitled canvas in the project, with its key wrapped in the browser, then opens it. */
export function useCreateCanvas(
  workspace: Workspace | undefined,
  project: Project | null,
  workspaceSlug: string,
) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: session } = useSession();
  const { privateKey } = useKeyContext();
  const [isCreating, setIsCreating] = useState(false);

  const create = async () => {
    if (!workspace || !project) return;
    const userId = session?.user?.id;
    const projectKeyVersion = project.keyVersion;
    if (!userId || projectKeyVersion === undefined) {
      toast.error('The project key version is unavailable. Reload and try again.');
      return;
    }

    setIsCreating(true);
    try {
      const boardId = crypto.randomUUID();
      const myGrant = project.members?.find((member) => member.userId === userId);
      let encryptedBoardKey: string;
      try {
        const projectKey = await resolveProjectKey({
          privateKey,
          projectId: project.id,
          projectKeyVersion,
          userId,
          encryptedProjectKey: project.encryptedProjectKey,
          memberEncryptedProjectKey: myGrant?.encryptedProjectKey,
          encryptedOrgKey: workspace.encryptedOrgKey ?? null,
          workspaceId: workspace.id,
          workspaceKeyVersion: workspace.keyVersion,
        });
        ({ encryptedBoardKey } = await provisionBoardKeys({
          projectKey,
          projectId: project.id,
          boardId,
          projectKeyVersion,
        }));
      } catch (keyError) {
        toast.error(
          `Encryption is unavailable, nothing was created. ${
            errorMessage(keyError) ?? 'The canvas key could not be wrapped.'
          }`,
        );
        return;
      }

      const board = await createBoard(workspace.id, {
        id: boardId,
        projectId: project.id,
        title: 'Untitled',
        encryptedBoardKey,
        projectKeyVersion,
      });
      void queryClient.invalidateQueries({ queryKey: boardKeys.lists(workspace.id) });
      void navigate(`/w/${workspaceSlug}/canvas/${board.id}`);
    } catch (error) {
      toast.error(errorMessage(error) ?? 'Failed to create canvas');
    } finally {
      setIsCreating(false);
    }
  };

  return { create, isCreating };
}
