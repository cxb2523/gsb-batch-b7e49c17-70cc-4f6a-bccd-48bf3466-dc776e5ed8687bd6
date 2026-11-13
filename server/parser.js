import fs from 'fs';
import path from 'path';

export function deriveProjectName(dirName) {
  // Strip drive prefix like "C--" at the start
  const clean = dirName.replace(/^[A-Za-z]--/, '');

  // Known parent directory markers (case-insensitive search)
  // Match the last occurrence of common parent dirs to get the project folder name
  const lower = clean.toLowerCase();
  const markers = ['-workspace-', '-projects-', '-repos-', '-src-', '-home-', '-desktop-', '-documents-', '-downloads-'];
  let bestIdx = -1;
  let bestLen = 0;
  for (const m of markers) {
    const idx = lower.lastIndexOf(m);
    if (idx > bestIdx) {
      bestIdx = idx;
      bestLen = m.length;
    }
  }
  if (bestIdx !== -1) {
    const result = clean.slice(bestIdx + bestLen);
    // Handle worktree subdirs: "project--claude-worktrees-branch-name" → "project"
    const wtIdx = result.indexOf('--claude-worktrees');
    return wtIdx !== -1 ? result.slice(0, wtIdx) : result;
  }

  // Fallback: strip Users-username prefix, return the rest.
  // macOS dir names start with "-" (paths start with "/"), e.g. "-Users-foo-proj".
  const userMatch = clean.match(/^-?Users-[^-]+-(.+)$/);
  if (userMatch) {
    const rest = userMatch[1];
    const wtIdx = rest.indexOf('--claude-worktrees');
    return wtIdx !== -1 ? rest.slice(0, wtIdx) : rest;
  }

  return clean;
}

// Only assistant entries carry usage, and their compact JSON always contains
// both of these byte sequences. Checking the raw bytes first means the large
// user/tool-result lines are never decoded into strings at all.
const ASSISTANT_MARK = Buffer.from('"assistant"');
const USAGE_MARK = Buffer.from('"usage"');

function recordFromLine(line) {
  if (line.indexOf(USAGE_MARK) === -1 || line.indexOf(ASSISTANT_MARK) === -1) return null;

  let entry;
  try {
    entry = JSON.parse(line.toString('utf8'));
  } catch {
    // Malformed, half-written, or longer than V8's maximum string length.
    return null;
  }

  if (entry?.type !== 'assistant') return null;

  const model = entry.message?.model;
  if (!model || model === '<synthetic>') return null;

  const usage = entry.message?.usage;
  if (!usage) return null;

  return {
    sessionId: entry.sessionId,
    timestamp: entry.timestamp,
    model,
    messageId: entry.message?.id || null,
    input_tokens: usage.input_tokens || 0,
    output_tokens: usage.output_tokens || 0,
    cache_creation_tokens: usage.cache_creation_input_tokens || 0,
    cache_read_tokens: usage.cache_read_input_tokens || 0,
  };
}

// Files are read in fixed-size chunks instead of as one string: a single
// readFileSync(..., 'utf-8') of a log past ~512MB throws "Cannot create a
// string longer than 0x1fffffe8 characters" (issue #2). Parsing is synchronous,
// so one lazily allocated buffer is safely reused across every read.
let chunkBytes = 8 * 1024 * 1024;
let chunkBuffer = null;

/** Test hook: shrink the chunk size to exercise lines that span chunks. */
export function setChunkBytesForTesting(bytes) {
  chunkBytes = bytes;
  chunkBuffer = null;
}

/**
 * Scan bytes [start, end) of a JSONL file. Lines split on the 0x0A byte, which
 * never occurs inside a multi-byte UTF-8 sequence, so a character straddling a
 * chunk boundary is always reassembled intact.
 *
 * Returns the records from newline-terminated lines (`stable`), the byte offset
 * just past the last newline (`stableEnd`), and the records from a trailing
 * unterminated fragment (`tail`), which may still be mid-write.
 */
