// Local GitHub stub used by the degradation tests in tests/degradation.spec.ts.
// The second dev server (port 3001) is pointed at this stub via GITHUB_*_URL
// environment variables, and tests switch its behaviour through /__scenario.
import { createServer } from "node:http";

const port = Number(process.env.MOCK_GITHUB_PORT ?? 4545);
const directory = "networking/gateways/base/http-routes";

type Scenario = "success" | "metadata-error" | "pins-unavailable" | "yaml-error";
let scenario: Scenario = "success";

const pins = ["okwilkins/h8s", "okwilkins/.dotfiles", "okwilkins/inferlace"];

function profile() {
  return `<h2>Pinned <span>Loading</span></h2>
    <ol class="list-style-none js-pinned-items-reorder-list">
      ${pins
        .map(
          (repository) => `<li class="pinned-item-list-item">
        <a href="/${repository}"><span class="repo">${repository.split("/")[1]}</span></a>
      </li>`,
        )
        .join("")}
    </ol>`;
}

function httpRoute(name: string, hostname: string) {
  return `kind: HTTPRoute
metadata:
  name: ${name}
spec:
  parentRefs:
    - name: cloudflare-gateway
      namespace: cloudflare
  hostnames: [${hostname}]
`;
}

const routeFiles: Record<string, string> = {
  "excalidraw.yaml": httpRoute("excalidraw", "draw.okwilkins.dev"),
  "grafana.yaml": httpRoute("grafana", "grafana.okwilkins.dev"),
  "searxng.yaml": httpRoute("searxng", "search.okwilkins.dev"),
};

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  const path = url.pathname;
  const send = (status: number, body: string | object, type = "application/json") => {
    response.writeHead(status, { "Content-Type": type });
    response.end(typeof body === "string" ? body : JSON.stringify(body));
  };

  if (path === "/health") return send(200, "ok", "text/plain");

  if (path === "/__scenario" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      try {
        const next = JSON.parse(body || "{}").scenario;
        const valid: Scenario[] = ["success", "metadata-error", "pins-unavailable", "yaml-error"];
        if (!valid.includes(next)) return send(400, { error: `unknown scenario: ${next}` });
        scenario = next;
        send(200, { scenario });
      } catch {
        send(400, { error: "invalid JSON" });
      }
    });
    return;
  }

  // Public profile page with the pinned repositories list.
  if (path === "/okwilkins") {
    if (scenario === "pins-unavailable") return send(503, "unavailable", "text/plain");
    return send(200, profile(), "text/html");
  }

  // Raw file downloads from the h8s repository.
  const raw = path.match(/^\/okwilkins\/h8s\/main\/(.+)$/);
  if (raw) {
    const file = raw[1].split("/").pop()!;
    if (scenario === "yaml-error" && file === "grafana.yaml") {
      return send(200, "kind: HTTPRoute\nmetadata:\n  name: [unclosed\n", "text/plain");
    }
    const content = routeFiles[file];
    if (content === undefined) return send(404, "not found", "text/plain");
    return send(200, content, "text/plain");
  }

  // Directory listing of the HTTPRoute manifests.
  if (path === `/repos/okwilkins/h8s/contents/${directory}`) {
    return send(
      200,
      Object.keys(routeFiles).map((name) => ({
        type: "file",
        path: `${directory}/${name}`,
      })),
    );
  }

  // Repository metadata.
  const repository = path.match(/^\/repos\/([^/]+)\/([^/]+)$/);
  if (repository) {
    if (scenario === "metadata-error" && repository[2] === "h8s") {
      return send(503, "unavailable", "text/plain");
    }
    return send(200, {
      description: `Mock description for ${repository[2]}`,
      topics: ["mock", "test"],
      stargazers_count: 42,
    });
  }

  send(404, { error: `unhandled: ${path}` });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`mock github listening on ${port}`);
});
