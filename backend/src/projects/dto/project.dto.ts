import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { PROJECT_ROLES } from '../../access/roles.js';
import { thingName } from '../../common/dto/name.schema.js';
import { WrappedKeySchema } from '../../common/dto/wrapped-key.schema.js';

export const CreateProjectSchema = z.object({
  /** Chosen by the browser so the wrapped keys can be bound to this project. */
  id: z.string().uuid('Project ID must be a UUID'),
  name: thingName('Project name'),
  encryptedProjectKey: WrappedKeySchema,
  creatorEncryptedProjectKey: WrappedKeySchema,
});

export class CreateProjectDto extends createZodDto(CreateProjectSchema) {}

const UpdateProjectSchema = z.object({
  name: thingName('Project name'),
});

export class UpdateProjectDto extends createZodDto(UpdateProjectSchema) {}

const AddProjectMemberSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  role: z.enum(PROJECT_ROLES).default(PROJECT_ROLES[1]),
  encryptedProjectKey: WrappedKeySchema,
});

export class AddProjectMemberDto extends createZodDto(AddProjectMemberSchema) {}

const UpdateProjectMemberRoleSchema = z.object({
  role: z.enum(PROJECT_ROLES),
});

export class UpdateProjectMemberRoleDto extends createZodDto(UpdateProjectMemberRoleSchema) {}
