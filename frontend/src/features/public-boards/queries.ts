import { useQuery } from '@tanstack/react-query';
import { publicBoardKeys } from './keys';
import { getPublicBoardMetadata, getPublicBoardPayload } from './api';

/** The metadata of a publicly shared board. A revoked or unknown link answers 404. */
export function usePublicBoard(token: string | undefined) {
  return useQuery({
    queryKey: publicBoardKeys.detail(token ?? ''),
    queryFn: () => getPublicBoardMetadata(token ?? ''),
    enabled: Boolean(token),
  });
}

/** The encrypted payload of a publicly shared board; only read once there is a key to open it. */
export function usePublicBoardPayload(token: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: publicBoardKeys.payload(token ?? ''),
    queryFn: () => getPublicBoardPayload(token ?? ''),
    enabled: Boolean(token) && enabled,
  });
}
