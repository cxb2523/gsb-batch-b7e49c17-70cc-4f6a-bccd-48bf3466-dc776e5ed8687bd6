import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createFixtureRepositoryFetcher,
  createFixtureRepositoryFetcherFromPath,
  loadFixture
} from "../fixtureDataSource.js";

const fixturesDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures"
);

const organization = (handle) => ({
  handle,
  municipality: "Test Municipality",
  province: "Ontario",
  latitude: 0,
  longitude: 0
});

describe("createFixtureRepositoryFetcher", () => {
  it("resolves with the repository list and followers", async () => {
    const fetcher = createFixtureRepositoryFetcher({
      cityssm: {
        followers: 7,
        repos: [{ stargazers_count: 1 }]
      }
    });

    const result = await fetcher(organization("cityssm"));
    assert.equal(result.followers, 7);
    assert.ok(Array.isArray(result.repos));
    assert.equal(result.repos.length, 1);
  });

  it("resolves with an empty array for a zero-repository city", async () => {
    const fetcher = createFixtureRepositoryFetcher({
      cityofvancouver: { followers: 0, repos: [] }
    });

    const result = await fetcher(organization("cityofvancouver"));
    assert.deepEqual(result.repos, []);
  });

  it("rejects with the fixture error message for simulated failures", async () => {
    const fetcher = createFixtureRepositoryFetcher({
      CityofToronto: { error: "Simulated API failure" }
    });

    await assert.rejects(
      () => fetcher(organization("CityofToronto")),
      /Simulated API failure/
    );
  });

  it("rejects for handles missing from the fixture", async () => {
    const fetcher = createFixtureRepositoryFetcher({});

    await assert.rejects(
      () => fetcher(organization("unknown-handle")),
      /No fixture data found/
    );
  });

  it("passes non-array repos through so the builder can flag them", async () => {
    const fetcher = createFixtureRepositoryFetcher({
      cityofottawa: { repos: "not-an-array" }
    });

    const result = await fetcher(organization("cityofottawa"));
    assert.equal(Array.isArray(result.repos), false);
    assert.equal(result.repos, "not-an-array");
  });
});

describe("fixture files on disk", () => {
  it("loads the partial-failure fixture", async () => {
    const fixture = await loadFixture(
      path.join(fixturesDirectory, "partial-failure.json")
    );

    assert.ok(Array.isArray(fixture.cityssm.repos));
    assert.equal(fixture.CityofToronto.error.includes("404"), true);
    assert.equal(Array.isArray(fixture.cityofottawa.repos), false);
    assert.deepEqual(fixture.cityofvancouver.repos, []);
  });

  it("loads the all-failure fixture", async () => {
    const fixture = await loadFixture(
      path.join(fixturesDirectory, "all-failure.json")
    );

    for (const handle of Object.keys(fixture)) {
      const entry = fixture[handle];
      assert.ok(
        entry.error !== undefined || !Array.isArray(entry.repos),
        handle + " should describe a failure"
      );
    }
  });

  it("loads the zero-repositories fixture", async () => {
    const fetcher = await createFixtureRepositoryFetcherFromPath(
      path.join(fixturesDirectory, "zero-repositories.json")
    );

    const result = await fetcher(organization("cityofvancouver"));
    assert.deepEqual(result.repos, []);
  });
});
