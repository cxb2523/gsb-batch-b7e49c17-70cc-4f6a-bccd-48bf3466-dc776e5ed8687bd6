import { useState } from 'react';
import { toPage } from '@/features/pagination';
import { useProjectMembers } from '@/features/projects/queries';
import type { ProjectMemberItem } from '@/features/projects/schemas';

const MEMBERS_PER_PAGE = 20;

/** One project's effective member list, a page at a time, for the access dialog. */
export function useProjectMemberPages(workspaceId: string, projectId: string | null) {
  const [page, setPage] = useState(1);
  const { data } = useProjectMembers(workspaceId, projectId ?? undefined, {
    page,
    limit: MEMBERS_PER_PAGE,
  });
  const { items, pagination } = toPage<ProjectMemberItem>(data, page);

  return {
    members: items,
    pagination,
    previous: () => setPage((current) => Math.max(1, current - 1)),
    next: () => setPage((current) => current + 1),
    restart: () => setPage(1),
  };
}
