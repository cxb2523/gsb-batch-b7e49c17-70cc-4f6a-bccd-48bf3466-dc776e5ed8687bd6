// Contract for opt-in local API auth (server/src/local-auth.ts + http/pairing-routes.ts): with
// requireAuth on, /api/* refuses a caller with no credential, accepts the cookie file the CLI and
// MCP shim send, and lets a browser in only after the OTP pairing handshake - until revoked. The
// paired key is a Bearer header, never a cookie (cookies ignore the port, so the user's other
// localhost dev servers would receive it); the stream takes a single-use ticket instead.
// Failures carry machine-readable `reason` codes (with a human `error` alongside), so the GUI can
// tell an expired request from a wrong code, an exhausted request and a global lock (which also
// reports the remaining wait), and a refused stream ticket knows whether it was used, expired or
// never issued. Drives a REAL Hono app over a REAL Manager with app.request, the house pattern.
import "./isolate"; // CWD-proof data-dir isolation - must load before any server/src import
import { afterEach, expect, test } from "bun:test";
import { createApp } from "../server/src/http";
import { Manager } from "../server/src/manager";
import {
  readCookieFile,
  resetPairingState,
  withLocalAuth,
  writeCookieFile,
} from "../server/src/local-auth";
import { ROUTES } from "../shared/routes";

const JSON_HEADERS = { "content-type": "application/json" };
/** The loopback daemon URL the CLI/MCP would target; withLocalAuth only signs loopback targets. */
const LOCAL = "http://127.0.0.1:7171";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The production lock/ticket windows are 15 min / 30 s. local-auth reads these TEST-only overrides
// lazily per call (like authRequired() reads DEVWEBUI_REQUIRE_AUTH), so a test can shrink the
// window to real milliseconds instead of faking timers.
const WINDOW_ENV = "DEVWEBUI_TEST_FAILURE_WINDOW_MS";
const TICKET_TTL_ENV = "DEVWEBUI_TEST_STREAM_TICKET_TTL_MS";
const TEST_ENV_KEYS = [WINDOW_ENV, TICKET_TTL_ENV];
const savedTestEnv = new Map<string, string | undefined>(
  TEST_ENV_KEYS.map((k) => [k, process.env[k]]),
);

function newApp(requireAuth: boolean) {
  const manager = new Manager();
  manager.monitorResources = false;
  manager.applyMonitorResources();
  return { app: createApp(manager, { requireAuth }), manager };
}

async function openPairing(
  app: ReturnType<typeof newApp>["app"],
  label = "test browser",
): Promise<{ requestId: string; code: string }> {
  const req = await app.request(ROUTES.pairingRequest, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ label }),
  });
  const { requestId } = (await req.json()) as { requestId: string };
  const codes = (await (await app.request(ROUTES.pairingCodes, withLocalAuth(LOCAL))).json()) as {
    requestId: string;
    code: string;
  }[];
  const code = codes.find((p) => p.requestId === requestId)?.code ?? "";
  expect(code).toMatch(/^\d{6}$/);
  return { requestId, code };
}

function verify(app: ReturnType<typeof newApp>["app"], requestId: string, code: string) {
  return app.request(ROUTES.pairingVerify, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ requestId, code }),
  });
}

const anotherCode = (code: string) => (code === "000000" ? "111111" : "000000");

afterEach(() => {
  resetPairingState();
  for (const [k, v] of savedTestEnv)
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
});

test("enforcing daemon: no credential is refused, health stays open, cookie file gets in", async () => {
  writeCookieFile();
  const { app, manager } = newApp(true);
  try {
    expect((await app.request(ROUTES.processes)).status).toBe(401);
    expect((await app.request(ROUTES.health)).status).toBe(200);
    expect(readCookieFile()).toMatch(/^__cookie__:[0-9a-f]{64}$/);
    expect((await app.request(ROUTES.processes, withLocalAuth(LOCAL))).status).toBe(200);
    const wrong = { headers: { authorization: `Basic ${btoa("__cookie__:nope")}` } };
    expect((await app.request(ROUTES.processes, wrong)).status).toBe(401);
  } finally {
    manager.dispose();
  }
});

test("non-enforcing daemon keeps the open-on-loopback behaviour", async () => {
  const { app, manager } = newApp(false);
  try {
    expect((await app.request(ROUTES.processes)).status).toBe(200);
  } finally {
    manager.dispose();
  }
});

