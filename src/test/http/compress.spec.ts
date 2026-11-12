import assert from "node:assert";
import { describe, test } from "node:test";
import { fetch as wreqFetch } from "../../wreq-js.js";
import { httpUrl, isLocalHttpBase } from "../helpers/http.js";

describe("Compression handling", () => {
  test("decompresses response body by default", { skip: !isLocalHttpBase }, async () => {
    const response = await wreqFetch(httpUrl("/gzip"), {
      browser: "chrome_142",
      timeout: 10_000,
    });

    assert.strictEqual(response.status, 200);
    const body = await response.json<{ message: string; gzipped: boolean }>();
    assert.strictEqual(body.message, "compressed");
    assert.strictEqual(body.gzipped, true);
  });

  test("compress: false returns raw compressed body", { skip: !isLocalHttpBase }, async () => {
    const response = await wreqFetch(httpUrl("/gzip"), {
      browser: "chrome_142",
      compress: false,
      timeout: 10_000,
    });

    assert.strictEqual(response.status, 200);

    // Content-Encoding should be preserved when decompression is disabled
    assert.strictEqual(response.headers.get("content-encoding"), "gzip");

    // Body should be raw gzip bytes, not decompressed JSON
    const buf = Buffer.from(await response.arrayBuffer());

    // Gzip magic number: 0x1f 0x8b
    assert.strictEqual(buf[0], 0x1f, "First byte should be gzip magic number 0x1f");
    assert.strictEqual(buf[1], 0x8b, "Second byte should be gzip magic number 0x8b");
  });

  test("compress: true explicitly decompresses (same as default)", { skip: !isLocalHttpBase }, async () => {
    const response = await wreqFetch(httpUrl("/gzip"), {
      browser: "chrome_142",
      compress: true,
      timeout: 10_000,
    });

    assert.strictEqual(response.status, 200);
    const body = await response.json<{ message: string; gzipped: boolean }>();
    assert.strictEqual(body.message, "compressed");
    assert.strictEqual(body.gzipped, true);
  });
});
