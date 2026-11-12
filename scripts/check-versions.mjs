#!/usr/bin/env node
// The version lives in the root package.json. The backend and frontend carry a copy (the app
// reads its own package.json), and the release process updates all three together. This fails
// when they differ, so a hand edit of one cannot ship a build that says a different version.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifests = ['package.json', 'backend/package.json', 'frontend/package.json'];

const versions = manifests.map((file) => ({
  file,
  version: JSON.parse(readFileSync(path.join(root, file), 'utf8')).version,
}));

const expected = versions[0].version;
const mismatches = versions.filter(({ version }) => version !== expected);

if (!/^\d+\.\d+\.\d+$/.test(expected) || mismatches.length > 0) {
  console.error(`The version must be one MAJOR.MINOR.PATCH number in every package.json (root: ${expected}):`);
  for (const { file, version } of versions) console.error(`  ${file}: ${version}`);
  process.exit(1);
}

console.log(`Version ${expected} in all ${versions.length} package.json files.`);
