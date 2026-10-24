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
  // An organization API key over its request limit.
  RATE_LIMITED = 'RATE_LIMITED',
  PARAMETER_OUT_OF_RANGE = 'PARAMETER_OUT_OF_RANGE',
  // Any 4xx that has no code of its own above (D-026 consequence, TK-90).
  CLIENT_ERROR = 'CLIENT_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  // Unhandled 5xx only; never a client error.
  INTERNAL_ERROR = 'INTERNAL_ERROR',

  // auth (specs/auth/design.md §4)
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  REFRESH_INVALID = 'REFRESH_INVALID',
  REFRESH_REUSED = 'REFRESH_REUSED',
  PASSWORD_POLICY = 'PASSWORD_POLICY',
  CODE_INVALID = 'CODE_INVALID',
  OTP_COOLDOWN = 'OTP_COOLDOWN',
  LAST_ADMIN = 'LAST_ADMIN',
  SELF_DEMOTION = 'SELF_DEMOTION',
  UNKNOWN_PERMISSION = 'UNKNOWN_PERMISSION',
  PERMISSION_SCOPE_MISMATCH = 'PERMISSION_SCOPE_MISMATCH',
  ADMIN_LOCKOUT = 'ADMIN_LOCKOUT',

  // incidents (specs/incidents/design.md §7)
  ALREADY_OWNED = 'ALREADY_OWNED',
  NOT_OWNER = 'NOT_OWNER',
}
