import {
  expect,
  type Response,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
import { createTestUserSession, unlockWorkspaceSession } from './e2ee-test-helpers';
import { API_URL } from './constants';

/**
 * A small cast of people for access-control journeys. Each scenario sets the cast up through the
 * screens people really use (so every key is wrapped in a browser), changes who may do what, and
 * after every change asks the same question of every canvas ever made: who can open it, who can
 * edit it, and who is refused. A wrong answer anywhere fails the run, which is how a canvas that
 * nobody could open after a key rotation would have been caught.
 */

export const PASSPHRASE = 'RbacCastPassphrase123!';
export const CANVAS = 'canvas.excalidraw__canvas.interactive';
export const CANNOT_DECRYPT = 'Could not decrypt this canvas';

/**
 * What a person may do with a canvas. `waiting` is a grant that has no key yet: the app says so and
 * shows nothing; the server still hands over the encrypted record, which cannot be opened.
 */
export type Access = 'edit' | 'view' | 'none' | 'waiting';

export interface Person {
  /** The name shown in lists, unique to this run. */
  name: string;
  email: string;
  userId: string;
  context: BrowserContext;
  page: Page;
}

export interface Canvas {
  id: string;
  project: string;
}

export async function completePassphrase(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/setup-passphrase/, { timeout: 15000 });
  await page.fill('#passphrase', PASSPHRASE);
  await page.fill('#confirm-passphrase', PASSPHRASE);
  await page.check('#acknowledge-recovery');
  await page.click('#submit-passphrase-btn');
}

const sameResponse = (method: string, part: string) => (r: Response) =>
  r.url().includes(part) && r.request().method() === method;

export class Cast {
  slug = '';
  workspaceId = '';
  readonly stamp = Date.now();

  private readonly browser: Browser;
  private readonly request: APIRequestContext;

  constructor(browser: Browser, request: APIRequestContext) {
    this.browser = browser;
    this.request = request;
  }

  /** A signed-in person who has not joined anything yet. */
  async person(label: string): Promise<Person> {
    const context = await this.browser.newContext();
    const page = await context.newPage();
    const user = await createTestUserSession(
      this.request,
      context,
      `${label}_${this.stamp}@canvhq.internal`,
      `${label} ${this.stamp}`,
    );
    return {
      name: `${label} ${this.stamp}`,
      email: user.email,
      userId: user.userId,
      context,
      page,
    };
  }

  /** The same account on a device that has never seen it: locked until the passphrase is given. */
  async freshDevice(person: Person): Promise<Person> {
    const context = await this.browser.newContext();
    const page = await context.newPage();
    await createTestUserSession(this.request, context, person.email, person.name);
    await page.goto(`/w/${this.slug}`);
    await unlockWorkspaceSession(page, PASSPHRASE, false);
    return { ...person, context, page };
  }