test("the cookie-file secret is never attached to a non-loopback daemon URL", () => {
  writeCookieFile();
  const remote = new Headers(withLocalAuth("http://devbox.example:7171/api/processes").headers);
  expect(remote.has("authorization")).toBe(false);
  const local = new Headers(withLocalAuth("http://localhost:7171/api/processes").headers);
  expect(local.get("authorization")).toStartWith("Basic ");
});

test("pairing: code only via an authorized caller, right code earns a revocable key", async () => {
  writeCookieFile();
  const { app, manager } = newApp(true);
  try {
    const status = await (await app.request(ROUTES.pairingStatus)).json();
    expect(status).toEqual({ required: true, authorized: false });

    const { requestId, code } = await openPairing(app);

    // The code list is behind auth: an unpaired caller cannot read its own code back.
    expect((await app.request(ROUTES.pairingCodes)).status).toBe(401);

    // A wrong code is a STRUCTURED failure: stable reason code + human message, never the code.
    const bad = await verify(app, requestId, anotherCode(code));
    expect(bad.status).toBe(403);
    const badBody = await bad.json();
    expect(badBody).toMatchObject({ reason: "wrong-code" });
    expect(typeof badBody.error).toBe("string");
    expect(JSON.stringify(badBody)).not.toContain(code);

    const ok = await verify(app, requestId, code);
    expect(ok.status).toBe(200);
    // No ambient cookie: it would reach every other localhost port the browser visits.
    expect(ok.headers.get("set-cookie")).toBeNull();
    const { clientId, key } = (await ok.json()) as { clientId: string; key: string };
    const bearer = { headers: { authorization: `Bearer ${key}` } };
    expect((await app.request(ROUTES.processes, bearer)).status).toBe(200);

    // A code is single-use: the spent request now answers "unknown" (it was deleted on success),
    // still structured and still 403.
    const replay = await verify(app, requestId, code);
    expect(replay.status).toBe(403);
    expect(await replay.json()).toMatchObject({ reason: "unknown-request" });

    const revoke = await app.request(
      ROUTES.pairingClient.build(clientId),
      withLocalAuth(LOCAL, { method: "DELETE" }),
    );
    expect(revoke.status).toBe(200);
    expect((await app.request(ROUTES.processes, bearer)).status).toBe(401);
  } finally {
    manager.dispose();
  }
});

test("pairing: an unknown/expired requestId is distinguished from a wrong code", async () => {
  writeCookieFile();
  const { app, manager } = newApp(true);
  try {
    const res = await verify(app, "no-such-request-id", "000000");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({ reason: "unknown-request" });
    expect(typeof body.error).toBe("string");
    expect(body.retryAfterSeconds).toBeUndefined();
  } finally {
    manager.dispose();
  }
});

test("pairing: a request whose guesses are exhausted says so, even after it is deleted", async () => {
  writeCookieFile();
  const { app, manager } = newApp(true);
  try {
    const { requestId, code } = await openPairing(app);
    const wrong = anotherCode(code);

    // Five wrong guesses is the per-request cap. The fifth answer is still "wrong-code"; the
    // request is deleted on that call, so every later submit with the SAME id must be
    // "request-exhausted" rather than the misleading "unknown-request".
    for (let attempt = 1; attempt <= 5; attempt++) {
      const res = await verify(app, requestId, wrong);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ reason: "wrong-code" });
    }
    const after = await verify(app, requestId, code);
    expect(after.status).toBe(403);
    const afterBody = await after.json();
    expect(afterBody).toMatchObject({ reason: "request-exhausted" });
    // The correct code is not leaked by the exhausted response either.
    expect(JSON.stringify(afterBody)).not.toContain(code);

    // A genuinely unseen id still maps to the unknown reason.
    const unseen = await verify(app, randomUnknownId(), code);
    expect(await unseen.json()).toMatchObject({ reason: "unknown-request" });
  } finally {
    manager.dispose();
  }
});

function randomUnknownId(): string {
  // A UUID-shaped id that cannot match any live or exhausted request.
  return "00000000-0000-4000-8000-000000000000";
}

