import {
  type Page,
  type BrowserContext,
  type APIRequestContext,
  type APIResponse,
  expect,
} from '@playwright/test';
import { API_URL, COOKIE_DOMAIN } from './constants';

export interface TestUser {
  email: string;
  name: string;
  token: string;
  userId: string;
}

/**
 * The production image has no dev login. With `E2E_DEMO_SESSIONS=true` a session is a throwaway
 * demo account instead (the same "Try the demo" sign-in a visitor uses), and the returned `email`
 * is the address that account was given, not the one the spec asked for. Specs that invite someone
 * must therefore create that person's session first and invite the address it reports.
 */
async function createDemoUserSession(context: BrowserContext, name: string): Promise<TestUser> {
  // The context's own request client keeps the session cookie in that context only, so each
  // account is a separate visitor.
  const signIn = async (attemptsLeft: number): Promise<APIResponse> => {
    const res = await context.request.post(`${API_URL}/api/auth/sign-in/anonymous`, {
      data: '{}',
      // Better Auth only accepts a sign-in that names a trusted origin, as a browser's would.
      headers: { origin: API_URL, 'content-type': 'application/json' },
    });
    if (res.status() !== 429 || attemptsLeft === 0) return res;
    // The sign-in routes have their own limiter in production; wait as long as it asks.
    const wait = Number(res.headers()['x-retry-after'] ?? 5);
    await new Promise((resolve) => setTimeout(resolve, (wait + 1) * 1000));
    return signIn(attemptsLeft - 1);
  };
  const res = await signIn(8);
  expect(res.ok(), `demo sign-in failed with ${res.status()}: ${await res.text()}`).toBeTruthy();

  const json = await res.json();
  return { email: json.user.email, name, token: '', userId: json.user.id };
}

/**
 * Creates a test user session using the dev-login bypass and attaches the session cookie to the browser context.
 */
export async function createTestUserSession(
  request: APIRequestContext,
  context: BrowserContext,
  email: string,
  name: string,
): Promise<TestUser> {
  if (process.env.E2E_DEMO_SESSIONS === 'true') {
    return createDemoUserSession(context, name);
  }
  const res = await request.post(`${API_URL}/api/auth/dev-login`, {
    data: { email, name },
  });
  expect(
    res.status(),
    'dev-login was rate limited: run the stack with RATE_LIMIT_ENABLED=false (see e2e/README.md)',
  ).not.toBe(429);
  expect(res.ok()).toBeTruthy();

  const json = await res.json();
  const token = json.session?.signedToken || json.session?.token;
  const userId = json.user?.id;
  expect(token).toBeTruthy();
  expect(userId).toBeTruthy();

  await context.addCookies([
    {
      name: 'better-auth.session_token',
      value: token,
      domain: COOKIE_DOMAIN,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  return { email, name, token, userId };
}

/**
 * Completes the first-time passphrase page. An authenticated user without an identity key is
 * redirected there (`/setup-passphrase?next=…`) before any other protected page.
 */
export async function completePassphrasePage(page: Page, passphrase: string): Promise<void> {
  await expect(page).toHaveURL(/\/setup-passphrase/, { timeout: 15000 });
  await page.fill('#passphrase', passphrase);
  await page.fill('#confirm-passphrase', passphrase);
  await page.check('#acknowledge-recovery');
  await page.click('#submit-passphrase-btn');
}

/**
 * Unlocks the workspace session using the current passphrase.
 */
export async function unlockWorkspaceSession(
  page: Page,
  passphrase: string,
  expectError: boolean = false,
): Promise<void> {
  const unlockInput = page.locator('#current-encryption-passphrase');
  await expect(unlockInput).toBeVisible({ timeout: 10000 });
  await unlockInput.fill(passphrase);

  const submitBtn = page.locator('form:has(#current-encryption-passphrase) button[type="submit"]');
  await submitBtn.click();

  if (expectError) {
    // Key derivation (PBKDF2, 600k iterations) is slow on a loaded machine.
    await expect(page.locator('text=Incorrect passphrase.')).toBeVisible({ timeout: 20000 });
  } else {
    await expect(page.locator('#current-encryption-passphrase')).not.toBeVisible({
      timeout: 15000,
    });
  }
}

/**
 * Inspects the cached CryptoKey inside the canvhq_e2ee IndexedDB store.
 */
export async function queryIndexedDBKey(page: Page, userId: string) {
  return page.evaluate(async (uid) => {
    return new Promise<{
      exists: boolean;
      extractable?: boolean;
      algorithm?: string;
      type?: string;
    }>((resolve) => {
      const req = window.indexedDB.open('canvhq_e2ee', 1);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('identity_keys')) {
          return resolve({ exists: false });
        }
        const tx = db.transaction('identity_keys', 'readonly');
        const store = tx.objectStore('identity_keys');
        const getReq = store.get(uid);
        getReq.onsuccess = () => {
          const res = getReq.result;
          if (!res || !res.key) {
            return resolve({ exists: false });
          }
          return resolve({
            exists: true,
            extractable: res.key.extractable,
            algorithm: res.key.algorithm?.name,
            type: res.key.type,
          });
        };
        getReq.onerror = () => resolve({ exists: false });
      };
      req.onerror = () => resolve({ exists: false });
    });
  }, userId);
}

/**
 * Attempts to extract/export the cached private key from IndexedDB to verify non-extractability.
 */
export async function attemptKeyExport(page: Page, userId: string) {
  return page.evaluate(async (uid) => {
    return new Promise<{
      found: boolean;
      extractable?: boolean;
      exported?: boolean;
      errorName?: string;
      errorMessage?: string;
    }>((resolve) => {
      const req = window.indexedDB.open('canvhq_e2ee', 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('identity_keys', 'readonly');
        const store = tx.objectStore('identity_keys');
        const getReq = store.get(uid);
        getReq.onsuccess = async () => {
          const key = getReq.result?.key;
          if (!key) return resolve({ found: false });
          try {
            await window.crypto.subtle.exportKey('pkcs8', key);
            resolve({ found: true, extractable: key.extractable, exported: true });
          } catch (err: any) {
            resolve({
              found: true,
              extractable: key.extractable,
              exported: false,
              errorName: err.name,
              errorMessage: err.message,
            });
          }
        };
        getReq.onerror = () => resolve({ found: false });
      };
      req.onerror = () => resolve({ found: false });
    });
  }, userId);
}

/**
 * Counts the number of keys stored in the canvhq_e2ee identity_keys store.
 */
export async function countIndexedDBKeys(page: Page): Promise<number> {
  return page.evaluate(async () => {
    return new Promise<number>((resolve) => {
      const req = window.indexedDB.open('canvhq_e2ee', 1);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('identity_keys')) return resolve(0);
        const tx = db.transaction('identity_keys', 'readonly');
        const store = tx.objectStore('identity_keys');
        const countReq = store.count();
        countReq.onsuccess = () => resolve(countReq.result);
        countReq.onerror = () => resolve(0);
      };
      req.onerror = () => resolve(0);
    });
  });
}
