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

interface Organization {
  handle: string;
  municipality: string;
  province: string;
  latitude: number;
  longitude: number;
}

interface Repository {
  private?: boolean;
  stargazers_count: number;
  forks: number;
  open_issues: number;
  language: string | null;
  updated_at: string;
  pushed_at: string;
}

interface FetchResult {
  repos: Repository[];
  followers?: number;
}

type FetchRepositories = (
  organization: Organization
) => Promise<FetchResult>;

interface OrganizationData {
  handle: string;
  municipality: string;
  province: string;
  latitude: number;
  longitude: number;
  followers?: number;
  repositories: number;
  stars: number;
  forks: number;
  issues: number;
  lastUpdate: string;
  languages: Record<string, number>;
  status: "success" | "failed";
  error?: string;
}

interface RankingData {
  organizations: OrganizationData[];
  failedOrganizations: OrganizationData[];
  refreshMillis: number;
}

/**
 * Turn a list of repositories into the aggregate statistics stored in data.json.
 */
export function buildOrganizationData(
  organization: Organization,
  repos: Repository[],
  followers?: number
): OrganizationData {
  const organizationData: OrganizationData = {
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
 */
export function buildFailedOrganizationData(
  organization: Organization,
  errorMessage: string
): OrganizationData {
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
 */
export function getErrorMessage(error: unknown): string {
  if (error === null || error === undefined) {
    return "Unknown error.";
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { message?: unknown }).message === "string" &&
    (error as { message: string }).message !== ""
  ) {
    return (error as { message: string }).message;
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
 */
export function compareOrganizations(
  organizationA: OrganizationData,
  organizationB: OrganizationData
): number {
  if (organizationA.stars !== organizationB.stars) {
    return organizationB.stars - organizationA.stars;
  } else if (organizationA.repositories !== organizationB.repositories) {
    return organizationB.repositories - organizationA.repositories;
  } else if (
    organizationA.handle.toLowerCase() < organizationB.handle.toLowerCase()
  ) {
    return -1;
  } else {
    return 1;
  }
}

/**
 * Fetch, classify and rank every municipality.
 */
export async function buildRankingData(
  organizations: Organization[],
  fetchRepositories: FetchRepositories,
  options: { now?: number } = {}
): Promise<RankingData> {
  const refreshMillis = options.now ?? Date.now();

  const results = await Promise.all(
    organizations.map(async (organization): Promise<OrganizationData> => {
      try {
        const result = await fetchRepositories(organization);

        if (!result || !Array.isArray(result.repos)) {
          return buildFailedOrganizationData(
            organization,
            "Repository list is not an array."
          );
        }

        return buildOrganizationData(
          organization,
          result.repos,
          result.followers
        );
      } catch (error) {
        return buildFailedOrganizationData(
          organization,
          getErrorMessage(error)
        );
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

export type {
  Organization,
  Repository,
  FetchResult,
  FetchRepositories,
  OrganizationData,
  RankingData
};
