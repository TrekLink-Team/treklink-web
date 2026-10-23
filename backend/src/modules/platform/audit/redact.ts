// Keys whose values never reach the audit log (specs/platform/design.md §4.5, REQ-UBI-09). Matched
// exactly, at any depth of the snapshot.
export const REDACTED_KEYS: ReadonlySet<string> = new Set([
  'passwordHash',
  'tokenHash',
  'codeHash',
  'keyHash',
  'secretHash',
  'signaturePng',
  'password',
  'key',
  'mqttSecret',
]);

export const REDACTED = '[REDACTED]';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

// Returns a copy with every listed key's value replaced; the input is not modified. Values other
// than plain objects and arrays (dates, decimals) are kept as they are.
export const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([name, inner]) => [
      name,
      REDACTED_KEYS.has(name) ? REDACTED : redact(inner),
    ]),
  );
};
