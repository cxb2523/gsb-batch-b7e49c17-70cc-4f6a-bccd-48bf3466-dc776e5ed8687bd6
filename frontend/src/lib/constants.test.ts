import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { APP_VERSION } from './constants';

describe('APP_VERSION', () => {
  it("is the frontend package's own version with a leading v, so a release changes it in one place", () => {
    const manifest: unknown = JSON.parse(
      readFileSync(path.resolve(import.meta.dirname, '../../package.json'), 'utf8'),
    );
    const version =
      typeof manifest === 'object' &&
      manifest !== null &&
      'version' in manifest &&
      typeof manifest.version === 'string'
        ? manifest.version
        : '';

    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(APP_VERSION).toBe(`v${version}`);
  });
});