function scanRecords(filePath, start = 0, end = Infinity) {
  if (!chunkBuffer) chunkBuffer = Buffer.allocUnsafe(chunkBytes);
  const stable = [];
  let stableEnd = start;
  let carry = [];

  const fd = fs.openSync(filePath, 'r');
  try {
    let pos = start;
    while (pos < end) {
      const bytesRead = fs.readSync(fd, chunkBuffer, 0, Math.min(chunkBuffer.length, end - pos), pos);
      if (bytesRead === 0) break;
      const chunk = chunkBuffer.subarray(0, bytesRead);

      let lineStart = 0;
      let nl;
      while ((nl = chunk.indexOf(0x0A, lineStart)) !== -1) {
        let line = chunk.subarray(lineStart, nl);
        if (carry.length) {
          line = Buffer.concat([...carry, line]);
          carry = [];
        }
        const record = recordFromLine(line);
        if (record) stable.push(record);
        lineStart = nl + 1;
        stableEnd = pos + lineStart;
      }
      // The shared buffer is overwritten by the next read, so copy the
      // unfinished line out of it.
      if (lineStart < bytesRead) carry.push(Buffer.from(chunk.subarray(lineStart)));
      pos += bytesRead;
    }
  } finally {
    fs.closeSync(fd);
  }

  const tailRecord = carry.length ? recordFromLine(Buffer.concat(carry)) : null;
  return { stable, stableEnd, tail: tailRecord ? [tailRecord] : [] };
}

export function parseLogFile(filePath) {
  const { stable, tail } = scanRecords(filePath);
  return tail.length ? stable.concat(tail) : stable;
}

/**
 * Deduplicate assistant records by `messageId`.
 *
 * Claude Code JSONL contains one line per streaming snapshot, not one per
 * message. Multiple lines can share the same `message.id`, with the early
 * ones reporting partial cumulative `output_tokens` and the final one the
 * full total. Multi-machine sync further multiplies the same message across
 * machines. Anthropic bills the server-side message once, so we keep the
 * record whose `output_tokens` is largest (the final cumulative snapshot)
 * for each `messageId`. Records without a `messageId` pass through — they
 * predate the id field and are assumed to already be one-per-message.
 */
export function dedupByMessageId(records) {
  const best = new Map();
  const passthrough = [];

  for (const r of records) {
    if (!r.messageId) { passthrough.push(r); continue; }
    const prev = best.get(r.messageId);
    if (!prev || r.output_tokens > prev.output_tokens) {
      best.set(r.messageId, r);
    }
  }

  return [...best.values(), ...passthrough];
}

/**
 * Parse a log file, reusing a previous parse when the file is unchanged.
 * The cache key is the absolute path; a file is considered unchanged when
 * both mtime and size match. Sync-dir reads can sit on slow network/cloud
 * mounts (e.g. Google Drive), where re-reading hundreds of MB per refresh
 * dominates request latency — a stat is orders of magnitude cheaper.
 *
 * Cache layout: `records` covers exactly the first `parsedBytes` bytes of the
 * file, which always end at a newline. The tail past `parsedBytes` (a line
 * still being written, or a final line without a trailing newline) is parsed
 * fresh on every call and never cached — a mid-write fragment fails
 * JSON.parse today but must be picked up once its remaining bytes land.
 *
 * Session JSONL files are append-only (and sync copies preserve that), so a
 * grown file re-parses only the appended bytes — this is what keeps refreshes
 * cheap while an active session's log grows into hundreds of MB.
 */
function parseLogFileCached(filePath, fileCache) {
  if (!fileCache) return parseLogFile(filePath);

  const stat = fs.statSync(filePath);
  // A directory named *.jsonl (or another non-regular entry) reports size 0,
  // which would skip the read loop below and get cached as a successfully
  // parsed empty file. Send it through scanRecords instead: opening it throws
  // EISDIR, and parseFileSafely records it as skipped.
  if (!stat.isFile()) return parseLogFile(filePath);
  const prev = fileCache.get(filePath);
  const unchanged = prev && prev.mtimeMs === stat.mtimeMs && prev.size === stat.size;
  // Anything other than unchanged or grown (shrunk, or rewritten in place)
  // invalidates the cached prefix and needs a full re-parse.
  const appendOnly = unchanged || (prev && stat.size > prev.size);

  if (unchanged && prev.parsedBytes === prev.size) return prev.records;

  const from = appendOnly ? prev.parsedBytes : 0;
  const base = appendOnly ? prev.records : [];
  const { stable, stableEnd, tail } = scanRecords(filePath, from, stat.size);
  const entry = {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    parsedBytes: stableEnd,
    records: stable.length ? base.concat(stable) : base,
  };
  fileCache.set(filePath, entry);
  return tail.length ? entry.records.concat(tail) : entry.records;
}

