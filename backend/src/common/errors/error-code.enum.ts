// Single error catalogue (specs/platform/design.md §4.2, REQ-UBI-04). A failure envelope carries
// one of these as `result.errorCode` (D-026). Each module appends its own codes, grouped under a
// module comment, as listed in that module's design.md; the enum is the union.
export enum ErrorCode {
  // Cross-cutting (platform)
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT_UNIQUE = 'CONFLICT_UNIQUE',
  INVALID_STATE_TRANSITION = 'INVALID_STATE_TRANSITION',
  STALE_VERSION = 'STALE_VERSION',
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
  PARAMETER_OUT_OF_RANGE = 'PARAMETER_OUT_OF_RANGE',
  // Any 4xx that has no code of its own above (D-026 consequence, TK-90).
  CLIENT_ERROR = 'CLIENT_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  // Unhandled 5xx only; never a client error.
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}
