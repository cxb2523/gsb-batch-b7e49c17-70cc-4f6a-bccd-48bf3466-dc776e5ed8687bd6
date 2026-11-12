import { z } from 'zod';

export const PageInfoSchema = z.object({
  page: z.number(),
  limit: z.number(),
  total: z.number(),
  totalPages: z.number(),
  hasNextPage: z.boolean(),
  hasPrevPage: z.boolean(),
});

export type PageInfo = z.infer<typeof PageInfoSchema>;

type ListResult<T> = T[] | { items: T[]; pagination?: PageInfo | undefined };

/**
 * List endpoints answer with a bare array when called without paging and with
 * `{ items, pagination }` when called with it. Pages read one shape.
 */
export function toPage<T>(
  data: ListResult<T> | undefined,
  page = 1,
  limit = 20,
): { items: T[]; pagination: PageInfo } {
  const items = data === undefined ? [] : Array.isArray(data) ? data : data.items;
  const reported = data !== undefined && !Array.isArray(data) ? data.pagination : undefined;
  return {
    items,
    pagination: reported ?? {
      page,
      limit,
      total: items.length,
      totalPages: 1,
      hasNextPage: false,
      hasPrevPage: false,
    },
  };
}