// One unreadable file (permissions, a directory named *.jsonl, a file removed
// mid-scan) must not take down the whole dashboard. Skip it, and say so once
// per file and error rather than on every refresh.
const reportedFailures = new Set();

function parseFileSafely(filePath, fileCache, onFailure) {
  try {
    return parseLogFileCached(filePath, fileCache);
  } catch (err) {
    fileCache?.delete(filePath);
    const key = `${filePath}\0${err.message}`;
    if (!reportedFailures.has(key)) {
      reportedFailures.add(key);
      console.warn(`Skipping unreadable log file ${filePath}: ${err.message}`);
    }
    // The one-time warning stays quiet on repeat failures, but health-check
    // callers must be told about the file on every run — invoke the callback
    // regardless of whether the warning was suppressed above.
    onFailure?.(filePath, err);
    return [];
  }
}

// Normalize the legacy `fileCache`-only second argument into
// { fileCache, onFailure } without breaking existing callers.
function normalizeParseOptions(options) {
  if (!options) return { fileCache: null, onFailure: null };
  if (options instanceof Map) return { fileCache: options, onFailure: null };
  return {
    fileCache: options.fileCache || null,
    onFailure: options.onFailure || null,
  };
}

// Array.prototype.push(...items) passes every item as a call argument and
// overflows the stack past roughly 100k items, which one large log can exceed.
function appendAll(target, items) {
  for (const item of items) target.push(item);
}

export function parseLogDirectory(baseDir, options = null) {
  const { fileCache, onFailure } = normalizeParseOptions(options);
  return dedupByMessageId(collectRawRecords(baseDir, fileCache, onFailure));
}

// Walk one machine's project directories and return every extracted record
// BEFORE messageId dedup. This is the single read path shared by normal
// parsing and by the sync-dir health check — chunked scans, the incremental
// per-file cache, project-name derivation and unreadable-file handling all
// live here so neither caller can drift into its own file-reading code.
function collectRawRecords(baseDir, fileCache, onFailure) {
  const allRecords = [];

  let projectDirs;
  try {
    projectDirs = fs.readdirSync(baseDir, { withFileTypes: true })
      .filter(d => d.isDirectory());
  } catch {
    return allRecords;
  }

  for (const dir of projectDirs) {
    const projectName = deriveProjectName(dir.name);
    const projectPath = path.join(baseDir, dir.name);

    let files;
    try {
      files = fs.readdirSync(projectPath)
        .filter(f => f.endsWith('.jsonl'));
    } catch {
      continue;
    }

    for (const file of files) {
      const filePath = path.join(projectPath, file);
      const records = parseFileSafely(filePath, fileCache, onFailure);
      for (const record of records) {
        record.project = projectName;
        record.projectDirName = dir.name;
      }
      appendAll(allRecords, records);

      // Also parse subagent transcript files for this session
      const sessionDirName = file.replace(/\.jsonl$/, '');
      const subagentsPath = path.join(projectPath, sessionDirName, 'subagents');
      let subagentFiles;
      try {
        subagentFiles = fs.readdirSync(subagentsPath)
          .filter(f => f.endsWith('.jsonl'));
      } catch {
        continue;
      }

      for (const subFile of subagentFiles) {
        const subFilePath = path.join(subagentsPath, subFile);
        const subRecords = parseFileSafely(subFilePath, fileCache, onFailure);
        for (const record of subRecords) {
          record.project = projectName;
          record.projectDirName = dir.name;
          record.sessionId = sessionDirName; // Group with parent session
        }
        appendAll(allRecords, subRecords);
      }
    }
  }

  return allRecords;
}

export function parseMultiMachineDirectory(syncDir, fileCache = null) {
  const allRecords = [];

  let machineDirs;
  try {
    machineDirs = fs.readdirSync(syncDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.isSymbolicLink());
  } catch {
    return allRecords;
  }

  for (const machineDir of machineDirs) {
    const machinePath = path.join(syncDir, machineDir.name);
    appendAll(allRecords, parseLogDirectory(machinePath, fileCache));
  }

  return dedupByMessageId(allRecords);
}

