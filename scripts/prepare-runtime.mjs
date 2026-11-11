import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = join(root, 'runtime-bundle');
const staging = join(root, `.runtime-stage-${process.pid}`);
const jdk = join(root, 'research/runtime/jdk-17.0.20.1+1');
const jarSource = join(root, 'research/sign-test/unidbg-sign/dependencies.jar');
const sdkSource = join(root, 'research/sign-test/capture/fq_oversea');
const ffmpegSource = process.env.HONGGUO_FFMPEG_SOURCE || 'C:/Users/11asa/AppData/Roaming/Python/Python313/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe';
const expectedJarHash = '03b6984d56682fbde0d941ca3ae7177260189a3c9da4a18732d1bae064bb1ecd';
const modules = 'java.base,java.desktop,java.logging,java.management,java.naming,java.sql,jdk.unsupported,jdk.crypto.ec';
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex');

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Runtime tool failed: ${command}\n${result.stderr || result.error || 'nonzero exit'}`);
  return result;
}

async function removeGenerated(path) {
  const target = resolve(path);
  if (target !== staging && target !== destination && !target.startsWith(staging + sep))
    throw new Error('Refusing to remove a path outside generated runtime output');
  await rm(target, { recursive: true, force: true });
}

async function walk(path, prefix = '') {
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await walk(join(path, entry.name), relative));
    else files.push(relative);
  }
  return files;
}

async function verifyBridge(bundle) {
  const child = spawn(join(bundle, 'java/bin/java.exe'), [
    '-cp', `${join(bundle, 'classes')};${join(bundle, 'dependencies.jar')}`,
    'app.hongguo.runtime.SignerBridge', join(bundle, 'sdk'),
  ], { cwd: bundle, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  let stderrBytes = 0;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { stderrBytes += chunk.length; });
  const timeout = setTimeout(() => child.kill(), 90_000);
  const requests = [1, 2].map(seq => JSON.stringify({
    seq,
    url: 'https://api5-normal-sinfonlinec.fqnovel.com/reading/bookapi/search/tab/v?aid=1967&version_code=68132&query=test',
    headers: { 'x-ss-req-ticket': String(Date.now()), 'content-type': 'application/json' },
  }));
  // An invalid line between valid requests verifies that protocol errors do not kill the worker.
  child.stdin.end(`${requests[0]}\n{\n${requests[1]}\n`);
  try {
    const code = await new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('close', resolveExit);
    });
    assert.equal(code, 0, 'signer must exit cleanly on EOF');
    assert.equal(stderrBytes, 0, 'signer must keep diagnostics private');
    const lines = output.trim().split(/\r?\n/);
    assert.equal(lines.length, 3, 'exactly one response per input line');
    let responses;
    try { responses = lines.map(line => JSON.parse(line)); }
    catch { throw new Error('signer emitted non-JSON output'); }
    assert.deepEqual(responses[1], { seq: null, error: 'SIGN_FAILED' });
    return [responses[0], responses[2]].map((response, index) => {
      // Fixed messages deliberately exclude actual signature values.
      if (response.seq !== index + 1 || !response.headers || response.error)
        throw new Error(`Signature smoke test ${index + 1} failed`);
      const names = Object.keys(response.headers);
      if (!names.some(name => name.toLowerCase() === 'x-gorgon') ||
          !names.some(name => name.toLowerCase() === 'x-argus'))
        throw new Error('Required signature fields absent');
      if (!Object.values(response.headers).every(value => typeof value === 'string' && value.length > 0))
        throw new Error('Empty signature value');
      return { seq: response.seq, fields: Object.fromEntries(names.map(name => [name, response.headers[name].length])) };
    });
  } finally { clearTimeout(timeout); }
}

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Windows x64 is required');
  assert.equal(await hash(jarSource), expectedJarHash, 'Research dependency checksum mismatch');
  for (const path of [join(jdk, 'bin/javac.exe'), join(jdk, 'bin/jlink.exe'), ffmpegSource]) await stat(path);
  await mkdir(staging, { recursive: true });
  const extracted = join(staging, 'dependency-content');
  const notices = join(staging, 'notices');
  await mkdir(extracted);
  await mkdir(notices);
  run(join(jdk, 'bin/jar.exe'), ['xf', jarSource], extracted);
  const originalEntries = await walk(extracted);
  const excluded = originalEntries.filter(path => path.startsWith('com/hongguo/') || path.startsWith('META-INF/maven/com.hongguo/'));
  for (const path of excluded) await removeGenerated(join(extracted, path));
  await removeGenerated(join(extracted, 'META-INF/MANIFEST.MF'));
  for (const path of originalEntries.filter(path => /(^|\/)(LICENSE[^/]*|NOTICE[^/]*|pom\.properties)$/i.test(path) && !excluded.includes(path))) {
    const target = join(notices, 'dependencies', path);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(extracted, path), target);
  }
  run(join(jdk, 'bin/jar.exe'), ['--create', '--file', join(staging, 'dependencies.jar'), '-C', extracted, '.']);
  const retained = run(join(jdk, 'bin/jar.exe'), ['tf', join(staging, 'dependencies.jar')]).stdout;
  if (/com\/hongguo\/.*\.class/.test(retained)) throw new Error('Upstream application classes remain in bundle');
  await removeGenerated(extracted);
  await mkdir(join(staging, 'classes'));
  run(join(jdk, 'bin/javac.exe'), ['--release', '17', '-encoding', 'UTF-8', '-cp', join(staging, 'dependencies.jar'), '-d', join(staging, 'classes'), join(root, 'runtime/SignerBridge.java')]);
  run(join(jdk, 'bin/jlink.exe'), ['--add-modules', modules, '--strip-debug', '--no-header-files', '--no-man-pages', '--compress=2', '--output', join(staging, 'java')]);
  await cp(join(jdk, 'NOTICE'), join(notices, 'TEMURIN-NOTICE.txt'));
  await cp(join(jdk, 'release'), join(notices, 'TEMURIN-release.txt'));
  await cp(join(root, 'docs/runtime-components.md'), join(notices, 'runtime-components.md'));
  await mkdir(join(staging, 'sdk'));
  const sdk = [];
  for (const filename of ['libc++_shared.so', 'libmetasec_ml.so', 'ms_16777218.bin']) {
    await cp(join(sdkSource, filename), join(staging, 'sdk', filename));
    sdk.push({ filename, sha256: await hash(join(staging, 'sdk', filename)) });
  }
  await cp(ffmpegSource, join(staging, 'ffmpeg.exe'));
  const ffmpegLicense = run(join(staging, 'ffmpeg.exe'), ['-L']);
  await writeFile(join(notices, 'FFMPEG-license-and-build.txt'), ffmpegLicense.stdout + ffmpegLicense.stderr);
  const verification = await verifyBridge(staging);
  const manifest = {
    scope: 'Local private Windows build; SDK redistribution permission unverified',
    preparedAt: new Date().toISOString(),
    java: { version: '17.0.20.1+1', modules },
    dependencies: { sourceSha256: expectedJarHash, bundledSha256: await hash(join(staging, 'dependencies.jar')), removedEntries: excluded },
    sdk,
    ffmpeg: { source: ffmpegSource, sha256: await hash(join(staging, 'ffmpeg.exe')), license: 'GPL-3.0-or-later, as reported by binary -L' },
    bridgeSourceSha256: await hash(join(root, 'runtime/SignerBridge.java')),
    verification,
  };
  await writeFile(join(notices, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await removeGenerated(destination);
  await rename(staging, destination);
  console.log(JSON.stringify({ runtime: destination, signingTests: verification, malformedRequest: 'SIGN_FAILED', upstreamApplicationClassesRemoved: excluded.length }, null, 2));
}

main().catch(async error => {
  await removeGenerated(staging).catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
});
