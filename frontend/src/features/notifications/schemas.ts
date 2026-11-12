import { z } from 'zod';
import { PageInfoSchema } from '../pagination';

/**
 * One inbox item. `data` is only the names the server stored with it; how each kind reads is
 * decided in `notification-text.ts`, so a kind this build does not know still arrives as an item.
 */
export const NotificationSchema = z.object({
  id: z.string(),
  kind: z.string(),
  workspaceId: z.string(),
  data: z.record(z.string(), z.unknown()),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});

export type Notification = z.infer<typeof NotificationSchema>;

export const NotificationListSchema = z.object({
  items: z.array(NotificationSchema),
  pagination: PageInfoSchema,
});

export type NotificationList = z.infer<typeof NotificationListSchema>;

export const UnreadCountSchema = z.object({ count: z.number() });
