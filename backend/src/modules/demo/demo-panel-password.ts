import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

// The panel password hash of DEMO_PANEL_PASSWORD_HASH (specs/demo/design.md §11, D-110): the text
// `scrypt:<salt hex>:<key hex>`, a salt of 16 bytes or more and a 32-byte key, scrypt N 16384, r 8, p 1.
// Only the hash is ever configured; the plaintext password lives in the leader's channel and the tab.

export const PANEL_KEY_BYTES = 32;
export const PANEL_SALT_BYTES = 16;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const HEX = /^[0-9a-f]+$/;

export interface PanelHash {
  salt: Buffer;
  key: Buffer;
}

const derive = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scryptCallback(password, salt, PANEL_KEY_BYTES, SCRYPT_OPTIONS, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );

// The parsed hash, or null for an empty or malformed value: the panel then stays off (REQ-PNL-01).
export const parsePanelHash = (value: string | undefined | null): PanelHash | null => {
  const parts = (value ?? '').trim().toLowerCase().split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return null;
  const [, saltHex, keyHex] = parts;
  if (!HEX.test(saltHex) || !HEX.test(keyHex) || saltHex.length % 2 || keyHex.length % 2)
    return null;
  const salt = Buffer.from(saltHex, 'hex');
  const key = Buffer.from(keyHex, 'hex');
  if (salt.length < PANEL_SALT_BYTES || key.length !== PANEL_KEY_BYTES) return null;
  return { salt, key };
};

// Constant-time comparison of a typed password with the configured key. The work is the same for a
// missing, short or wrong password: each is derived with the configured salt and compared in full.
export const verifyPanelPassword = async (typed: string, hash: PanelHash): Promise<boolean> => {
  const derived = await derive(typed, hash.salt);
  return timingSafeEqual(derived, hash.key);
};

// The value to put in DEMO_PANEL_PASSWORD_HASH for a password (npm run demo:panel-hash).
export const hashPanelPassword = async (
  password: string,
  salt: Buffer = randomBytes(PANEL_SALT_BYTES),
): Promise<string> =>
  `scrypt:${salt.toString('hex')}:${(await derive(password, salt)).toString('hex')}`;
