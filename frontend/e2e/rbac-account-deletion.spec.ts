import { test } from '@playwright/test';
import { Cast, type Canvas } from './rbac-cast';

test.describe('A member erases their account', { tag: '@journeys-1' }, () => {
  test.use({ actionTimeout: 30_000 });

  test('what they made stays openable for everyone else, and the project keeps working', async ({
    browser,
    request,
  }) => {
    test.setTimeout(360_000);
    const cast = new Cast(browser, request);
    const project = 'Tech';

    const owner = await cast.person('owner');
    const pia = await cast.person('pia'); // Project Admin; leaves by erasing the account
    const eve = await cast.person('eve'); // project Editor
    await cast.startWorkspace(owner, project);
    await cast.invite(owner, pia, [project]);
    await cast.invite(owner, eve, [project]);
    const access = await cast.openAccess(owner, project);
    await cast.grantPending(owner.page, access, pia.name);
    await cast.grantPending(owner.page, access, eve.name);
    await cast.setProjectRole(owner.page, access, pia.name, 'admin');

    const canvases: Canvas[] = [
      await cast.createCanvas(owner, project),
      await cast.createCanvas(pia, project),
      await cast.createCanvas(eve, project),
    ];
    const check = () =>
      cast.expectAccess(canvases, [
        [owner, () => 'edit'],
        [eve, () => 'edit'],
      ]);
    await check();

    // Pia erases her account. The canvas she made is not hers to take with her.
    await cast.deleteAccount(pia);
    await owner.page.goto(`/w/${cast.slug}`);
    await cast.waitForRotation(owner, project);
    await check();

    // And the project carries on: new canvases open for the two who remain.
    canvases.push(await cast.createCanvas(eve, project));
    canvases.push(await cast.createCanvas(owner, project));
    await check();
  });
});
