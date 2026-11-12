import { existsSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { isInside } from "./paths.js";

/** Existing local NON-HTML files (public/*.docx, /brochure.pdf, images) are download assets, not Route Screen targets; .html files stay pages. */
export function isLocalAssetHref(rootDir: string, href: string, sourceFile?: string): boolean {
  const path = href.split(/[?#]/)[0];
  if (!path || path.startsWith("#") || /^(https?:)?\/\/|^(mailto|tel):/.test(path)) return false;
  const clean = path.replace(/^\/+/, "");
  if (!/\.[a-z0-9]{1,8}$/i.test(clean) || /\.html?$/i.test(clean)) return false;
  const candidates = [resolve(rootDir, "public", clean), resolve(rootDir, clean)];
  if (sourceFile) {
    // Evidence paths are POSIX-shaped; convert to OS-native before resolving against the filesystem.
    const absSource = sourceFile.startsWith(rootDir) ? sourceFile : resolve(rootDir, sourceFile.split("/").join(sep));
    candidates.push(resolve(rootDir, dirname(absSource), path));
  }
  return candidates.some((candidate) => isInside(rootDir, candidate) && existsSync(candidate) && statSync(candidate).isFile());
}
