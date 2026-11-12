const fs = require('fs');
const path = require('path');

// Define the query to interact with the page
const query = `
{
    items(might be aritcles, posts, tweets)[]
    {
        published_date(convert to XX/XX/XXXX format)
        entry(title or post if no title is available)
        author(person's name; return "n/a" if not available)
        outlet(the original platform it is posted on; if no platform is listed, use the root domain of the url)
        url
    }
}
`;

// Set URLs to the desired websites
const websiteUrls = [
  'https://bsky.app/search?q=agents+for+the+web',
  'https://dev.to/search?q=agents%20for%20the%20web&sort_by=published_at&sort_direction=desc',
  'https://hn.algolia.com/?dateRange=last24h&page=0&prefix=false&query=agents%20for%20the%20web&sort=byDate&type=story',
  'https://duckduckgo.com/?q=agents+for+the+web&t=h_&iar=news&ia=news',
];

// Get the directory of the current script and create path to the csv file
const scriptDir = __dirname;
const defaultCsvFilePath = path.join(scriptDir, 'news_headlines.csv');

// Single source of truth for the on-disk CSV layout.
const HEADER = 'Posted | Entry | URL | Platform | Author';
const DELIMITER = ' | ';
// Query-result keys in the same order as the CSV columns above.
const FIELD_ORDER = ['published_date', 'entry', 'url', 'outlet', 'author'];

function sanitizeField(value) {
  // Remove pipes and line breaks so a field cannot break the CSV layout.
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\|/g, '')
    .replace(/[\r\n]+/g, ' ');
}

function normalizeItem(item) {
  const record = {};
  for (const field of FIELD_ORDER) {
    record[field] = sanitizeField(item[field]);
  }
  return record;
}

function itemToLine(item) {
  return FIELD_ORDER.map((field) => item[field]).join(DELIMITER) + '\n';
}

function readExistingRecords(csvPath) {
  // Read an existing CSV and return { records, seenUrls }.
  if (!fs.existsSync(csvPath)) {
    return { records: [], seenUrls: new Set() };
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const records = [];
  const seenUrls = new Set();
  for (const line of content.split(/\r?\n/)) {
    if (line.trim() === '' || line === HEADER) {
      continue;
    }
    const parts = line.split(DELIMITER);
    if (parts.length !== FIELD_ORDER.length) {
      // Legacy / malformed line: keep it untouched on rewrite.
      records.push({ _raw: line });
      continue;
    }
    const record = {};
    FIELD_ORDER.forEach((field, index) => {
      record[field] = parts[index];
    });
    records.push(record);
    if (record.url) {
      seenUrls.add(record.url);
    }
  }
  return { records, seenUrls };
}

function dedupeRecords(records, seenUrls) {
  // Drop records whose URL is already known, keeping the first occurrence.
  const uniqueRecords = [];
  for (const record of records) {
    const url = record.url;
    if (url && seenUrls.has(url)) {
      console.log(`Skipping duplicate entry for URL: ${url}`);
      continue;
    }
    uniqueRecords.push(record);
    if (url) {
      seenUrls.add(url);
    }
  }
  return uniqueRecords;
}

function saveResults(newRecords, csvPath = defaultCsvFilePath) {
  // Write the whole batch (existing rows + unique new rows) atomically.
  // The file is fully rendered in a temporary file in the same directory and
  // then renamed onto the target, so readers always see either the previous
  // complete file or the new complete file -- never a half-written one. The
  // header is always emitted exactly once on the first line.
  const { records: existingRecords, seenUrls } = readExistingRecords(csvPath);
  const uniqueRecords = dedupeRecords(newRecords, seenUrls);

  const directory = path.dirname(path.resolve(csvPath));
  fs.mkdirSync(directory, { recursive: true });

  const lines = [HEADER];
  for (const record of existingRecords) {
    lines.push(record._raw !== undefined ? record._raw : itemToLine(record).replace(/\n$/, ''));
  }
  for (const record of uniqueRecords) {
    lines.push(itemToLine(record).replace(/\n$/, ''));
  }
  const payload = lines.join('\n') + '\n';

  const tmpPath = path.join(
    directory,
    `${path.basename(csvPath)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    fs.writeFileSync(tmpPath, payload, 'utf-8');
    fs.renameSync(tmpPath, csvPath);
  } catch (error) {
    // Never leave a stray temporary file behind if the batch fails.
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // The temp file may already be gone; nothing else to clean up.
    }
    throw error;
  }

  console.log(`Wrote ${uniqueRecords.length} new record(s) to ${csvPath}`);
  return uniqueRecords.length;
}

async function fetchData(context, sessionUrl) {
  // Open the given URL in a new tab and return its normalized items. AgentQL
  // and Playwright are required lazily on purpose: this module must remain
  // importable in offline tests that replace this function with a fake fetcher.
  const { wrap } = require('agentql');

  const page = await wrap(await context.newPage());
  try {
    await page.goto(sessionUrl);
    const data = await page.queryData(query);
    const items = (data && data.items) || [];
    if (items.length === 0) {
      console.warn(`No items returned from ${sessionUrl}`);
    }
    return items.map(normalizeItem);
  } finally {
    await page.close();
  }
}

async function collectResults(fetcher, urls) {
  // Fetch every URL concurrently and return a Map(url => records). A failing
  // fetch or a site that returns an empty list is logged and mapped to an empty
  // list; one broken site never interrupts the other sites or the batch write.
  const entries = await Promise.all(
    urls.map(async (sessionUrl) => {
      try {
        return [sessionUrl, await fetcher(sessionUrl)];
      } catch (error) {
        console.error(`Failed to fetch data from ${sessionUrl}: ${error.message}`);
        return [sessionUrl, []];
      }
    }),
  );
  return new Map(entries);
}

async function main(csvPath = defaultCsvFilePath, urls = websiteUrls) {
  // Configure the AgentQL API key and launch the browser only when actually
  // running the scraper, so importing this module for tests needs no credentials.
  const { configure } = require('agentql');
  const { chromium } = require('playwright');

  configure({
    apiKey: process.env.AGENTQL_API_KEY, // This is the default and can be omitted
  });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  try {
    // Open multiple tabs in the same browser context to fetch concurrently.
    const collected = await collectResults((url) => fetchData(context, url), urls);

    // Flatten in configured site order; fetching itself stays fully concurrent.
    const newRecords = [];
    for (const url of urls) {
      newRecords.push(...(collected.get(url) || []));
    }
    const written = saveResults(newRecords, csvPath);
    console.log(`All done! ${written} new record(s) saved to ${csvPath}`);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  HEADER,
  DELIMITER,
  FIELD_ORDER,
  sanitizeField,
  normalizeItem,
  itemToLine,
  readExistingRecords,
  dedupeRecords,
  saveResults,
  fetchData,
  collectResults,
  main,
  defaultCsvFilePath,
};
