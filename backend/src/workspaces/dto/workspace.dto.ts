import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { DEFAULT_INVITATION_ROLE, INVITATION_ROLES } from '../../access/roles.js';
import { thingName } from '../../common/dto/name.schema.js';
import { WrappedKeySchema } from '../../common/dto/wrapped-key.schema.js';

const WorkspaceNameSchema = thingName('Workspace name');

const UpdateWorkspaceSchema = z.object({
  name: WorkspaceNameSchema,
});

export class UpdateWorkspaceDto extends createZodDto(UpdateWorkspaceSchema) {}

export const CreateWorkspaceSchema = z.object({
  /** Chosen by the browser so every wrapped key can be bound to this id before creation. */
  id: z.string().uuid('Workspace ID must be a UUID'),
  name: WorkspaceNameSchema,
  /** The workspace key wrapped for the creator, who becomes its Owner. */
  encryptedOrgKey: WrappedKeySchema,
  project: z.object({
    /** Also browser-chosen, for the same reason as the workspace id. */
    id: z.string().uuid('Project ID must be a UUID'),
    name: thingName('Project name'),
    encryptedProjectKey: WrappedKeySchema,
    creatorEncryptedProjectKey: WrappedKeySchema,
  }),
});

export class CreateWorkspaceDto extends createZodDto(CreateWorkspaceSchema) {}

export const InviteMemberSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, 'Email address cannot exceed 254 characters')
    .email('Valid email address is required'),
  role: z.enum(INVITATION_ROLES).default(DEFAULT_INVITATION_ROLE),
  projectIds: z.array(z.string().min(1).max(64)).max(100).optional(),
});

export class InviteMemberDto extends createZodDto(InviteMemberSchema) {}

const UpdateMemberRoleSchema = z.object({
  role: z.string().min(1, 'Role is required'),
  /** The workspace key wrapped for the target member. Required when promoting to admin. */
  encryptedOrgKey: WrappedKeySchema.optional(),
});

export class UpdateMemberRoleDto extends createZodDto(UpdateMemberRoleSchema) {}

const TransferOwnershipSchema = z.object({
  memberId: z.string().min(1, 'memberId is required'),
});

export class TransferOwnershipDto extends createZodDto(TransferOwnershipSchema) {}
