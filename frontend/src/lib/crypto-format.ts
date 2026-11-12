/**
 * The v1 encrypted-blob format.
 *
 * Every encrypted object starts with a one-byte format marker (`0x01`) and a big-endian header of
 * 32-bit key versions (and payload revision), followed by its body. The same header values are
 * also inside the authenticated data (AES-GCM) or the RSA-OAEP label, so a blob cannot be moved
 * to another board, project, workspace, person or file, nor relabelled with another key version
 * or revision.
 *
 * | Blob                              | Header                                    | Body                     | Bound context (AAD / label)                                     |
 * |-----------------------------------|-------------------------------------------|--------------------------|-----------------------------------------------------------------|
 * | Board payload                     | `01` · boardKeyVersion(4) · revision(4)   | IV(12) · ciphertext+tag  | `canvhq/v1/board-payload/{boardId}/{boardKeyVersion}/{revision}`|
 * | Board file                        | `01` · boardKeyVersion(4)                 | IV(12) · ciphertext+tag  | `canvhq/v1/board-file/{boardId}/{boardKeyVersion}/{fileId}`     |
 * | Board key under project key       | `01` · boardKeyVersion · projectKeyVersion| IV(12) · ciphertext+tag  | `canvhq/v1/board-key/{projectId}/{boardId}/{boardKeyVersion}/{projectKeyVersion}` |
 * | Project key under workspace key   | `01` · projectKeyVersion · workspaceKeyVersion | IV(12) · ciphertext+tag | `canvhq/v1/project-key/{workspaceId}/{projectId}/{projectKeyVersion}/{workspaceKeyVersion}` |
 * | Project key to a person (RSA)     | `01` · projectKeyVersion                  | RSA ciphertext           | `canvhq/v1/member-project-key/{projectId}/{userId}/{projectKeyVersion}` |
 * | Workspace key to a person (RSA)   | `01` · workspaceKeyVersion                | RSA ciphertext           | `canvhq/v1/member-workspace-key/{workspaceId}/{userId}/{workspaceKeyVersion}` |
 * | Project key history (old under new)| `01` · oldVersion · newVersion            | IV(12) · ciphertext+tag  | `canvhq/v1/project-key-history/{projectId}/{oldVersion}/{newVersion}` |
 *
 * Wrapped keys are base64url encoded for transport; the board payload and board files stay binary.
 * This binds a blob to where it belongs. Rollback detection is narrowed: a server replaying an older
 * valid payload is detected on devices that have seen a newer version (via their local highest-seen
 * revision store; a brand new device with no local history cannot detect an initial replay). The
 * passphrase-to-private-key wrap is deliberately outside this format: it is not tied to a board and
 * is not rotated here.
 *
 * The only differences in a v1 blob are its header layout and bound context, so each public
 * function names its own type rather than taking an "any blob" union.
 */

import { base64UrlToBytes, bytesToBase64Url } from './crypto';

const FORMAT_V1 = 0x01;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const U32_BYTES = 4;
const MAX_KEY_VERSION = 0xffffffff;
const MAX_REVISION = 0xffffffff;

const PAYLOAD_HEADER_BYTES = 1 + U32_BYTES + U32_BYTES;
const FILE_HEADER_BYTES = 1 + U32_BYTES;
const WRAP_HEADER_BYTES = 1 + U32_BYTES + U32_BYTES;
const RSA_HEADER_BYTES = 1 + U32_BYTES;

/** The blob's first byte is not the format this build understands, or its header is truncated. */
export class UnsupportedFormatError extends Error {
  readonly code = 'unsupported-format' as const;

  constructor(message = 'This encrypted data uses an unsupported format.') {
    super(message);
    this.name = 'UnsupportedFormatError';
  }
}

/** The blob is valid but was made under a different key generation than the caller expected. */
export class KeyVersionMismatchError extends Error {
  readonly code = 'key-version-mismatch' as const;

  constructor(message = 'This encrypted data belongs to a different key generation.') {
    super(message);
    this.name = 'KeyVersionMismatchError';
  }
}

/** The key was right and the format was readable, but authentication or decryption failed. */
export class DecryptionError extends Error {
  readonly code = 'decryption-failed' as const;

  constructor(message = 'This encrypted data could not be decrypted.', options?: ErrorOptions) {
    super(message, options);
    this.name = 'DecryptionError';
  }
}

export interface BoardPayloadContext {
  boardId: string;
  keyVersion: number;
  revision: number;
}

