import type { DocCategory, DocArticle } from './types';

import runWithDockerComposeMd from './articles/run-with-docker-compose.md?raw';
import signInProvidersMd from './articles/sign-in-providers.md?raw';
import deployingOnAServerMd from './articles/deploying-on-a-server.md?raw';
import deployingOnCoolifyMd from './articles/deploying-on-coolify.md?raw';
import goingPublicMd from './articles/going-public.md?raw';
import storageMd from './articles/storage.md?raw';
import backupsAndRestoreMd from './articles/backups-and-restore.md?raw';
import upgradingMd from './articles/upgrading.md?raw';
import architectureMd from './articles/architecture.md?raw';
import keysAndRolesMd from './articles/keys-and-roles.md?raw';
import environmentVariablesMd from './articles/environment-variables.md?raw';

export const DOC_ARTICLES = {
  'run-with-docker-compose': {
    slug: 'run-with-docker-compose',
    title: 'Run with Docker Compose',
    description: 'Start CanvHQ and its database on one machine.',
    category: 'Getting started',
    readingTime: '3 min read',
    content: runWithDockerComposeMd,
  },
  'sign-in-providers': {
    slug: 'sign-in-providers',
    title: 'Sign in with Google',
    description: 'Let people sign in with their Google account.',
    category: 'Getting started',
    readingTime: '2 min read',
    content: signInProvidersMd,
  },
  'deploying-on-a-server': {
    slug: 'deploying-on-a-server',
    title: 'Deploying on a server',
    description: 'What a host needs to run CanvHQ for other people.',
    category: 'Running it',
    readingTime: '2 min read',
    content: deployingOnAServerMd,
  },
  'deploying-on-coolify': {
    slug: 'deploying-on-coolify',
    title: 'Deploying on Coolify',
    description: 'A compose file for Coolify, and the settings to fill in.',
    category: 'Running it',
    readingTime: '3 min read',
    content: deployingOnCoolifyMd,
  },
  'going-public': {
    slug: 'going-public',
    title: 'Behind a proxy and going public',
    description: 'Proxy trust, closing sign-ups, limits and a public demo.',
    category: 'Running it',
    readingTime: '4 min read',
    content: goingPublicMd,
  },
  storage: {
    slug: 'storage',
    title: 'Storage',
    description: 'Point CanvHQ at any S3-compatible object storage.',
    category: 'Running it',
    readingTime: '2 min read',
    content: storageMd,
  },
  'backups-and-restore': {
    slug: 'backups-and-restore',
    title: 'Backups and restore',
    description: 'Back up the database and the bucket together, and bring them back.',
    category: 'Running it',
    readingTime: '3 min read',
    content: backupsAndRestoreMd,
  },
  upgrading: {
    slug: 'upgrading',
    title: 'Upgrading',
    description: 'What happens when a new version starts, and what to check first.',
    category: 'Running it',
    readingTime: '2 min read',
    content: upgradingMd,
  },
  architecture: {
    slug: 'architecture',
    title: 'How your data is protected',
    description: 'What is encrypted, what is not, and the limits.',
    category: 'Keys and security',
    readingTime: '3 min read',
    content: architectureMd,
  },
  'keys-and-roles': {
    slug: 'keys-and-roles',
    title: 'Keys and roles',
    description: 'The four roles, your passphrase, invitations and removals.',
    category: 'Keys and security',
    readingTime: '3 min read',
    content: keysAndRolesMd,
  },
  'environment-variables': {
    slug: 'environment-variables',
    title: 'Environment variables',
    description: 'Every setting, with its default.',
    category: 'Reference',
    readingTime: '4 min read',
    content: environmentVariablesMd,
  },
} satisfies Record<string, DocArticle>;

const ARTICLE_BY_SLUG = new Map<string, DocArticle>(Object.entries(DOC_ARTICLES));

export const DEFAULT_DOC_SLUG = 'run-with-docker-compose';

/** The article for a slug, falling back to the first one when the slug is unknown. */
export function getDocArticle(slug?: string): DocArticle {
  const article = slug ? ARTICLE_BY_SLUG.get(slug) : undefined;
  return article ?? DOC_ARTICLES[DEFAULT_DOC_SLUG];
}

export const DOC_CATEGORIES: DocCategory[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    articles: [DOC_ARTICLES['run-with-docker-compose'], DOC_ARTICLES['sign-in-providers']],
  },
  {
    id: 'running',
    title: 'Running it',
    articles: [
      DOC_ARTICLES['deploying-on-a-server'],
      DOC_ARTICLES['deploying-on-coolify'],
      DOC_ARTICLES['going-public'],
      DOC_ARTICLES.storage,
      DOC_ARTICLES['backups-and-restore'],
      DOC_ARTICLES.upgrading,
    ],
  },
  {
    id: 'keys',
    title: 'Keys and security',
    articles: [DOC_ARTICLES.architecture, DOC_ARTICLES['keys-and-roles']],
  },
  {
    id: 'reference',
    title: 'Reference',
    articles: [DOC_ARTICLES['environment-variables']],
  },
];
