import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildOrganizationData,
  buildFailedOrganizationData,
  buildRankingData,
  compareOrganizations,
  getErrorMessage
} from "../rankingBuilder.js";

const organizations = [
  {
    handle: "cityssm",
    municipality: "City of Sault Ste. Marie",
    province: "Ontario",
    latitude: 46.5197,
    longitude: -84.3421
  },
  {
    handle: "CityofToronto",
    municipality: "City of Toronto",
    province: "Ontario",
    latitude: 43.6532,
    longitude: -79.3832
  },
  {
    handle: "cityofottawa",
    municipality: "City of Ottawa",
    province: "Ontario",
    latitude: 45.4215,
    longitude: -75.6972
  },
  {
    handle: "cityofvancouver",
    municipality: "City of Vancouver",
    province: "British Columbia",
    latitude: 49.2827,
    longitude: -123.1207
  }
];

const sampleRepos = [
  {
    private: false,
    stargazers_count: 10,
    forks: 2,
    open_issues: 5,
    language: "TypeScript",
    updated_at: "2026-10-01T00:00:00Z",
    pushed_at: "2026-10-02T00:00:00Z"
  },
  {
    private: true,
    stargazers_count: 99,
    forks: 99,
    open_issues: 99,
    language: "SecretLang",
    updated_at: "2026-11-01T00:00:00Z",
    pushed_at: "2026-11-02T00:00:00Z"
  },
  {
    private: false,
    stargazers_count: 5,
    forks: 1,
    open_issues: 0,
    language: null,
    updated_at: "2026-09-01T00:00:00Z",
    pushed_at: "2026-09-02T00:00:00Z"
  }
];

/**
 * Build a fetchRepositories implementation from a simple map,
 * mirroring the fixture data source contract.
 */
function fetcherFromMap(map) {
  return async (organization) => {
    const entry = map[organization.handle];

    if (entry === undefined) {
      throw new Error('No data for "' + organization.handle + '".');
    }

    if (entry.error !== undefined) {
      throw new Error(String(entry.error));
    }

    return {
      repos: entry.repos,
      followers: entry.followers
    };
  };
}

const FIXED_NOW = 1700000000000;

describe("buildOrganizationData", () => {
  it("aggregates public repositories and skips private ones", () => {
    const result = buildOrganizationData(organizations[0], sampleRepos, 42);

    assert.equal(result.status, "success");
    assert.equal(result.repositories, 2);
    assert.equal(result.stars, 15);
    assert.equal(result.forks, 3);
    assert.equal(result.issues, 5);
    assert.equal(result.followers, 42);
    assert.deepEqual(result.languages, { TypeScript: 1, null: 1 });
    assert.equal(result.lastUpdate, "2026-10-02T00:00:00Z");
  });

  it("returns zeroed statistics for an empty repository list", () => {
    const result = buildOrganizationData(organizations[3], [], 0);

    assert.equal(result.status, "success");
    assert.equal(result.repositories, 0);
    assert.equal(result.stars, 0);
    assert.equal(result.forks, 0);
    assert.equal(result.issues, 0);
    assert.equal(result.lastUpdate, "");
    assert.deepEqual(result.languages, {});
  });
});

describe("buildFailedOrganizationData", () => {
  it("records the handle, municipality and failure reason", () => {
    const result = buildFailedOrganizationData(
      organizations[1],
      "Request failed"
    );

    assert.equal(result.status, "failed");
    assert.equal(result.handle, "CityofToronto");
    assert.equal(result.municipality, "City of Toronto");
    assert.equal(result.error, "Request failed");
  });
});

describe("getErrorMessage", () => {
  it("uses the message of an Error", () => {
    assert.equal(getErrorMessage(new Error("boom")), "boom");
  });

  it("passes strings through", () => {
    assert.equal(getErrorMessage("plain"), "plain");
  });

  it("handles null and undefined", () => {
    assert.equal(getErrorMessage(null), "Unknown error.");
    assert.equal(getErrorMessage(undefined), "Unknown error.");
  });

  it("serializes plain objects", () => {
    assert.equal(getErrorMessage({ code: 500 }), '{"code":500}');
  });
});

describe("compareOrganizations", () => {
  it("sorts by stars descending", () => {
    const a = { handle: "a", stars: 5, repositories: 1 };
    const b = { handle: "b", stars: 10, repositories: 1 };
    assert.ok(compareOrganizations(a, b) > 0);
    assert.ok(compareOrganizations(b, a) < 0);
  });

  it("breaks star ties by repository count descending", () => {
    const a = { handle: "a", stars: 5, repositories: 1 };
    const b = { handle: "b", stars: 5, repositories: 4 };
    assert.ok(compareOrganizations(a, b) > 0);
  });

  it("breaks remaining ties by handle, case-insensitive ascending", () => {
    const a = { handle: "Zeta", stars: 0, repositories: 0 };
    const b = { handle: "alpha", stars: 0, repositories: 0 };
    assert.ok(compareOrganizations(a, b) > 0);
    assert.ok(compareOrganizations(b, a) < 0);
  });
});

