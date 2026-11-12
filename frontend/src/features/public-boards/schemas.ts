import { z } from 'zod';

export const PublicBoardMetadataSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    hasPayload: z.boolean().optional(),
    revision: z.number().optional(),
    keyVersion: z.number().optional(),
    createdAt: z.string().or(z.date()).optional(),
    updatedAt: z.string().or(z.date()).optional(),
  })
  .passthrough();

export type PublicBoardMetadata = z.infer<typeof PublicBoardMetadataSchema>;
