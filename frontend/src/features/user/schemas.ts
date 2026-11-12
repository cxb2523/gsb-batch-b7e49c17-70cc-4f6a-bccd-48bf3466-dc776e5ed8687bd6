import { z } from 'zod';
import { personName } from '@/lib/names';

export const EncryptionParamsSchema = z
  .object({
    kdfSalt: z.string().nullable().optional(),
    keyWrapIv: z.string().nullable().optional(),
    wrappedPrivateKey: z.string().nullable().optional(),
    publicKey: z.string().nullable().optional(),
  })
  .passthrough();

export type EncryptionParams = z.infer<typeof EncryptionParamsSchema>;

export const EncryptionSetupInputSchema = z.object({
  kdfSalt: z.string(),
  keyWrapIv: z.string(),
  wrappedPrivateKey: z.string(),
  publicKey: z.string(),
});

export type EncryptionSetupInput = z.infer<typeof EncryptionSetupInputSchema>;

export const EncryptionPassphraseInputSchema = z.object({
  kdfSalt: z.string(),
  keyWrapIv: z.string(),
  wrappedPrivateKey: z.string(),
});

export type EncryptionPassphraseInput = z.infer<typeof EncryptionPassphraseInputSchema>;

export const UserPublicKeySchema = z
  .object({
    id: z.string(),
    publicKey: z.string(),
  })
  .passthrough();

export type UserPublicKey = z.infer<typeof UserPublicKeySchema>;

export const UserProfileSchema = z
  .object({
    id: z.string(),
    name: z.string().nullable().optional(),
    email: z.string(),
    image: z.string().nullable().optional(),
    createdAt: z.string().or(z.date()).optional(),
  })
  .passthrough();

export type UserProfile = z.infer<typeof UserProfileSchema>;

export const UpdateUserProfileInputSchema = z.object({
  name: personName('Name').optional(),
  image: z.string().nullable().optional(),
});

export type UpdateUserProfileInput = z.infer<typeof UpdateUserProfileInputSchema>;

export const LinkedAccountSchema = z
  .object({
    id: z.string(),
    providerId: z.string(),
    accountId: z.string().optional(),
    createdAt: z.string().or(z.date()).optional(),
  })
  .passthrough();

export type LinkedAccount = z.infer<typeof LinkedAccountSchema>;

export const LinkedAccountsListSchema = z.array(LinkedAccountSchema);

export const OwnedWorkspaceOtherMemberSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    name: z.string().nullable().optional(),
    email: z.string().optional(),
    role: z.string().optional(),
    canReceiveOwnership: z.boolean().optional(),
  })
  .passthrough();

export type OwnedWorkspaceOtherMember = z.infer<typeof OwnedWorkspaceOtherMemberSchema>;

export const OwnedWorkspaceSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    totalMembersCount: z.number().optional(),
    membersCount: z.number().optional(),
    otherMembers: z.array(OwnedWorkspaceOtherMemberSchema).default([]),
  })
  .passthrough();

export type OwnedWorkspace = z.infer<typeof OwnedWorkspaceSchema>;

export const OwnedWorkspacesListSchema = z.array(OwnedWorkspaceSchema);

export const DeleteAccountInputSchema = z.object({
  transfers: z.record(z.string(), z.string()).optional(),
  confirmSoleDeletion: z.boolean().optional(),
});

export type DeleteAccountInput = z.infer<typeof DeleteAccountInputSchema>;

export const UserMetricsSchema = z
  .object({
    workspacesCount: z.number(),
    projectsCount: z.number(),
  })
  .passthrough();

export type UserMetrics = z.infer<typeof UserMetricsSchema>;

export const AuthConfigSchema = z
  .object({
    devLoginEnabled: z.boolean(),
    allowSignups: z.boolean().optional(),
    isFirstAccountSetup: z.boolean().optional(),
    demoMode: z.boolean().optional(),
    providers: z.array(z.string()),
    analytics: z
      .object({
        umami: z
          .object({
            websiteId: z.string(),
            hostUrl: z.string(),
          })
          .nullable()
          .optional(),
      })
      .nullable()
      .optional(),
    operator: z
      .object({
        name: z.string().nullable().optional(),
        contact: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
  })
  .passthrough();

export type AuthConfig = z.infer<typeof AuthConfigSchema>;

export const DevLoginInputSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
});

export type DevLoginInput = z.infer<typeof DevLoginInputSchema>;

export const SuccessResultSchema = z
  .object({
    success: z.boolean().optional(),
  })
  .passthrough();

export type SuccessResult = z.infer<typeof SuccessResultSchema>;
