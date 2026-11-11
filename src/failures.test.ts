import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  failureFileStem,
  makeRecordingExecutor,
  MAX_FAILURE_BODY_BYTES,
  startFailureRun,
  writeFailure,
  type FailureRecord
} from "./failures.js";
import type { Provider, ProviderFetchResult, WebAccessTestConfig } from "./types.js";

const target: WebAccessTestConfig = { name: "Example Shop", url: "https://example.test/item", containsText: "Add to cart" };

function withTempDir(fn: (dir: string) => Promise<void> | void): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "failures-test-"));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

function fakeProvider(fetch: () => Promise<ProviderFetchResult>): Provider {
  return { name: "fake", envKeys: [], fetch };
}

function readRecord(path: string): FailureRecord {
  return JSON.parse(readFileSync(path, "utf8")) as FailureRecord;
}

test("file stems are file-system safe", () => {
  assert.equal(failureFileStem("Example Shop / US", 3), "Example_Shop_US-3");
});

test(
  "each run gets its own timestamped directory, even when two start in the same millisecond",
  withTempDir((dir) => {
    const now = new Date("2026-11-12T08:30:00.000Z");
    const first = startFailureRun(dir, now);
    const second = startFailureRun(dir, now);
    assert.equal(first.runId, "run-2026-11-12T08-30-00-000Z");
    assert.equal(second.runId, "run-2026-11-12T08-30-00-000Z-2");
    assert.equal(first.dir, join(dir, first.runId));
    assert.equal(second.dir, join(dir, second.runId));
    assert.ok(statSync(first.dir).isDirectory());
    assert.ok(statSync(second.dir).isDirectory());
    // Starting a run on an existing directory must not throw.
    const again = startFailureRun(dir, now);
    assert.equal(again.runId, "run-2026-11-12T08-30-00-000Z-3");
  })
);

test(
  "two runs of the same test and attempt keep both bodies and sidecars, each tagged with its run id",
  withTempDir(async (dir) => {
    const runA = startFailureRun(dir, new Date("2026-11-12T08:30:00.000Z"));
    const runB = startFailureRun(dir, new Date("2026-11-12T09:45:00.000Z"));
    const bodyA = "<html><body>captcha from run A</body></html>";
    const bodyB = "<html><body>captcha from run B</body></html>";

    const execA = makeRecordingExecutor(fakeProvider(async () => ({ body: bodyA, statusCode: 200, traceId: "trace-a" })), runA);
    const execB = makeRecordingExecutor(fakeProvider(async () => ({ body: bodyB, statusCode: 200, traceId: "trace-b" })), runB);
    const [resultA, resultB] = await Promise.all([execA(target, 1_000, 0), execB(target, 1_000, 0)]);
    assert.equal(resultA.success, false);
    assert.equal(resultB.success, false);

    // Same test, same attempt number, different run directories: both must exist.
    const fileA = join(runA.dir, "fake", "Example_Shop-1.html");
    const fileB = join(runB.dir, "fake", "Example_Shop-1.html");
    assert.equal(readFileSync(fileA, "utf8"), bodyA);
    assert.equal(readFileSync(fileB, "utf8"), bodyB);

    const recordA = readRecord(join(runA.dir, "fake", "Example_Shop-1.json"));
    const recordB = readRecord(join(runB.dir, "fake", "Example_Shop-1.json"));
    assert.equal(recordA.runId, runA.runId);
    assert.equal(recordB.runId, runB.runId);
    assert.equal(recordA.traceId, "trace-a");
    assert.equal(recordB.traceId, "trace-b");
    assert.equal(recordA.attempt, 1);
    assert.equal(recordB.attempt, 1);
    assert.notEqual(recordA.runId, recordB.runId);
  })
);