  async startWorkspace(owner: Person, projectName: string): Promise<void> {
    const { page } = owner;
    await page.goto('/create-workspace');
    await completePassphrase(page);
    await expect(page).toHaveURL(/\/create-workspace/, { timeout: 20000 });
    await page.fill('#workspace-name', `Cast ${this.stamp}`);
    await page.fill('#project-name', projectName);
    await page.click('button[id="submit-btn"]');
    await expect(page).toHaveURL(/\/w\//, { timeout: 25000 });
    this.slug = new URL(page.url()).pathname.split('/')[2] ?? '';
    const workspace = await page.context().request.get(`${API_URL}/api/workspaces/${this.slug}`);
    this.workspaceId = (await workspace.json()).id;
  }

  /** The Owner invites `who` (optionally onto projects) and `who` accepts, setting a passphrase. */
  async invite(
    owner: Person,
    who: Person,
    projects: string[] = [],
    role: 'editor' | 'viewer' = 'editor',
  ): Promise<void> {
    const { page } = owner;
    await page.goto(`/w/${this.slug}/management`);
    await page.getByRole('button', { name: /Invite member/i }).click();
    await page.fill('#invite-email', who.email);
    await page.selectOption('#invite-role', role);
    await Promise.all(
      projects.map((name) =>
        page.locator(`label:has-text("${name}") input[type="checkbox"]`).check(),
      ),
    );
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/members/invite') && r.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Send Invite' }).click(),
    ]);
    expect(response.status()).toBe(201);
    const link: string = (await response.json()).inviteUrl;

    await who.page.goto(link);
    // Somebody coming back already has a passphrase and is let straight in.
    await who.page.waitForURL(/\/(setup-passphrase|w\/)/, { timeout: 20000 });
    if (who.page.url().includes('/setup-passphrase')) await completePassphrase(who.page);
    await expect(who.page).toHaveURL(/\/w\//, { timeout: 25000 });
  }

  /** Opens a project's access dialog from Workspace Management (Owners and Admins). */
  async openAccess(admin: Person, project: string): Promise<Locator> {
    const { page } = admin;
    await page.goto(`/w/${this.slug}/management`);
    const row = page
      .locator('#projects div')
      .filter({ hasText: project })
      .filter({ has: page.getByRole('button', { name: /Manage Access/ }) })
      .last();
    await row.getByRole('button', { name: /Manage Access/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(`Project Access · ${project}`)).toBeVisible({ timeout: 15000 });
    return dialog;
  }

  /** Opens the same dialog from inside a project ("Add members"), as a Project Admin does. */
  async openAddMembers(person: Person, project: string): Promise<Locator> {
    const { page } = person;
    await this.selectProject(page, project);
    await page.getByRole('button', { name: 'Add members' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(`Project Access · ${project}`)).toBeVisible({ timeout: 15000 });
    return dialog;
  }

  async grantPending(page: Page, dialog: Locator, name: string): Promise<void> {
    await dialog
      .locator('.grid', { hasText: name })
      .getByRole('button', { name: 'Grant access' })
      .click();
    const confirm = page.getByRole('dialog', { name: /Grant access to/ });
    await expect(confirm).toBeVisible({ timeout: 15000 });
    await Promise.all([
      page.waitForResponse(sameResponse('POST', '/members')),
      confirm.getByRole('button', { name: 'Confirm and grant' }).click(),
    ]);
    await expect(confirm).toHaveCount(0);
  }

  async setProjectRole(
    page: Page,
    dialog: Locator,
    name: string,
    role: 'admin' | 'editor' | 'viewer',
  ): Promise<void> {
    await Promise.all([
      page.waitForResponse(sameResponse('PATCH', '/members/')),
      dialog.locator(`select[aria-label="Role for ${name}"]`).selectOption(role),
    ]);
  }

  async assign(
    page: Page,
    dialog: Locator,
    who: Person,
    role: 'admin' | 'editor' | 'viewer',
  ): Promise<void> {
    await dialog
      .getByLabel('Workspace member to assign')
      .selectOption({ label: `${who.name} (${who.email})` });
    await dialog.getByLabel('Project role').selectOption(role);
    await Promise.all([
      page.waitForResponse(sameResponse('POST', '/members')),
      dialog.getByRole('button', { name: 'Assign Member' }).click(),
    ]);
    await expect(dialog.locator(`select[aria-label="Role for ${who.name}"]`)).toBeVisible({
      timeout: 15000,
    });
  }

  async unassign(page: Page, dialog: Locator, name: string): Promise<void> {
    await Promise.all([
      page.waitForResponse(sameResponse('DELETE', '/members/')),
      dialog.locator('.grid', { hasText: name }).getByTitle('Unassign from project').click(),
    ]);
    await expect(dialog.locator('.grid', { hasText: name })).toHaveCount(0, { timeout: 15000 });
  }

  /** Changes somebody's role in the workspace, from Workspace Management. */
  async setWorkspaceRole(
    admin: Person,
    name: string,
    role: 'admin' | 'editor' | 'viewer',
  ): Promise<void> {
    const { page } = admin;
    await page.goto(`/w/${this.slug}/management`);
    await Promise.all([
      page.waitForResponse(sameResponse('PATCH', '/members/')),
      page.locator('#members').locator(`select[aria-label="Role for ${name}"]`).selectOption(role),
    ]);
  }

  /** The Owner hands the workspace to an Admin, who becomes Owner; the old Owner becomes Admin. */
  async transferOwnership(owner: Person, toName: string): Promise<void> {
    const { page } = owner;
    await page.goto(`/w/${this.slug}/management`);
    await page
      .locator('#members div')
      .filter({ hasText: toName })
      .filter({ has: page.getByRole('button', { name: 'Transfer ownership' }) })
      .last()
      .getByRole('button', { name: 'Transfer ownership' })
      .click();
    const dialog = page.getByRole('dialog');
    await Promise.all([
      page.waitForResponse(sameResponse('POST', '/transfer-ownership')),
      dialog.getByRole('button', { name: 'Transfer ownership' }).click(),
    ]);
  }

  /** A member erases their own account from their profile. */
  async deleteAccount(person: Person): Promise<void> {
    const { page } = person;
    await page.goto('/profile');
    await page.getByRole('button', { name: 'Delete Personal Account' }).click();
    await page.getByPlaceholder('DELETE').fill('DELETE');
    await page.getByRole('button', { name: 'Permanently Delete Account' }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 30000 });
  }

  /** Takes somebody out of the workspace altogether. */
  async removeFromWorkspace(admin: Person, name: string): Promise<void> {
    const { page } = admin;
    await page.goto(`/w/${this.slug}/management`);
    await page
      .locator('#members div')
      .filter({ hasText: name })
      .filter({ has: page.getByTitle('Remove member') })
      .last()
      .getByTitle('Remove member')
      .click();
    await Promise.all([
      page.waitForResponse(sameResponse('DELETE', '/members/')),
      page.getByRole('dialog').getByRole('button', { name: 'Remove Member' }).click(),
    ]);
  }

  async createProject(owner: Person, name: string): Promise<void> {
    const { page } = owner;
    await page.goto(`/w/${this.slug}`);
    await page.locator('aside').getByRole('button', { name: '+' }).click();
    await page.getByPlaceholder('Project name...').fill(name);
    await Promise.all([
      page.waitForResponse(sameResponse('POST', '/api/projects')),
      page.getByRole('button', { name: 'Add', exact: true }).click(),
    ]);
    await expect(page.locator('aside').getByText(name, { exact: true })).toBeVisible({
      timeout: 15000,
    });
  }

  /** The dashboard with `project` selected in the sidebar. */
  async selectProject(page: Page, project: string): Promise<void> {
    await page.goto(`/w/${this.slug}`);
    await page.locator('aside').getByText(project, { exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: project })).toBeAttached({
      timeout: 15000,
    });
  }

  /** Turns the public link on for a canvas and returns it (the key rides in the fragment). */
  async publishLink(person: Person, canvas: Canvas): Promise<string> {
    const { page, context } = person;
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(`/w/${this.slug}/canvas/${canvas.id}`);
    await expect(page.locator(CANVAS).first()).toBeVisible({ timeout: 20000 });
    await page.getByTitle('Share Canvas').click();
    await Promise.all([
      page.waitForResponse(sameResponse('POST', '/public-share')),
      page.getByRole('switch', { name: /public link/i }).click(),
    ]);
    await page.getByRole('button', { name: /Copy Public Link/i }).click();
    return page.evaluate(() => navigator.clipboard.readText());
  }

  async unpublishLink(person: Person, canvas: Canvas): Promise<void> {
    const { page } = person;
    await page.goto(`/w/${this.slug}/canvas/${canvas.id}`);
    await expect(page.locator(CANVAS).first()).toBeVisible({ timeout: 20000 });
    await page.getByTitle('Share Canvas').click();
    await Promise.all([
      page.waitForResponse(sameResponse('DELETE', '/public-share')),
      page.getByRole('switch', { name: /public link/i }).click(),
    ]);
  }

  /** A visitor with no account opens a public link. */
  async visitor(link: string): Promise<{ opens: boolean; context: BrowserContext }> {
    const context = await this.browser.newContext();
    const page = await context.newPage();
    await page.goto(link);
    const opens = await page
      .locator(CANVAS)
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(
        () => true,
        () => false,
      );
    return { opens, context };
  }

  /** Opens a project from the dashboard and creates a canvas in it, drawing one shape. */
  async createCanvas(person: Person, project: string): Promise<Canvas> {
    const { page } = person;
    await this.selectProject(page, project);
    await page
      .getByRole('button', { name: /New Canvas/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/canvas\//, { timeout: 20000 });
    await expect(page.locator(CANVAS).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(CANNOT_DECRYPT)).toHaveCount(0);
    const id = new URL(page.url()).pathname.split('/').pop() ?? '';
    await drawRectangle(page);
    return { id, project };
  }

  /**
   * Waits until every project key that was flagged for rotation has been replaced. Rotation is
   * done by an Owner's or Admin's browser, so the test waits for it rather than guessing a delay.
   */
  async waitForRotation(admin: Person, ...projects: string[]): Promise<void> {
    const headers = { 'active-organization': this.workspaceId };
    await expect
      .poll(
        async () => {
          const res = await admin.context.request.get(`${API_URL}/api/projects?page=1&limit=100`, {
            headers,
          });
          const body = await res.json();
          const items: Array<{ name: string; keyRotationDue?: boolean }> = body.items ?? body;
          const workspace = await admin.context.request.get(
            `${API_URL}/api/workspaces/${this.slug}`,
          );
          const projectsDone = projects.every(
            (name) => items.find((p) => p.name === name)?.keyRotationDue === false,
          );
          return projectsDone && (await workspace.json()).keyRotationDue !== true;
        },
        { timeout: 60000, message: `${projects.join(', ')} key was not rotated` },
      )
      .toBe(true);
  }

  /** The question every scenario asks: for each person, what may they do with this canvas? */
  async expectAccess(
    canvases: Canvas[],
    expected: Array<[Person, (canvas: Canvas) => Access]>,
  ): Promise<void> {
    // Everyone is checked at once, but an edit is really saved only on the newest canvas, and one
    // person at a time: two people saving the same canvas together is a conflict by design.
    const newest = canvases[canvases.length - 1];
    await Promise.all(
      expected.map(([person, accessFor]) =>
        canvases.reduce(
          (previous, canvas) =>
            previous.then(() => {
              const access = accessFor(canvas);
              const saveHere = canvas === newest && access === 'edit';
              const check = () => this.expectOne(person, canvas, access, saveHere);
              // Open and save inside the same turn, so what is saved is built on the latest copy.
              return saveHere ? this.takeTurn(check) : check();
            }),
          Promise.resolve(),
        ),
      ),
    );
  }

  private saves: Promise<void> = Promise.resolve();

  private takeTurn(work: () => Promise<void>): Promise<void> {
    const turn = this.saves.then(work);
    this.saves = turn.catch(() => undefined);
    return turn;
  }

  private async expectOne(
    person: Person,
    canvas: Canvas,
    access: Access,
    saveHere: boolean,
  ): Promise<void> {
    const { page, context, name } = person;
    const label = `${name} on ${canvas.project}/${canvas.id}`;
    const board = `${API_URL}/api/boards/${canvas.id}`;
    const headers = { 'active-organization': this.workspaceId };

    await page.goto(`/w/${this.slug}/canvas/${canvas.id}`);

    if (access === 'waiting') {
      await expect(page.getByText('Waiting for access'), `${label}: told to wait`).toBeVisible({
        timeout: 15000,
      });
      await expect(page.locator(CANVAS), `${label}: nothing to show yet`).toHaveCount(0);
      return;
    }

    if (access === 'none') {
      await expect(page.locator(CANVAS), `${label}: must not open`).toHaveCount(0, {
        timeout: 15000,
      });
      await expect(page.getByText(CANNOT_DECRYPT), `${label}: refused, not broken`).toHaveCount(0);
      const res = await context.request.get(board, { headers });
      expect([403, 404], `${label}: server refuses the canvas`).toContain(res.status());
      return;
    }

    await expect(page.locator(CANVAS).first(), `${label}: must open`).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByText(CANNOT_DECRYPT), `${label}: must decrypt`).toHaveCount(0);
    await expect(
      page.getByText(/Unsaved changes from/),
      `${label}: no leftover local copy of a saved canvas`,
    ).toHaveCount(0);

    if (access === 'view') {
      await expect(
        page.getByText('Read-Only', { exact: true }),
        `${label}: read-only`,
      ).toBeVisible();
      const write = await context.request.put(`${board}/payload`, {
        headers: {
          ...headers,
          'x-board-revision': '0',
          'content-type': 'application/octet-stream',
        },
        data: Buffer.from([1]),
      });
      expect(write.status(), `${label}: server refuses a write`).toBe(403);
      return;
    }

    await expect(page.getByText('Read-Only', { exact: true }), `${label}: editable`).toHaveCount(0);
    await expect(
      page.locator('button[aria-label="Rectangle"]'),
      `${label}: has the tools`,
    ).toBeVisible();
    if (saveHere) await drawRectangle(page);
  }
}

export async function drawRectangle(page: Page): Promise<void> {
  const box = await page.locator(CANVAS).first().boundingBox();
  if (!box) throw new Error('Excalidraw canvas has no bounding box');
  await page.locator('button[aria-label="Rectangle"]').click();
  // The "Saved" pill is already showing before the edit counts as unsaved, so it proves nothing:
  // wait for the save request itself, or the next page load cuts the save short.
  const saved = page.waitForResponse(
    (r) => r.url().includes('/payload') && r.request().method() === 'PUT' && r.status() === 200,
    { timeout: 20000 },
  );
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4 + 120, box.y + box.height * 0.4 + 80, {
    steps: 10,
  });
  await page.mouse.up();
  await saved;
  await expect(page.locator('header').locator('text=Saved')).toBeVisible({ timeout: 15000 });
}
