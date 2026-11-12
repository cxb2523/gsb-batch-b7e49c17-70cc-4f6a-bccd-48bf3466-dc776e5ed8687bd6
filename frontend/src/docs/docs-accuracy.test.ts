import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DOC_ARTICLES } from './content';

// These read files from the backend and the repository root as text, so that the docs cannot drift
// from the settings and compose files they describe. Nothing is imported across the two packages.
const repositoryRoot = path.resolve(import.meta.dirname, '../../..');

function readRepositoryFile(relativePath: string): string {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf-8');
}

/** The names of the environment variables the backend validates, read from its schema source. */
// GitHub and Microsoft sign-in work in the code but are not supported yet (a post-launch item in
// local/TODO.md), so they are deliberately left out of the docs. GitLab is not in the code at all.
const UNSUPPORTED_PROVIDER_SETTING = /^(GITHUB|MICROSOFT)_CLIENT_(ID|SECRET)$/;

function settingsNames(): string[] {
  const schema = readRepositoryFile('backend/src/config/env.schema.ts');
  return [...new Set([...schema.matchAll(/^ {2,4}([A-Z][A-Z0-9_]+):/gm)].map((match) => match[1]))]
    .filter((name): name is string => name !== undefined)
    .filter((name) => !UNSUPPORTED_PROVIDER_SETTING.test(name))
    .sort();
}

describe('docs accuracy', () => {
  it('documents every setting the backend validates', () => {
    const reference = DOC_ARTICLES['environment-variables'].content;
    const missing = settingsNames().filter((name) => !reference.includes(`\`${name}\``));

    expect(settingsNames().length).toBeGreaterThan(30);
    expect(
      missing,
      `Add these to the environment variables article: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('names only the supported sign-in provider, Google', () => {
    const unsupported = /gitlab|microsoft|GITHUB_CLIENT|sign in with github/i;
    const offenders = Object.values(DOC_ARTICLES)
      .filter((article) => unsupported.test(article.content))
      .map((article) => article.slug);

    expect(offenders).toEqual([]);
  });

  it('shows docker-compose.prod.yml exactly as it is in the repository', () => {
    const compose = readRepositoryFile('docker-compose.prod.yml').trimEnd();

    expect(DOC_ARTICLES['run-with-docker-compose'].content).toContain(compose);
  });

  it('shows docker-compose.coolify.yml exactly as it is in the repository', () => {
    const compose = readRepositoryFile('docker-compose.coolify.yml').trimEnd();

    expect(DOC_ARTICLES['deploying-on-coolify'].content).toContain(compose);
  });

  it('only links to articles that exist', () => {
    const slugs = new Set(Object.keys(DOC_ARTICLES));
    const broken: string[] = [];

    for (const article of Object.values(DOC_ARTICLES)) {
      for (const [, slug] of article.content.matchAll(/\]\(\/docs\/([a-z0-9-]+)\)/g)) {
        if (slug !== undefined && !slugs.has(slug)) broken.push(`${article.slug} -> ${slug}`);
      }
    }

    expect(broken).toEqual([]);
  });
});