test("pairing: the global lock reports a remaining-wait countdown, then releases", async () => {
  writeCookieFile();
  process.env[WINDOW_ENV] = "1000"; // 15-min lock window shrunk to 1 s
  const { app, manager } = newApp(true);
  try {
    // Burn the global budget of ten wrong guesses: each request allows five, so two requests are
    // enough (the second one is deleted on its fifth wrong guess, i.e. failure number ten).
    for (const label of ["first", "second"]) {
      const r = await openPairing(app, label);
      for (let i = 0; i < 5; i++) {
        const res = await verify(app, r.requestId, anotherCode(r.code));
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ reason: "wrong-code" });
      }
    }

    // The next guess - against a brand-new request, even with its CORRECT code - is locked: the
    // global-lock check runs before the code is ever compared.
    const third = await openPairing(app, "third");
    const locked = await verify(app, third.requestId, third.code);
    expect(locked.status).toBe(403);
    const lockedBody = await locked.json();
    expect(lockedBody).toMatchObject({ reason: "globally-locked" });
    // The remaining wait is both a body field and the standard Retry-After header.
    expect(locked.headers.get("retry-after")).toBe(String(lockedBody.retryAfterSeconds));
    expect(lockedBody.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(lockedBody.retryAfterSeconds).toBeLessThanOrEqual(1);
    expect(lockedBody.error).not.toContain(third.code);

    // Once the window elapses, a NEW pairing request completes normally with the correct code.
    await sleep(1100);
    const fresh = await openPairing(app, "after-lock");
    const ok = await verify(app, fresh.requestId, fresh.code);
    expect(ok.status).toBe(200);
    const { key } = (await ok.json()) as { key: string };
    expect(
      (await app.request(ROUTES.processes, { headers: { authorization: `Bearer ${key}` } })).status,
    ).toBe(200);
  } finally {
    manager.dispose();
  }
});

test("stream ticket: minted only with a credential, opens only the stream, once", async () => {
  writeCookieFile();
  const { app, manager } = newApp(true);
  try {
    expect((await app.request(ROUTES.pairingStreamTicket, { method: "POST" })).status).toBe(401);
    const minted = await app.request(
      ROUTES.pairingStreamTicket,
      withLocalAuth(LOCAL, { method: "POST" }),
    );
    const { ticket } = (await minted.json()) as { ticket: string };
    // A ticket is not a general credential.
    expect((await app.request(`${ROUTES.processes}?ticket=${ticket}`)).status).toBe(401);
    const first = await app.request(`${ROUTES.stream}?ticket=${ticket}`);
    expect(first.status).toBe(200);
    await first.body?.cancel();
    // The replay is refused with a SPECIFIC reason: already used, not a bare 401.
    const replay = await app.request(`${ROUTES.stream}?ticket=${ticket}`);
    expect(replay.status).toBe(401);
    expect(await replay.json()).toMatchObject({ reason: "ticket-used" });
  } finally {
    manager.dispose();
  }
});

test("stream ticket: never-issued and expired tickets are refused for their own reasons", async () => {
  writeCookieFile();
  process.env[TICKET_TTL_ENV] = "200"; // 30-s ticket TTL shrunk to 200 ms
  const { app, manager } = newApp(true);
  try {
    // A ticket the daemon never minted.
    const never = await app.request(`${ROUTES.stream}?ticket=${"ab".repeat(32)}`);
    expect(never.status).toBe(401);
    expect(await never.json()).toMatchObject({ reason: "ticket-never-issued" });

    // A ticket that ages out before first use.
    const minted = await app.request(
      ROUTES.pairingStreamTicket,
      withLocalAuth(LOCAL, { method: "POST" }),
    );
    const { ticket } = (await minted.json()) as { ticket: string };
    await sleep(300);
    const expired = await app.request(`${ROUTES.stream}?ticket=${ticket}`);
    expect(expired.status).toBe(401);
    const expiredBody = await expired.json();
    expect(expiredBody).toMatchObject({ reason: "ticket-expired" });

    // Its replay stays "expired"; an unknown id is still "never issued".
    expect(await (await app.request(`${ROUTES.stream}?ticket=${ticket}`)).json()).toMatchObject({
      reason: "ticket-expired",
    });
    expect(
      await (await app.request(`${ROUTES.stream}?ticket=${"cd".repeat(32)}`)).json(),
    ).toMatchObject({ reason: "ticket-never-issued" });
  } finally {
    manager.dispose();
  }
});
