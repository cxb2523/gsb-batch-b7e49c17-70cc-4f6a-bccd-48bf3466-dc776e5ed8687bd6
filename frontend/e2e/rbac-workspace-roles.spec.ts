import { test } from '@playwright/test';
import { Cast, type Access, type Canvas } from './rbac-cast';

/**
 * Roles in the workspace itself: an Editor becomes an Admin (and gets the workspace key), is
 * demoted again (which replaces the workspace key and every project key), becomes Owner when the
 * workspace is handed over, and a member is finally removed from the workspace. Two projects, so
 * "everything" and "only what you were given" are different answers. After every step every canvas
 * ever made is checked for every person.
 */
// Tagged so CI can run the slow access journeys in separate jobs (see e2e/README.md).
test.describe('Workspace roles over time', { tag: '@journeys-1' }, () => {
  test.use({ actionTimeout: 30_000 });

  test('Admin promotion, demotion, ownership transfer and removal leave every canvas with the right people', async ({
    browser,
    request,
  }) => {
    test.setTimeout(480_000);
    const cast = new Cast(browser, request);

    const owner = await cast.person('owner');
    const ann = await cast.person('ann'); // Editor in Tech, later Admin, Editor again, then Owner
    const ben = await cast.person('ben'); // Editor in Ops only, removed from the workspace at the end

    await cast.startWorkspace(owner, 'Tech');
    await cast.createProject(owner, 'Ops');
    const canvases: Canvas[] = [
      await cast.createCanvas(owner, 'Tech'),
      await cast.createCanvas(owner, 'Ops'),
    ];

    await cast.invite(owner, ann, ['Tech']);
    await cast.invite(owner, ben, ['Ops']);
    const techAccess = await cast.openAccess(owner, 'Tech');
    await cast.grantPending(owner.page, techAccess, ann.name);
    const opsAccess = await cast.openAccess(owner, 'Ops');
    await cast.grantPending(owner.page, opsAccess, ben.name);

    type Table = { owner: Access; ann: Access; ben: Access };
    /** What each person may do, by project. */
    const check = (tech: Table, ops: Table) =>
      cast.expectAccess(canvases, [
        [owner, (c) => (c.project === 'Tech' ? tech.owner : ops.owner)],
        [ann, (c) => (c.project === 'Tech' ? tech.ann : ops.ann)],
        [ben, (c) => (c.project === 'Tech' ? tech.ben : ops.ben)],
      ]);

    // 1. Each is where they were put.
    await check(
      { owner: 'edit', ann: 'edit', ben: 'none' },
      { owner: 'edit', ann: 'none', ben: 'edit' },
    );

    // 2. Ann becomes an Admin: she is handed the workspace key and opens everything, and a canvas
    //    she makes in Ops opens for Ben and the Owner.
    await cast.setWorkspaceRole(owner, ann.name, 'admin');
    await check(
      { owner: 'edit', ann: 'edit', ben: 'none' },
      { owner: 'edit', ann: 'edit', ben: 'edit' },
    );
    canvases.push(await cast.createCanvas(ann, 'Ops'));
    await check(
      { owner: 'edit', ann: 'edit', ben: 'none' },
      { owner: 'edit', ann: 'edit', ben: 'edit' },
    );

    // 3. Ann is demoted: the workspace key and every project key are replaced. She keeps Tech, which
    //    she was given, and loses Ops, which she only had as an Admin. Canvases made afterwards by
    //    the Owner, in both projects, follow the same rule.
    await cast.setWorkspaceRole(owner, ann.name, 'editor');
    await cast.waitForRotation(owner, 'Tech', 'Ops');
    canvases.push(await cast.createCanvas(owner, 'Tech'));
    canvases.push(await cast.createCanvas(owner, 'Ops'));
    await check(
      { owner: 'edit', ann: 'edit', ben: 'none' },
      { owner: 'edit', ann: 'none', ben: 'edit' },
    );

    // 4. Ann is promoted again and the workspace is handed to her. Both Owners-to-be open and edit
    //    everything, including what each makes after the hand-over.
    await cast.setWorkspaceRole(owner, ann.name, 'admin');
    await cast.transferOwnership(owner, ann.name);
    canvases.push(await cast.createCanvas(ann, 'Tech'));
    canvases.push(await cast.createCanvas(owner, 'Ops'));
    await check(
      { owner: 'edit', ann: 'edit', ben: 'none' },
      { owner: 'edit', ann: 'edit', ben: 'edit' },
    );

    // 5. The new Owner removes Ben from the workspace: he is refused everywhere, and a canvas made
    //    afterwards still opens for the two who remain.
    await cast.removeFromWorkspace(ann, ben.name);
    await cast.waitForRotation(ann, 'Tech', 'Ops');
    canvases.push(await cast.createCanvas(ann, 'Ops'));
    await check(
      { owner: 'edit', ann: 'edit', ben: 'none' },
      { owner: 'edit', ann: 'edit', ben: 'none' },
    );

    // 6. Ben is invited back to Ops and given it again: he opens every Ops canvas, old and new
    //    (his new key reaches back through the key history), and still nothing in Tech.
    await cast.invite(ann, ben, ['Ops']);
    const opsAgain = await cast.openAccess(ann, 'Ops');
    await cast.grantPending(ann.page, opsAgain, ben.name);
    await check(
      { owner: 'edit', ann: 'edit', ben: 'none' },
      { owner: 'edit', ann: 'edit', ben: 'edit' },
    );

    // 7. The new Owner on a device that has never seen the account opens everything.
    const newDevice = await cast.freshDevice(ann);
    await cast.expectAccess(canvases, [[newDevice, () => 'edit']]);
  });
});
