import assert from "node:assert";
import { describe, test } from "node:test";
import { ReadableStream } from "node:stream/web";
import { RequestError, fetch as wreqFetch } from "../../wreq-js.js";
import { httpUrl } from "../helpers/http.js";

const PAYLOAD = Buffer.from("stream body payload");

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

describe("Request body types", () => {
  test("sends a ReadableStream body", async () => {
    const response = await wreqFetch(httpUrl("/echo-body"), {
      method: "POST",
      timeout: 10_000,
      body: streamOf([PAYLOAD.subarray(0, 6), PAYLOAD.subarray(6)]),
    });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(Buffer.from(await response.arrayBuffer()).toString(), PAYLOAD.toString());
  });

  test("sends an async iterable body", async () => {
    async function* chunks() {
      yield PAYLOAD.subarray(0, 6);
      yield PAYLOAD.subarray(6);
    }

    const response = await wreqFetch(httpUrl("/echo-body"), {
      method: "POST",
      timeout: 10_000,
      body: chunks(),
    });

    assert.strictEqual(Buffer.from(await response.arrayBuffer()).toString(), PAYLOAD.toString());
  });

  test("sends a sync iterable body", async () => {
    const response = await wreqFetch(httpUrl("/echo-body"), {
      method: "POST",
      timeout: 10_000,
      body: [PAYLOAD.subarray(0, 6), PAYLOAD.subarray(6)],
    });

    assert.strictEqual(Buffer.from(await response.arrayBuffer()).toString(), PAYLOAD.toString());
  });

  test("rejects iterables that do not yield binary chunks", async () => {
    await assert.rejects(
      wreqFetch(httpUrl("/echo-body"), {
        method: "POST",
        timeout: 10_000,
        body: ["not binary"] as unknown as Uint8Array[],
      }),
      (error: unknown) => error instanceof TypeError && /must yield Uint8Array chunks/.test(error.message),
    );
  });

  test("keeps URLSearchParams and FormData on their own encoding path", async () => {
    // Both are iterable, so a mis-ordered iterable branch would swallow them and drop
    // the Content-Type these bodies are supposed to set.
    const params = await wreqFetch(httpUrl("/headers"), {
      method: "POST",
      timeout: 10_000,
      body: new URLSearchParams({ a: "1" }),
    });
    const paramsBody = await params.json<{ headers: Record<string, string> }>();
    assert.match(paramsBody.headers["Content-Type"] ?? "", /application\/x-www-form-urlencoded/);

    const form = new FormData();
    form.set("field", "value");
    const multipart = await wreqFetch(httpUrl("/headers"), { method: "POST", timeout: 10_000, body: form });
    const multipartBody = await multipart.json<{ headers: Record<string, string> }>();
    assert.match(multipartBody.headers["Content-Type"] ?? "", /multipart\/form-data/);
  });

  test("still rejects unsupported body types", async () => {
    await assert.rejects(
      wreqFetch(httpUrl("/echo-body"), {
        method: "POST",
        timeout: 10_000,
        body: 42 as unknown as string,
      }),
      (error: unknown) => error instanceof TypeError || error instanceof RequestError,
    );
  });
});

describe("Response.bytes()", () => {
  test("returns the body as a Uint8Array", async () => {
    const response = await wreqFetch(httpUrl("/binary?len=64"), { timeout: 10_000 });
    const bytes = await response.bytes();

    assert.ok(bytes instanceof Uint8Array);
    assert.strictEqual(bytes.length, 64);
    assert.strictEqual(bytes[0], 0);
    assert.strictEqual(bytes[63], 63);
  });

  test("marks the body as used", async () => {
    const response = await wreqFetch(httpUrl("/get"), { timeout: 10_000 });
    await response.bytes();

    assert.strictEqual(response.bodyUsed, true);
  });
});