export interface BoardFileContext {
  boardId: string;
  boardKeyVersion: number;
  fileId: string;
}

export interface BoardKeyContext {
  projectId: string;
  boardId: string;
  boardKeyVersion: number;
  projectKeyVersion: number;
}

export interface ProjectKeyContext {
  workspaceId: string;
  projectId: string;
  projectKeyVersion: number;
  workspaceKeyVersion: number;
}

export interface MemberProjectKeyContext {
  projectId: string;
  userId: string;
  projectKeyVersion: number;
}

export interface MemberWorkspaceKeyContext {
  workspaceId: string;
  userId: string;
  workspaceKeyVersion: number;
}

export interface ProjectKeyHistoryContext {
  projectId: string;
  oldVersion: number;
  newVersion: number;
}

function assertVersion(version: number): void {
  if (!Number.isInteger(version) || version < 1 || version > MAX_KEY_VERSION) {
    throw new UnsupportedFormatError('The key version in this data is not valid.');
  }
}

function assertRevision(revision: number): void {
  if (!Number.isInteger(revision) || revision < 0 || revision > MAX_REVISION) {
    throw new UnsupportedFormatError('The revision in this data is not valid.');
  }
}

function u32(value: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(U32_BYTES);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function readU32(view: DataView, offset: number): number {
  const version = view.getUint32(offset, false);
  if (version < 1) {
    throw new UnsupportedFormatError('The key version in this data is not valid.');
  }
  return version;
}

function readRevision(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

function randomIv(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(IV_BYTES));
}

function aad(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value);
}

function decodeWrapped(blob: string, headerBytes: number): Uint8Array<ArrayBuffer> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64UrlToBytes(blob);
  } catch {
    throw new UnsupportedFormatError('This wrapped key is not valid base64url data.');
  }

  if (bytes.length < headerBytes + IV_BYTES + TAG_BYTES || bytes[0] !== FORMAT_V1) {
    throw new UnsupportedFormatError(
      'This wrapped key is truncated or uses an unsupported format.',
    );
  }

  return bytes;
}

function assertMatches(actual: number, expected: number, what: string): void {
  if (actual !== expected) {
    throw new KeyVersionMismatchError(
      `This ${what} is version ${actual}, but version ${expected} was expected.`,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Board payload
// ---------------------------------------------------------------------------------------------

export async function sealBoardPayload(
  key: CryptoKey,
  data: unknown,
  context: BoardPayloadContext,
): Promise<Uint8Array<ArrayBuffer>> {
  assertVersion(context.keyVersion);
  assertRevision(context.revision);
  const iv = randomIv();
  const bound = aad(
    `canvhq/v1/board-payload/${context.boardId}/${context.keyVersion}/${context.revision}`,
  );

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: bound },
      key,
      new TextEncoder().encode(JSON.stringify(data)),
    ),
  );

  return concat([
    new Uint8Array([FORMAT_V1]),
    u32(context.keyVersion),
    u32(context.revision),
    iv,
    ciphertext,
  ]);
}

/**
 * The revision a payload claims in its header. It is only a claim until `openBoardPayload`
 * authenticates it (the revision is part of the authenticated data), so callers pass it back there.
 */
export function readPayloadRevision(blob: ArrayBuffer | Uint8Array): number {
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  if (bytes.length < PAYLOAD_HEADER_BYTES || bytes[0] !== FORMAT_V1) {
    throw new UnsupportedFormatError(
      'This board payload is truncated or uses an unsupported format.',
    );
  }
  return readRevision(
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    1 + U32_BYTES,
  );
}

/** The key version a payload claims in its header; authenticated by `openBoardPayload` like the revision. */
export function readPayloadKeyVersion(blob: ArrayBuffer | Uint8Array): number {
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  if (bytes.length < PAYLOAD_HEADER_BYTES || bytes[0] !== FORMAT_V1) {
    throw new UnsupportedFormatError(
      'This board payload is truncated or uses an unsupported format.',
    );
  }
  return readU32(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), 1);
}

