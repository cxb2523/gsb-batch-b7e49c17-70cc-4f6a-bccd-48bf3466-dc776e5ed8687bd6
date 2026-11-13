#!/usr/bin/env node
/**
 * Run the local crawler end to end.
 *
 * Usage:
 *   node scripts/crawl-local.mjs [input.json | '{"startUrls": [...]}']
 *
 * Without an argument, references/example-input.json is used.
 *
 * Output:
 *   - stdout: one JSON record per line (url, title, depth, wordCount, httpStatusCode)
 *   - stderr: the run summary, including why the crawl stopped and the grouped
 *     skipped URLs.
 *
 * Options:
 *   --records <path>  also write the JSONL records to a file
 *   --summary <path>  also write the summary JSON to a file
 *   --no-summary      suppress the summary on stderr
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { crawlSite } from '../local/src/crawler.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

function optionValue(name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] ?? null;
}

function readInput() {
  const flagsWithValues = new Set(['--records', '--summary']);
  const positional = args.filter((arg, index) => {
    if (flagsWithValues.has(arg)) return false;
    if (index > 0 && flagsWithValues.has(args[index - 1])) return false;
    return !arg.startsWith('--');
  });
  const arg = positional[0];
  if (!arg) {
    return fs.readFileSync(path.join(here, '..', 'local', 'example-input.json'), 'utf8');
  }
  if (arg.trim().startsWith('{')) return arg;
  return fs.readFileSync(arg, 'utf8');
}

const input = JSON.parse(readInput());
const { records, summary } = await crawlSite(input);

for (const record of records) {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

const recordsPath = optionValue('--records');
if (recordsPath) {
  fs.writeFileSync(recordsPath, records.map((record) => `${JSON.stringify(record)}\n`).join(''));
}

if (!args.includes('--no-summary')) {
  const summaryText = `${JSON.stringify(summary, null, 2)}\n`;
  process.stderr.write(summaryText);
  const summaryPath = optionValue('--summary');
  if (summaryPath) fs.writeFileSync(summaryPath, summaryText);
}
