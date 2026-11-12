import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const DevLoginSchema = z.object({
  email: z.string().email('Valid email address is required').optional(),
  name: z.string().optional(),
});

export class DevLoginDto extends createZodDto(DevLoginSchema) {}