export async function openBoardPayload(
  key: CryptoKey,
  blob: ArrayBuffer | Uint8Array,
  context: BoardPayloadContext,
): Promise<unknown> {
  assertVersion(context.keyVersion);
  assertRevision(context.revision);
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);

  if (bytes.length < PAYLOAD_HEADER_BYTES + IV_BYTES + TAG_BYTES || bytes[0] !== FORMAT_V1) {
    throw new UnsupportedFormatError(
      'This board payload is truncated or uses an unsupported format.',
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = readU32(view, 1);
  const revision = readRevision(view, 1 + U32_BYTES);
  assertMatches(version, context.keyVersion, 'board payload');
  assertMatches(revision, context.revision, 'board payload revision');

  const iv = bytes.slice(PAYLOAD_HEADER_BYTES, PAYLOAD_HEADER_BYTES + IV_BYTES);
  const ciphertext = bytes.slice(PAYLOAD_HEADER_BYTES + IV_BYTES);

  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: aad(`canvhq/v1/board-payload/${context.boardId}/${version}/${revision}`),
      },
      key,
      ciphertext,
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch (error) {
    throw new DecryptionError('This board payload could not be decrypted.', { cause: error });
  }
}

// ---------------------------------------------------------------------------------------------
// Board file (images)
// ---------------------------------------------------------------------------------------------

export async function encryptBoardFile(
  key: CryptoKey,
  context: BoardFileContext,
  file: { mimeType: string; data: Uint8Array },
): Promise<Uint8Array<ArrayBuffer>> {
  assertVersion(context.boardKeyVersion);

  const mimeBytes = new TextEncoder().encode(file.mimeType);
  if (mimeBytes.length > 255) {
    throw new UnsupportedFormatError('The file MIME type is too long.');
  }

  const plaintext = concat([new Uint8Array([mimeBytes.length]), mimeBytes, file.data]);
  const iv = randomIv();
  const bound = aad(
    `canvhq/v1/board-file/${context.boardId}/${context.boardKeyVersion}/${context.fileId}`,
  );

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: bound }, key, plaintext),
  );

  return concat([new Uint8Array([FORMAT_V1]), u32(context.boardKeyVersion), iv, ciphertext]);
}

export async function decryptBoardFile(
  key: CryptoKey,
  blob: Uint8Array | ArrayBuffer,
  context: BoardFileContext,
): Promise<{ mimeType: string; data: Uint8Array<ArrayBuffer> }> {
  assertVersion(context.boardKeyVersion);
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);

  if (bytes.length < FILE_HEADER_BYTES + IV_BYTES + TAG_BYTES || bytes[0] !== FORMAT_V1) {
    throw new UnsupportedFormatError('This board file is truncated or uses an unsupported format.');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = readU32(view, 1);
  assertMatches(version, context.boardKeyVersion, 'board file');

  const iv = bytes.slice(FILE_HEADER_BYTES, FILE_HEADER_BYTES + IV_BYTES);
  const ciphertext = bytes.slice(FILE_HEADER_BYTES + IV_BYTES);

  let plaintextBuffer: ArrayBuffer;
  try {
    plaintextBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: aad(`canvhq/v1/board-file/${context.boardId}/${version}/${context.fileId}`),
      },
      key,
      ciphertext,
    );
  } catch (error) {
    throw new DecryptionError('This board file could not be decrypted.', { cause: error });
  }

  const plaintext = new Uint8Array(plaintextBuffer);
  if (plaintext.length < 1) {
    throw new UnsupportedFormatError('This decrypted board file is empty.');
  }

  const mimeLen = plaintext[0] ?? 0;
  if (plaintext.length < 1 + mimeLen) {
    throw new UnsupportedFormatError('This decrypted board file is truncated.');
  }

  const mimeType = new TextDecoder().decode(plaintext.subarray(1, 1 + mimeLen));
  const data = plaintext.slice(1 + mimeLen);

  return { mimeType, data };
}

// ---------------------------------------------------------------------------------------------
// Board key wrapped under the project key
// ---------------------------------------------------------------------------------------------

export async function wrapBoardKeyForProject(
  boardKey: CryptoKey,
  projectKey: CryptoKey,
  context: BoardKeyContext,
): Promise<string> {
  assertVersion(context.boardKeyVersion);
  assertVersion(context.projectKeyVersion);

  const iv = randomIv();
  const wrapped = new Uint8Array(
    await crypto.subtle.wrapKey('raw', boardKey, projectKey, {
      name: 'AES-GCM',
      iv,
      additionalData: aad(
        `canvhq/v1/board-key/${context.projectId}/${context.boardId}/${context.boardKeyVersion}/${context.projectKeyVersion}`,
      ),
    }),
  );

  return bytesToBase64Url(
    concat([
      new Uint8Array([FORMAT_V1]),
      u32(context.boardKeyVersion),
      u32(context.projectKeyVersion),
      iv,
      wrapped,
    ]),
  );
}

