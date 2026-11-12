import { useQuery } from '@tanstack/react-query';
import { memberKeys } from './keys';
import {
  listWorkspaceMembers,
  listWorkspaceInvitations,
  getPublicInvitation,
  isInvitationRecipient,
} from './api';

export function useWorkspaceMembers(
  workspaceId: string | undefined,
  params?: { page?: number; limit?: number },
) {
  return useQuery({
    queryKey: memberKeys.list(workspaceId ?? '', params),
    queryFn: () => listWorkspaceMembers(workspaceId ?? '', params),
    enabled: Boolean(workspaceId),
  });
}

export function useWorkspaceInvitations(workspaceId: string | undefined) {
  return useQuery({
    queryKey: memberKeys.invitations(workspaceId ?? ''),
    queryFn: () => listWorkspaceInvitations(workspaceId ?? ''),
    enabled: Boolean(workspaceId),
  });
}

export function usePublicInvitation(inviteId: string | undefined) {
  return useQuery({
    queryKey: memberKeys.publicInvitation(inviteId ?? ''),
    queryFn: () => getPublicInvitation(inviteId ?? ''),
    enabled: Boolean(inviteId),
  });
}

/** Asked only while signed in; the answer is for that account, so it is keyed by the user too. */
export function useInvitationRecipient(inviteId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: memberKeys.invitationRecipient(inviteId ?? '', userId ?? ''),
    queryFn: () => isInvitationRecipient(inviteId ?? ''),
    enabled: Boolean(inviteId && userId),
  });
}
