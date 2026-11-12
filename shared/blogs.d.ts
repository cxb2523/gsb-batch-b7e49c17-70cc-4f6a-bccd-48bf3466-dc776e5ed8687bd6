export interface Blog {
  id: string;
  num: number;
  name: string;
  url: string;
  feed: string;
  tags: string[];
  dead: boolean;
  reason: string;
  /** no RSS in the source list: the blog can never be checked */
  noFeed?: boolean;
  /** unix seconds of the newest post, when our own crawl has seen the feed */
  lastPostAt?: number;
  fresh: number;
}

export interface CatalogStats {
  total: number;
  dead: number;
  tagged: number;
  matchedInReadme: number;
}

export interface Catalog {
  generatedAt: string;
  source: string;
  stats: CatalogStats;
  blogs: Blog[];
}

export interface CategoryDef {
  id: string;
  name: string;
  re: RegExp;
}

export function categorize(tags: string[]): string[];
export function blogId(url: string): string;
export function parseCsv(text: string): Pick<Blog, 'name' | 'url' | 'feed' | 'tags'>[];
export function parseReadme(text: string): {
  active: { name: string; url: string; feed: string; tags: string[] }[];
  dead: { name: string; url: string; reason: string }[];
};
export interface HealthEntry {
  lastPostAt?: number;
  failingSince?: number;
  deadSince?: number;
  reason?: string;
}

export function buildCatalog(input: {
  csvText: string;
  readmeText: string;
  health?: Record<string, HealthEntry> | Map<string, HealthEntry>;
  generatedAt?: string;
  now?: number;
}): Catalog;

export const CATEGORIES: CategoryDef[];
