import assert from "node:assert";
import { describe, test } from "node:test";
import type { Session, SessionCookie } from "../../wreq-js.js";
import { createSession, RequestError, withSession, fetch as wreqFetch } from "../../wreq-js.js";
import { httpUrl } from "../helpers/http.js";

describe("HTTP sessions", () => {
  test("setCookie/getCookies round-trips and affects outgoing requests", async () => {
    const session = await createSession({ browser: "chrome_142" });
    const cookiesUrl = httpUrl("/cookies");

    try {
      assert.deepStrictEqual(session.getCookies(cookiesUrl), {}, "New sessions should start with an empty cookie jar");

      session.setCookie("token", "abc123", cookiesUrl);

      assert.deepStrictEqual(session.getCookies(cookiesUrl), { token: "abc123" });

      const response = await session.fetch(cookiesUrl, { timeout: 10_000 });
      const body = await response.json<{ cookies: Record<string, string> }>();
      assert.strictEqual(body.cookies.token, "abc123");
    } finally {
      await session.close();
    }
  });

  test("recreating a disposed session id starts with an empty cookie jar", async () => {
    const sessionId = `cookie-disposed-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const cookiesUrl = httpUrl("/cookies");

    const first = await createSession({ browser: "chrome_142", sessionId });
    try {
      first.setCookie("persist", "nope", cookiesUrl);
      assert.deepStrictEqual(first.getCookies(cookiesUrl), { persist: "nope" });
    } finally {
      await first.close();
    }

    const second = await createSession({ browser: "chrome_142", sessionId });
    try {
      assert.deepStrictEqual(second.getCookies(cookiesUrl), {}, "Dropped session ids should not retain cookies");
    } finally {
      await second.close();
    }
  });

  test("rejects invalid setCookie input and keeps jar unchanged", async () => {
    const session = await createSession({ browser: "chrome_142" });
    const cookiesUrl = httpUrl("/cookies");

    try {
      assert.deepStrictEqual(session.getCookies(cookiesUrl), {});

      assert.throws(
        () => {
          session.setCookie("", "value", cookiesUrl);
        },
        (error: unknown) => error instanceof RequestError && /Invalid cookie string/.test(error.message),
      );

      assert.deepStrictEqual(session.getCookies(cookiesUrl), {}, "Invalid setCookie input should not mutate the jar");
    } finally {
      await session.close();
    }
  });

  test("rejects cookie APIs on disposed sessions", async () => {
    const session = await createSession({ browser: "chrome_142" });
    await session.close();

    assert.throws(
      () => {
        session.getCookies(httpUrl("/cookies"));
      },
      (error: unknown) => error instanceof RequestError && /Session has been closed/.test(error.message),
    );

    assert.throws(
      () => {
        session.setCookie("k", "v", httpUrl("/cookies"));
      },
      (error: unknown) => error instanceof RequestError && /Session has been closed/.test(error.message),
    );

    assert.throws(
      () => {
        session.getAllCookies();
      },
      (error: unknown) => error instanceof RequestError && /Session has been closed/.test(error.message),
    );

    assert.throws(
      () => {
        session.setCookies([{ name: "k", value: "v", url: httpUrl("/cookies") }]);
      },
      (error: unknown) => error instanceof RequestError && /Session has been closed/.test(error.message),
    );
  });

  test("getAllCookies returns cookies without needing a URL", async () => {
    const session = await createSession({ browser: "chrome_142" });

    try {
      session.setCookie("root", "alpha", httpUrl("/"));
      session.setCookie("nested", "beta", httpUrl("/account/settings"));

      const cookies = session.getAllCookies().sort((left, right) => left.name.localeCompare(right.name));

      assert.strictEqual(cookies.length, 2);
      assert.deepStrictEqual(
        cookies.map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
        })),
        [
          { name: "nested", value: "beta", secure: false, httpOnly: false },
          { name: "root", value: "alpha", secure: false, httpOnly: false },
        ],
      );
    } finally {
      await session.close();
    }
  });

  test("getAllCookies preserves duplicate cookie names across different paths", async () => {
    const session = await createSession({ browser: "chrome_142" });

    try {
      session.setCookie("token", "root", httpUrl("/"));
      session.setCookie("token", "admin", httpUrl("/admin/panel"));

      const cookies = session
        .getAllCookies()
        .filter((cookie) => cookie.name === "token")
        .sort((left, right) => left.value.localeCompare(right.value));

      assert.deepStrictEqual(
        cookies.map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
        })),
        [
          { name: "token", value: "admin", secure: false, httpOnly: false },
          { name: "token", value: "root", secure: false, httpOnly: false },
        ],
      );
    } finally {
      await session.close();
    }
  });

  test("getAllCookies reports every SameSite value", async () => {
    const session = await createSession({ browser: "chrome_142" });

    try {
      session.setCookies(
        [
          { name: "lax", value: "1", sameSite: "lax" },
          { name: "strict", value: "1", sameSite: "strict" },
          // SameSite=None is the case wreq's cookie wrapper cannot tell from an absent attribute.
          { name: "none", value: "1", sameSite: "none", secure: true },
          { name: "unset", value: "1" },
        ],
        httpUrl("/"),
      );

      const bySameSite = Object.fromEntries(session.getAllCookies().map((cookie) => [cookie.name, cookie.sameSite]));

      assert.deepStrictEqual(bySameSite, {
        lax: "lax",
        strict: "strict",
        none: "none",
        unset: undefined,
      });
    } finally {
      await session.close();
    }
  });

  test("setCookies restores an exported jar with every attribute", async () => {
    const source = await createSession({ browser: "chrome_142" });
    const target = await createSession({ browser: "chrome_142" });

    try {
      source.setCookie("token", "abc123", httpUrl("/"));
      source.setCookie("scoped", "nested", httpUrl("/account/settings"));
      source.setCookie(
        "flagged",
        "on; Domain=127.0.0.1; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600",
        "https://127.0.0.1/",
      );

      const exported = source.getAllCookies();
      assert.strictEqual(exported.length, 3);

      // Cross a JSON round-trip the way a caller persisting a jar to disk would.
      target.setCookies(JSON.parse(JSON.stringify(exported)), httpUrl("/"));

      const byName = (cookies: SessionCookie[]) => [...cookies].sort((a, b) => a.name.localeCompare(b.name));
      assert.deepStrictEqual(byName(target.getAllCookies()), byName(exported));

      const response = await target.fetch(httpUrl("/cookies"), { timeout: 10_000 });
      const body = await response.json<{ cookies: Record<string, string> }>();
      assert.strictEqual(body.cookies.token, "abc123");
    } finally {
      await source.close();
      await target.close();
    }
  });

  test("setCookies scopes host-only cookies per cookie url", async () => {
    const session = await createSession({ browser: "chrome_142" });

    try {
      session.setCookies([
        { name: "here", value: "local", url: httpUrl("/") },
        { name: "elsewhere", value: "remote", url: "https://example.com/" },
      ]);

      assert.deepStrictEqual(session.getCookies(httpUrl("/")), { here: "local" });
      assert.deepStrictEqual(session.getCookies("https://example.com/"), { elsewhere: "remote" });
    } finally {
      await session.close();
    }
  });

  test("setCookies rejects a bad batch without touching the jar", async () => {
    const session = await createSession({ browser: "chrome_142" });

    try {
      session.setCookie("keep", "me", httpUrl("/"));

      assert.throws(
        () => {
          session.setCookies([{ name: "stray", value: "1" }]);
        },
        (error: unknown) => error instanceof RequestError && /has no domain/.test(error.message),
        "Host-only cookies need a URL to scope them",
      );

      assert.throws(
        () => {
          session.setCookies([
            { name: "good", value: "1", domain: "127.0.0.1" },
            { name: "bad", value: "1", domain: "127.0.0.1", sameSite: "sometimes" as never },
          ]);
        },
        (error: unknown) => error instanceof RequestError && /invalid sameSite/.test(error.message),
      );

      assert.deepStrictEqual(
        session.getCookies(httpUrl("/")),
        { keep: "me" },
        "A rejected batch should leave the jar untouched",
      );
    } finally {
      await session.close();
    }
  });

  test("setCookies drops cookies that have already expired", async () => {
    const session = await createSession({ browser: "chrome_142" });

    try {
      session.setCookies(
        [
          { name: "fresh", value: "1", expiresAtMs: Date.now() + 3_600_000 },
          { name: "stale", value: "1", expiresAtMs: Date.now() - 60_000 },
        ],
        httpUrl("/"),
      );

      assert.deepStrictEqual(session.getCookies(httpUrl("/")), { fresh: "1" });
    } finally {
      await session.close();
    }
  });

  test("setCookies rejects a later bad entry atomically and keeps the pre-existing cookie", async () => {
    const session = await createSession({ browser: "chrome_142" });

    try {
      // Start from a jar that already holds a legitimate cookie, the way a resumed scrape would.
      session.setCookie("seeded", "original", httpUrl("/"));

      const badBatch = [
        { name: "would-be-first", value: "1", url: httpUrl("/") },
        { name: "   ", value: "1", url: httpUrl("/") },
      ];

      assert.throws(
        () => {
          session.setCookies(badBatch);
        },
        (error: unknown) => {
          if (!(error instanceof RequestError)) {
            return false;
          }
          // The message has to pinpoint the entry: its index, and the reason it failed.
          return /index 1/.test(error.message) && /empty name/.test(error.message);
        },
        "The rejected entry's index and failure reason must both appear in the error",
      );

      const remaining = session
        .getAllCookies()
        .map((cookie) => cookie.name)
        .sort();
      assert.deepStrictEqual(
        remaining,
        ["seeded"],
        "Neither the bad entry nor the valid entry ahead of it may land in the jar",
      );
      assert.deepStrictEqual(session.getCookies(httpUrl("/")), { seeded: "original" });
    } finally {
      await session.close();
    }
  });

  test("setCookies errors identify the entry index, name and reason for every invalid shape", async () => {
    const cases: Array<{
      cookies: Parameters<Session["setCookies"]>[0];
      url?: string;
      index: string;
      name?: string;
      reason: RegExp;
    }> = [
      {
        cookies: [{ name: "", value: "1", url: httpUrl("/") }],
        index: "index 0",
        reason: /empty name/,
      },
      {
        cookies: [
          { name: "ok", value: "1", domain: "127.0.0.1" },
          { name: "samesite-bad", value: "1", domain: "127.0.0.1", sameSite: "sometimes" as never },
        ],
        index: "index 1",
        name: "samesite-bad",
        reason: /invalid sameSite/,
      },
      {
        cookies: [{ name: "nan-expiry", value: "1", domain: "127.0.0.1", expiresAtMs: Number.NaN }],
        index: "index 0",
        name: "nan-expiry",
        reason: /non-finite expiresAtMs/,
      },
      {
        cookies: [{ name: "infinity-expiry", value: "1", domain: "127.0.0.1", expiresAtMs: Number.POSITIVE_INFINITY }],
        index: "index 0",
        name: "infinity-expiry",
        reason: /non-finite expiresAtMs/,
      },
      {
        cookies: [{ name: "huge-expiry", value: "1", domain: "127.0.0.1", expiresAtMs: 1e20 }],
        index: "index 0",
        name: "huge-expiry",
        reason: /out-of-range expiresAtMs/,
      },
      {
        cookies: [{ name: "orphan", value: "1" }],
        index: "index 0",
        name: "orphan",
        reason: /no domain/,
      },
      {
        // A path-only reference parses but resolves to no host, which must be rejected.
        cookies: [{ name: "bad-url", value: "1", url: "/just-a-path" }],
        index: "index 0",
        name: "bad-url",
        reason: /unparseable url/,
      },
    ];

    for (const [caseIndex, testCase] of cases.entries()) {
      const session = await createSession({ browser: "chrome_142" });

      try {
        session.setCookie("seeded", "original", httpUrl("/"));

        assert.throws(
          () => {
            session.setCookies(testCase.cookies, testCase.url);
          },
          (error: unknown) => {
            if (!(error instanceof RequestError)) {
              return false;
            }
            const hasIndex = error.message.includes(testCase.index);
            const hasName = testCase.name ? error.message.includes(`"${testCase.name}"`) : true;
            return hasIndex && hasName && testCase.reason.test(error.message);
          },
          `case ${caseIndex} should report index, name and reason, got a different error`,
        );

        assert.deepStrictEqual(
          session.getCookies(httpUrl("/")),
          { seeded: "original" },
          `case ${caseIndex} must leave the jar untouched`,
        );
      } finally {
        await session.close();
      }
    }

    const defaultUrlSession = await createSession({ browser: "chrome_142" });
    try {
      defaultUrlSession.setCookie("seeded", "original", httpUrl("/"));
      assert.throws(
        () => {
          defaultUrlSession.setCookies([{ name: "restored", value: "1" }], "/just-a-path");
        },
        (error: unknown) => error instanceof RequestError && /Batch default URL is invalid/.test(error.message),
      );
      assert.deepStrictEqual(defaultUrlSession.getCookies(httpUrl("/")), { seeded: "original" });
    } finally {
      await defaultUrlSession.close();
    }
  });

  test("setCookies preserves every attribute, leading-dot domains and root-path fallback", async () => {
    const session = await createSession({ browser: "chrome_142" });
    const expiresAtMs = Date.now() + 86_400_000;

    try {
      session.setCookies([
        {
          name: "full",
          value: "scalar-value",
          domain: ".127.0.0.1",
          path: "relative-path",
          secure: true,
          httpOnly: true,
          sameSite: "lax",
          expiresAtMs,
        },
      ]);

      const [stored] = session.getAllCookies();
      assert.ok(stored, "the valid cookie must be stored");
      // A leading dot is Set-Cookie spelling, not part of the matched domain.
      assert.strictEqual(stored.domain?.replace(/^\.+/, ""), "127.0.0.1");
      assert.strictEqual(stored.path, "/", "a path not starting with / must fall back to the root path");
      assert.strictEqual(stored.secure, true);
      assert.strictEqual(stored.httpOnly, true);
      assert.strictEqual(stored.sameSite, "lax");
      assert.ok(
        stored.expiresAtMs !== undefined && Math.abs(stored.expiresAtMs - expiresAtMs) < 1_000,
        "expiry must be retained to the millisecond",
      );
    } finally {
      await session.close();
    }
  });

  test("restored cookies reach the server and host-only and domain scopes differ", async () => {
    const session = await createSession({ browser: "chrome_142" });

    try {
      session.setCookie("seeded", "original", httpUrl("/"));

      // A fully valid batch following the rejected one: host-only, domain and path-scoped entries.
      session.setCookies([
        { name: "hostonly", value: "h", url: httpUrl("/") },
        { name: "domained", value: "d", domain: "127.0.0.1" },
        { name: "pathed", value: "p", url: httpUrl("/"), path: "/cookies" },
      ]);

      const cookiesResponse = await session.fetch(httpUrl("/cookies"), { timeout: 10_000 });
      const cookiesBody = await cookiesResponse.json<{ cookies: Record<string, string> }>();
      assert.deepStrictEqual(
        cookiesBody.cookies,
        {
          seeded: "original",
          hostonly: "h",
          domained: "d",
          // Path /cookies matches the request path, so this one is sent too.
          pathed: "p",
        },
        "the server must receive every cookie whose domain and path match the request",
      );

      const rootResponse = await session.fetch(httpUrl("/get"), { timeout: 10_000 });
      const rootBody = await rootResponse.json<{ headers: Record<string, string> }>();
      const rootCookieHeader = rootBody.headers.Cookie ?? "";
      assert.match(rootCookieHeader, /hostonly=h/);
      assert.match(rootCookieHeader, /domained=d/);
      assert.doesNotMatch(
        rootCookieHeader,
        /pathed=p/,
        "a cookie scoped to /cookies must not be sent to a different path",
      );

      // Scope difference, checked straight against the jar without touching the network:
      // a host-only cookie is invisible to a subdomain, a domain cookie is shared with it.
      const apexCookies = session.getCookies("https://example.com/");
      session.setCookies([
        { name: "apex-host-only", value: "1", url: "https://example.com/" },
        { name: "apex-domain", value: "1", domain: "example.com" },
      ]);

      assert.deepStrictEqual(session.getCookies("https://example.com/"), {
        ...apexCookies,
        "apex-host-only": "1",
        "apex-domain": "1",
      });
      assert.deepStrictEqual(session.getCookies("https://sub.example.com/"), {
        "apex-domain": "1",
      });
    } finally {
      await session.close();
    }
  });

  test("isolates cookies for default fetch calls", async () => {
    await wreqFetch(httpUrl("/cookies/set?ephemeral=on"), {
      browser: "chrome_142",
      timeout: 5000,
    });

    const response = await wreqFetch(httpUrl("/cookies"), {
      browser: "chrome_142",
      timeout: 5000,
    });

    const body = await response.json<{ cookies: Record<string, string> }>();

    assert.ok(!body.cookies.ephemeral, "Ephemeral cookies should not persist across requests");
  });

  test("isolates cookies between sessions", async () => {
    const sessionA = await createSession({ browser: "chrome_142" });
    const sessionB = await createSession({ browser: "chrome_142" });

    try {
      await sessionA.fetch(httpUrl("/cookies/set?flavor=alpha"), { timeout: 10000 });
      await sessionB.fetch(httpUrl("/cookies/set?flavor=beta"), { timeout: 10000 });

      const cookiesA = await sessionA.fetch(httpUrl("/cookies"), { timeout: 10000 });
      const cookiesB = await sessionB.fetch(httpUrl("/cookies"), { timeout: 10000 });

      const bodyA = await cookiesA.json<{ cookies: Record<string, string> }>();
      const bodyB = await cookiesB.json<{ cookies: Record<string, string> }>();

      assert.strictEqual(bodyA.cookies.flavor, "alpha", "Session A should keep its own cookies");
      assert.strictEqual(bodyB.cookies.flavor, "beta", "Session B should keep its own cookies");
    } finally {
      await sessionA.close();
      await sessionB.close();
    }
  });

  test("clears session cookies on demand", async () => {
    const session = await createSession({ browser: "chrome_142" });

    try {
      await session.fetch(httpUrl("/cookies/set?token=123"), { timeout: 10000 });
      await session.clearCookies();

      const response = await session.fetch(httpUrl("/cookies"), { timeout: 10000 });
      const body = await response.json<{ cookies: Record<string, string> }>();

      assert.deepStrictEqual(body.cookies, {}, "Clearing the session should drop stored cookies");
    } finally {
      await session.close();
    }
  });

  test("withSession helper disposes sessions automatically", async () => {
    let capturedSession: Session | undefined;

    await withSession(async (session: Session) => {
      capturedSession = session;
      const response = await session.fetch(httpUrl("/get"), { timeout: 5000 });
      assert.strictEqual(response.status, 200);
    });

    const session = capturedSession;
    assert.ok(session, "withSession should provide a session instance");

    await assert.rejects(
      async () => {
        await session.fetch(httpUrl("/get"), { timeout: 5000 });
      },
      (error: unknown) => error instanceof RequestError,
      "Using a closed session should fail",
    );
  });

  test("rejects changing session proxy per request", async () => {
    const session = await createSession({ browser: "chrome_142" });

    try {
      await assert.rejects(
        session.fetch(httpUrl("/get"), { proxy: "http://proxy.example.com:8080", timeout: 5_000 }),
        (error: unknown) => error instanceof RequestError && /Session proxy cannot be changed/.test(error.message),
      );
    } finally {
      await session.close();
    }
  });

  test("createSession({ emulation }) works without browser/os and reuses standalone custom emulation", async () => {
    const session = await createSession({
      emulation: {
        headers: {
          "User-Agent": "Standalone Session/1.0",
          "X-Session-Emulation": "alpha",
        },
      },
    });

    try {
      const first = await session.fetch(httpUrl("/headers"), { timeout: 10_000 });
      const second = await session.fetch(httpUrl("/headers"), { timeout: 10_000 });

      const firstBody = await first.json<{ headers: Record<string, string> }>();
      const secondBody = await second.json<{ headers: Record<string, string> }>();

      assert.strictEqual(firstBody.headers["User-Agent"], "Standalone Session/1.0");
      assert.strictEqual(firstBody.headers["X-Session-Emulation"], "alpha");
      assert.strictEqual(secondBody.headers["User-Agent"], "Standalone Session/1.0");
      assert.strictEqual(secondBody.headers["X-Session-Emulation"], "alpha");
    } finally {
      await session.close();
    }
  });
});
