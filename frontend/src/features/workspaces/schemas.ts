import { z } from 'zod';
import { thingName } from '@/lib/names';

export const WorkspaceCountsSchema = z
  .object({
    members: z.number().optional(),
    projects: z.number().optional(),
    boards: z.number().optional(),
  })
  .passthrough();

export const WorkspaceSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    keyVersion: z.number().optional(),
    keyRotationDue: z.boolean().optional(),
    currentUserRole: z.string().optional(),
    encryptedOrgKey: z.string().nullable().optional(),
    _count: WorkspaceCountsSchema.optional(),
    createdAt: z.string().or(z.date()).optional(),
    updatedAt: z.string().or(z.date()).optional(),
  })
  .passthrough();

export type Workspace = z.infer<typeof WorkspaceSchema>;

export const CreateWorkspaceInputSchema = z.object({
  id: z.string(),
  name: thingName('Workspace name'),
  encryptedOrgKey: z.string(),
  project: z.object({
    id: z.string(),
    name: thingName('Project name'),
    encryptedProjectKey: z.string(),
    creatorEncryptedProjectKey: z.string(),
  }),
});

export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceInputSchema>;

export const UpdateWorkspaceInputSchema = z.object({
  name: thingName('Workspace name').optional(),
  slug: z.string().min(1).optional(),
});

export type UpdateWorkspaceInput = z.infer<typeof UpdateWorkspaceInputSchema>;

export const WorkspaceRotationPlanSchema = z.object({
  keyVersion: z.number(),
  holders: z.array(
    z.object({
      userId: z.string(),
      publicKey: z.string().nullable(),
    }),
  ),
  projects: z.array(
    z.object({
      id: z.string(),
      keyVersion: z.number(),
      encryptedProjectKey: z.string(),
    }),
  ),
});

export type WorkspaceRotationPlan = z.infer<typeof WorkspaceRotationPlanSchema>;

/** The boards still encrypted under an older project key, as the server derives them. */
export const RekeyQueueSchema = z.object({
  boards: z.array(
    z.object({
      boardId: z.string(),
      projectId: z.string(),
      keyVersion: z.number(),
      projectKeyVersion: z.number(),
      revision: z.number(),
    }),
  ),
  /** Boards with a public link: they keep their key, so they are counted, not queued. */
  skippedPublic: z.number(),
});

export type RekeyQueue = z.infer<typeof RekeyQueueSchema>;

export const RotateWorkspaceKeyInputSchema = z.object({
  expectedVersion: z.number(),
  encryptedOrgKeys: z.array(
    z.object({
      userId: z.string(),
      encryptedOrgKey: z.string(),
    }),
  ),
  projects: z.array(
    z.object({
      id: z.string(),
      projectKeyVersion: z.number(),
      encryptedProjectKey: z.string(),
    }),
  ),
});

export type RotateWorkspaceKeyInput = z.infer<typeof RotateWorkspaceKeyInputSchema>;

export const RotateWorkspaceKeyResultSchema = z
  .object({
    keyVersion: z.number(),
  })
  .passthrough();

export type RotateWorkspaceKeyResult = z.infer<typeof RotateWorkspaceKeyResultSchema>;

export const TransferOwnershipInputSchema = z.object({
  memberId: z.string(),
});

export type TransferOwnershipInput = z.infer<typeof TransferOwnershipInputSchema>;

export const AccessMeSchema = z
  .object({
    canCreateWorkspace: z.boolean(),
    workspace: z
      .object({
        id: z.string(),
        name: z.string().optional(),
        slug: z.string(),
      })
      .nullable()
      .optional(),
    workspaceRole: z.string().optional(),
    isWorkspaceAdministrator: z.boolean().optional(),
    rules: z.array(z.unknown()).optional(),
    projectRules: z.record(z.string(), z.array(z.unknown())).optional(),
    projectRoles: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

export type AccessMe = z.infer<typeof AccessMeSchema>;

export const DeleteWorkspaceResultSchema = z
  .object({
    success: z.boolean().optional(),
  })
  .passthrough();
