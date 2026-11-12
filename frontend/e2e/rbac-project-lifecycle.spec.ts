import { test } from '@playwright/test';
import { Cast, type Access, type Canvas } from './rbac-cast';

/**
 * One project over its whole life: people join with different roles, are removed (which rotates
 * the key), come back, change roles, and use a device that has never seen their account. After
 * every step every canvas ever made is checked for every person.
 */
test.describe('Project access over time', { tag: '@journeys-2' }, () => {
  // A click that cannot find its target should fail with its name, not hang until the test ends.
  test.use({ actionTimeout: 30_000 });

  test('who can open and edit which canvas stays right through removals, returns and role changes', async ({
    browser,
    request,
  }) => {
    test.setTimeout(420_000);
    const cast = new Cast(browser, request);
    const project = 'Tech';

    const owner = await cast.person('owner');
    const pia = await cast.person('pia'); // Project Admin, only an Editor in the workspace
    const eve = await cast.person('eve'); // project Editor
    const vic = await cast.person('vic'); // project Viewer
    const xan = await cast.person('xan'); // in the workspace, never given the project

    await cast.startWorkspace(owner, project);
    const canvases: Canvas[] = [await cast.createCanvas(owner, project)];

    await cast.invite(owner, pia, [project]);
    await cast.invite(owner, eve, [project]);
    await cast.invite(owner, vic, [project]);
    await cast.invite(owner, xan);

    const access = await cast.openAccess(owner, project);
    await cast.grantPending(owner.page, access, pia.name);
    await cast.grantPending(owner.page, access, eve.name);
    await cast.grantPending(owner.page, access, vic.name);
    await cast.setProjectRole(owner.page, access, pia.name, 'admin');
    await cast.setProjectRole(owner.page, access, vic.name, 'viewer');

    const check = (
      table: { owner: Access; pia: Access; eve: Access; vic: Access; xan: Access },
      list: Canvas[] = canvases,
    ) =>
      cast.expectAccess(list, [
        [owner, () => table.owner],
        [pia, () => table.pia],
        [eve, () => table.eve],
        [vic, () => table.vic],
        [xan, () => table.xan],
      ]);

    // 1. Everyone has what their role says.
    await check({ owner: 'edit', pia: 'edit', eve: 'edit', vic: 'view', xan: 'none' });

    // 2. The Project Admin makes a canvas; the Owner and the others can open it.
    canvases.push(await cast.createCanvas(pia, project));
    await check({ owner: 'edit', pia: 'edit', eve: 'edit', vic: 'view', xan: 'none' });

    // 3. Eve is removed, which replaces the project's key. A canvas made afterwards must open for
    //    everyone who still has the project, and Eve is refused on all of them.
    const ownerAccess = await cast.openAccess(owner, project);
    await cast.unassign(owner.page, ownerAccess, eve.name);
    await cast.waitForRotation(owner, project);
    canvases.push(await cast.createCanvas(owner, project));
    await check({ owner: 'edit', pia: 'edit', eve: 'none', vic: 'view', xan: 'none' });

    // 4. The Project Admin brings Eve back as a Viewer: she reads canvases of every age.
    const piaAccess = await cast.openAddMembers(pia, project);
    await cast.assign(pia.page, piaAccess, eve, 'viewer');
    await check({ owner: 'edit', pia: 'edit', eve: 'view', vic: 'view', xan: 'none' });

    // 5. Promoted to Editor, Eve can edit them all; demoted again, she is read-only again.
    const promote = await cast.openAddMembers(pia, project);
    await cast.setProjectRole(pia.page, promote, eve.name, 'editor');
    await check({ owner: 'edit', pia: 'edit', eve: 'edit', vic: 'view', xan: 'none' });
    const demote = await cast.openAddMembers(pia, project);
    await cast.setProjectRole(pia.page, demote, eve.name, 'viewer');
    await check({ owner: 'edit', pia: 'edit', eve: 'view', vic: 'view', xan: 'none' });

    // 6. The Project Admin removes Vic. She cannot replace the key herself; the Owner's next visit
    //    does. Canvases made after that by both of them open for the people who remain.
    const removal = await cast.openAddMembers(pia, project);
    await cast.unassign(pia.page, removal, vic.name);
    await owner.page.goto(`/w/${cast.slug}`);
    await cast.waitForRotation(owner, project);
    canvases.push(await cast.createCanvas(pia, project));
    canvases.push(await cast.createCanvas(owner, project));
    await check({ owner: 'edit', pia: 'edit', eve: 'view', vic: 'none', xan: 'none' });

    // 7. The Project Admin on a device that has never seen the account opens every canvas.
    const newDevice = await cast.freshDevice(pia);
    await cast.expectAccess(canvases, [[newDevice, () => 'edit']]);
  });
});
