import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AccessService } from './access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AccessUser } from './access.types.js';

const user: AccessUser = { id: 'user-1', name: 'User', email: 'user@local.com' };

interface OrganizationRow {
  id: string;
  slug: string | null;
}

interface WorkspaceLookupDouble {
  organization: {
    findUnique: (args: {
      where: { id?: string; slug?: string };
    }) => Promise<OrganizationRow | null>;
    findFirst: (args: unknown) => Promise<OrganizationRow | null>;
  };
  member: {
    findUnique: (args: unknown) => Promise<{ id: string; role: string } | null>;
  };
}

/** Uses Nest's own provider override, so the test double needs no cast to `PrismaService`. */
async function serviceWith(prisma: WorkspaceLookupDouble): Promise<AccessService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      AccessService,
      { provide: PrismaService, useValue: prisma },
      { provide: ConfigService, useValue: { get: () => undefined } },
    ],
  }).compile();

  return moduleRef.get(AccessService);
}

describe('AccessService workspace lookup', () => {
  it('looks a workspace up by id before considering a slug', async () => {
    const squatter = { id: 'squatter-id', slug: 'target-id' };
    const findUnique = vi.fn(
      async ({ where }: { where: { id?: string; slug?: string } }): Promise<OrganizationRow> =>
        where.id === 'target-id' ? { id: 'target-id', slug: 'target-slug' } : squatter,
    );
    const findFirst = vi.fn(async (): Promise<OrganizationRow> => squatter);
    const service = await serviceWith({
      organization: { findUnique, findFirst },
      member: { findUnique: vi.fn(async () => ({ id: 'member-1', role: 'owner' })) },
    });

    const access = await service.resolveWorkspaceForUser(user, 'target-id');

    expect(access.workspace).toEqual({ id: 'target-id', slug: 'target-slug' });
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'target-id' } }),
    );
    // The slug fallback must not run when an id matched, and the old ambiguous OR is gone.
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('falls back to the slug when no id matches', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'org-by-slug', slug: 'friendly-slug' });
    const service = await serviceWith({
      organization: { findUnique, findFirst: vi.fn() },
      member: { findUnique: vi.fn(async () => ({ id: 'member-1', role: 'editor' })) },
    });

    const access = await service.resolveWorkspaceForUser(user, 'friendly-slug');

    expect(access.workspace).toEqual({ id: 'org-by-slug', slug: 'friendly-slug' });
    expect(findUnique).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { slug: 'friendly-slug' } }),
    );
  });
});
