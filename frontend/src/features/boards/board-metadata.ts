import type { Board } from './schemas';

/** A board as the canvas works with it: optional server fields resolved to concrete values. */
export interface BoardMetadata {
  id: string;
  title: string;
  projectId: string;
  keyVersion: number;
  revision?: number | undefined;
  hasPayload?: boolean | undefined;
  encryptedBoardKey?: string | null | undefined;
  /** The public link, when there is one. */
  publicShareToken: string | null;
  updatedAt: string;
  project: {
    id: string;
    name: string;
    organizationId: string;
    keyVersion: number;
    organization?:
      | {
          id: string;
          name: string;
          slug?: string | null | undefined;
        }
      | undefined;
    encryptedProjectKey?: string | null | undefined;
    members?:
      | Array<{
          id: string;
          userId: string;
          role?: string | undefined;
          encryptedProjectKey?: string | null | undefined;
        }>
      | undefined;
  };
}

export function toBoardMetadata(data: Board): BoardMetadata {
  return {
    id: data.id,
    title: data.title,
    projectId: data.projectId,
    keyVersion: data.keyVersion ?? 1,
    revision: data.revision ?? 0,
    hasPayload: data.hasPayload,
    encryptedBoardKey: data.encryptedBoardKey,
    publicShareToken: data.publicShareToken ?? null,
    updatedAt: String(data.updatedAt ?? ''),
    project: {
      id: data.project?.id ?? '',
      name: data.project?.name ?? '',
      organizationId: data.project?.organizationId ?? '',
      keyVersion: data.project?.keyVersion ?? 1,
      organization: data.project?.organization
        ? {
            id: data.project.organization.id,
            name: data.project.organization.name,
            slug: data.project.organization.slug,
          }
        : undefined,
      encryptedProjectKey: data.project?.encryptedProjectKey ?? null,
      members: data.project?.members
        ? data.project.members.map((m) => ({
            id: m.id ?? '',
            userId: m.userId ?? '',
            role: m.role,
            encryptedProjectKey: m.encryptedProjectKey ?? null,
          }))
        : undefined,
    },
  };
}
