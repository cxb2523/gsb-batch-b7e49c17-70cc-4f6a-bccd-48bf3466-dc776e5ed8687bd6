import assert from "node:assert";
import { describe, test } from "node:test";
import { fetch as wreqFetch } from "../../wreq-js.js";
import { httpUrl } from "../helpers/http.js";

describe("HTTP errors", () => {
  test("handles timeout errors", async () => {
    await assert.rejects(
      async () => {
        await wreqFetch(httpUrl("/delay/10"), {
          browser: "chrome_142",
          timeout: 1000,
        });
      },
      {
        name: "RequestError",
      },
      "Should throw an error on timeout",
    );
  });

  test("rejects aborted requests with AbortError", async () => {
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      async () => {
        await wreqFetch(httpUrl("/get"), {
          browser: "chrome_142",
          signal: controller.signal,
          timeout: 1000,
        });
      },
      (error: unknown) => error instanceof Error && error.name === "AbortError",
      "Should reject with AbortError",
    );
  });
});
