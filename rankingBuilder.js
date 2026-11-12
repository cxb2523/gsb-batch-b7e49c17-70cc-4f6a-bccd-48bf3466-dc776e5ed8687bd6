/*
 * Core build logic for the municipal GitHub rankings.
 *
 * This module is intentionally independent of the github-api library.
 * Repository data is fetched through an injectable `fetchRepositories`
 * function so the whole pipeline can be tested without calling GitHub.
 *
 * A municipality ends up in one of three states:
 *   - success with one or more public repositories
 *   - success with zero public repositories (still included in the rankings)
 *   - failure (the request errored, or the response was not an array),
 *     recorded separately and excluded from totals and sorting
 */

/**
 * @typedef {Object} Organization
 * @property {string} handle
 * @property {string} municipality
 * @property {string} province
 * @property {number} latitude
 * @property {number} longitude
 */

/**
 * @typedef {Object} FetchResult
 * @property {Array} repos - raw GitHub repository objects
 * @property {number} [followers]
 */

/**
 * Turn a list of repositories into the aggregate statistics stored in data.json.
 * @param {Organization} organization
 * @param {Array} repos - array of raw GitHub repository objects
 * @param {number} [followers]
 * @returns {object} organization data record with status "success"
 */
export function buildOrganizationData(organization, repos, followers) {
  const organizationData = {
    handle: organization.handle,
    municipality: organization.municipality,
    province: organization.province,
    latitude: organization.latitude,
    longitude: organization.longitude,
    followers,
    repositories: 0,
    stars: 0,
    forks: 0,
    issues: 0,
    lastUpdate: "",
    languages: {},
    status: "success"
  };

  for (const repo of repos) {
    if (repo.private) {
      continue;
    }

    organizationData.repositories += 1;

    organizationData.stars += repo.stargazers_count;
    organizationData.forks += repo.forks;
    organizationData.issues += repo.open_issues;

    if (!organizationData.languages[repo.language]) {
      organizationData.languages[repo.language] = 0;
    }

    organizationData.languages[repo.language] += 1;

    if (organizationData.lastUpdate < repo.updated_at) {
      organizationData.lastUpdate = repo.updated_at;
    }

    if (organizationData.lastUpdate < repo.pushed_at) {
      organizationData.lastUpdate = repo.pushed_at;
    }
  }

  return organizationData;
}

/**
 * Build a failure record for a municipality whose repository list
 * could not be retrieved.
 * @param {Organization} organization
 * @param {string} errorMessage
 * @returns {object} organization data record with status "failed"
 */
export function buildFailedOrganizationData(organization, errorMessage) {
  return {
    handle: organization.handle,
    municipality: organization.municipality,
    province: organization.province,
    latitude: organization.latitude,
    longitude: organization.longitude,
    status: "failed",
    error: errorMessage
  };
}

/**
 * Extract a human-readable message from anything thrown by a data source.
 * @param {unknown} error
 * @returns {string}
 */
export function getErrorMessage(error) {
  if (error === null || error === undefined) {
    return "Unknown error.";
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (typeof error.message === "string" && error.message !== "") {
    return error.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Ranking comparator, unchanged from the original build script:
 * stars descending, then repositories descending,
 * then handle ascending using a case-insensitive comparison.
 * @param {object} organizationA
 * @param {object} organizationB
 * @returns {number}
 */
export function compareOrganizations(organizationA, organizationB) {
  if (organizationA.stars !== organizationB.stars) {
    return organizationB.stars - organizationA.stars;
  } else if (organizationA.repositories !== organizationB.repositories) {
    return organizationB.repositories - organizationA.repositories;
  } else if (organizationA.handle.toLowerCase() < organizationB.handle.toLowerCase()) {
    return -1;
  } else {
    return 1;
  }
}

/**
 * Fetch, classify and rank every municipality.
 * @param {Organization[]} organizations
 * @param {(organization: Organization) => Promise<FetchResult>} fetchRepositories
 *   resolves with the repository list for one municipality, or rejects.
 *   A resolved value whose `repos` property is not an array is treated
 *   as a failure, matching the github-api callback contract.
 * @param {{ now?: number }} [options]
 * @returns {Promise<{organizations: object[], failedOrganizations: object[], refreshMillis: number}>}
 */
export async function buildRankingData(organizations, fetchRepositories, options = {}) {
  const refreshMillis = options.now ?? Date.now();

  const results = await Promise.all(
    organizations.map(async (organization) => {
      try {
        const result = await fetchRepositories(organization);

        if (!result || !Array.isArray(result.repos)) {
          return buildFailedOrganizationData(
            organization,
            "Repository list is not an array."
          );
        }

        return buildOrganizationData(organization, result.repos, result.followers);
      } catch (error) {
        return buildFailedOrganizationData(organization, getErrorMessage(error));
      }
    })
  );

  const successfulOrganizations = results.filter(
    (result) => result.status === "success"
  );

  const failedOrganizations = results.filter(
    (result) => result.status === "failed"
  );

  // Failed municipalities never participate in the ranking.
  successfulOrganizations.sort(compareOrganizations);

  return {
    organizations: successfulOrganizations,
    failedOrganizations,
    refreshMillis
  };
}
