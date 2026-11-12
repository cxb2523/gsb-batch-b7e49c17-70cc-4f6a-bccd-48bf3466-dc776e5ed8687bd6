export type KeyServiceErrorCode =
  | 'locked'
  | 'no-public-key'
  | 'no-workspace-key'
  | 'no-project-key'
  | 'wrap-failed'
  | 'unwrap-failed'
  /** Another admin already rotated the project while this rotation was in flight. */
  | 'rotation-stale';

/** Every key operation either returns the key it promised or throws one of these. */
export class KeyServiceError extends Error {
  readonly code: KeyServiceErrorCode;

  constructor(code: KeyServiceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'KeyServiceError';
    this.code = code;
  }
}
