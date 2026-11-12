/*
 * Replaceable, offline data source for local verification and tests.
 *
 * A fixture is a JSON file keyed by GitHub organization handle.
 * Every entry can express one of the three possible outcomes:
 *
 *   1. Successful fetch with repositories:
 *      "cityssm": { "followers": 5, "repos": [ { ...repo }, ... ] }
 *
 *   2. Successful fetch with zero public repositories:
 *      "cityofvancouver": { "followers": 0, "repos": [] }
 *
 *   3. Failed fetch (request error or invalid payload):
 *      "CityofToronto": { "error": "Simulated API failure" }
 *      "cityofottawa": { "repos": "not-an-array" }
 *
 * Select it when running the build by setting RANKINGS_FIXTURE_FILE:
 *
 *   RANKINGS_FIXTURE_FILE=./test/fixtures/partial-failure.json npm run build
 */

import fs from "node:fs/promises";

import type {
  FetchResult,
  Organization,
  Repository
} from "./rankingBuilder.js";

type Fixture = Record<
  string,
  { repos?: Repository[] | unknown; followers?: number; error?: string }
>;

type RepositoryFetcher = (
  organization: Organization
) => Promise<FetchResult>;

/**
 * Load a fixture JSON file from disk.
 */
export async function loadFixture(fixturePath: string): Promise<Fixture> {
  const contents = await fs.readFile(fixturePath, "utf8");
  return JSON.parse(contents) as Fixture;
}

/**
 * Build the fetchRepositories function backed by an in-memory fixture.
 *
 * Entries with an `error` property reject to simulate request failures.
 * Entries whose `repos` value is not an array resolve as-is so that the
 * ranking builder's own array validation can classify them as failures.
 * Handles missing from the fixture reject so typos surface immediately.
 */
export function createFixtureRepositoryFetcher(fixture: Fixture): RepositoryFetcher {
  return async (organization: Organization): Promise<FetchResult> => {
    const entry = fixture[organization.handle];

    if (entry === undefined) {
      throw new Error(
        'No fixture data found for organization "' + organization.handle + '".'
      );
    }

    if (entry.error !== undefined) {
      throw new Error(String(entry.error));
    }

    return {
      repos: entry.repos as Repository[],
      followers: entry.followers
    };
  };
}

/**
 * Convenience wrapper: load the fixture file and return the fetcher.
 */
export async function createFixtureRepositoryFetcherFromPath(
  fixturePath: string
): Promise<RepositoryFetcher> {
  const fixture = await loadFixture(fixturePath);
  return createFixtureRepositoryFetcher(fixture);
}
