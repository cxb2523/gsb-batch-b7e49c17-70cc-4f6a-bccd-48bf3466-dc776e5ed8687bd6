/*
 * Real GitHub data source backed by the github-api library.
 *
 * Converts the callback-based Organization.getRepos API into the
 * promise-based contract expected by rankingBuilder.buildRankingData:
 *
 *   fetchRepositories(organization) => Promise<{ repos, followers }>
 *
 * The promise rejects when the callback returns an error, and the
 * builder also rejects any resolved value whose repos property is
 * not an array.
 */

import GitHub from "github-api";

/**
 * Create the github-api client, authenticated when GH_TOKEN is set.
 * @returns {GitHub}
 */
export function createGitHubClient() {
  const token = process.env.GH_TOKEN;

  if (token && token !== "") {
    return new GitHub({ token });
  }

  console.log("No GH_TOKEN provided.");
  return new GitHub();
}

/**
 * Build the fetchRepositories function used by the ranking builder.
 * @param {GitHub} [gh] - a github-api client, created when omitted.
 * @returns {(organization: object) => Promise<{repos: Array, followers: number}>}
 */
export function createGitHubRepositoryFetcher(gh) {
  const client = gh ?? createGitHubClient();

  return (organization) => {
    const ghOrganization = client.getOrganization(organization.handle);

    if (!ghOrganization) {
      return Promise.reject(new Error("Organization not available."));
    }

    return new Promise((resolve, reject) => {
      ghOrganization.getRepos((err, repos) => {
        if (err) {
          reject(err);
          return;
        }

        resolve({
          repos,
          followers: ghOrganization.followers
        });
      });
    });
  };
}
