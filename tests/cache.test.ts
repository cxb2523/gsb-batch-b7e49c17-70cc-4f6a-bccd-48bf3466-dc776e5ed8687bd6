import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { QueryResult, getFromCache, saveResult } from "../src/cache";
import { installLocalStorage } from "./test-helpers";

const repoOrg = "test-org";
const cacheKey = (repoName: string) =>
  ["__stargazer", repoOrg, repoName, "100", null].join("-");

describe("getFromCache", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = installLocalStorage();
  });

  it("returns null when the cached JSON is corrupted", () => {
    storage.setItem(cacheKey("corrupted"), "{not valid json");

    assert.equal(
      getFromCache({
        repoOrg,
        repoName: "corrupted",
        count: 100,
        cursor: null,
      }),
      null,
    );
  });

  it("returns null when the cached value has no cursor", () => {
    storage.setItem(
      cacheKey("missing-cursor"),
      JSON.stringify({ results: [] }),
    );

    assert.equal(
      getFromCache({
        repoOrg,
        repoName: "missing-cursor",
        count: 100,
        cursor: null,
      }),
      null,
    );
  });

  it("returns null when results is not an array", () => {
    storage.setItem(
      cacheKey("bad-results"),
      JSON.stringify({ cursor: null, results: {} }),
    );

    assert.equal(
      getFromCache({
        repoOrg,
        repoName: "bad-results",
        count: 100,
        cursor: null,
      }),
      null,
    );
  });

  it("returns the cached result when the structure is valid", () => {
    const result: QueryResult = {
      cursor: "next-cursor",
      results: [
        {
          avatarUrl: "https://example.com/avatar.png",
          name: "Test User",
          date: "2024-01-01T00:00:00Z",
          login: "test-user",
        },
      ],
    };
    storage.setItem(cacheKey("valid"), JSON.stringify(result));

    assert.deepEqual(
      getFromCache({ repoOrg, repoName: "valid", count: 100, cursor: null }),
      result,
    );
  });

  it("still skips writes silently when the quota is exceeded", () => {
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };

    assert.doesNotThrow(() => {
      saveResult({
        repoOrg,
        repoName: "quota",
        count: 100,
        cursor: null,
        result: { cursor: null, results: [] },
      });
    });
  });
});
