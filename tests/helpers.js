import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

export function createProject(files) {
  const dir = mkdtempSync(join(tmpdir(), 'osv-ui-project-'));
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  return dir;
}

export function removeProject(dir) {
  rmSync(dir, { recursive: true, force: true });
}

export const npmFixture = {
  'package.json': {
    name: 'fixture-app',
    version: '1.0.0',
    dependencies: { lodash: '4.17.20' },
  },
  'package-lock.json': {
    name: 'fixture-app',
    version: '1.0.0',
    lockfileVersion: 3,
    packages: {
      '': { name: 'fixture-app', version: '1.0.0', dependencies: { lodash: '4.17.20' } },
      'node_modules/lodash': { version: '4.17.20' },
      'node_modules/parent/node_modules/lodash': { version: '4.17.19' },
      'node_modules/parent/node_modules/@scope/child': { version: '2.0.0' },
    },
  },
};

// Service whose OSV lookup fails in tests/mock-fetch-partial.js.
export const flakyFixture = {
  'package.json': {
    name: 'flaky-app',
    version: '1.0.0',
    dependencies: { 'flaky-pkg': '1.0.0' },
  },
  'package-lock.json': {
    name: 'flaky-app',
    version: '1.0.0',
    lockfileVersion: 3,
    packages: {
      '': { name: 'flaky-app', version: '1.0.0', dependencies: { 'flaky-pkg': '1.0.0' } },
      'node_modules/flaky-pkg': { version: '1.0.0' },
    },
  },
};
