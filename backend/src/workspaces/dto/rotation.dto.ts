import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { WrappedKeySchema } from '../../common/dto/wrapped-key.schema.js';

const OrgKeyHolderSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  encryptedOrgKey: WrappedKeySchema,
});

const ProjectRewrapSchema = z.object({
  id: z.string().min(1, 'project id is required'),
  projectKeyVersion: z.number().int().min(1),
  encryptedProjectKey: WrappedKeySchema,
});

export const RotateWorkspaceKeySchema = z.object({
  expectedVersion: z.number().int().min(1),
  encryptedOrgKeys: z
    .array(OrgKeyHolderSchema)
    .refine(
      (keys) => new Set(keys.map((k) => k.userId)).size === keys.length,
      'Each holder may appear only once',
    ),
  projects: z
    .array(ProjectRewrapSchema)
    .refine(
      (projects) => new Set(projects.map((p) => p.id)).size === projects.length,
      'Each project may appear only once',
    ),
});

export class RotateWorkspaceKeyDto extends createZodDto(RotateWorkspaceKeySchema) {}
