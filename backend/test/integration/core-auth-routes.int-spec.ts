import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createIntegrationHarness, type IntegrationHarness } from './harness.js';
import { ALLOWED_CORE_PATHS, AUTH, DISABLED_CORE_PATHS, type Auth } from '../../src/auth/auth.js';

interface AuthEndpoint {
  path?: string;
}

/**
 * Batch 8 decided about the organization plugin's routes. This does the same for the library's
 * core: every route it registers is either allowed on purpose or disabled on purpose, and a
 * library upgrade that adds one fails here until somebody decides.
 */
describe('Better Auth core route allowlist (Integration)', () => {
  let harness: IntegrationHarness;
  let corePaths: string[];

  beforeAll(async () => {
    harness = await createIntegrationHarness();
    const auth = harness.app.get<Auth>(AUTH);

    corePaths = Object.values(auth.api as Record<string, AuthEndpoint>)
      .map((endpoint) => endpoint?.path)
      .filter((path): path is string => typeof path === 'string')
      .filter((path) => !path.startsWith('/organization'))
      .sort();
  });

  afterAll(async () => {
    if (harness) await harness.close();
  });

  it('core route allowlist: every registered core route is either allowed or disabled', () => {
    const allowed = new Set<string>(ALLOWED_CORE_PATHS);
    const disabled = new Set<string>(DISABLED_CORE_PATHS);

    expect(corePaths.length).toBeGreaterThan(20);

    const undecided = corePaths.filter((path) => !allowed.has(path) && !disabled.has(path));
    expect(undecided).toEqual([]);

    const both = corePaths.filter((path) => allowed.has(path) && disabled.has(path));
    expect(both).toEqual([]);
  });

  it('core route allowlist: every disabled path still exists in the installed library', () => {
    const core = new Set(corePaths);
    const stale = DISABLED_CORE_PATHS.filter((path) => !core.has(path));
    expect(stale).toEqual([]);
  });

  it('core route allowlist: a disabled route answers 404 and an allowed one answers normally', async () => {
    const disabled = await harness.request().get('/api/auth/list-sessions');
    expect(disabled.status).toBe(404);

    const updateUser = await harness.request().post('/api/auth/update-user').send({ name: 'x' });
    expect(updateUser.status).toBe(404);

    const ok = await harness.request().get('/api/auth/ok');
    expect(ok.status).toBe(200);

    const user = await harness.signIn('core-routes@local.com', 'Core Routes');
    const session = await harness.request().get('/api/auth/get-session').set('Cookie', user.cookie);
    expect(session.status).toBe(200);
    expect(session.body?.user?.id).toBe(user.user.id);
  });
});
