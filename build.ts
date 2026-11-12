import * as fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildRankingData } from "./rankingBuilder.js";
import type { RankingData } from "./rankingBuilder.js";
import { createGitHubRepositoryFetcher } from "./githubDataSource.js";
import { createFixtureRepositoryFetcherFromPath } from "./fixtureDataSource.js";
import { organizations } from "./organizations.js";

/*
 * Entry point for the rankings build.
 *
 * By default data is pulled from GitHub using github-api.
 * Set RANKINGS_FIXTURE_FILE to a JSON fixture path to run the exact
 * same pipeline offline (see fixtureDataSource.js for the format).
 *
 * RANKINGS_OUTPUT_FILE optionally overrides where data.json is written.
 */

async function main(): Promise<RankingData> {
  const fixturePath = process.env.RANKINGS_FIXTURE_FILE;
  const outputPath = process.env.RANKINGS_OUTPUT_FILE || "./data.json";

  let fetchRepositories;

  if (fixturePath && fixturePath !== "") {
    console.log("Using fixture data source: " + fixturePath);
    fetchRepositories =
      await createFixtureRepositoryFetcherFromPath(fixturePath);
  } else {
    fetchRepositories = createGitHubRepositoryFetcher();
  }

  for (const organization of organizations) {
    console.log(
      "Processing " +
        organization.municipality +
        ", " +
        organization.province +
        " (" +
        organization.handle +
        ")..."
    );
  }

  const outputData = await buildRankingData(organizations, fetchRepositories);

  for (const failedOrganization of outputData.failedOrganizations) {
    console.error(
      "\t-Failed to fetch repositories for " +
        failedOrganization.handle +
        ": " +
        failedOrganization.error
    );
  }

  try {
    await fs.writeFile(outputPath, JSON.stringify(outputData, null, 2));
    console.log(
      "Data written for " +
        outputData.organizations.length.toString() +
        " municipalities (" +
        outputData.failedOrganizations.length.toString() +
        " failed)."
    );
  } catch (error) {
    console.error(error);
  }

  return outputData;
}

// Only run the build when this file is executed directly,
// so tests can import `main` without side effects.
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}

export { main };
