import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce
    .number()
    .int()
    .transform((val) => Math.min(100, Math.max(20, val)))
    .default(20),
});

export class PaginationQueryDto extends createZodDto(PaginationQuerySchema) {}