describe("buildRankingData - partial failure", () => {
  const map = {
    cityssm: { followers: 42, repos: sampleRepos },
    CityofToronto: { error: "Simulated API failure" },
    cityofottawa: { repos: "not-an-array" },
    cityofvancouver: { followers: 3, repos: [] }
  };

  it("separates successes from failures and keeps zero-repo cities ranked", async () => {
    const result = await buildRankingData(
      organizations,
      fetcherFromMap(map),
      { now: FIXED_NOW }
    );

    assert.equal(result.refreshMillis, FIXED_NOW);

    // Two successes, one of which has zero repositories.
    assert.equal(result.organizations.length, 2);
    const handles = result.organizations.map((org) => org.handle);
    assert.deepEqual(handles, ["cityssm", "cityofvancouver"]);

    // Every successful record keeps the original field structure.
    for (const organization of result.organizations) {
      assert.equal(organization.status, "success");
      for (const field of [
        "handle",
        "municipality",
        "province",
        "latitude",
        "longitude",
        "repositories",
        "stars",
        "forks",
        "issues",
        "lastUpdate",
        "languages"
      ]) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(organization, field),
          "missing field " + field
        );
      }
    }

    // The zero-repository city stays in the ranking with zero stars
    // and is not treated as a failure.
    const vancouver = result.organizations.find(
      (org) => org.handle === "cityofvancouver"
    );
    assert.equal(vancouver.repositories, 0);
    assert.equal(vancouver.stars, 0);

    // Both failure modes are recorded with handle, municipality and reason.
    assert.equal(result.failedOrganizations.length, 2);
    const failedHandles = result.failedOrganizations.map((org) => org.handle);
    assert.deepEqual(failedHandles.sort(), ["CityofToronto", "cityofottawa"]);

    const toronto = result.failedOrganizations.find(
      (org) => org.handle === "CityofToronto"
    );
    assert.equal(toronto.status, "failed");
    assert.equal(toronto.municipality, "City of Toronto");
    assert.equal(toronto.error, "Simulated API failure");

    const ottawa = result.failedOrganizations.find(
      (org) => org.handle === "cityofottawa"
    );
    assert.equal(ottawa.status, "failed");
    assert.equal(ottawa.error, "Repository list is not an array.");
  });

  it("excludes failed cities from aggregated totals and sorting", async () => {
    const result = await buildRankingData(
      organizations,
      fetcherFromMap(map),
      { now: FIXED_NOW }
    );

    const totalRepositories = result.organizations.reduce(
      (sum, org) => sum + org.repositories,
      0
    );
    const totalStars = result.organizations.reduce(
      (sum, org) => sum + org.stars,
      0
    );
    const totalForks = result.organizations.reduce(
      (sum, org) => sum + org.forks,
      0
    );
    const totalIssues = result.organizations.reduce(
      (sum, org) => sum + org.issues,
      0
    );

    // cityssm: 2 public repos, 15 stars, 3 forks, 5 issues;
    // cityofvancouver: all zero. Nothing from the failed cities.
    assert.equal(totalRepositories, 2);
    assert.equal(totalStars, 15);
    assert.equal(totalForks, 3);
    assert.equal(totalIssues, 5);

    // Failed handles never appear in the ranked list.
    for (const failed of result.failedOrganizations) {
      assert.ok(
        !result.organizations.some((org) => org.handle === failed.handle)
      );
    }
  });
});

describe("buildRankingData - all failures", () => {
  const map = {
    cityssm: { error: "Internal Server Error" },
    CityofToronto: { error: "Network request failed" },
    cityofottawa: { repos: null },
    cityofvancouver: { error: "Rate limit exceeded" }
  };

  it("returns an empty ranking and records every failure", async () => {
    const result = await buildRankingData(
      organizations,
      fetcherFromMap(map),
      { now: FIXED_NOW }
    );

    assert.deepEqual(result.organizations, []);
    assert.equal(result.failedOrganizations.length, 4);
    assert.equal(result.refreshMillis, FIXED_NOW);

    for (const failed of result.failedOrganizations) {
      assert.equal(failed.status, "failed");
      assert.equal(typeof failed.handle, "string");
      assert.equal(typeof failed.municipality, "string");
      assert.equal(typeof failed.error, "string");
      assert.ok(failed.error.length > 0);
    }

    // The null repos payload is classified by the array check.
    const ottawa = result.failedOrganizations.find(
      (org) => org.handle === "cityofottawa"
    );
    assert.equal(ottawa.error, "Repository list is not an array.");
  });
});

describe("buildRankingData - zero repositories", () => {
  const zeroOrganizations = [
    {
      handle: "cityofvancouver",
      municipality: "City of Vancouver",
      province: "British Columbia",
      latitude: 49.2827,
      longitude: -123.1207
    },
    {
      handle: "Clearwater-County",
      municipality: "Clearwater County",
      province: "Alberta",
      latitude: 52.9733,
      longitude: -114.9211
    },
    {
      handle: "alpha-town",
      municipality: "Alpha Town",
      province: "Ontario",
      latitude: 0,
      longitude: 0
    }
  ];

  const map = {
    cityofvancouver: { followers: 0, repos: [] },
    "Clearwater-County": { followers: 1, repos: [] },
    "alpha-town": { repos: [] }
  };

  it("keeps zero-repository cities in the ranking with zero stats and no failures", async () => {
    const result = await buildRankingData(
      zeroOrganizations,
      fetcherFromMap(map),
      { now: FIXED_NOW }
    );

    assert.equal(result.organizations.length, 3);
    assert.deepEqual(result.failedOrganizations, []);

    for (const organization of result.organizations) {
      assert.equal(organization.status, "success");
      assert.equal(organization.repositories, 0);
      assert.equal(organization.stars, 0);
      assert.equal(organization.forks, 0);
      assert.equal(organization.issues, 0);
      assert.equal(organization.lastUpdate, "");
      assert.deepEqual(organization.languages, {});
    }

    // Zero/zero ties fall through to case-insensitive handle ordering.
    // "alpha-town" < "cityofvancouver" (ci) < "Clearwater-County" (cl)
    assert.deepEqual(
      result.organizations.map((org) => org.handle),
      ["alpha-town", "cityofvancouver", "Clearwater-County"]
    );
  });
});
