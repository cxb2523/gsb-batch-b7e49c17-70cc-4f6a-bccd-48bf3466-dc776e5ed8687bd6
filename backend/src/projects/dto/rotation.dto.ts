import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { WrappedKeySchema } from '../../common/dto/wrapped-key.schema.js';

const RotationGrantSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  encryptedProjectKey: WrappedKeySchema,
});

export const RotateProjectKeySchema = z.object({
  /** The version the browser saw; the server refuses if it is no longer current. */
  expectedVersion: z.number().int().min(1),
  /** The new project key wrapped under the workspace key. */
  encryptedProjectKey: WrappedKeySchema,
  /** The old project key wrapped under the new one, for the history chain. */
  historyEntry: WrappedKeySchema,
  /** The new project key for every currently granted person; pending grants are not included. */
  grants: z
    .array(RotationGrantSchema)
    .refine(
      (grants) => new Set(grants.map((grant) => grant.userId)).size === grants.length,
      'Each granted person may appear only once',
    ),
});

export class RotateProjectKeyDto extends createZodDto(RotateProjectKeySchema) {}
