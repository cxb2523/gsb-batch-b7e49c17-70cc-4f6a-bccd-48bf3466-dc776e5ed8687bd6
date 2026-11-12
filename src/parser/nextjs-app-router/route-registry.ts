import { knownLocales } from "./locale-samples.js";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { bump, type Counters, type ScreenNode } from "../../schema/index.js";
import { posixRelative } from "../paths.js";

const PAGE_FILES = new Set(["page.tsx", "page.jsx", "page.ts", "page.js"]);

/** Directory segments that never contribute to the URL. */
function isTransparentSegment(segment: string): boolean {
  return segment.startsWith("(") && segment.endsWith(")"); // route group
}

/** Segments that mark subtrees we do not treat as user screens. */
function isSkippedSubtree(segment: string): boolean {
  return segment === "api" || segment.startsWith("@") || segment.startsWith("_") || segment === "node_modules";
}

/** Converts an App Router directory path (relative to appDir) into a route id such as "/blog/[slug]". */
export function directoryToRoute(relDir: string): string {
  // Route ids are POSIX-shaped by contract; split on both separators so a backslash path (Windows `relative()`) works too.
  const parts = relDir.split(/[\\/]/).filter((p) => p.length > 0 && !isTransparentSegment(p));
  return "/" + parts.join("/");
}

export interface RouteRegistry {
  screens: ScreenNode[];
  /** Resolves a concrete or parametric path ("/iam/users/anhnt" or "/iam/users/[id]") to a route screen id. */
  resolve(path: string): string | null;
  /** Counters the resolver bumps when it infers something (e.g. a bare next-intl link mapped onto [locale]); optional for unit tests. */
  counters?: Counters;
}

/** Leading `[locale]` / `[lang]` segment of a route id. */
const LOCALE_SEGMENT = /^\/\[(locale|lang|language)\]/;

/** Walks appDir for page files and builds the Route Screen list plus a path resolver. */
export function buildRouteRegistry(rootDir: string, appDir: string, locales: string[] = knownLocales(rootDir), counters?: Counters): RouteRegistry {
  const screens: ScreenNode[] = [];
  walk(appDir, appDir, rootDir, screens);
  screens.sort((a, b) => a.id.localeCompare(b.id));
  const matchers = screens.map((s) => ({ id: s.id, regex: routeToRegex(s.id), staticDepth: s.id.split("/").filter((p) => !p.startsWith("[")).length }));
  // Prefer the most static match so "/idp/404" beats "/iam/[...slug]" style overlaps.
  matchers.sort((a, b) => b.staticDepth - a.staticDepth);
  // next-intl style apps link without the locale prefix (`/bang-gia` → `/[locale]/bang-gia`): try the locale-less shape last.
  const localeless = screens.filter((s) => LOCALE_SEGMENT.test(s.id)).map((s) => ({ id: s.id, stripped: s.id.replace(LOCALE_SEGMENT, "") || "/" }));
  const localelessMatchers = localeless.map((m) => ({ id: m.id, regex: routeToRegex(m.stripped), staticDepth: m.stripped.split("/").filter((p) => !p.startsWith("[")).length })).sort((a, b) => b.staticDepth - a.staticDepth);
  return {
    screens,
    counters,
    resolve(path: string): string | null {
      const clean = path.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
      const exact = screens.find((s) => s.id === clean);
      if (exact) return exact.id;
      // `/about` is `/[locale]/about`, not `/[locale]` with locale "about", when the app declares its locales
      const localeOk = (m: { id: string }): boolean => !LOCALE_SEGMENT.test(m.id) || !locales.length || locales.includes(clean.split("/")[1] ?? "");
      const hit = matchers.find((m) => m.regex.test(clean) && localeOk(m));
      if (hit) return hit.id;
      const bare = localeless.find((m) => m.stripped === clean) ?? localelessMatchers.find((m) => m.regex.test(clean));
      // Auditable inference: a link written without the locale prefix only matches via the localeless fallback.
      if (bare && counters) bump(counters, "route-registry", "locale-prefix-inferred");
      return bare ? bare.id : null;
    },
  };
}

function walk(dir: string, appDir: string, rootDir: string, out: ScreenNode[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // Neither isDirectory() nor the PAGE_FILES check below discriminates a symlink from a real file/dir:
    // a symlinked `page.tsx` pointing outside the repo would otherwise become a Route Screen.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (isSkippedSubtree(entry.name)) continue;
      walk(join(dir, entry.name), appDir, rootDir, out);
    } else if (PAGE_FILES.has(entry.name)) {
      const id = directoryToRoute(relative(appDir, dir));
      out.push({
        id,
        kind: "route",
        filePath: posixRelative(rootDir, join(dir, entry.name)),
        dynamic: /\[[^.\]]+\]/.test(id) || undefined,
        catchAll: /\[\.\.\./.test(id) || undefined,
      });
    }
  }
}

/** "/blog/[slug]" → /^\/blog\/[^/]+$/ ; "/docs/[...parts]" → /^\/docs\/.+$/ */
function routeToRegex(routeId: string): RegExp {
  const pattern = routeId
    .split("/")
    .map((seg) => {
      if (/^\[\.\.\..+\]$/.test(seg) || /^\[\[\.\.\..+\]\]$/.test(seg)) return ".+";
      if (/^\[.+\]$/.test(seg)) return "[^/]+";
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp("^" + pattern + "$");
}
