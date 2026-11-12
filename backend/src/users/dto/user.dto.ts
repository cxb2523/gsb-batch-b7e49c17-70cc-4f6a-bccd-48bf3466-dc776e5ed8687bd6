import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { personName } from '../../common/dto/name.schema.js';

const SetupEncryptionSchema = z.object({
  kdfSalt: z.string().min(1, 'kdfSalt is required'),
  keyWrapIv: z.string().min(1, 'keyWrapIv is required'),
  wrappedPrivateKey: z.string().min(1, 'wrappedPrivateKey is required'),
  publicKey: z.string().min(1, 'publicKey is required'),
});

export class SetupEncryptionDto extends createZodDto(SetupEncryptionSchema) {}

const RotatePassphraseSchema = z.object({
  kdfSalt: z.string().min(1, 'kdfSalt is required'),
  keyWrapIv: z.string().min(1, 'keyWrapIv is required'),
  wrappedPrivateKey: z.string().min(1, 'wrappedPrivateKey is required'),
});

export class RotatePassphraseDto extends createZodDto(RotatePassphraseSchema) {}

const UpdateProfileSchema = z.object({
  name: personName('Name').optional(),
});

export class UpdateProfileDto extends createZodDto(UpdateProfileSchema) {}

const DeleteAccountSchema = z.object({
  transfers: z.record(z.string(), z.string()).optional(),
  confirmSoleDeletion: z.boolean().optional(),
});

export class DeleteAccountDto extends createZodDto(DeleteAccountSchema) {}
