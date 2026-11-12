import { test, expect } from '@playwright/test';
import { Cast, type Access, type Canvas } from './rbac-cast';

test.describe('Joining a project, and the public link', { tag: '@journeys-2' }, () => {
  test.use({ actionTimeout: 30_000 });

  test('a Project Admin completes a pending invitation and assigns a workspace Viewer; each gets exactly what they were given', async ({
    browser,
    request,
  }) => {
    test.setTimeout(420_000);
    const cast = new Cast(browser, request);
    const project = 'Tech';

    const owner = await cast.person('owner');
    const pia = await cast.person('pia'); // Project Admin, only an Editor in the workspace
    const nia = await cast.person('nia'); // invited onto the project; her grant starts pending
    const wes = await cast.person('wes'); // invited as a workspace Viewer, onto nothing

    await cast.startWorkspace(owner, project);
    const canvases: Canvas[] = [await cast.createCanvas(owner, project)];
    await cast.invite(owner, pia, [project]);
    const access = await cast.openAccess(owner, project);
    await cast.grantPending(owner.page, access, pia.name);
    await cast.setProjectRole(owner.page, access, pia.name, 'admin');

    const check = (table: { owner: Access; pia: Access; nia: Access; wes: Access }) =>
      cast.expectAccess(canvases, [
        [owner, () => table.owner],
        [pia, () => table.pia],
        [nia, () => table.nia],
        [wes, () => table.wes],
      ]);

    // 1. Nia is invited onto the project and Wes into the workspace. Neither can open anything yet:
    //    a pending grant is not access.
    await cast.invite(owner, nia, [project]);
    await cast.invite(owner, wes, [], 'viewer');
    await check({ owner: 'edit', pia: 'edit', nia: 'waiting', wes: 'none' });

    // 2. The Project Admin, not an Owner, completes Nia's grant: she edits at once, on canvases
    //    made before she joined.
    const complete = await cast.openAddMembers(pia, project);
    await cast.grantPending(pia.page, complete, nia.name);
    await check({ owner: 'edit', pia: 'edit', nia: 'edit', wes: 'none' });

    // 3. Wes is assigned as a Viewer, then as an Editor, then as a Viewer again.
    const assign = await cast.openAddMembers(pia, project);
    await cast.assign(pia.page, assign, wes, 'viewer');
    await check({ owner: 'edit', pia: 'edit', nia: 'edit', wes: 'view' });
    const promote = await cast.openAddMembers(pia, project);
    await cast.setProjectRole(pia.page, promote, wes.name, 'editor');
    await check({ owner: 'edit', pia: 'edit', nia: 'edit', wes: 'edit' });
    const demote = await cast.openAddMembers(pia, project);
    await cast.setProjectRole(pia.page, demote, wes.name, 'viewer');

    // 4. Canvases made by the newcomer and by the Project Admin open for everyone allowed.
    canvases.push(await cast.createCanvas(nia, project));
    canvases.push(await cast.createCanvas(pia, project));
    await check({ owner: 'edit', pia: 'edit', nia: 'edit', wes: 'view' });
  });

  test('a public link keeps working through a key rotation and stops when it is turned off', async ({
    browser,
    request,
  }) => {
    test.setTimeout(300_000);
    const cast = new Cast(browser, request);
    const project = 'Tech';

    const owner = await cast.person('owner');
    const eve = await cast.person('eve');
    await cast.startWorkspace(owner, project);
    const shared = await cast.createCanvas(owner, project);
    await cast.invite(owner, eve, [project]);
    const access = await cast.openAccess(owner, project);
    await cast.grantPending(owner.page, access, eve.name);

    const link = await cast.publishLink(owner, shared);
    expect(link).toContain('/share/');
    expect((await cast.visitor(link)).opens, 'the link opens for a visitor').toBe(true);

    // Removing Eve replaces the project key; the link carries its own key, so it keeps working.
    await cast.unassign(owner.page, await cast.openAccess(owner, project), eve.name);
    await cast.waitForRotation(owner, project);
    expect((await cast.visitor(link)).opens, 'the link still opens after a rotation').toBe(true);
    await cast.expectAccess([shared], [[owner, () => 'edit']]);

    // Turned off, it is gone for the visitor, and the Owner still has the canvas.
    await cast.unpublishLink(owner, shared);
    expect((await cast.visitor(link)).opens, 'a revoked link does not open').toBe(false);
    await cast.expectAccess([shared], [[owner, () => 'edit']]);
  });
});