export async function unwrapBoardKeyFromProject(
  blob: string,
  projectKey: CryptoKey,
  context: BoardKeyContext,
): Promise<CryptoKey> {
  const bytes = decodeWrapped(blob, WRAP_HEADER_BYTES);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boardKeyVersion = readU32(view, 1);
  const projectKeyVersion = readU32(view, 5);
  assertMatches(boardKeyVersion, context.boardKeyVersion, 'board key');
  assertMatches(projectKeyVersion, context.projectKeyVersion, 'board key project version');

  const iv = bytes.slice(WRAP_HEADER_BYTES, WRAP_HEADER_BYTES + IV_BYTES);
  const wrapped = bytes.slice(WRAP_HEADER_BYTES + IV_BYTES);

  try {
    return await crypto.subtle.unwrapKey(
      'raw',
      wrapped,
      projectKey,
      {
        name: 'AES-GCM',
        iv,
        additionalData: aad(
          `canvhq/v1/board-key/${context.projectId}/${context.boardId}/${boardKeyVersion}/${projectKeyVersion}`,
        ),
      },
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'],
    );
  } catch (error) {
    throw new DecryptionError('This board key could not be unwrapped.', { cause: error });
  }
}

// ---------------------------------------------------------------------------------------------
// Project key wrapped under the workspace key
// ---------------------------------------------------------------------------------------------

export async function wrapProjectKeyForWorkspace(
  projectKey: CryptoKey,
  workspaceKey: CryptoKey,
  context: ProjectKeyContext,
): Promise<string> {
  assertVersion(context.projectKeyVersion);
  assertVersion(context.workspaceKeyVersion);

  const iv = randomIv();
  const wrapped = new Uint8Array(
    await crypto.subtle.wrapKey('raw', projectKey, workspaceKey, {
      name: 'AES-GCM',
      iv,
      additionalData: aad(
        `canvhq/v1/project-key/${context.workspaceId}/${context.projectId}/${context.projectKeyVersion}/${context.workspaceKeyVersion}`,
      ),
    }),
  );

  return bytesToBase64Url(
    concat([
      new Uint8Array([FORMAT_V1]),
      u32(context.projectKeyVersion),
      u32(context.workspaceKeyVersion),
      iv,
      wrapped,
    ]),
  );
}

export async function unwrapProjectKeyFromWorkspace(
  blob: string,
  workspaceKey: CryptoKey,
  context: ProjectKeyContext,
): Promise<CryptoKey> {
  const bytes = decodeWrapped(blob, WRAP_HEADER_BYTES);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const projectKeyVersion = readU32(view, 1);
  const workspaceKeyVersion = readU32(view, 5);
  assertMatches(projectKeyVersion, context.projectKeyVersion, 'project key');
  assertMatches(workspaceKeyVersion, context.workspaceKeyVersion, 'project key workspace version');

  const iv = bytes.slice(WRAP_HEADER_BYTES, WRAP_HEADER_BYTES + IV_BYTES);
  const wrapped = bytes.slice(WRAP_HEADER_BYTES + IV_BYTES);

  try {
    return await crypto.subtle.unwrapKey(
      'raw',
      wrapped,
      workspaceKey,
      {
        name: 'AES-GCM',
        iv,
        additionalData: aad(
          `canvhq/v1/project-key/${context.workspaceId}/${context.projectId}/${projectKeyVersion}/${workspaceKeyVersion}`,
        ),
      },
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'],
    );
  } catch (error) {
    throw new DecryptionError('This project key could not be unwrapped.', { cause: error });
  }
}

// ---------------------------------------------------------------------------------------------
// Keys wrapped to a person (RSA-OAEP label)
// ---------------------------------------------------------------------------------------------

export async function wrapProjectKeyForMember(
  projectKey: CryptoKey,
  publicKey: CryptoKey,
  context: MemberProjectKeyContext,
): Promise<string> {
  assertVersion(context.projectKeyVersion);

  const wrapped = new Uint8Array(
    await crypto.subtle.wrapKey('raw', projectKey, publicKey, {
      name: 'RSA-OAEP',
      label: aad(
        `canvhq/v1/member-project-key/${context.projectId}/${context.userId}/${context.projectKeyVersion}`,
      ),
    }),
  );

  return bytesToBase64Url(
    concat([new Uint8Array([FORMAT_V1]), u32(context.projectKeyVersion), wrapped]),
  );
}

