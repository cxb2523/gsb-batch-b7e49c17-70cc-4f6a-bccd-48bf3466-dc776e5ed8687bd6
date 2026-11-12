import assert from "node:assert";
import { describe, test } from "node:test";
import type { BrowserAlias, BrowserProfile, EmulationOS } from "../../wreq-js.js";
import { BROWSER_ALIASES } from "../../generated-types.js";
import { getEmulationHeaders, getProfiles, RequestError, resolveProfile, fetch as wreqFetch } from "../../wreq-js.js";
import { httpUrl } from "../helpers/http.js";

// Added by the client rather than the emulation profile, so they are not part of its header set.
// Accept-Encoding is not in this list: the profile owns it, which is what puts it in the
// browser's real header position rather than appended at the end.
const TRANSPORT_HEADERS = new Set(["host", "connection", "content-length"]);

describe("HTTP profiles", () => {
  test("returns available browser profiles", () => {
    const profiles = getProfiles();

    assert.ok(Array.isArray(profiles), "Profiles should be an array");
    assert.ok(profiles.length > 0, "Should have at least one profile");
    assert.ok(
      profiles.some((p) => p.includes("chrome")) ||
        profiles.some((p) => p.includes("firefox")) ||
        profiles.some((p) => p.includes("safari")),
      "Should include standard browser profiles",
    );
  });

  test("rejects invalid browser profiles", async () => {
    await assert.rejects(
      async () => {
        await wreqFetch(httpUrl("/get"), {
          browser: "nonexistent_browser" as BrowserProfile,
          timeout: 1000,
        });
      },
      (error: unknown) => error instanceof RequestError,
      "Should reject invalid browser profiles",
    );
  });

  test("exposes the headers a profile injects", () => {
    const headers = getEmulationHeaders("firefox_147");

    assert.ok(headers.get("user-agent")?.includes("Firefox/147"), "Should expose the profile's User-Agent");
    assert.ok(headers.get("accept"), "Should expose the profile's Accept header");
  });

  test("emulation headers follow the requested operating system", () => {
    const macos = getEmulationHeaders("chrome_142", "macos").get("user-agent");
    const windows = getEmulationHeaders("chrome_142", "windows").get("user-agent");

    assert.ok(macos?.includes("Mac OS X"), "macOS profile should report a macOS User-Agent");
    assert.ok(windows?.includes("Windows"), "Windows profile should report a Windows User-Agent");
    assert.notStrictEqual(macos, windows);
  });

  test("emulation headers match what the profile actually sends", async () => {
    for (const browser of ["firefox_147", "chrome_142", "safari_18"] as BrowserProfile[]) {
      const response = await wreqFetch(httpUrl("/headers"), { browser, timeout: 10_000 });
      const body = await response.json<{ rawHeaders: string[] }>();

      const sent = body.rawHeaders
        .filter((_, index) => index % 2 === 0)
        .map((name) => name.toLowerCase())
        .filter((name) => !TRANSPORT_HEADERS.has(name));
      const declared = [...getEmulationHeaders(browser)].map(([name]) => name.toLowerCase());

      // Header order is part of the fingerprint, so compare the sequence, not just the set.
      assert.deepStrictEqual(declared, sent, `${browser} should declare the headers it sends, in order`);
    }
  });

  test("returns a fresh Headers instance per call", () => {
    const first = getEmulationHeaders("chrome_142");
    first.set("user-agent", "mutated");

    assert.notStrictEqual(getEmulationHeaders("chrome_142").get("user-agent"), "mutated");
  });

  test("rejects invalid profiles and operating systems", () => {
    assert.throws(() => getEmulationHeaders("nonexistent_browser" as BrowserProfile), RequestError);
    assert.throws(() => getEmulationHeaders("chrome_142", "solaris" as EmulationOS), RequestError);
  });

  test("every alias resolves to a real profile", () => {
    const profiles = new Set<string>(getProfiles());

    for (const [alias, profile] of Object.entries(BROWSER_ALIASES)) {
      assert.ok(profiles.has(profile), `Alias ${alias} should resolve to a known profile, got ${profile}`);
      assert.strictEqual(resolveProfile(alias as BrowserAlias), profile);
    }
  });

  test("aliases pick the numerically newest version in the family", () => {
    const profiles = getProfiles();

    for (const [alias, resolved] of Object.entries(BROWSER_ALIASES)) {
      // Exact family match, so `safari` never considers `safari_ios_*` or `safari_ipad_*`.
      const family = profiles.filter((profile) => {
        const match = profile.match(/^(.*)_([0-9][0-9.]*)$/);
        return match?.[1] === alias;
      });

      const versionOf = (profile: string) =>
        profile
          .slice(alias.length + 1)
          .split(".")
          .map(Number);
      const isNewest = family.every((profile) => {
        const [left, right] = [versionOf(resolved), versionOf(profile)];
        for (let i = 0; i < Math.max(left.length, right.length); i++) {
          const delta = (left[i] ?? 0) - (right[i] ?? 0);
          if (delta !== 0) {
            return delta > 0;
          }
        }
        return true;
      });

      assert.ok(isNewest, `Alias ${alias} resolved to ${resolved}, which is not the newest of ${family.join(", ")}`);
    }
  });

  test("the default profile tracks the newest Chrome", () => {
    const defaults = [...getEmulationHeaders()];

    assert.deepStrictEqual(defaults, [...getEmulationHeaders("chrome")]);
    assert.deepStrictEqual(defaults, [...getEmulationHeaders(BROWSER_ALIASES.chrome)]);
  });

  test("aliases do not leak across families", () => {
    assert.ok(!resolveProfile("safari").startsWith("safari_ios"));
    assert.ok(!resolveProfile("safari").startsWith("safari_ipad"));
    assert.ok(!resolveProfile("firefox").startsWith("firefox_private"));
    assert.ok(!resolveProfile("firefox").startsWith("firefox_android"));
  });

  test("concrete profiles pass through resolveProfile unchanged", () => {
    assert.strictEqual(resolveProfile("chrome_142"), "chrome_142");
    assert.strictEqual(resolveProfile("safari_18.3.1" as BrowserProfile), "safari_18.3.1");
  });

  test("rejects inherited object keys as aliases", () => {
    // `toString` is on Object.prototype, so a plain `in` check would accept it.
    assert.throws(() => resolveProfile("toString" as BrowserAlias), RequestError);
    assert.throws(() => resolveProfile("constructor" as BrowserAlias), RequestError);
  });

  test("an alias sends the same headers as the profile it resolves to", async () => {
    const alias = await wreqFetch(httpUrl("/headers"), { browser: "firefox", timeout: 10_000 });
    const concrete = await wreqFetch(httpUrl("/headers"), {
      browser: resolveProfile("firefox"),
      timeout: 10_000,
    });

    const rawOf = async (response: Awaited<typeof alias>) =>
      (await response.json<{ rawHeaders: string[] }>()).rawHeaders;

    assert.deepStrictEqual(await rawOf(alias), await rawOf(concrete));
  });
});
