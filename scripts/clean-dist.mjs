#!/usr/bin/env node
/*
 * Empties dist/ of built files before a build. Each language is a chunk whose name carries a
 * content hash, so without this a build after a translation change would leave the previous
 * chunk behind as a stale file that the CI dist check then complains about.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (fs.existsSync(DIST)) {
  for (const name of fs.readdirSync(DIST)) {
    if (/\.js(\.map)?$/.test(name)) fs.unlinkSync(path.join(DIST, name));
  }
}