export async function unwrapProjectKeyForMember(
  blob: string,
  privateKey: CryptoKey,
  context: MemberProjectKeyContext,
): Promise<CryptoKey> {
  const bytes = decodeWrapped(blob, RSA_HEADER_BYTES);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = readU32(view, 1);
  assertMatches(version, context.projectKeyVersion, 'member project key');

  try {
    return await crypto.subtle.unwrapKey(
      'raw',
      bytes.slice(RSA_HEADER_BYTES),
      privateKey,
      {
        name: 'RSA-OAEP',
        label: aad(
          `canvhq/v1/member-project-key/${context.projectId}/${context.userId}/${version}`,
        ),
      },
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'],
    );
  } catch (error) {
    throw new DecryptionError('This project key could not be unwrapped for this account.', {
      cause: error,
    });
  }
}

export async function wrapWorkspaceKeyForMember(
  workspaceKey: CryptoKey,
  publicKey: CryptoKey,
  context: MemberWorkspaceKeyContext,
): Promise<string> {
  assertVersion(context.workspaceKeyVersion);

  const wrapped = new Uint8Array(
    await crypto.subtle.wrapKey('raw', workspaceKey, publicKey, {
      name: 'RSA-OAEP',
      label: aad(
        `canvhq/v1/member-workspace-key/${context.workspaceId}/${context.userId}/${context.workspaceKeyVersion}`,
      ),
    }),
  );

  return bytesToBase64Url(
    concat([new Uint8Array([FORMAT_V1]), u32(context.workspaceKeyVersion), wrapped]),
  );
}

export async function unwrapWorkspaceKeyForMember(
  blob: string,
  privateKey: CryptoKey,
  context: MemberWorkspaceKeyContext,
): Promise<CryptoKey> {
  const bytes = decodeWrapped(blob, RSA_HEADER_BYTES);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = readU32(view, 1);
  assertMatches(version, context.workspaceKeyVersion, 'member workspace key');

  try {
    return await crypto.subtle.unwrapKey(
      'raw',
      bytes.slice(RSA_HEADER_BYTES),
      privateKey,
      {
        name: 'RSA-OAEP',
        label: aad(
          `canvhq/v1/member-workspace-key/${context.workspaceId}/${context.userId}/${version}`,
        ),
      },
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'],
    );
  } catch (error) {
    throw new DecryptionError('This workspace key could not be unwrapped for this account.', {
      cause: error,
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Project key history (an older project key wrapped under the next one)
// ---------------------------------------------------------------------------------------------

export async function wrapProjectKeyHistory(
  oldKey: CryptoKey,
  newKey: CryptoKey,
  context: ProjectKeyHistoryContext,
): Promise<string> {
  assertVersion(context.oldVersion);
  assertVersion(context.newVersion);

  const iv = randomIv();
  const wrapped = new Uint8Array(
    await crypto.subtle.wrapKey('raw', oldKey, newKey, {
      name: 'AES-GCM',
      iv,
      additionalData: aad(
        `canvhq/v1/project-key-history/${context.projectId}/${context.oldVersion}/${context.newVersion}`,
      ),
    }),
  );

  return bytesToBase64Url(
    concat([
      new Uint8Array([FORMAT_V1]),
      u32(context.oldVersion),
      u32(context.newVersion),
      iv,
      wrapped,
    ]),
  );
}

export async function unwrapProjectKeyHistory(
  blob: string,
  newKey: CryptoKey,
  context: ProjectKeyHistoryContext,
): Promise<CryptoKey> {
  const bytes = decodeWrapped(blob, WRAP_HEADER_BYTES);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const oldVersion = readU32(view, 1);
  const newVersion = readU32(view, 5);
  assertMatches(oldVersion, context.oldVersion, 'project key history old version');
  assertMatches(newVersion, context.newVersion, 'project key history new version');

  const iv = bytes.slice(WRAP_HEADER_BYTES, WRAP_HEADER_BYTES + IV_BYTES);
  const wrapped = bytes.slice(WRAP_HEADER_BYTES + IV_BYTES);

  try {
    return await crypto.subtle.unwrapKey(
      'raw',
      wrapped,
      newKey,
      {
        name: 'AES-GCM',
        iv,
        additionalData: aad(
          `canvhq/v1/project-key-history/${context.projectId}/${oldVersion}/${newVersion}`,
        ),
      },
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'],
    );
  } catch (error) {
    throw new DecryptionError('This older project key could not be unwrapped.', { cause: error });
  }
}
