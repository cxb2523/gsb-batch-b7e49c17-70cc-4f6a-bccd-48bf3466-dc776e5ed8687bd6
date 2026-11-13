#!/usr/bin/env node
/**
 * Serve the local fixture site so the crawler can be run by hand.
 *
 * Usage:
 *   node local/scripts/serve-fixture.mjs [port]
 *
 * Then, in another terminal:
 *   node scripts/crawl-local.mjs local/example-input.json
 *
 * Use Ctrl+C to stop.
 */

import { startFixtureServer } from '../test/fixture-server.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const requestedPort = Number(process.argv[2] ?? 3000);
if (!Number.isInteger(requestedPort) || requestedPort <= 0 || requestedPort > 65535) {
  console.error('Port must be an integer between 1 and 65535');
  process.exit(1);
}

const server = await startFixtureServer({ port: requestedPort });
console.log(`Fixture site: ${server.origin}`);
console.log(`Example input: ${path.join(here, '..', 'example-input.json')}`);
console.log('Press Ctrl+C to stop.');
