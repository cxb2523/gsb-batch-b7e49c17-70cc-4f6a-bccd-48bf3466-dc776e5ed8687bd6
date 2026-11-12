/**
 * Structurally valid v1 wrapped-key envelopes for API tests. The server only checks the format
 * byte and the minimum length; these tests are about the API, not about decrypting the blob.
 */
export const V1_WRAPPED_KEY = v1WrappedKey('default');

export function v1WrappedKey(marker: string): string {
  const bytes = Buffer.alloc(64);
  bytes[0] = 0x01;
  bytes.writeUInt32BE(1, 1);
  bytes.writeUInt32BE(1, 5);
  bytes.write(marker.slice(0, 55), 9, 'utf8');
  return bytes.toString('base64url');
}

/** A minimal valid v1 board payload: format byte, version 1, revision 1, IV, tag. */
export const V1_BOARD_PAYLOAD = Buffer.concat([
  Buffer.from([0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01]),
  Buffer.alloc(28),
]);

/** A minimal valid v1 file buffer: format byte, version 1, IV, tag. */
export const V1_FILE_BUFFER = Buffer.concat([
  Buffer.from([0x01, 0x00, 0x00, 0x00, 0x01]),
  Buffer.alloc(28),
]);

/** A v1 wrapped-key envelope with explicit version bytes, for rotation/header tests. */
export function wrappedKeyWithVersions(versions: number[], bodyBytes = 64): string {
  const bytes = Buffer.alloc(1 + 4 * versions.length + bodyBytes);
  bytes[0] = 0x01;
  versions.forEach((version, index) => bytes.writeUInt32BE(version, 1 + 4 * index));
  return bytes.toString('base64url');
}

/** A minimal v1 board payload for an arbitrary key version and revision. */
export function boardPayload(version: number, revision = 1): Buffer {
  const bytes = Buffer.alloc(9 + 28);
  bytes[0] = 0x01;
  bytes.writeUInt32BE(version, 1);
  bytes.writeUInt32BE(revision, 5);
  return bytes;
}
