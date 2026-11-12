import { parseAllDocuments } from "yaml";
import { serviceDetails, site } from "@/data/site";
import { logger } from "@/lib/logger";

const repository = `${site.handle}/h8s`;
const directory = "networking/gateways/base/http-routes";
const options = {
  headers: { Accept: "application/vnd.github+json" },
  next: { revalidate: 3600 },
};

// Overridable so tests can point the site at a local GitHub stub.
const apiUrl = process.env.GITHUB_API_URL ?? "https://api.github.com";
const rawUrl = process.env.GITHUB_RAW_URL ?? "https://raw.githubusercontent.com";

type Route = { id: string; href: string };
export type PublicService = Route & { name: string; description?: string };

export type RouteFailure = { path: string; reason: string };
export type PublicServicesResult = {
  services: PublicService[];
  failures: RouteFailure[];
};

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function publicRoutes(source: string): Route[] {
  return parseAllDocuments(source).flatMap((document) => {
    if (document.errors.length) throw document.errors[0];
    const route = document.toJS();
    if (
      route?.kind !== "HTTPRoute" ||
      typeof route.metadata?.name !== "string" ||
      !route.spec?.parentRefs?.some(
        (parent: { name?: string; namespace?: string }) =>
          parent.name === "cloudflare-gateway" &&
          (parent.namespace ?? route.metadata.namespace) === "cloudflare",
      )
    ) return [];

    return (route.spec.hostnames ?? [])
      .filter(
        (hostname: unknown): hostname is string =>
          typeof hostname === "string" &&
          /^[a-z0-9-]+\.okwilkins\.dev$/.test(hostname),
      )
      .map((hostname: string) => ({
        id: route.metadata.name,
        href: `https://${hostname}/`,
      }));
  });
}

export async function publicServices(): Promise<PublicServicesResult> {
  try {
    const response = await fetch(
      `${apiUrl}/repos/${repository}/contents/${directory}?ref=main`,
      { ...options, signal: AbortSignal.timeout(3000) },
    );
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
    const files: { type: string; path: string }[] = await response.json();
    const results = await Promise.all(
      files
        .filter((file) => file.type === "file" && /\.ya?ml$/.test(file.path))
        .map(async (file): Promise<{ routes: Route[]; failure?: RouteFailure }> => {
          try {
            const response = await fetch(
              `${rawUrl}/${repository}/main/${file.path}`,
              { ...options, signal: AbortSignal.timeout(3000) },
            );
            if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
            return { routes: publicRoutes(await response.text()) };
          } catch (err) {
            logger.warn({ err, path: file.path }, "Homelab route unavailable");
            // A broken file must not silently drop its routes: report it.
            return {
              routes: [],
              failure: { path: file.path, reason: reason(err) },
            };
          }
        }),
    );
    const routes = results.flatMap((result) => result.routes);
    const failures = results.flatMap((result) =>
      result.failure ? [result.failure] : [],
    );
    const services = [...new Map(routes.map((route) => [route.href, route])).values()]
      .map((route) => ({
        ...route,
        name: serviceDetails[route.id]?.name ?? route.id.replaceAll("-", " "),
        description: serviceDetails[route.id]?.description,
      }))
      .sort((a, b) =>
        Number(!!serviceDetails[b.id]?.featured) - Number(!!serviceDetails[a.id]?.featured) ||
        a.name.localeCompare(b.name, "en-GB"),
      );
    return { services, failures };
  } catch (err) {
    logger.warn({ err, repository }, "Public homelab services unavailable");
    return {
      services: [],
      failures: [{ path: directory, reason: reason(err) }],
    };
  }
}
