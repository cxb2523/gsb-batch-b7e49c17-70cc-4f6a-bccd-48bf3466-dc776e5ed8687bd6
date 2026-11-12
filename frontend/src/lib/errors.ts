import { ZodError } from 'zod';

/**
 * The message of a thrown value, when it has one. A refused form field says what to change, not the
 * raw list of what failed.
 */
export function errorMessage(error: unknown): string | null {
  if (error instanceof ZodError) {
    return error.issues[0]?.message ?? null;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.length > 0) {
    return error;
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.length > 0
  ) {
    return error.message;
  }
  return null;
}

/** The name of a thrown value, useful for Web Crypto's DOMException codes. */
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : '';
}
