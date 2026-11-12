/*
 * Real GitHub data source backed by the github-api library.
 *
 * Converts the callback-based Organization.getRepos API into the
 * promise-based contract expected by rankingBuilder.buildRankingData.
 */

import GitHub from "github-api";

import type {
  FetchResult,
  Organization
} from "./rankingBuilder.js";

/**
 * Create the github-api client, authenticated when GH_TOKEN is set.
 */
export function createGitHubClient(): GitHub {
  const token = process.env.GH_TOKEN;

  if (token && token !== "") {
    return new GitHub({ token });
  }

  console.log("No GH_TOKEN provided.");
  return new GitHub();
}

/**
 * Build the fetchRepositories function used by the ranking builder.
 */
export function createGitHubRepositoryFetcher(
  gh?: GitHub
): (organization: Organization) => Promise<FetchResult> {
  const client = gh ?? createGitHubClient();

  return (organization: Organization): Promise<FetchResult> => {
    const ghOrganization = client.getOrganization(organization.handle);

    if (!ghOrganization) {
      return Promise.reject(new Error("Organization not available."));
    }

    return new Promise((resolve, reject) => {
      ghOrganization.getRepos((err: unknown, repos: unknown) => {
        if (err) {
          reject(err);
          return;
        }

        resolve({
          repos: repos as FetchResult["repos"],
          followers: ghOrganization.followers
        });
      });
    });
  };
}
