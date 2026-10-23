import { REDACTED, REDACTED_KEYS, redact } from './redact';

describe('redact', () => {
  it.each([...REDACTED_KEYS])('replaces %s at the top level', (key) => {
    expect(redact({ [key]: 'secret', name: 'kept' })).toEqual({ [key]: REDACTED, name: 'kept' });
  });

  it.each([...REDACTED_KEYS])('replaces %s inside nested objects and arrays', (key) => {
    const snapshot = {
      member: { profile: { [key]: 'secret' } },
      keys: [{ [key]: 'secret', id: 'k1' }],
    };

    expect(redact(snapshot)).toEqual({
      member: { profile: { [key]: REDACTED } },
      keys: [{ [key]: REDACTED, id: 'k1' }],
    });
  });

  it('replaces a listed key even when its value is an object', () => {
    expect(redact({ password: { plain: 'x' } })).toEqual({ password: REDACTED });
  });

  it('leaves the input unmodified and keeps dates and scalars', () => {
    const at = new Date('2026-10-23T00:00:00.000Z');
    const input = { passwordHash: 'h', at, count: 3, note: null };

    expect(redact(input)).toEqual({ passwordHash: REDACTED, at, count: 3, note: null });
    expect(input.passwordHash).toBe('h');
  });

  it('matches keys exactly', () => {
    expect(redact({ apiKeyId: 'k1', keyPrefix: 'tk_', Password: 'x' })).toEqual({
      apiKeyId: 'k1',
      keyPrefix: 'tk_',
      Password: 'x',
    });
  });
});
