import { likeLiteral } from './like-literal';

describe('likeLiteral', () => {
  it('escapes the LIKE wildcards and the escape character, and keeps everything else', () => {
    expect(likeLiteral('acme')).toBe('acme');
    expect(likeLiteral('50%_off')).toBe('50\\%\\_off');
    expect(likeLiteral('a\\b')).toBe('a\\\\b');
    expect(likeLiteral('')).toBe('');
  });
});
