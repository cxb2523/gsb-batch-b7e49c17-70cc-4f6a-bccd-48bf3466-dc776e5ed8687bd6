import { http, validateResponse } from '@/lib/http';
import {
  WorkspaceMembersListSchema,
  WorkspaceMemberSchema,
  WorkspaceInvitationsListSchema,
  WorkspaceInvitationSchema,
  InviteMemberInputSchema,
  UpdateMemberRoleInputSchema,
  PublicInvitationSchema,
  InvitationRecipientSchema,
  AcceptInvitationResultSchema,
  type WorkspaceMembersListResult,
  type WorkspaceMember,
  type WorkspaceInvitation,
  type InviteMemberInput,
  type UpdateMemberRoleInput,
  type PublicInvitation,
  type AcceptInvitationResult,
} from './schemas';

export async function listWorkspaceMembers(
  workspaceId: string,
  params?: { page?: number; limit?: number },
): Promise<WorkspaceMembersListResult> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set('page', String(params.page));
  if (params?.limit) qs.set('limit', String(params.limit));
  const queryStr = qs.toString() ? `?${qs.toString()}` : '';

  const data = await http.get(`/api/workspaces/${workspaceId}/members${queryStr}`, {
    workspaceId,
  });
  return validateResponse(
    WorkspaceMembersListSchema,
    data,
    `GET /api/workspaces/${workspaceId}/members${queryStr}`,
  );
}

export async function inviteWorkspaceMember(
  workspaceId: string,
  input: InviteMemberInput,
): Promise<WorkspaceInvitation> {
  InviteMemberInputSchema.parse(input);
  const data = await http.post(`/api/workspaces/${workspaceId}/members/invite`, input, {
    workspaceId,
  });
  return validateResponse(
    WorkspaceInvitationSchema,
    data,
    `POST /api/workspaces/${workspaceId}/members/invite`,
  );
}

export async function updateWorkspaceMemberRole(
  workspaceId: string,
  memberId: string,
  input: UpdateMemberRoleInput,
): Promise<WorkspaceMember> {
  UpdateMemberRoleInputSchema.parse(input);
  const data = await http.patch(`/api/workspaces/${workspaceId}/members/${memberId}`, input, {
    workspaceId,
  });
  return validateResponse(
    WorkspaceMemberSchema,
    data,
    `PATCH /api/workspaces/${workspaceId}/members/${memberId}`,
  );
}

export async function removeWorkspaceMember(
  workspaceId: string,
  memberId: string,
): Promise<{ rotationDue?: string[] } | void> {
  return await http.delete<{ rotationDue?: string[] }>(
    `/api/workspaces/${workspaceId}/members/${memberId}`,
    {
      workspaceId,
    },
  );
}

export async function listWorkspaceInvitations(
  workspaceId: string,
): Promise<WorkspaceInvitation[]> {
  const data = await http.get(`/api/workspaces/${workspaceId}/invitations`, {
    workspaceId,
  });
  return validateResponse(
    WorkspaceInvitationsListSchema,
    data,
    `GET /api/workspaces/${workspaceId}/invitations`,
  );
}

export async function cancelWorkspaceInvitation(
  workspaceId: string,
  invitationId: string,
): Promise<void> {
  await http.delete(`/api/workspaces/${workspaceId}/invitations/${invitationId}`, {
    workspaceId,
  });
}

export async function getPublicInvitation(inviteId: string): Promise<PublicInvitation> {
  const data = await http.get(`/api/invitations/${inviteId}`);
  return validateResponse(PublicInvitationSchema, data, `GET /api/invitations/${inviteId}`);
}

/** Whether the signed-in account is the one the invitation was sent to. */
export async function isInvitationRecipient(inviteId: string): Promise<boolean> {
  const data = await http.get(`/api/invitations/${inviteId}/recipient`);
  const result = validateResponse(
    InvitationRecipientSchema,
    data,
    `GET /api/invitations/${inviteId}/recipient`,
  );
  return result.isRecipient;
}

export async function acceptPublicInvitation(inviteId: string): Promise<AcceptInvitationResult> {
  const data = await http.post(`/api/invitations/${inviteId}/accept`);
  return validateResponse(
    AcceptInvitationResultSchema,
    data,
    `POST /api/invitations/${inviteId}/accept`,
  );
}
