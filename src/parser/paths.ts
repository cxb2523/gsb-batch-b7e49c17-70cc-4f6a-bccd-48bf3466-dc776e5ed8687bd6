import { relative, sep } from "node:path";

/**
 * Repo-relative paths are part of the graph contract (counter keys, evidence `file`, ScreenNode.filePath):
 * they must be POSIX-shaped (`app/[locale]/page.tsx`) on every OS so scans of the same repo on Windows and
 * POSIX produce byte-identical graphs. `node:path.relative()` returns OS-native separators (`\` on Windows),
 * so every relative path emitted by the parsers goes through this helper.
 */
export function posixRelative(rootDir: string, target: string): string {
  return relative(rootDir, target).split(sep).join("/");
}

/** Whether `candidate` is `root` itself or nested inside it, regardless of the platform separator. */
export function isInside(root: string, candidate: string): boolean {
  const normalizedRoot = root.split(sep).join("/").replace(/\/+$/, "");
  const normalizedCandidate = candidate.split(sep).join("/");
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(normalizedRoot + "/");
}
