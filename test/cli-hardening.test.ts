import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { diffCommand } from "../src/cli/diff-command.js";
import { isCliEntry, main, parseArgs } from "../src/cli/index.js";
import { lintCommand } from "../src/cli/lint-command.js";
import { scanCommand } from "../src/cli/scan-command.js";
import { serveCommand } from "../src/cli/serve-command.js";
import { copyFixture } from "./helpers/fixture-copy.js";

const fx = copyFixture("cli"); const FIXTURE = fx.dir; const GRAPH = join(FIXTURE, ".code2flow", "graph.json");
// URL.pathname keeps a leading slash on Windows (`/D:/...`), which fs APIs reject; fileURLToPath yields the native path.
const viewerDir = fileURLToPath(new URL("../out/viewer", import.meta.url));
beforeAll(async () => { await scanCommand(FIXTURE, () => {}); });
afterAll(() => fx.cleanup());

describe("CLI hardening (seams: process exit codes, HTTP responses, graph.json)", () => {
  it("serve survives a malformed URL, refuses foreign Host headers, and never leaves .code2flow/", async () => {
    const srv = await serveCommand(FIXTURE, viewerDir, () => {});
    try {
      // node:http, not fetch: undici silently drops a caller-supplied Host header
      const get = (path: string, host = "127.0.0.1:4317"): Promise<{ status: number; json: () => unknown }> => new Promise((ok, fail) => { const req = request({ host: "127.0.0.1", port: 4317, path, headers: { host } }, (res) => { let body = ""; res.on("data", (c) => (body += c)); res.on("end", () => ok({ status: res.statusCode ?? 0, json: () => JSON.parse(body) })); }); req.on("error", fail); req.end(); });
      expect((await get("/%")).status).toBe(400); // URIError used to kill the process
      expect((await get("/data/graph.json")).status).toBe(200); // still alive
      expect((await get("/data/graph.json", "evil.example:4317")).status).toBe(403); // DNS-rebinding guard
      expect((await get("/data/..%2F..%2Fpackage.json")).status).toBe(404); // basename() confines the lookup
      writeFileSync(join(FIXTURE, ".code2flow", "storage-state.json"), "{}"); writeFileSync(join(FIXTURE, ".code2flow", "run-summary.json"), "{}");
      expect((await get("/data/storage-state.json")).status).toBe(404); // the saved login session is never served (2026-09-04 audit C2)
      expect((await get("/data/run-summary.json")).status).toBe(404); // only the viewer's own data files
      expect((await get("/shots/%E0%A4%A")).status).toBe(400);
      expect(Object.values(((await get("/data/info.json")).json() as { shotIndex: Record<string, string> }).shotIndex)[0]).toMatch(/^[0-9a-f]{16}$/); // hash keys, not positions
    } finally { srv.close(); }
  });
  it("prints a one-line error and exits 1 for every command failure (no unhandled rejection)", async () => {
    const errors: string[] = []; const orig = console.error; console.error = (m: string) => errors.push(String(m));
    try {
      expect(await main(["stories", "bogus", FIXTURE])).toBe(1);
      expect(await main(["stories", "scaffold", FIXTURE, "/nope/prd.md"])).toBe(1);
      expect(await main(["export", FIXTURE, "--feature", "--out", "x"])).toBe(2);
      expect(await main(["diff", FIXTURE])).toBe(1);
    } finally { console.error = orig; }
    // The error echoes the path the platform resolved (`resolve()` adds a drive prefix on Windows).
    const missingPrd = `stories: PRD file not found: ${resolve("/nope/prd.md")}`;
    expect(errors).toEqual([expect.stringMatching(/^stories: unknown subcommand "bogus"/), missingPrd, "export: --feature needs a value", expect.stringMatching(/^diff: pass --from/)]);
  });
  it("detects the CLI entry through the npm bin symlink (a bare filename match exits silently)", () => {
    const selfPath = fileURLToPath(import.meta.url);
    const bin = join(FIXTURE, "bin"); mkdirSync(bin, { recursive: true }); symlinkSync(selfPath, join(bin, "code2flow"));
    expect(isCliEntry(join(bin, "code2flow"), import.meta.url)).toBe(true);
    expect(isCliEntry(selfPath, import.meta.url)).toBe(true);
    expect(isCliEntry("/nowhere/index.js", import.meta.url)).toBe(false);
    expect(isCliEntry(undefined, import.meta.url)).toBe(false);
  });
  it("keeps boolean flags from swallowing a repository positional and treats help as success", async () => {
    expect(parseArgs(["paths", "--orphans", FIXTURE]).positionals).toEqual([FIXTURE]);
    expect(await main(["--help"])).toBe(0);
  });

  it("re-scan keeps the counters the last snapshot recorded", async () => {
    const g = JSON.parse(readFileSync(GRAPH, "utf8")); g.counters.snapshot = { "capture-failed": 2, "no-url": 1 }; writeFileSync(GRAPH, JSON.stringify(g));
    await scanCommand(FIXTURE, () => {});
    expect(JSON.parse(readFileSync(GRAPH, "utf8")).counters.snapshot).toEqual({ "capture-failed": 2, "no-url": 1 });
  });
  it("lint reports the fixture's broken link and exits 1 on --fail-on error; diff sees the previous scan", async () => {
    const lines: string[] = [];
    expect(await lintCommand(FIXTURE, {}, (l) => lines.push(l))).toBe(1);
    expect(lines.join("\n")).toMatch(/broken-link/);
    const before = join(FIXTURE, "before.json"); writeFileSync(before, readFileSync(GRAPH));
    const g = JSON.parse(readFileSync(GRAPH, "utf8")); g.screens = g.screens.filter((s: { id: string }) => s.id !== "/team"); writeFileSync(GRAPH, JSON.stringify(g));
    const out: string[] = [];
    expect(await diffCommand(FIXTURE, { from: before, "exit-code": true }, (l) => out.push(l))).toBe(1);
    expect(out.join("\n")).toMatch(/\/team/);
  });
});