function emptySyncHealth() {
  return {
    machines: [],
    skipped_files: [],
    totals: {
      machine_count: 0,
      record_count: 0,
      unique_message_count: 0,
      duplicate_count: 0,
      skipped_file_count: 0,
    },
  };
}

/**
 * Health check for a multi-machine sync directory.
 *
 * Each machine folder is walked with the shared raw-collection path (same
 * chunked reads, incremental cache and one-time unreadable-file warning as a
 * normal parse). Dedup then runs in two passes, reusing dedupByMessageId:
 *
 *   1. Per machine — streaming snapshots and same-machine repeats of one
 *      messageId collapse to the largest output_tokens row; rows without a
 *      messageId (older log format) pass through untouched.
 *   2. Globally — the same messageId synced from several machines again keeps
 *      only the largest output_tokens row, and every extra copy is reported
 *      as a duplicate against the machine that carried it.
 *
 * A missing or unreadable sync dir yields an empty report rather than throwing.
 *
 * @param {string} syncDir shared directory containing per-machine subfolders
 * @param {Map} [fileCache] optional per-file parse cache, shared with normal parses
 * @returns {{
 *   machines: Array<{machine: string, record_count: number,
 *     unique_message_count: number, projects: string[], duplicate_count: number}>,
 *   skipped_files: Array<{machine: string, file: string, error: string}>,
 *   totals: {machine_count: number, record_count: number,
 *     unique_message_count: number, duplicate_count: number, skipped_file_count: number}
 * }}
 */
export function inspectSyncDirectory(syncDir, fileCache = null) {
  let machineDirs;
  try {
    machineDirs = fs.readdirSync(syncDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.isSymbolicLink());
  } catch {
    return emptySyncHealth();
  }

  const machines = [];
  const skippedFiles = [];
  // Deduped per-machine records, tagged with the machine they belong to.
  const perMachineDeduped = [];

  for (const machineDir of machineDirs) {
    const machine = machineDir.name;
    const skippedForMachine = [];

    const rawRecords = collectRawRecords(
      path.join(syncDir, machine),
      fileCache,
      (file, err) => skippedForMachine.push({ machine, file, error: err.message })
    );
    const dedupedRecords = dedupByMessageId(rawRecords);

    const projectSet = new Set();
    for (const r of dedupedRecords) {
      if (r.project) projectSet.add(r.project);
    }

    machines.push({
      machine,
      record_count: rawRecords.length,
      unique_message_count: dedupedRecords.length,
      projects: [...projectSet].sort(),
      // Rows dropped by the per-machine dedup (streaming snapshots, repeats).
      duplicate_count: rawRecords.length - dedupedRecords.length,
    });
    skippedFiles.push(...skippedForMachine);

    for (const record of dedupedRecords) perMachineDeduped.push({ machine, record });
  }

  // Global pass: one messageId copied across machines survives once (largest
  // output_tokens — the same rule as dedupByMessageId). Rows without a
  // messageId pass through and are never duplicates.
  const bestById = new Map();
  const globalPassthrough = [];
  for (const candidate of perMachineDeduped) {
    const { machine, record } = candidate;
    if (!record.messageId) { globalPassthrough.push(candidate); continue; }
    const prev = bestById.get(record.messageId);
    if (!prev || record.output_tokens > prev.record.output_tokens) {
      if (prev) {
        machines.find(m => m.machine === prev.machine).duplicate_count++;
      }
      bestById.set(record.messageId, candidate);
    } else {
      machines.find(m => m.machine === machine).duplicate_count++;
    }
  }

  const globalUnique = bestById.size + globalPassthrough.length;
  const totalDuplicates = machines.reduce((sum, m) => sum + m.duplicate_count, 0);

  return {
    machines,
    skipped_files: skippedFiles,
    totals: {
      machine_count: machines.length,
      record_count: globalUnique,
      unique_message_count: globalUnique,
      duplicate_count: totalDuplicates,
      skipped_file_count: skippedFiles.length,
    },
  };
}
