import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { inspectSyncDirectory } from '../server/parser.js';

const assistant = ({ id, out, sessionId = 's1', project }) => JSON.stringify({
  type: 'assistant',
  sessionId,
  timestamp: '2026-07-01T00:00:00.000Z',
  message: {
    id,
    model: 'claude-sonnet-5',
    usage: { input_tokens: 10, output_tokens: out, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  },
});

// Old-format entry predating the message.id field.
const legacyAssistant = ({ out = 5, sessionId = 's1' }) => JSON.stringify({
  type: 'assistant',
  sessionId,
  timestamp: '2025-01-01T00:00:00.000Z',
  message: {
    model: 'claude-opus-4',
    usage: { input_tokens: 10, output_tokens: out, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  },
});

const proj = (root, machine, project) => {
  const dir = path.join(root, machine, `-Users-test-Workspace-${project}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

describe('inspectSyncDirectory', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-health-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  describe('grouped stats and cross-machine duplicates', () => {
    beforeEach(() => {
      // --- Machine A: two projects, one message streamed in 3 snapshots,
      // one unique message, one legacy record without a messageId, and the
      // shared message duplicated on the other machine.
      const dirA1 = proj(tmpDir, 'machine-a', 'alpha');
      fs.writeFileSync(path.join(dirA1, 'sess.jsonl'), [
        assistant({ id: 'msg_shared', out: 100 }),
        assistant({ id: 'msg_shared', out: 180 }), // same-machine streaming snapshot
        assistant({ id: 'msg_only_a', out: 40 }),
        legacyAssistant({ out: 7 }),               // no messageId: never deduped
      ].join('\n') + '\n');

      const dirA2 = proj(tmpDir, 'machine-a', 'beta');
      fs.writeFileSync(path.join(dirA2, 'other.jsonl'),
        assistant({ id: 'msg_beta', out: 25, sessionId: 's9' }) + '\n');

      // --- Machine B: the shared message with a LARGER output_tokens wins
      // globally; plus its own unique message.
      const dirB1 = proj(tmpDir, 'machine-b', 'alpha');
      fs.writeFileSync(path.join(dirB1, 'sess.jsonl'), [
        assistant({ id: 'msg_shared', out: 220 }),
        assistant({ id: 'msg_only_b', out: 60 }),
      ].join('\n') + '\n');
    });

    it('groups stats by machine name', () => {
      const health = inspectSyncDirectory(tmpDir);
      expect(health.machines).to.have.length(2);
      const byName = Object.fromEntries(health.machines.map(m => [m.machine, m]));
      expect(byName).to.have.property('machine-a');
      expect(byName).to.have.property('machine-b');
    });

    it('counts raw records and deduped messages per machine', () => {
      const byName = Object.fromEntries(
        inspectSyncDirectory(tmpDir).machines.map(m => [m.machine, m])
      );
      // Machine A raw: shared x2 snapshots + only_a + legacy + beta = 5
      expect(byName['machine-a'].record_count).to.equal(5);
      // Deduped within A: shared (1) + only_a + legacy + beta = 4
      expect(byName['machine-a'].unique_message_count).to.equal(4);
      // Machine B raw: shared + only_b = 2, both unique within the machine
      expect(byName['machine-b'].record_count).to.equal(2);
      expect(byName['machine-b'].unique_message_count).to.equal(2);
    });

    it('collects the project-name set per machine', () => {
      const byName = Object.fromEntries(
        inspectSyncDirectory(tmpDir).machines.map(m => [m.machine, m])
      );
      expect(byName['machine-a'].projects).to.deep.equal(['alpha', 'beta']);
      expect(byName['machine-b'].projects).to.deep.equal(['alpha']);
    });

    it('keeps only the largest output_tokens copy of a cross-machine message', () => {
      const health = inspectSyncDirectory(tmpDir);
      // 4 per-machine-unique rows on A + 2 on B = 6, minus the one extra
      // cross-machine copy of msg_shared.
      expect(health.totals.unique_message_count).to.equal(5);
      expect(health.totals.record_count).to.equal(5);
    });

    it('reports every dropped copy as a duplicate against its machine', () => {
      const health = inspectSyncDirectory(tmpDir);
      const byName = Object.fromEntries(health.machines.map(m => [m.machine, m]));
      // Machine A: one streaming snapshot of msg_shared lost in the per-machine
      // dedup. Its remaining shared copy (out=180) then loses the global dedup
      // to machine B's out=220 copy → 2 duplicates total.
      expect(byName['machine-a'].duplicate_count).to.equal(2);
      // Machine B keeps its shared copy; no duplicates.
      expect(byName['machine-b'].duplicate_count).to.equal(0);
      expect(health.totals.duplicate_count).to.equal(2);
    });

    it('counts records without a messageId as unique and never as duplicates', () => {
      const health = inspectSyncDirectory(tmpDir);
      const byName = Object.fromEntries(health.machines.map(m => [m.machine, m]));
      expect(byName['machine-a'].unique_message_count).to.equal(4);
      expect(health.totals.duplicate_count).to.equal(2);
    });

    it('reuses the incremental parse cache without changing the result', () => {
      const cache = new Map();
      const first = inspectSyncDirectory(tmpDir, cache);
      const second = inspectSyncDirectory(tmpDir, cache);
      expect(second).to.deep.equal(first);
      expect(cache.size).to.be.greaterThan(0);
    });
  });

  describe('skipped files', () => {
    beforeEach(() => {
      const dir = proj(tmpDir, 'machine-a', 'alpha');
      // A normal, readable log beside a directory named broken.jsonl: opening
      // it as a file fails, so it must land in the skipped list.
      fs.writeFileSync(path.join(dir, 'good.jsonl'),
        assistant({ id: 'msg_good', out: 10 }) + '\n');
      fs.mkdirSync(path.join(dir, 'broken.jsonl'));
    });

    it('keeps parsing the readable log and lists the unreadable one', () => {
      const originalWarn = console.warn;
      const warnings = [];
      console.warn = msg => warnings.push(msg);
      let health;
      try {
        health = inspectSyncDirectory(tmpDir, new Map());
      } finally {
        console.warn = originalWarn;
      }

      const machine = health.machines.find(m => m.machine === 'machine-a');
      expect(machine.record_count).to.equal(1);
      expect(machine.unique_message_count).to.equal(1);

      expect(health.skipped_files).to.have.length(1);
      const skipped = health.skipped_files[0];
      expect(skipped.machine).to.equal('machine-a');
      expect(skipped.file).to.equal(path.join(tmpDir, 'machine-a', '-Users-test-Workspace-alpha', 'broken.jsonl'));
      expect(skipped.error).to.be.a('string').and.not.be.empty;
      expect(health.totals.skipped_file_count).to.equal(1);
      // The existing one-time warning behavior must not regress.
      expect(warnings).to.have.length(1);
      expect(warnings[0]).to.include('broken.jsonl');
    });
  });

  describe('missing or unreadable sync directory', () => {
    it('returns an empty result for a non-existent directory', () => {
      const health = inspectSyncDirectory(path.join(tmpDir, 'does-not-exist'));
      expect(health.machines).to.deep.equal([]);
      expect(health.skipped_files).to.deep.equal([]);
      expect(health.totals).to.deep.equal({
        machine_count: 0,
        record_count: 0,
        unique_message_count: 0,
        duplicate_count: 0,
        skipped_file_count: 0,
      });
    });

    it('returns an empty result instead of throwing for a file used as the sync dir', () => {
      const filePath = path.join(tmpDir, 'not-a-dir');
      fs.writeFileSync(filePath, 'data');
      expect(() => inspectSyncDirectory(filePath)).to.not.throw();
      const health = inspectSyncDirectory(filePath);
      expect(health.machines).to.deep.equal([]);
      expect(health.totals.machine_count).to.equal(0);
    });

    it('returns an empty result for an empty directory', () => {
      const health = inspectSyncDirectory(tmpDir);
      expect(health.machines).to.deep.equal([]);
      expect(health.skipped_files).to.deep.equal([]);
      expect(health.totals.machine_count).to.equal(0);
    });
  });
});
