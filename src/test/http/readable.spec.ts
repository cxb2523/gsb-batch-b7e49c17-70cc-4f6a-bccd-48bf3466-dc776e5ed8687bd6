import assert from "node:assert";
import { Readable, Writable } from "node:stream";
import { describe, test } from "node:test";
import { fetch as wreqFetch } from "../../wreq-js.js";
import { httpUrl, isLocalHttpBase } from "../helpers/http.js";

describe("response.readable()", () => {
  test("returns a Readable instance with .pipe()", { skip: !isLocalHttpBase }, async () => {
    const response = await wreqFetch(httpUrl("/json"), {
      browser: "chrome_142",
      timeout: 10_000,
    });

    const stream = response.readable();
    assert.ok(stream instanceof Readable, "should be a Readable instance");
    assert.strictEqual(typeof stream.pipe, "function", "should have .pipe()");

    // Consume stream to avoid resource leaks
    for await (const _ of stream) {
      // drain
    }
  });

  test("streams chunked response body correctly", { skip: !isLocalHttpBase }, async () => {
    const chunkCount = 4;
    const chunkSize = 512;
    const response = await wreqFetch(httpUrl(`/stream/chunks?n=${chunkCount}&size=${chunkSize}`), {
      browser: "chrome_142",
      timeout: 10_000,
    });

    const stream = response.readable();
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }

    const totalBytes = chunks.reduce((sum, c) => sum + c.length, 0);
    assert.strictEqual(totalBytes, chunkCount * chunkSize, "total bytes should match expected");
  });

  test(".pipe() works end-to-end with a writable stream", { skip: !isLocalHttpBase }, async () => {
    const response = await wreqFetch(httpUrl("/json"), {
      browser: "chrome_142",
      timeout: 10_000,
    });

    const collected: Buffer[] = [];

    const writable = new Writable({
      write(chunk, _encoding, callback) {
        collected.push(Buffer.from(chunk));
        callback();
      },
    });

    await new Promise<void>((resolve, reject) => {
      response.readable().pipe(writable);
      writable.on("finish", resolve);
      writable.on("error", reject);
    });

    const body = Buffer.concat(collected).toString("utf-8");
    const parsed = JSON.parse(body);
    assert.strictEqual(parsed.message, "local test server");
  });

  test("throws when body is already consumed", { skip: !isLocalHttpBase }, async () => {
    const response = await wreqFetch(httpUrl("/json"), {
      browser: "chrome_142",
      timeout: 10_000,
    });

    // Consume the body first
    await response.text();

    assert.throws(() => response.readable(), {
      name: "TypeError",
      message: /already used/,
    });
  });

  test("returns empty Readable for null body (HEAD request)", { skip: !isLocalHttpBase }, async () => {
    const response = await wreqFetch(httpUrl("/json"), {
      method: "HEAD",
      browser: "chrome_142",
      timeout: 10_000,
    });

    const stream = response.readable();
    assert.ok(stream instanceof Readable);

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }

    assert.strictEqual(chunks.length, 0, "HEAD response should yield no chunks");
  });

  test("sets bodyUsed to true", { skip: !isLocalHttpBase }, async () => {
    const response = await wreqFetch(httpUrl("/json"), {
      browser: "chrome_142",
      timeout: 10_000,
    });

    assert.strictEqual(response.bodyUsed, false, "bodyUsed should be false before readable()");
    const stream = response.readable();
    assert.strictEqual(response.bodyUsed, true, "bodyUsed should be true after readable()");

    // Drain to avoid leaks
    for await (const _ of stream) {
      // drain
    }
  });
});
