import { z } from 'zod';
import { PageInfoSchema } from '../pagination';

export const WorkspaceMemberUserSchema = z
  .object({
    id: z.string(),
    name: z.string().nullable().optional(),
    email: z.string(),
    image: z.string().nullable().optional(),
    publicKey: z.string().nullable().optional(),
  })
  .passthrough();

export const WorkspaceMemberSchema = z
  .object({
    id: z.string(),
    userId: z.string().optional(),
    name: z.string().nullable().optional(),
    email: z.string().optional(),
    image: z.string().nullable().optional(),
    role: z.string(),
    assignedProjectsCount: z.number().optional(),
    organizationId: z.string().optional(),
    encryptedOrgKey: z.string().nullable().optional(),
    rotationDue: z.array(z.string()).optional(),
    user: WorkspaceMemberUserSchema.optional(),
    createdAt: z.string().or(z.date()).optional(),
  })
  .passthrough();

export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;

export const PaginatedWorkspaceMembersSchema = z
  .object({
    items: z.array(WorkspaceMemberSchema),
    pagination: PageInfoSchema.optional(),
  })
  .passthrough();

export const WorkspaceMembersListSchema = z.union([
  z.array(WorkspaceMemberSchema),
  PaginatedWorkspaceMembersSchema,
]);

export type WorkspaceMembersListResult = z.infer<typeof WorkspaceMembersListSchema>;

export const WorkspaceInvitationSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    role: z.string(),
    status: z.string().optional(),
    inviteUrl: z.string().optional(),
    organizationId: z.string().optional(),
    inviterId: z.string().optional(),
    expiresAt: z.string().or(z.date()).optional(),
    createdAt: z.string().or(z.date()).optional(),
  })
  .passthrough();

export type WorkspaceInvitation = z.infer<typeof WorkspaceInvitationSchema>;

export const WorkspaceInvitationsListSchema = z.array(WorkspaceInvitationSchema);

export const InviteMemberInputSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, 'Email address cannot exceed 254 characters')
    .email('Valid email address is required'),
  role: z.string().optional(),
  projectIds: z.array(z.string()).max(100).optional(),
});

export type InviteMemberInput = z.infer<typeof InviteMemberInputSchema>;

export const UpdateMemberRoleInputSchema = z.object({
  role: z.string(),
  encryptedOrgKey: z.string().nullable().optional(),
});

export type UpdateMemberRoleInput = z.infer<typeof UpdateMemberRoleInputSchema>;

export const PublicInvitationSchema = z
  .object({
    id: z.string().optional(),
    role: z.string(),
    status: z.enum(['pending', 'expired', 'accepted', 'revoked']).default('pending'),
    email: z.string().optional(),
    organization: z
      .object({
        id: z.string().optional(),
        name: z.string().optional(),
        slug: z.string().optional(),
      })
      .optional(),
    organizationId: z.string().optional(),
    organizationName: z.string().optional(),
    organizationSlug: z.string().optional(),
    inviterEmail: z.string().optional(),
    inviterName: z.string().nullable().optional(),
    /** The invited address with most of it hidden, such as `q***@gmail.com`. */
    emailHint: z.string().optional(),
    expiresAt: z.string().or(z.date()).optional(),
  })
  .passthrough();

export type PublicInvitation = z.infer<typeof PublicInvitationSchema>;

export const InvitationRecipientSchema = z.object({ isRecipient: z.boolean() });

export const AcceptInvitationResultSchema = z
  .object({
    success: z.boolean().optional(),
    workspaceSlug: z.string().optional(),
    workspaceId: z.string().optional(),
    organizationId: z.string().optional(),
    pendingProjectGrants: z.number().optional(),
    alreadyAccepted: z.boolean().optional(),
  })
  .passthrough();

export type AcceptInvitationResult = z.infer<typeof AcceptInvitationResultSchema>;
