import test from "node:test";
import assert from "node:assert/strict";
import { readJson } from "./read-json.ts";

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request("https://jobs.whatrunsindia.com/api/x", { method: "POST", body, headers, duplex: "half" } as RequestInit);

test("parses a small same-origin body", async () => {
  const [body, error] = await readJson<{ email: string }>(post('{"email":"a@b.co"}', { "sec-fetch-site": "same-origin" }));
  assert.equal(error, null);
  assert.equal(body?.email, "a@b.co");
});

test("allows clients that send no Sec-Fetch-Site (they carry no cookies)", async () => {
  const [, error] = await readJson(post("{}"));
  assert.equal(error, null);
});

test("refuses same-site and cross-site requests", async () => {
  for (const site of ["same-site", "cross-site"]) {
    const [, error] = await readJson(post("{}", { "sec-fetch-site": site }));
    assert.equal(error?.status, 403, site);
  }
});

test("refuses an oversized body by Content-Length without reading it", async () => {
  const [, error] = await readJson(post("{}", { "content-length": "999999" }));
  assert.equal(error?.status, 413);
});

test("refuses an oversized chunked body while reading", async () => {
  const chunk = new TextEncoder().encode("x".repeat(8 * 1024));
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent++ < 100) controller.enqueue(chunk);
      else controller.close();
    },
  });
  const [, error] = await readJson(post(stream));
  assert.equal(error?.status, 413);
  assert.ok(sent < 100, "stopped reading early");
});

test("answers 400 to invalid JSON", async () => {
  const [, error] = await readJson(post("{nope"));
  assert.equal(error?.status, 400);
});
