import { existsSync, readFileSync } from 'fs';
import path from 'path';
import type { RequestHandler } from 'express';

/** The placeholder in the built `index.html` that stands for this instance's public address. */
export const SITE_URL_PLACEHOLDER = '__SITE_URL__';

/**
 * Serves the single-page app's shell with this instance's own address filled in, so the link
 * preview image (which scrapers only accept as an absolute address) comes from whoever hosts it.
 * Anything with a file extension, and everything under `/api/`, is left to the next handler.
 */
export function indexHtmlWithSiteUrl(staticDir: string, siteUrl: string): RequestHandler | null {
  const indexPath = path.join(staticDir, 'index.html');
  if (!existsSync(indexPath)) {
    return null;
  }
  const html = readFileSync(indexPath, 'utf8').replaceAll(
    SITE_URL_PLACEHOLDER,
    new URL(siteUrl).origin,
  );

  return (req, res, next) => {
    const isPage =
      (req.method === 'GET' || req.method === 'HEAD') &&
      !req.path.startsWith('/api/') &&
      path.extname(req.path) === '';
    if (!isPage) {
      return next();
    }
    res.type('html').send(html);
  };
}
