import { test, expect, type APIRequestContext } from "@playwright/test";

// These tests run against the second dev server (port 3001), whose GitHub
// fetches are redirected to the local stub in tests/mock-github.ts. The stub
// is shared state, so the scenarios run serially and only on desktop.
const degradedSite = "http://127.0.0.1:3001";
const mockGitHub = "http://127.0.0.1:4545";

const projectHint = "Latest GitHub data is temporarily unavailable.";
const serviceHint = /couldn.t be loaded just now/;

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

test.beforeEach(async ({ request }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "degradation scenarios are covered on desktop only",
  );
  const response = await request.post(`${mockGitHub}/__scenario`, {
    data: { scenario: "success" },
  });
  expect(response.ok()).toBe(true);
});

test.afterAll(async ({ request }) => {
  await request.post(`${mockGitHub}/__scenario`, { data: { scenario: "success" } });
});

async function setScenario(request: APIRequestContext, scenario: string) {
  const response = await request.post(`${mockGitHub}/__scenario`, {
    data: { scenario },
  });
  expect(response.ok()).toBe(true);
}

test("successful fetches show live data without degradation hints", async ({
  page,
  request,
}) => {
  await setScenario(request, "success");

  await page.goto(`${degradedSite}/projects/`);
  const projects = page.getByRole("region", { name: "GitHub projects" });
  await expect(projects.getByRole("heading", { level: 3 })).toHaveText([
    "h8s",
    ".dotfiles",
    "inferlace",
  ]);
  await expect(projects.getByText("GitHub stars")).toHaveCount(3);
  await expect(projects.getByText("42")).toHaveCount(3);
  await expect(projects.getByText(projectHint)).toHaveCount(0);

  await page.goto(`${degradedSite}/services/`);
  const services = page.getByRole("region", { name: "Public services" });
  await expect(services.getByRole("link")).toHaveCount(3);
  await expect(services.getByText(serviceHint)).toHaveCount(0);
});

test("a single repository metadata failure degrades only that entry", async ({
  page,
  request,
}) => {
  await setScenario(request, "metadata-error");

  await page.goto(`${degradedSite}/projects/`);
  const projects = page.getByRole("region", { name: "GitHub projects" });
  // The curated order is preserved.
  await expect(projects.getByRole("heading", { level: 3 })).toHaveText([
    "h8s",
    ".dotfiles",
    "inferlace",
  ]);
  const entries = projects.getByRole("listitem");

  // The failed entry keeps its static description, shows no fabricated star
  // count, and explains the degradation.
  await expect(entries.nth(0)).toContainText(
    "My bare-metal Kubernetes homelab",
  );
  await expect(entries.nth(0).getByText("GitHub stars")).toHaveCount(0);
  await expect(entries.nth(0).getByText(projectHint)).toBeVisible();

  // Healthy entries are unaffected.
  for (const index of [1, 2]) {
    await expect(entries.nth(index).getByText(projectHint)).toHaveCount(0);
    await expect(entries.nth(index).getByText("GitHub stars")).toHaveCount(1);
    await expect(entries.nth(index)).toContainText("Mock description");
  }
});

test("an unavailable pinned list marks every curated entry as stale", async ({
  page,
  request,
}) => {
  await setScenario(request, "pins-unavailable");

  await page.goto(`${degradedSite}/projects/`);
  const projects = page.getByRole("region", { name: "GitHub projects" });
  await expect(projects.getByRole("heading", { level: 3 })).toHaveText([
    "h8s",
    ".dotfiles",
    "inferlace",
  ]);
  await expect(projects.getByText(projectHint)).toHaveCount(3);
  await expect(projects.getByText("GitHub stars")).toHaveCount(0);
  await expect(projects.getByRole("listitem").nth(0)).toContainText(
    "My bare-metal Kubernetes homelab",
  );
});

test("a single broken YAML file is flagged without dropping healthy services", async ({
  page,
  request,
}) => {
  await setScenario(request, "yaml-error");

  await page.goto(`${degradedSite}/services/`);
  const services = page.getByRole("region", { name: "Public services" });
  // Routes from the healthy files still render.
  await expect(
    services.getByRole("link", { name: /Excalidraw/ }),
  ).toBeVisible();
  await expect(services.getByRole("link", { name: /SearXNG/ })).toBeVisible();
  // The broken file's routes are absent, and the page says why.
  await expect(services.getByRole("link", { name: /Grafana/ })).toHaveCount(0);
  await expect(services.getByText(serviceHint)).toBeVisible();
});
