import { z } from 'zod';

/**
 * Every wrapped key is a v1 envelope: a format byte (0x01), a header carrying key versions, then
 * the wrapped bytes. The frontend format module owns the exact layout; the server only checks the
 * one byte and the minimum length it needs to reject obvious junk early. Versions are not secret.
 */
const V1_FORMAT_BYTE = 0x01;
const MIN_WRAPPED_KEY_BYTES = 21; // v1 header (5) + GCM tag (16)
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export const WrappedKeySchema = z
  .string()
  .regex(BASE64URL, 'Wrapped keys must be base64url without padding')
  .refine((value) => {
    try {
      const bytes = Buffer.from(value, 'base64url');
      return bytes.length >= MIN_WRAPPED_KEY_BYTES && bytes[0] === V1_FORMAT_BYTE;
    } catch {
      return false;
    }
  }, 'Wrapped keys must use the v1 encrypted format (format byte 0x01)');

/**
 * Reads the big-endian key versions from a v1 wrapped key. Returns null when the blob is not a
 * readable v1 envelope. The server never decrypts; it only checks the declarations.
 */
export function readWrappedKeyVersions(value: string, count: number): number[] | null {
  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.length < 1 + 4 * count || bytes[0] !== V1_FORMAT_BYTE) {
      return null;
    }
    const versions: number[] = [];
    for (let index = 0; index < count; index += 1) {
      versions.push(bytes.readUInt32BE(1 + 4 * index));
    }
    return versions;
  } catch {
    return null;
  }
}
