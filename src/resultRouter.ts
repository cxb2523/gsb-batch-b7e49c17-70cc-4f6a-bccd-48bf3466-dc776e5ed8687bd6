// Pure plumbing behind the Promise-based imperative API in
// `SignatureInk.tsx`: request-id ⇄ Promise routing, export-format
// validation and result payload decoding. Kept free of react-native
// imports so it can be unit-tested under plain `node --test`.
import type { SavedToPhotoLibraryResult } from './types';

/** Payload of the native `onResult` event (mirrors the codegen spec). */
export interface ResultPayload {
  requestId: string;
  type: string;
  value?: string;
  error?: string;
}

export interface PendingResolver {
  /** Called with the native `value` once it is known to be a non-empty string. */
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  /** Command type (`toBase64`, …) — only used to make rejections readable. */
  type: string;
}

/**
 * Tracks in-flight command Promises by request id and settles them from
 * native `onResult` events.
 */
export class PendingRequests {
  private readonly map = new Map<string, PendingResolver>();

  add(requestId: string, resolver: PendingResolver): void {
    this.map.set(requestId, resolver);
  }

  remove(requestId: string): void {
    this.map.delete(requestId);
  }

  get size(): number {
    return this.map.size;
  }

  /**
   * Settle the Promise for `payload.requestId`. Returns `false` when no
   * request is pending under that id — a late or duplicate `onResult`
   * (e.g. arriving after unmount) is dropped without resolving anything.
   *
   * A payload carrying neither `error` nor a non-empty `value` rejects:
   * the native side reported nothing, and resolving with an empty string
   * or `undefined` would be indistinguishable from a real result.
   */
  settle(payload: ResultPayload): boolean {
    const resolver = this.map.get(payload.requestId);
    if (!resolver) return false;
    this.map.delete(payload.requestId);
    const { value, error } = payload;
    if (error) {
      resolver.reject(new Error(error));
    } else if (value == null || value === '') {
      resolver.reject(
        new Error(
          `SignatureInk: ${resolver.type} returned an empty result ` +
            '(native sent neither a value nor an error)'
        )
      );
    } else {
      resolver.resolve(value);
    }
    return true;
  }

  /**
   * Reject every in-flight request (the component is unmounting). The map
   * is cleared, so any `onResult` arriving afterwards hits the
   * no-pending-entry path in {@link settle} and is ignored.
   */
  rejectAll(): void {
    this.map.forEach(({ reject, type }) =>
      reject(new Error(`SignatureInk unmounted before ${type} completed`))
    );
    this.map.clear();
  }
}

/**
 * Validate the export format *before* a native command is dispatched.
 * `jpg` is accepted as an alias of `jpeg`, matching both native sides.
 * Anything else throws, so callers can reject without ever touching the
 * pending table or the native view.
 */
export const normalizeExportFormat = (
  format: string | undefined
): 'png' | 'jpeg' => {
  const normalized = (format ?? 'png').toLowerCase();
  if (normalized === 'png') return 'png';
  if (normalized === 'jpeg' || normalized === 'jpg') return 'jpeg';
  throw new Error(
    `SignatureInk: unsupported export format "${String(format)}". ` +
      'Supported formats: "png" and "jpeg".'
  );
};

export const parseMaybeJson = <T>(
  value: string | undefined,
  fallback: T
): T => {
  if (value == null || value === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

/**
 * Parse the `saveToPhotoLibrary` result. Unlike `getStrokeData` (which
 * falls back to an empty drawing), a parse failure here must throw:
 * falling back to `{ granted: false }` would disguise a broken payload
 * as the user denying the photo permission.
 */
export const parsePhotoLibraryResult = (
  raw: string
): SavedToPhotoLibraryResult => {
  try {
    return JSON.parse(raw) as SavedToPhotoLibraryResult;
  } catch {
    throw new Error(
      'SignatureInk: saveToPhotoLibrary returned an unparseable result: ' +
        (raw.length > 120 ? `${raw.slice(0, 120)}…` : raw)
    );
  }
};
