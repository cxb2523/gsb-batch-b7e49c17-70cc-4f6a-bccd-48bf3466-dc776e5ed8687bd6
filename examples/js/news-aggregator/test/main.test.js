'use strict';

// Offline tests for the news aggregator CSV logic.
//
// These tests never open a real browser or load AgentQL/Playwright: the
// scraping step is replaced with a fake fetcher returning canned records, so
// they run fully offline and need no credentials.
//
// Run from this directory:
//   node --test test/main.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const aggregator = require('../main');

function makeItem(publishedDate, entry, url, outlet, author) {
  return { published_date: publishedDate, entry, url, outlet, author };
}

function readLines(csvPath) {
  return fs.readFileSync(csvPath, 'utf-8').split(/\r?\n/).filter((line, index, all) => {
    // A trailing newline produces one empty final element; drop only that one.
    return !(index === all.length - 1 && line === '');
  });
}

function parseRecord(line) {
  return line.split(aggregator.DELIMITER);
}

async function withTempCsv(run) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'news-aggregator-'));
  const csvPath = path.join(tempDir, 'news_headlines.csv');
  try {
    await run(csvPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('two sites fetched concurrently with duplicate URLs keep first occurrence', async () => {
  await withTempCsv(async (csvPath) => {
    const siteA = [
      aggregator.normalizeItem(
        makeItem('01/02/2026', 'Alpha story', 'https://a.test/1', 'a.test', 'Ada'),
      ),
      aggregator.normalizeItem(
        makeItem('01/03/2026', 'Shared story', 'https://shared.test/x', 'a.test', 'Ada'),
      ),
    ];
    const siteB = [
      aggregator.normalizeItem(
        makeItem('01/04/2026', 'Beta story', 'https://b.test/2', 'b.test', 'Bob'),
      ),
      // Cross-site duplicate of a site-a URL.
      aggregator.normalizeItem(
        makeItem(
          '01/05/2026',
          'Shared story duplicate',
          'https://shared.test/x',
          'b.test',
          'Bob',
        ),
      ),
      // Intra-site duplicate pair.
      aggregator.normalizeItem(
        makeItem('01/06/2026', 'Twin one', 'https://b.test/twin', 'b.test', 'Bob'),
      ),
      aggregator.normalizeItem(
        makeItem('01/07/2026', 'Twin two', 'https://b.test/twin', 'b.test', 'Bob'),
      ),
    ];

    const canned = new Map([
      ['https://site-a.test', siteA],
      ['https://site-b.test', siteB],
    ]);
    const urls = [...canned.keys()];
    const fakeFetcher = async (url) => {
      // Genuine interleave point, without any real network.
      await Promise.resolve();
      return canned.get(url);
    };

    const collected = await aggregator.collectResults(fakeFetcher, urls);
    const records = urls.flatMap((url) => collected.get(url));
    const written = aggregator.saveResults(records, csvPath);

    // 2 + 4 - 1 cross-site dup - 1 intra-site dup = 4.
    assert.equal(written, 4);

    const lines = readLines(csvPath);
    assert.equal(lines.length, 5); // one header + four records
    assert.equal(lines[0], aggregator.HEADER);
    assert.ok(!lines.slice(1).includes(aggregator.HEADER));

    const dataLines = lines.slice(1);
    for (const line of dataLines) {
      assert.equal(parseRecord(line).length, 5);
    }

    const urlsOnDisk = dataLines.map((line) => parseRecord(line)[2]);
    assert.deepEqual(urlsOnDisk, [
      'https://a.test/1',
      'https://shared.test/x',
      'https://b.test/2',
      'https://b.test/twin',
    ]);
    // First occurrence wins: the shared URL keeps site-a's record.
    assert.deepEqual(parseRecord(dataLines[1]), [
      '01/03/2026',
      'Shared story',
      'https://shared.test/x',
      'a.test',
      'Ada',
    ]);
  });
});

test('empty results from every site still produce a header-only CSV', async () => {
  await withTempCsv(async (csvPath) => {
    const fakeFetcher = async () => {
      await Promise.resolve();
      return [];
    };

    const collected = await aggregator.collectResults(
      fakeFetcher,
      ['https://empty-1.test', 'https://empty-2.test'],
    );
    assert.deepEqual([...collected.entries()], [
      ['https://empty-1.test', []],
      ['https://empty-2.test', []],
    ]);

    const records = [...collected.values()].flat();
    const written = aggregator.saveResults(records, csvPath);
    assert.equal(written, 0);

    assert.deepEqual(readLines(csvPath), [aggregator.HEADER]);
  });
});

test('a failing site is logged and the other site still lands in the batch', async () => {
  await withTempCsv(async (csvPath) => {
    const urls = ['https://broken.test', 'https://ok.test'];
    const fakeFetcher = async (url) => {
      await Promise.resolve();
      if (url === 'https://broken.test') {
        throw new Error('boom');
      }
      return [
        aggregator.normalizeItem(
          makeItem('02/01/2026', 'Still here', 'https://ok.test/1', 'ok.test', 'Kim'),
        ),
      ];
    };

    const originalError = console.error;
    const errorMessages = [];
    console.error = (...args) => errorMessages.push(args.join(' '));
    try {
      const collected = await aggregator.collectResults(fakeFetcher, urls);
      assert.deepEqual(collected.get('https://broken.test'), []);
      assert.equal(collected.get('https://ok.test').length, 1);
      assert.ok(errorMessages.some((message) => message.includes('Failed to fetch')));

      const records = urls.flatMap((url) => collected.get(url));
      aggregator.saveResults(records, csvPath);
    } finally {
      console.error = originalError;
    }

    const lines = readLines(csvPath);
    assert.equal(lines[0], aggregator.HEADER);
    assert.equal(lines.length, 2);
    assert.deepEqual(parseRecord(lines[1]), [
      '02/01/2026',
      'Still here',
      'https://ok.test/1',
      'ok.test',
      'Kim',
    ]);
  });
});

test('URLs already present in the target CSV are skipped', async () => {
  await withTempCsv(async (csvPath) => {
    const existing =
      aggregator.HEADER +
      '\n' +
      aggregator
        .itemToLine(
          aggregator.normalizeItem(
            makeItem('03/01/2026', 'Old entry', 'https://old.test/1', 'old.test', 'Lee'),
          ),
        )
        .replace(/\n$/, '');
    fs.writeFileSync(csvPath, existing + '\n', 'utf-8');

    const newRecords = [
      aggregator.normalizeItem(
        makeItem('03/02/2026', 'Old entry again', 'https://old.test/1', 'new.test', 'Pat'),
      ),
      aggregator.normalizeItem(
        makeItem('03/03/2026', 'Brand new', 'https://new.test/2', 'new.test', 'Pat'),
      ),
    ];
    const written = aggregator.saveResults(newRecords, csvPath);
    assert.equal(written, 1);

    const lines = readLines(csvPath);
    assert.equal(lines.length, 3);
    assert.equal(lines[0], aggregator.HEADER);
    assert.deepEqual(parseRecord(lines[1]), [
      '03/01/2026',
      'Old entry',
      'https://old.test/1',
      'old.test',
      'Lee',
    ]);
    assert.deepEqual(parseRecord(lines[2]), [
      '03/03/2026',
      'Brand new',
      'https://new.test/2',
      'new.test',
      'Pat',
    ]);
  });
});

test('pipes are stripped from every field', async () => {
  await withTempCsv(async (csvPath) => {
    const record = aggregator.normalizeItem(
      makeItem(
        '04|01/2026',
        'A | tricky | entry',
        'https://pipes.test/|x|',
        'pipes|test',
        'Sam|my',
      ),
    );
    aggregator.saveResults([record], csvPath);

    const lines = readLines(csvPath);
    assert.equal(lines[0], aggregator.HEADER);
    const fields = parseRecord(lines[1]);
    assert.equal(fields.length, 5);
    assert.deepEqual(fields, [
      '0401/2026',
      'A  tricky  entry',
      'https://pipes.test/x',
      'pipestest',
      'Sammy',
    ]);
    for (const field of fields) {
      assert.ok(!field.includes('|'));
    }
  });
});

test('re-running the same batch is idempotent and never repeats the header', async () => {
  await withTempCsv(async (csvPath) => {
    const records = [
      aggregator.normalizeItem(
        makeItem('05/01/2026', 'Once', 'https://once.test/1', 'once.test', 'Ty'),
      ),
      aggregator.normalizeItem(
        makeItem('05/02/2026', 'Twice', 'https://twice.test/2', 'twice.test', 'Ty'),
      ),
    ];

    const first = aggregator.saveResults(records, csvPath);
    const second = aggregator.saveResults(records, csvPath);
    assert.equal(first, 2);
    assert.equal(second, 0);

    const lines = readLines(csvPath);
    assert.equal(lines.length, 3);
    assert.equal(lines[0], aggregator.HEADER);
    assert.equal(lines.filter((line) => line === aggregator.HEADER).length, 1);
  });
});

test('columns follow the Posted | Entry | URL | Platform | Author contract', async () => {
  await withTempCsv(async (csvPath) => {
    const record = aggregator.normalizeItem(
      makeItem('06/01/2026', 'Ordered', 'https://order.test/1', 'order.test', 'Uma'),
    );
    aggregator.saveResults([record], csvPath);

    const lines = readLines(csvPath);
    assert.equal(lines[0], 'Posted | Entry | URL | Platform | Author');
    assert.deepEqual(parseRecord(lines[1]), [
      '06/01/2026',
      'Ordered',
      'https://order.test/1',
      'order.test',
      'Uma',
    ]);
  });
});

test('main() runs end-to-end on fakes: one stable batch, no network or credentials', async () => {
  await withTempCsv(async (csvPath) => {
    const urls = [
      'https://site-a.test',
      'https://site-b.test',
      'https://empty.test',
      'https://broken.test',
    ];
    const canned = new Map([
      ['https://site-a.test', [
        makeItem('11/01/2026', 'A one', 'https://a.test/1', 'a.test', 'Ada'),
        makeItem('11/02/2026', 'Shared', 'https://shared.test/x', 'a.test', 'Ada'),
      ]],
      ['https://site-b.test', [
        makeItem('11/03/2026', 'B one', 'https://b.test/2', 'b.test', 'Bob'),
        // Cross-site duplicate that must be dropped.
        makeItem('11/04/2026', 'Shared again', 'https://shared.test/x', 'b.test', 'Bob'),
      ]],
      ['https://empty.test', []],
    ]);

    // ---- Fake browser/AgentQL stack, wired in via a require() interceptor.
    class FakePage {
      constructor(sessionUrl) {
        this.sessionUrl = sessionUrl;
      }
      async goto(url) {
        this.sessionUrl = url;
      }
      async queryData() {
        if (this.sessionUrl === 'https://broken.test') {
          throw new Error('simulated outage');
        }
        return { items: canned.get(this.sessionUrl) || [] };
      }
      async close() {}
    }

    class FakeContext {
      async newPage() {
        return new FakePage(null);
      }
    }

    class FakeBrowser {
      async newContext() {
        return new FakeContext();
      }
      async close() {}
    }

    const fakeAgentql = {
      configure() {},
      wrap(page) {
        return page;
      },
    };
    const fakePlaywright = {
      chromium: {
        async launch() {
          return new FakeBrowser();
        },
      },
    };

    const originalLoad = Module._load;
    Module._load = function patchedLoad(request, parent, isMain) {
      if (request === 'agentql') return fakeAgentql;
      if (request === 'playwright') return fakePlaywright;
      return originalLoad.call(this, request, parent, isMain);
    };
    try {
      // Pre-seed the CSV with one URL that site-a would fetch again.
      aggregator.saveResults(
        [
          aggregator.normalizeItem(
            makeItem('10/31/2026', 'Already stored', 'https://a.test/1', 'old.test', 'Lee'),
          ),
        ],
        csvPath,
      );

      const errorMessages = [];
      const originalError = console.error;
      console.error = (...args) => errorMessages.push(args.join(' '));
      try {
        await aggregator.main(csvPath, urls);
      } finally {
        console.error = originalError;
      }
      assert.ok(errorMessages.some((message) => message.includes('Failed to fetch')));
    } finally {
      Module._load = originalLoad;
    }

    const lines = readLines(csvPath);
    // Header + pre-existing row + shared URL + site-b row = 4 lines.
    assert.equal(lines[0], aggregator.HEADER);
    assert.equal(lines.length, 4);
    assert.equal(lines.filter((line) => line === aggregator.HEADER).length, 1);

    const urlsOnDisk = lines.slice(1).map((line) => parseRecord(line)[2]);
    assert.deepEqual(urlsOnDisk, [
      'https://a.test/1',
      'https://shared.test/x',
      'https://b.test/2',
    ]);
    // Existing content is preserved verbatim.
    assert.deepEqual(parseRecord(lines[1]), [
      '10/31/2026',
      'Already stored',
      'https://a.test/1',
      'old.test',
      'Lee',
    ]);
    // No temporary files are left behind after the atomic write.
    const leftovers = fs
      .readdirSync(path.dirname(csvPath))
      .filter((name) => name.endsWith('.tmp'));
    assert.deepEqual(leftovers, []);
  });
});
