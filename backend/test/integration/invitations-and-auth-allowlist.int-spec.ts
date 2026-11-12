import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { organization } from 'better-auth/plugins';
import {
  createIntegrationHarness,
  type IntegrationHarness,
  type SignedInActor,
} from './harness.js';
import {
  AUTH,
  type Auth,
  ALLOWED_ORGANIZATION_PATHS,
  DISABLED_ORGANIZATION_PATHS,
} from '../../src/auth/auth.js';

function first<T>(items: readonly T[]): T {
  const [head] = items;
  if (head === undefined) {
    throw new Error('expected at least one item');
  }
  return head;
}

describe('Invitations, public lookup & Better Auth bypass allowlist (Integration)', () => {
  let harness: IntegrationHarness;
  let owner: SignedInActor;
  let recipient: SignedInActor;
  let wrongUser: SignedInActor;
  let orgId: string;
  let project1Id: string;
  let project2Id: string;

  beforeAll(async () => {
    harness = await createIntegrationHarness({
      env: {
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
      },
    });
    await harness.resetDatabase();

    const [ownerActor, recipientActor, wrongActor] = await Promise.all([
      harness.signIn('owner-inv@local.com', 'Owner Inviter'),
      harness.signIn('recipient-inv@local.com', 'Invited Colleague'),
      harness.signIn('wrong-user@local.com', 'Wrong User'),
    ]);
    owner = ownerActor;
    recipient = recipientActor;
    wrongUser = wrongActor;

    const org = await harness.seedWorkspace({
      name: 'Invitation Test Workspace',
      slug: 'invitation-test-ws',
    });
    orgId = org.id;

    await harness.seedMember({
      organizationId: orgId,
      userId: owner.user.id,
      role: 'owner',
    });

    const [p1, p2] = await Promise.all([
      harness.seedProject({ organizationId: orgId, name: 'Project One' }),
      harness.seedProject({ organizationId: orgId, name: 'Project Two' }),
    ]);
    project1Id = p1.id;
    project2Id = p2.id;
  });

  afterAll(async () => {
    if (harness) {
      await harness.close();
    }
  });

  describe('R10: Unguessable invitation IDs & minimal public lookup', () => {
    it('generates base64url invitation IDs of at least 43 characters and unique across a sample', async () => {
      const responses = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          harness
            .request()
            .post(`/api/workspaces/${orgId}/members/invite`)
            .set('Cookie', owner.cookie)
            .send({
              email: `sample-${i}@local.com`,
              role: 'editor',
            }),
        ),
      );

      const sampleIds = new Set<string>();
      for (const res of responses) {
        expect(res.status).toBe(201);
        const invId = String(res.body.id);
        expect(invId.length).toBeGreaterThanOrEqual(43);
        expect(invId).toMatch(/^[A-Za-z0-9_-]{43,}$/);
        expect(invId.startsWith('inv_')).toBe(false);
        sampleIds.add(invId);
      }

      expect(sampleIds.size).toBe(8);
    });

    it('returns only minimal public fields and one server-computed status, and 404 for an unknown ID', async () => {
      const createRes = await harness
        .request()
        .post(`/api/workspaces/${orgId}/members/invite`)
        .set('Cookie', owner.cookie)
        .send({
          email: 'public-lookup@local.com',
          role: 'editor',
          projectIds: [project1Id],
        });

      expect(createRes.status).toBe(201);
      const inviteId = String(createRes.body.id);

      const lookupRes = await harness.request().get(`/api/invitations/${inviteId}`);
      expect(lookupRes.status).toBe(200);

      // Exact top-level keys and nested organization keys
      expect(Object.keys(lookupRes.body).sort()).toEqual(
        ['emailHint', 'inviterName', 'organization', 'role', 'status'].sort(),
      );
      expect(Object.keys(lookupRes.body.organization)).toEqual(['name']);
      expect(lookupRes.body).toEqual({
        organization: { name: 'Invitation Test Workspace' },
        role: 'editor',
        inviterName: 'Owner Inviter',
        status: 'pending',
        emailHint: 'p***@local.com',
      });
      // The whole address never reaches someone who only holds the link.
      expect(JSON.stringify(lookupRes.body)).not.toContain('public-lookup');

      // Removed fields must not be present
      expect(lookupRes.body.id).toBeUndefined();
      expect(lookupRes.body.isExpired).toBeUndefined();
      expect(lookupRes.body.projectIds).toBeUndefined();
      expect(lookupRes.body.organization.id).toBeUndefined();
      expect(lookupRes.body.organization.slug).toBeUndefined();

      // Unknown invitation -> 404
      const missingRes = await harness
        .request()
        .get('/api/invitations/nonexistent-invitation-token-123456789012345');
      expect(missingRes.status).toBe(404);
      expect(missingRes.body.message).toMatch(/not valid or has expired/i);

      // An expired link keeps its page and reports one status; it never reveals anything else.
      await harness.prisma.invitation.update({
        where: { id: inviteId },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });
      const expiredRes = await harness.request().get(`/api/invitations/${inviteId}`);
      expect(expiredRes.status).toBe(200);
      expect(expiredRes.body.status).toBe('expired');

      // A revoked (or legacy canceled) invitation reports the same normalized status.
      await harness.prisma.invitation.update({
        where: { id: inviteId },
        data: { status: 'canceled', expiresAt: new Date(Date.now() + 3600_000) },
      });
      const canceledRes = await harness.request().get(`/api/invitations/${inviteId}`);
      expect(canceledRes.status).toBe(200);
      expect(canceledRes.body.status).toBe('revoked');
    });
  });

  describe('Schema: invitations carry no keys', () => {
    it('has dropped the invitation key columns and kept the membership and grant keys', async () => {
      const columns = await harness.prisma.$queryRawUnsafe<
        Array<{ table_name: string; column_name: string }>
      >(
        `SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name IN ('invitation', 'member', 'project_member')
           AND column_name IN ('encryptedOrgKey', 'encryptedProjectKeys', 'encryptedProjectKey')`,
      );

      const inventory = columns
        .map((column) => `${column.table_name}.${column.column_name}`)
        .sort();
      expect(inventory).toEqual(['member.encryptedOrgKey', 'project_member.encryptedProjectKey']);
    });
  });

  describe('H8: Atomic invitation acceptance & concurrency', () => {
    it('handles two concurrent accepts of one invitation with no 500, creating exactly one member row and one set of grants', async () => {
      const createRes = await harness
        .request()
        .post(`/api/workspaces/${orgId}/members/invite`)
        .set('Cookie', owner.cookie)
        .send({
          email: recipient.user.email,
          role: 'editor',
          projectIds: [project1Id, project2Id],
        });

      expect(createRes.status).toBe(201);
      const inviteId = String(createRes.body.id);

      const [res1, res2] = await Promise.all([
        harness
          .request()
          .post(`/api/invitations/${inviteId}/accept`)
          .set('Cookie', recipient.cookie),
        harness
          .request()
          .post(`/api/invitations/${inviteId}/accept`)
          .set('Cookie', recipient.cookie),
      ]);

      expect([200, 201]).toContain(res1.status);
      expect([200, 201]).toContain(res2.status);
      expect(res1.body.success).toBe(true);
      expect(res2.body.success).toBe(true);

      const members = await harness.prisma.member.findMany({
        where: { organizationId: orgId, userId: recipient.user.id },
      });
      expect(members).toHaveLength(1);
      expect(first(members).id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      // Invitations never carry a workspace key, and acceptance creates pending grants only.
      expect(first(members).encryptedOrgKey).toBeNull();
      // Exactly one of the two requests did the acceptance; the other reports it was already done.
      const claims = [res1.body, res2.body].filter((body) => !body.alreadyAccepted);
      expect(claims).toHaveLength(1);
      expect(claims[0].pendingProjectGrants).toBe(2);

      const grants = await harness.prisma.projectMember.findMany({
        where: { userId: recipient.user.id, projectId: { in: [project1Id, project2Id] } },
      });
      expect(grants).toHaveLength(2);
      for (const grant of grants) {
        expect(grant.encryptedProjectKey).toBeNull();
      }

      const updatedInvite = await harness.prisma.invitation.findUnique({
        where: { id: inviteId },
      });
      expect(updatedInvite?.status).toBe('accepted');

      const acceptedLookup = await harness.request().get(`/api/invitations/${inviteId}`);
      expect(acceptedLookup.status).toBe(200);
      expect(acceptedLookup.body.status).toBe('accepted');

      // Repeated accept by the same user returns alreadyAccepted: true without error
      const repeatRes = await harness
        .request()
        .post(`/api/invitations/${inviteId}/accept`)
        .set('Cookie', recipient.cookie)
        .send({});
      expect([200, 201]).toContain(repeatRes.status);
      expect(repeatRes.body).toMatchObject({
        success: true,
        alreadyAccepted: true,
        workspaceSlug: 'invitation-test-ws',
      });
    });

    it('rolls back member creation and invitation status if project grants insertion fails part-way through', async () => {
      const rollbackUser = await harness.signIn('rollback-user@local.com', 'Rollback User');

      const createRes = await harness
        .request()
        .post(`/api/workspaces/${orgId}/members/invite`)
        .set('Cookie', owner.cookie)
        .send({
          email: rollbackUser.user.email,
          role: 'editor',
          projectIds: [project1Id],
        });

      expect(createRes.status).toBe(201);
      const inviteId = String(createRes.body.id);

      const origTransaction = harness.prisma.$transaction.bind(harness.prisma);
      const txSpy = vi.spyOn(harness.prisma, '$transaction');
      txSpy.mockImplementationOnce(
        async (
          fn: Parameters<typeof origTransaction>[0],
          options?: Parameters<typeof origTransaction>[1],
        ) => {
          if (typeof fn !== 'function') {
            return origTransaction(fn);
          }
          return origTransaction(async (tx) => {
            vi.spyOn(tx.projectMember, 'createMany').mockImplementationOnce(() => {
              throw new Error('Simulated mid-transaction failure on projectMember.createMany');
            });
            return fn(tx);
          }, options);
        },
      );

      try {
        const failRes = await harness
          .request()
          .post(`/api/invitations/${inviteId}/accept`)
          .set('Cookie', rollbackUser.cookie);

        // Caught by AllExceptionsFilter -> opaque 500
        expect(failRes.status).toBe(500);
        expect(failRes.body).toEqual({
          statusCode: 500,
          message: 'Internal server error',
          error: 'Internal Server Error',
        });
      } finally {
        txSpy.mockRestore();
      }

      // Verify full rollback: no member row, no project grant, invitation still pending
      const memberAfterFailure = await harness.prisma.member.findFirst({
        where: { organizationId: orgId, userId: rollbackUser.user.id },
      });
      expect(memberAfterFailure).toBeNull();

      const grantsAfterFailure = await harness.prisma.projectMember.findMany({
        where: { userId: rollbackUser.user.id },
      });
      expect(grantsAfterFailure).toHaveLength(0);

      const inviteAfterFailure = await harness.prisma.invitation.findUnique({
        where: { id: inviteId },
      });
      expect(inviteAfterFailure?.status).toBe('pending');
    });

    it('rejects canceled, expired, and mismatched-email invitations without creating any membership', async () => {
      const targetUser = await harness.signIn('target-check@local.com', 'Target Check');

      const createRes = await harness
        .request()
        .post(`/api/workspaces/${orgId}/members/invite`)
        .set('Cookie', owner.cookie)
        .send({
          email: targetUser.user.email,
          role: 'editor',
          projectIds: [project1Id],
        });
      expect(createRes.status).toBe(201);
      const inviteId = String(createRes.body.id);

      // 0. Asked first, the invited account is told it is the recipient and any other is not
      const rightRecipientRes = await harness
        .request()
        .get(`/api/invitations/${inviteId}/recipient`)
        .set('Cookie', targetUser.cookie);
      expect(rightRecipientRes.body).toEqual({ isRecipient: true });
      const wrongRecipientRes = await harness
        .request()
        .get(`/api/invitations/${inviteId}/recipient`)
        .set('Cookie', wrongUser.cookie);
      expect(wrongRecipientRes.body).toEqual({ isRecipient: false });
      const signedOutRes = await harness.request().get(`/api/invitations/${inviteId}/recipient`);
      expect(signedOutRes.status).toBe(401);
      const unknownRes = await harness
        .request()
        .get('/api/invitations/nonexistent-invitation-token-123456789012345/recipient')
        .set('Cookie', targetUser.cookie);
      expect(unknownRes.status).toBe(404);

      // 1. Mismatched email -> 403
      const wrongEmailRes = await harness
        .request()
        .post(`/api/invitations/${inviteId}/accept`)
        .set('Cookie', wrongUser.cookie);
      expect(wrongEmailRes.status).toBe(403);

      // 2. Expired invitation -> 400
      await harness.prisma.invitation.update({
        where: { id: inviteId },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });
      const expiredRes = await harness
        .request()
        .post(`/api/invitations/${inviteId}/accept`)
        .set('Cookie', targetUser.cookie);
      expect(expiredRes.status).toBe(400);

      // 3. Canceled invitation -> 400
      await harness.prisma.invitation.update({
        where: { id: inviteId },
        data: { status: 'canceled', expiresAt: new Date(Date.now() + 3600_000) },
      });
      const canceledRes = await harness
        .request()
        .post(`/api/invitations/${inviteId}/accept`)
        .set('Cookie', targetUser.cookie);
      expect(canceledRes.status).toBe(400);

      // Confirm neither targetUser nor wrongUser became a member
      const createdMembers = await harness.prisma.member.findMany({
        where: {
          organizationId: orgId,
          userId: { in: [targetUser.user.id, wrongUser.user.id] },
        },
      });
      expect(createdMembers).toHaveLength(0);
    });
  });

  describe('H1: Better Auth organization route allowlist & bypass route closure', () => {
    it('enumerates all organization plugin endpoints and refuses every non-allowlisted organization route and delete-user while keeping allowlisted routes working', async () => {
      const authInstance = harness.app.get<Auth>(AUTH);
      const orgPlugin = organization();

      // Enumerate every HTTP endpoint exposed by the Better Auth organization plugin
      const rawEndpoints: Record<
        string,
        { path?: string; options?: { method?: string | string[] } }
      > = orgPlugin.endpoints;
      const orgEndpoints = Object.entries(rawEndpoints)
        .map(([key, endpoint]) => {
          const rawMethod = Array.isArray(endpoint.options?.method)
            ? endpoint.options.method[0]
            : endpoint.options?.method;
          return {
            key,
            path: endpoint.path,
            method: rawMethod === 'GET' ? ('GET' as const) : ('POST' as const),
          };
        })
        .filter((e): e is { key: string; path: string; method: 'GET' | 'POST' } => Boolean(e.path));

      expect(orgEndpoints.length).toBeGreaterThanOrEqual(20);

      // Verify auth.api also exposes these organization endpoints and that our allowlist + disabled list partition them
      const allOrgPaths = orgEndpoints.map((e) => e.path).sort();
      const configuredPartition = [
        ...ALLOWED_ORGANIZATION_PATHS,
        ...DISABLED_ORGANIZATION_PATHS,
      ].sort();
      expect(allOrgPaths).toEqual(configuredPartition);

      // 1. Every non-allowlisted organization route must answer 404 when called with a valid session
      const disallowedEndpoints = orgEndpoints.filter(
        (endpoint) => !(ALLOWED_ORGANIZATION_PATHS as readonly string[]).includes(endpoint.path),
      );
      const disallowedResults = await Promise.all(
        disallowedEndpoints.map(async (endpoint) => {
          const url = `/api/auth${endpoint.path}`;
          const req =
            endpoint.method === 'GET'
              ? harness.request().get(url)
              : harness.request().post(url).send({});
          const res = await req.set('Cookie', owner.cookie).set('Origin', 'http://localhost:5173');
          return { endpoint, url, status: res.status };
        }),
      );

      for (const { endpoint, url, status } of disallowedResults) {
        expect(
          [404, 403],
          `Expected ${endpoint.method} ${url} (${endpoint.key}) to be refused with 404/403, got ${status}`,
        ).toContain(status);
      }

      // 2. Core bypass route /api/auth/delete-user (and /api/auth/delete-user/callback) must be refused
      expect(authInstance.options.user?.deleteUser?.enabled).toBe(false);
      const deleteUserRes = await harness
        .request()
        .post('/api/auth/delete-user')
        .set('Cookie', owner.cookie)
        .set('Origin', 'http://localhost:5173')
        .send({});
      expect(deleteUserRes.status).toBe(404);

      const deleteUserCallbackRes = await harness
        .request()
        .get('/api/auth/delete-user/callback?token=some-token')
        .set('Cookie', owner.cookie);
      expect(deleteUserCallbackRes.status).toBe(404);

      // 3. The two allowlisted organization routes work with a valid session. Creation is
      //    disabled: the app's own POST /api/workspaces is the only way to make a workspace.
      const createOrgRes = await harness
        .request()
        .post('/api/auth/organization/create')
        .set('Cookie', owner.cookie)
        .set('Origin', 'http://localhost:5173')
        .send({ name: 'Disabled Org', slug: `disabled-org-${Date.now()}` });
      expect(createOrgRes.status).toBe(404);

      const listOrgRes = await harness
        .request()
        .get('/api/auth/organization/list')
        .set('Cookie', owner.cookie);
      expect(listOrgRes.status).toBe(200);
      expect(Array.isArray(listOrgRes.body)).toBe(true);

      const setActiveRes = await harness
        .request()
        .post('/api/auth/organization/set-active')
        .set('Cookie', owner.cookie)
        .set('Origin', 'http://localhost:5173')
        .send({ organizationId: orgId });
      expect(setActiveRes.status).toBe(200);

      // 4. Core session & OAuth endpoints remain functional: get-session, sign-in/social, link-social, sign-out
      const getSessionRes = await harness
        .request()
        .get('/api/auth/get-session')
        .set('Cookie', owner.cookie);
      expect(getSessionRes.status).toBe(200);
      expect(getSessionRes.body?.user?.id).toBe(owner.user.id);

      const signInSocialRes = await harness
        .request()
        .post('/api/auth/sign-in/social')
        .set('Origin', 'http://localhost:5173')
        .send({ provider: 'google', callbackURL: 'http://localhost:5173/workspace' });
      expect(signInSocialRes.status).toBe(200);
      expect(signInSocialRes.body?.url).toContain('accounts.google.com');

      const linkSocialRes = await harness
        .request()
        .post('/api/auth/link-social')
        .set('Cookie', owner.cookie)
        .set('Origin', 'http://localhost:5173')
        .send({ provider: 'google', callbackURL: 'http://localhost:5173/profile' });
      expect(linkSocialRes.status).toBe(200);
      expect(linkSocialRes.body?.url).toContain('accounts.google.com');

      const signOutTarget = await harness.signIn('signout-check@local.com', 'SignOut User');
      const signOutRes = await harness
        .request()
        .post('/api/auth/sign-out')
        .set('Cookie', signOutTarget.cookie)
        .set('Origin', 'http://localhost:5173')
        .send({});
      expect(signOutRes.status).toBe(200);
    });
  });
});
