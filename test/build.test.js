import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { main } from "../build.js";
import { organizations } from "../organizations.js";

const fixturesDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures"
);

let tempDirectory;

before(async () => {
  tempDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "municipal-rankings-")
  );
});

after(async () => {
  await fs.rm(tempDirectory, { recursive: true, force: true });
});

/**
 * Run the full build pipeline against a fixture and return
 * the data.json contents written to a temp directory.
 */
async function runBuild(fixtureName) {
  const outputFile = path.join(tempDirectory, fixtureName + "-data.json");

  process.env.RANKINGS_FIXTURE_FILE = path.join(
    fixturesDirectory,
    fixtureName + ".json"
  );
  process.env.RANKINGS_OUTPUT_FILE = outputFile;

  const result = await main();

  const written = JSON.parse(await fs.readFile(outputFile, "utf8"));

  // The returned value and the written file must describe the same run.
  assert.deepEqual(written, result);

  return written;
}

describe("build pipeline end to end", () => {
  it("handles a partial failure without real GitHub calls", async () => {
    const data = await runBuild("partial-failure");

    assert.ok(Array.isArray(data.organizations));
    assert.ok(Array.isArray(data.failedOrganizations));
    assert.equal(typeof data.refreshMillis, "number");

    // 19 municipalities: two failed, seventeen succeeded.
    assert.equal(
      data.organizations.length + data.failedOrganizations.length,
      organizations.length
    );
    assert.equal(data.organizations.length, 17);
    assert.equal(data.failedOrganizations.length, 2);

    // Highest-star city is ranked first.
    assert.equal(data.organizations[0].handle, "cityssm");
    const cityssm = data.organizations.find((org) => org.handle === "cityssm");
    assert.equal(cityssm.repositories, 2);
    assert.equal(cityssm.stars, 15);
    assert.equal(cityssm.forks, 3);
    assert.equal(cityssm.issues, 5);
    assert.equal(cityssm.status, "success");

    // The zero-repository city stays in the ranking with zero stats
    // and is not mixed into the failure list.
    const vancouver = data.organizations.find(
      (org) => org.handle === "cityofvancouver"
    );
    assert.equal(vancouver.repositories, 0);
    assert.equal(vancouver.stars, 0);
    assert.equal(vancouver.status, "success");

    assert.deepEqual(
      data.failedOrganizations.map((org) => org.handle).sort(),
      ["CityofToronto", "cityofottawa"]
    );

    // Both failure modes: callback-style error and non-array payload.
    const toronto = data.failedOrganizations.find(
      (org) => org.handle === "CityofToronto"
    );
    assert.equal(toronto.municipality, "City of Toronto");
    assert.ok(toronto.error.includes("404"));

    const ottawa = data.failedOrganizations.find(
      (org) => org.handle === "cityofottawa"
    );
    assert.equal(ottawa.error, "Repository list is not an array.");

    // Failed cities carry no ranking statistics, so they cannot
    // contaminate any totals computed by the page.
    for (const failed of data.failedOrganizations) {
      assert.equal("repositories" in failed, false);
      assert.equal("stars" in failed, false);
      assert.equal("forks" in failed, false);
      assert.equal("issues" in failed, false);
    }

    // Successful records keep the original field structure the pages read.
    for (const organization of data.organizations) {
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

    // Aggregate totals come only from the seventeen successful cities:
    // cityssm (2 repos/15 stars/3 forks/5 issues), fifteen one-repo
    // cities (1/1/1/1 each), cityofvancouver (all zero).
    const sum = (records, field) =>
      records.reduce((total, record) => total + record[field], 0);

    assert.equal(sum(data.organizations, "repositories"), 17);
    assert.equal(sum(data.organizations, "stars"), 30);
    assert.equal(sum(data.organizations, "forks"), 18);
    assert.equal(sum(data.organizations, "issues"), 20);
  });

  it("handles an all-failure run", async () => {
    const data = await runBuild("all-failure");

    assert.deepEqual(data.organizations, []);
    assert.equal(data.failedOrganizations.length, organizations.length);
    assert.equal(typeof data.refreshMillis, "number");

    // Every municipality is recorded with handle, municipality and reason.
    const expectedHandles = organizations.map((org) => org.handle).sort();
    assert.deepEqual(
      data.failedOrganizations.map((org) => org.handle).sort(),
      expectedHandles
    );

    for (const failed of data.failedOrganizations) {
      assert.equal(failed.status, "failed");
      assert.equal(typeof failed.municipality, "string");
      assert.equal(typeof failed.error, "string");
      assert.ok(failed.error.length > 0);
    }
  });

  it("handles a run where every successful city has zero repositories", async () => {
    const data = await runBuild("zero-repositories");

    assert.equal(data.failedOrganizations.length, 0);
    assert.equal(data.organizations.length, organizations.length);

    for (const organization of data.organizations) {
      assert.equal(organization.status, "success");
      assert.equal(organization.repositories, 0);
      assert.equal(organization.stars, 0);
      assert.equal(organization.forks, 0);
      assert.equal(organization.issues, 0);
      assert.equal(organization.lastUpdate, "");
      assert.deepEqual(organization.languages, {});
    }

    // With every stars/repositories tie, ordering is the original
    // case-insensitive handle rule applied to the full municipality list.
    const expectedOrder = organizations
      .map((org) => org.handle)
      .sort((a, b) =>
        a.toLowerCase() < b.toLowerCase()
          ? -1
          : a.toLowerCase() > b.toLowerCase()
            ? 1
            : 0
      );

    assert.deepEqual(
      data.organizations.map((org) => org.handle),
      expectedOrder
    );
  });
});
