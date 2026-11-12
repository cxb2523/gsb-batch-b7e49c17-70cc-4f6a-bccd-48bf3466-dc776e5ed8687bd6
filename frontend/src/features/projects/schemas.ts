import { z } from 'zod';
import { thingName } from '@/lib/names';
import { PageInfoSchema } from '../pagination';

export const ProjectMemberGrantSchema = z
  .object({
    id: z.string().optional(),
    userId: z.string().optional(),
    role: z.string().optional(),
    encryptedProjectKey: z.string().nullable().optional(),
  })
  .passthrough();

export const ProjectCountsSchema = z
  .object({
    boards: z.number().optional(),
    members: z.number().optional(),
  })
  .passthrough();

export const ProjectSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    organizationId: z.string().default(''),
    keyVersion: z.number().optional(),
    keyRotationDue: z.boolean().optional(),
    keyStatus: z.enum(['granted', 'pending']).optional(),
    encryptedProjectKey: z.string().nullable().optional(),
    members: z.array(ProjectMemberGrantSchema).optional(),
    _count: ProjectCountsSchema.optional(),
    createdAt: z.string().or(z.date()).optional(),
    updatedAt: z.string().or(z.date()).optional(),
  })
  .passthrough();

export type Project = z.infer<typeof ProjectSchema>;

export const PaginatedProjectsSchema = z
  .object({
    items: z.array(ProjectSchema),
    pagination: PageInfoSchema.optional(),
  })
  .passthrough();

export const ProjectsListSchema = z.union([z.array(ProjectSchema), PaginatedProjectsSchema]);
export type ProjectsListResult = z.infer<typeof ProjectsListSchema>;

export const CreateProjectInputSchema = z.object({
  id: z.string(),
  name: thingName('Project name'),
  encryptedProjectKey: z.string(),
  creatorEncryptedProjectKey: z.string(),
});

export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

export const UpdateProjectInputSchema = z.object({
  name: thingName('Project name'),
});

export type UpdateProjectInput = z.infer<typeof UpdateProjectInputSchema>;

export const ProjectMemberItemSchema = z
  .object({
    id: z.string(),
    projectId: z.string().optional(),
    userId: z.string().optional(),
    role: z.string().optional(),
    name: z.string().nullable().optional(),
    email: z.string().optional(),
    image: z.string().nullable().optional(),
    source: z.enum(['workspace', 'project']).optional(),
    keyStatus: z.enum(['granted', 'pending']).optional(),
    encryptedProjectKey: z.string().nullable().optional(),
    user: z
      .object({
        id: z.string().optional(),
        name: z.string().nullable().optional(),
        email: z.string().optional(),
        image: z.string().nullable().optional(),
        publicKey: z.string().nullable().optional(),
      })
      .passthrough()
      .optional(),
    createdAt: z.string().or(z.date()).optional(),
  })
  .passthrough();

export type ProjectMemberItem = z.infer<typeof ProjectMemberItemSchema>;

export const PaginatedProjectMembersSchema = z
  .object({
    items: z.array(ProjectMemberItemSchema),
    pagination: PageInfoSchema.optional(),
  })
  .passthrough();

export const ProjectMembersListSchema = z.union([
  z.array(ProjectMemberItemSchema),
  PaginatedProjectMembersSchema,
]);

export type ProjectMembersListResult = z.infer<typeof ProjectMembersListSchema>;

/** A workspace member who could still be given a project: just enough to pick them. */
export const AssignableMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
});

export type AssignableMember = z.infer<typeof AssignableMemberSchema>;

export const AssignableMembersSchema = z.object({
  items: z.array(AssignableMemberSchema),
  pagination: PageInfoSchema,
});

export type AssignableMembersResult = z.infer<typeof AssignableMembersSchema>;

export const AddProjectMemberInputSchema = z.object({
  userId: z.string(),
  role: z.string(),
  encryptedProjectKey: z.string(),
});

export type AddProjectMemberInput = z.infer<typeof AddProjectMemberInputSchema>;

export const UpdateProjectMemberRoleInputSchema = z.object({
  role: z.string(),
});

export type UpdateProjectMemberRoleInput = z.infer<typeof UpdateProjectMemberRoleInputSchema>;

export const ProjectRotationPlanSchema = z.object({
  keyVersion: z.number(),
  keyRotationDue: z.boolean().optional(),
  grants: z.array(
    z.object({
      userId: z.string(),
      publicKey: z.string().nullable(),
    }),
  ),
});

export type ProjectRotationPlan = z.infer<typeof ProjectRotationPlanSchema>;

export const RotateProjectKeyInputSchema = z.object({
  expectedVersion: z.number(),
  encryptedProjectKey: z.string(),
  historyEntry: z.string(),
  grants: z.array(
    z.object({
      userId: z.string(),
      encryptedProjectKey: z.string(),
    }),
  ),
});

export type RotateProjectKeyInput = z.infer<typeof RotateProjectKeyInputSchema>;

export const RotateProjectKeyResultSchema = z
  .object({
    keyVersion: z.number(),
  })
  .passthrough();

export type RotateProjectKeyResult = z.infer<typeof RotateProjectKeyResultSchema>;

export const ProjectKeyHistoryEntrySchema = z.object({
  oldVersion: z.number(),
  newVersion: z.number(),
  encryptedKey: z.string(),
  createdAt: z.string().or(z.date()).optional(),
});

export type ProjectKeyHistoryEntry = z.infer<typeof ProjectKeyHistoryEntrySchema>;

export const ProjectKeyHistorySchema = z.object({
  keyVersion: z.number(),
  entries: z.array(ProjectKeyHistoryEntrySchema),
});

export type ProjectKeyHistory = z.infer<typeof ProjectKeyHistorySchema>;