test(
  "a 200 captcha page is kept as the scored body with a sidecar",
  withTempDir(async (dir) => {
    const run = startFailureRun(dir);
    const captcha = "<html><body>Please verify you are human</body></html>";
    const executor = makeRecordingExecutor(fakeProvider(async () => ({ body: captcha, statusCode: 200, traceId: "abc123" })), run);

    const result = await executor(target, 1_000, 1);
    assert.equal(result.success, false);
    assert.equal(result.errorMessage, "Missing expected text");
    assert.equal(result.traceId, "abc123");

    assert.equal(readFileSync(join(run.dir, "fake", "Example_Shop-2.html"), "utf8"), captcha);
    const record = readRecord(join(run.dir, "fake", "Example_Shop-2.json"));
    assert.equal(record.runId, run.runId);
    assert.equal(record.provider, "fake");
    assert.equal(record.test, "Example Shop");
    assert.equal(record.url, target.url);
    assert.equal(record.attempt, 2);
    assert.equal(record.statusCode, 200);
    assert.equal(record.errorMessage, "Missing expected text");
    assert.equal(record.traceId, "abc123");
    assert.equal(record.bodyFile, "Example_Shop-2.html");
    assert.equal(record.bodyTruncated, false);
    assert.ok(!Number.isNaN(Date.parse(record.timestamp)));
  })
);

test(
  "successful attempts write nothing and keep the result unchanged",
  withTempDir(async (dir) => {
    const run = startFailureRun(dir);
    const executor = makeRecordingExecutor(fakeProvider(async () => ({ body: "<p>Add to cart</p>", statusCode: 200, traceId: "t" })), run);
    const result = await executor(target, 1_000, 0);
    assert.equal(result.success, true);
    assert.equal(result.traceId, undefined);
    assert.deepEqual(readdirSync(run.dir), []);
  })
);

test(
  "a thrown error keeps its trace id and writes a sidecar without a body file",
  withTempDir(async (dir) => {
    const run = startFailureRun(dir);
    const executor = makeRecordingExecutor(
      fakeProvider(async () => {
        throw Object.assign(new Error("fake request failed with status 502"), { traceId: "err-trace" });
      }),
      run
    );
    const result = await executor(target, 1_000, 0);
    assert.equal(result.success, false);
    assert.equal(result.traceId, "err-trace");

    assert.deepEqual(readdirSync(join(run.dir, "fake")), ["Example_Shop-1.json"]);
    const record = readRecord(join(run.dir, "fake", "Example_Shop-1.json"));
    assert.equal(record.runId, run.runId);
    assert.equal(record.statusCode, null);
    assert.equal(record.bodyFile, null);
    assert.equal(record.errorMessage, "fake request failed with status 502");
    assert.equal(record.traceId, "err-trace");
  })
);

test(
  "non-2xx JSON bodies are saved as text, and oversized bodies are capped with the sidecar recording the true size",
  withTempDir((dir) => {
    const run = startFailureRun(dir);
    const json = writeFailure(run, "fake", target, 1, { success: false, latencyMs: 5, errorMessage: "Status 403" }, {
      body: { error: "blocked" },
      statusCode: 403
    });
    assert.equal(json.bodyFile, "Example_Shop-1.txt");
    assert.equal(readFileSync(join(run.dir, "fake", "Example_Shop-1.txt"), "utf8"), '{"error":"blocked"}');
    assert.equal(json.traceId, null);

    const huge = "<html>" + "x".repeat(MAX_FAILURE_BODY_BYTES);
    const capped = writeFailure(run, "fake", target, 2, { success: false, latencyMs: 5, errorMessage: "Missing expected text" }, {
      body: huge,
      statusCode: 200
    });
    assert.equal(capped.bodyTruncated, true);
    assert.equal(capped.bodyBytes, huge.length);
    assert.equal(statSync(join(run.dir, "fake", "Example_Shop-2.html")).size, MAX_FAILURE_BODY_BYTES);

    const record = readRecord(join(run.dir, "fake", "Example_Shop-2.json"));
    assert.equal(record.runId, run.runId);
    assert.equal(record.bodyBytes, huge.length);
    assert.equal(record.bodyTruncated, true);
    assert.equal(record.bodyFile, "Example_Shop-2.html");
    assert.ok(existsSync(join(run.dir, "fake", "Example_Shop-2.html")));
  })
);
