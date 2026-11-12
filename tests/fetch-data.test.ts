import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { fetchStargazers } from "../src/fetch/fetch-data";
import {
  graphQlResponse,
  httpErrorResponse,
  installFetch,
  installLocalStorage,
  makeEdges,
  parseQuery,
  setGitHubToken,
} from "./test-helpers";

const repoOrg = "test-org";
const repoName = "test-repo";

const runFetch = (starCount: number) =>
  fetchStargazers({
    repoOrg,
    repoName,
    starCount,
    abortSignal: new AbortController().signal,
  });

describe("fetchStargazers", () => {
  beforeEach(() => {
    installLocalStorage();
    setGitHubToken();
  });

  it("fetches two full pages and stops once starCount is reached", async () => {
    const calls = installFetch((_call, index) =>
      graphQlResponse(
        index === 0
          ? makeEdges({ count: 100, lastCursor: "page-1-end" })
          : makeEdges({ count: 50, startIndex: 100, lastCursor: "page-2-end" }),
      ),
    );

    const stargazers = await runFetch(150);

    assert.equal(stargazers.length, 150);
    assert.equal(calls.length, 2);
    assert.ok(parseQuery(calls[0].body).includes("stargazers(first: 100)"));
    assert.ok(
      parseQuery(calls[1].body).includes(
        'stargazers(first: 50, after: "page-1-end")',
      ),
    );
    assert.equal(stargazers[149].login, "user-149");
  });

  it("stops early when a page comes back empty", async () => {
    const calls = installFetch((_call, index) =>
      index === 0
        ? graphQlResponse(makeEdges({ count: 100, lastCursor: "page-1-end" }))
        : graphQlResponse([]),
    );

    const stargazers = await runFetch(300);

    assert.equal(stargazers.length, 100);
    assert.equal(calls.length, 2);
  });

  it("stops when the cursor does not advance", async () => {
    const calls = installFetch((_call, index) =>
      graphQlResponse(
        index === 0
          ? makeEdges({ count: 100, lastCursor: "stuck-cursor" })
          : makeEdges({
              count: 100,
              startIndex: 100,
              lastCursor: "stuck-cursor",
            }),
      ),
    );

    const stargazers = await runFetch(300);

    assert.equal(stargazers.length, 200);
    assert.equal(calls.length, 2);
  });

  it("throws with the repository and completed page count when a page fails", async () => {
    const calls = installFetch((_call, index) =>
      index === 0
        ? graphQlResponse(makeEdges({ count: 100, lastCursor: "page-1-end" }))
        : httpErrorResponse(500, "server exploded"),
    );

    await assert.rejects(runFetch(200), (error: unknown) => {
      return (
        error instanceof Error &&
        error.message.includes(`${repoOrg}/${repoName}`) &&
        error.message.includes("after 1 completed page(s)") &&
        error.message.includes("HTTP 500")
      );
    });
    assert.equal(calls.length, 2);
  });
});
