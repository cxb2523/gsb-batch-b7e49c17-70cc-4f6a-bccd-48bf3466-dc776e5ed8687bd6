import { useQuery } from '@tanstack/react-query';
import { boardKeys, type BoardListParams } from './keys';
import { getBoard, listBoards } from './api';
import { toBoardMetadata } from './board-metadata';

export function useBoards(
  workspaceId: string | undefined,
  params?: BoardListParams,
  enabled = true,
) {
  return useQuery({
    queryKey: boardKeys.list(workspaceId ?? '', params),
    queryFn: () => listBoards(workspaceId ?? '', params),
    enabled: Boolean(workspaceId) && enabled,
  });
}

/**
 * One board's metadata, normalised for the canvas. The cache holds the server's shape, but its
 * revision and "has a payload" flag go stale as soon as the board is saved, so it is read from the
 * server on every mount. Callers that open the canvas wait for `isFetchedAfterMount`.
 */
export function useBoard(workspaceId: string | undefined, boardId: string | undefined) {
  return useQuery({
    queryKey: boardKeys.detail(workspaceId ?? '', boardId ?? ''),
    queryFn: () => getBoard(workspaceId ?? '', boardId ?? ''),
    select: toBoardMetadata,
    staleTime: 0,
    enabled: Boolean(workspaceId) && Boolean(boardId),
  });
}
