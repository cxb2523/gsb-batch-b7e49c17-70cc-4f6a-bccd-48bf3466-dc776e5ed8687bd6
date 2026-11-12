// Writes dist/THIRD_PARTY_LICENSES.txt: the name, version, licence and licence text of every
// production dependency. It runs after `vite build` and reads what is installed. A package with
// no licence file gets its licence name only, and is listed on the console.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const outputPath = path.resolve(import.meta.dirname, '../dist/THIRD_PARTY_LICENSES.txt');
const LICENCE_FILE = /^(licen[cs]e|copying|notice)([-.].*)?$/i;

const report = JSON.parse(
  execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }),
);

function licenceTexts(directory) {
  return readdirSync(directory)
    .filter((name) => LICENCE_FILE.test(name))
    .sort()
    .map((name) => readFileSync(path.join(directory, name), 'utf8').trim());
}

const packages = Object.entries(report)
  .flatMap(([licence, entries]) => entries.map((entry) => ({ ...entry, licence })))
  .sort((a, b) => a.name.localeCompare(b.name));

const missing = [];
const sections = packages.map((pkg) => {
  const [directory] = pkg.paths;
  const texts = existsSync(directory) ? licenceTexts(directory) : [];
  if (texts.length === 0) missing.push(`${pkg.name}@${pkg.versions.join(', ')} (${pkg.licence})`);
  const heading = `${pkg.name} ${pkg.versions.join(', ')} - ${pkg.licence}`;
  return [
    heading,
    '='.repeat(heading.length),
    texts.join('\n\n') || `Licence: ${pkg.licence}`,
  ].join('\n');
});

const header = [
  'Third-party software in CanvHQ',
  '',
  'CanvHQ itself is licensed under the Apache License 2.0 (see LICENSE in the source repository).',
  'The packages below are used by the app; each is under its own licence.',
  '',
  'The canvas fonts served from /excalidraw-assets come from the Excalidraw package, which does',
  'not ship licence texts for them; see the Excalidraw project for their terms.',
  '',
].join('\n');

writeFileSync(outputPath, `${header}\n${sections.join('\n\n\n')}\n`);
console.log(`Wrote ${packages.length} packages to ${path.relative(process.cwd(), outputPath)}`);

if (missing.length > 0) {
  console.warn(
    `No licence file found for ${missing.length} package(s); licence name written instead:`,
  );
  for (const entry of missing) console.warn(`  ${entry}`);
}
