import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { thingName } from '../../common/dto/name.schema.js';
import { WrappedKeySchema } from '../../common/dto/wrapped-key.schema.js';

const CreateBoardSchema = z.object({
  /** Chosen by the browser so the wrapped key and the payload can be bound to this board. */
  id: z.string().uuid('Board ID must be a UUID'),
  projectId: z.string().min(1, 'Project ID is required'),
  title: thingName('Canvas title'),
  encryptedBoardKey: WrappedKeySchema,
  /** The project key generation the board key was wrapped under. */
  projectKeyVersion: z.number().int().min(1, 'projectKeyVersion must be at least 1'),
});

export class CreateBoardDto extends createZodDto(CreateBoardSchema) {}

export const UpdateBoardSchema = z.object({
  title: thingName('Canvas title'),
});

export class UpdateBoardDto extends createZodDto(UpdateBoardSchema) {}
