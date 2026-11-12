import { API_URL, BASE_URL } from './constants';

const TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 1_000;
/** The dev server reloads in bursts; require several consecutive good answers before starting. */
const QUIET_ANSWERS = 3;

async function answers(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitUntilQuiet(url: string): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  let consecutive = 0;
  while (Date.now() < deadline) {
    consecutive = (await answers(url)) ? consecutive + 1 : 0;
    if (consecutive >= QUIET_ANSWERS) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(
    `${url} did not answer ${QUIET_ANSWERS} times in a row within ${TIMEOUT_MS / 1000}s. ` +
      'Start the stack with `docker compose up` (see e2e/README.md).',
  );
}

export default async function globalSetup(): Promise<void> {
  await waitUntilQuiet(`${API_URL}/api/health`);
  await waitUntilQuiet(BASE_URL);
}
