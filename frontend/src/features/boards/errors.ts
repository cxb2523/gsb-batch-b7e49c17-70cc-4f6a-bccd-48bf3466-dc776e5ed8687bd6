/**
 * Error message mapping for board operations (Batch 17, Decision 13).
 * Plain, user-friendly messages for board-specific error codes.
 */

export function mapBoardError(code?: string, defaultMessage?: string): string {
  switch (code) {
    case 'BOARD_CONFLICT':
      return 'This canvas was changed elsewhere.';
    case 'BOARD_TOO_LARGE':
      return 'Canvas exceeds maximum allowed size (50MB).';
    case 'TOO_MANY_FILES':
      return 'Canvas contains too many images (maximum 100).';
    default:
      return defaultMessage || 'An unexpected error occurred.';
  }
}
