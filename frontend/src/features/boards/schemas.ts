import { z } from 'zod';
import { thingName } from '@/lib/names';
import { PageInfoSchema } from '../pagination';

export const BoardProjectMemberSchema = z
  .object({
    id: z.string().optional(),
    userId: z.string().optional(),
    role: z.string().optional(),
    encryptedProjectKey: z.string().nullable().optional(),
  })
  .passthrough();

export const BoardProjectOrganizationSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string().nullable().optional(),
  })
  .passthrough();

export const BoardProjectSchema = z
  .object({
    id: z.string(),
    organizationId: z.string().optional(),
    name: z.string().optional(),
    keyVersion: z.number().optional(),
    encryptedProjectKey: z.string().nullable().optional(),
    organization: BoardProjectOrganizationSchema.optional(),
    members: z.array(BoardProjectMemberSchema).optional(),
  })
  .passthrough();

export const BoardSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    projectId: z.string(),
    hasPayload: z.boolean().optional(),
    keyVersion: z.number().optional(),
    revision: z.number().optional(),
    encryptedBoardKey: z.string().nullable().optional(),
    project: BoardProjectSchema.optional(),
    publicShareToken: z.string().nullable().optional(),
    publicShareExpiresAt: z.string().nullable().optional(),
    createdAt: z.string().or(z.date()).optional(),
    updatedAt: z.string().or(z.date()).optional(),
  })
  .passthrough();

export type Board = z.infer<typeof BoardSchema>;

export const PaginatedBoardsSchema = z
  .object({
    items: z.array(BoardSchema),
    pagination: PageInfoSchema.optional(),
  })
  .passthrough();

export const BoardsListSchema = z.union([z.array(BoardSchema), PaginatedBoardsSchema]);
export type BoardsListResult = z.infer<typeof BoardsListSchema>;

export const CreateBoardInputSchema = z.object({
  id: z.string(),
  title: thingName('Canvas title'),
  projectId: z.string(),
  encryptedBoardKey: z.string(),
  projectKeyVersion: z.number(),
});

export type CreateBoardInput = z.infer<typeof CreateBoardInputSchema>;

export const UpdateBoardInputSchema = z.object({
  title: thingName('Canvas title').optional(),
});

export type UpdateBoardInput = z.infer<typeof UpdateBoardInputSchema>;

export const SaveBoardPayloadResultSchema = z.object({
  success: z.boolean(),
  hasPayload: z.boolean(),
  revision: z.number(),
  updatedAt: z.string(),
});

export type SaveBoardPayloadResult = z.infer<typeof SaveBoardPayloadResultSchema>;

export const PublicShareResultSchema = z
  .object({
    id: z.string().optional(),
    isPublic: z.boolean().optional(),
    publicShareToken: z.string().nullable().optional(),
    token: z.string().optional(),
    expiresAt: z.string().nullable().optional(),
  })
  .passthrough();

export type PublicShareResult = z.infer<typeof PublicShareResultSchema>;
