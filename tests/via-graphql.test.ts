import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { fetchViaGraphQl } from "../src/fetch/via-graphql";
import {
  graphQlResponse,
  installFetch,
  installLocalStorage,
  makeEdges,
  rateLimitedResponse,
  setGitHubToken,
} from "./test-helpers";

const repoOrg = "test-org";
const repoName = "test-repo";

describe("fetchViaGraphQl rate limiting", () => {
  beforeEach(() => {
    installLocalStorage();
    setGitHubToken();
  });

  it("gives up after 3 retries when GitHub keeps rate limiting", async () => {
    const calls = installFetch(() => rateLimitedResponse());
    const controller = new AbortController();

    await assert.rejects(
      fetchViaGraphQl({
        repoOrg,
        repoName,
        count: 100,
        cursor: null,
        abortSignal: controller.signal,
        retryDelayMs: 0,
      }),
      (error: unknown) => {
        return (
          error instanceof Error &&
          error.name === "RateLimitError" &&
          error.message.includes(`${repoOrg}/${repoName}`) &&
          error.message.includes("3 retries")
        );
      },
    );
    assert.equal(calls.length, 4);
  });

  it("succeeds when a retry is no longer rate limited", async () => {
    let attempt = 0;
    const calls = installFetch(() => {
      attempt += 1;
      return attempt <= 2
        ? rateLimitedResponse()
        : graphQlResponse(makeEdges({ count: 1 }));
    });
    const controller = new AbortController();

    const result = await fetchViaGraphQl({
      repoOrg,
      repoName,
      count: 100,
      cursor: null,
      abortSignal: controller.signal,
      retryDelayMs: 0,
    });

    assert.equal(calls.length, 3);
    assert.equal(result.results.length, 1);
    assert.equal(result.cursor, "cursor-0");
  });

  it("cancels during the retry wait without making another request", async () => {
    const calls = installFetch(() => rateLimitedResponse());
    const controller = new AbortController();

    const promise = fetchViaGraphQl({
      repoOrg,
      repoName,
      count: 100,
      cursor: null,
      abortSignal: controller.signal,
      retryDelayMs: 60_000,
    });

    // Let the first request settle and the retry wait begin.
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await assert.rejects(promise, (error: unknown) => {
      return error instanceof Error && error.name === "AbortError";
    });
    assert.equal(calls.length, 1);
  });
});
