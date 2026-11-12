import { test, expect } from "@playwright/test";
import { publicRoutes, publicServices } from "@/lib/homelab";

const directory = "networking/gateways/base/http-routes";
const listingUrl = `https://api.github.com/repos/okwilkins/h8s/contents/${directory}?ref=main`;

function httpRoute(name: string, hostname: string) {
  return `
kind: HTTPRoute
metadata:
  name: ${name}
spec:
  parentRefs:
    - name: cloudflare-gateway
      namespace: cloudflare
  hostnames: [${hostname}]
`;
}

function mockGitHub(files: Record<string, string | Response>) {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === listingUrl) {
      return Response.json(
        Object.keys(files).map((name) => ({
          type: "file",
          path: `${directory}/${name}`,
        })),
      );
    }
    const file = url.split(`https://raw.githubusercontent.com/okwilkins/h8s/main/${directory}/`)[1];
    const content = files[file];
    if (content === undefined) return new Response("not found", { status: 404 });
    return content instanceof Response ? content : new Response(content);
  };
}

const originalFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("only Cloudflare HTTP routes become public service links", () => {
  const source = `
kind: HTTPRoute
metadata:
  name: drawing
spec:
  parentRefs:
    - name: default-gateway
      namespace: default
    - name: cloudflare-gateway
      namespace: cloudflare
  hostnames: [draw.okwilkins.dev, '*.okwilkins.dev', 192.168.1.1, example.com]
---
kind: HTTPRoute
metadata:
  name: internal-monitoring
spec:
  parentRefs:
    - name: default-gateway
      namespace: default
  hostnames: [prometheus.okwilkins.dev]
`;
  expect(publicRoutes(source)).toEqual([
    { id: "drawing", href: "https://draw.okwilkins.dev/" },
  ]);
});

test("new public services are discovered without an existing description", () => {
  expect(publicRoutes(`
kind: HTTPRoute
metadata:
  name: new-service
  namespace: cloudflare
spec:
  parentRefs:
    - name: cloudflare-gateway
  hostnames: [new.okwilkins.dev]
`)).toEqual([{ id: "new-service", href: "https://new.okwilkins.dev/" }]);
});

test("services from every healthy file are returned with no failures", async () => {
  mockGitHub({
    "excalidraw.yaml": httpRoute("excalidraw", "draw.okwilkins.dev"),
    "grafana.yaml": httpRoute("grafana", "grafana.okwilkins.dev"),
  });

  const { services, failures } = await publicServices();
  expect(failures).toEqual([]);
  expect(services.map((service) => service.id)).toEqual(["excalidraw", "grafana"]);
  expect(services[0]).toMatchObject({
    name: "Excalidraw",
    href: "https://draw.okwilkins.dev/",
  });
});

test("a single broken YAML file is reported without dropping healthy services", async () => {
  mockGitHub({
    "excalidraw.yaml": httpRoute("excalidraw", "draw.okwilkins.dev"),
    "grafana.yaml": "kind: HTTPRoute\nmetadata:\n  name: [unclosed",
    "searxng.yaml": new Response("unavailable", { status: 500 }),
  });

  const { services, failures } = await publicServices();
  expect(services.map((service) => service.id)).toEqual(["excalidraw"]);
  expect(failures).toHaveLength(2);
  expect(failures.map((failure) => failure.path)).toEqual([
    `${directory}/grafana.yaml`,
    `${directory}/searxng.yaml`,
  ]);
  for (const failure of failures) expect(failure.reason).toBeTruthy();
});

test("an unavailable directory listing reports a failure and no services", async () => {
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });

  const { services, failures } = await publicServices();
  expect(services).toEqual([]);
  expect(failures).toEqual([
    { path: directory, reason: "GitHub returned 503" },
  ]);
});
