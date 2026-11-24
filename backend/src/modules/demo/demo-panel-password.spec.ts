import { hashPanelPassword, parsePanelHash, verifyPanelPassword } from './demo-panel-password';

describe('demo panel password (REQ-PNL-02, design §11)', () => {
  const salt = Buffer.alloc(16, 7);

  it('round-trips a hash and accepts only the right password', async () => {
    const hash = parsePanelHash(await hashPanelPassword('correct horse battery', salt))!;
    expect(hash).not.toBeNull();
    await expect(verifyPanelPassword('correct horse battery', hash)).resolves.toBe(true);
    await expect(verifyPanelPassword('correct horse batterY', hash)).resolves.toBe(false);
    await expect(verifyPanelPassword('', hash)).resolves.toBe(false);
  });

  it('makes a new salt each time, so two hashes of one password differ', async () => {
    expect(await hashPanelPassword('same password here')).not.toBe(
      await hashPanelPassword('same password here'),
    );
  });

  it.each([
    undefined,
    '',
    'plain-password',
    'scrypt:abc',
    'bcrypt:00112233445566778899aabbccddeeff:' + 'aa'.repeat(32),
    'scrypt:0011:' + 'aa'.repeat(32), // salt under 16 bytes
    'scrypt:' + '00'.repeat(16) + ':' + 'aa'.repeat(31), // key not 32 bytes
    'scrypt:' + 'zz'.repeat(16) + ':' + 'aa'.repeat(32), // not hex
    'scrypt:' + '0'.repeat(33) + ':' + 'aa'.repeat(32), // odd length
  ])('rejects the malformed hash %p, which keeps the panel off', (value) => {
    expect(parsePanelHash(value)).toBeNull();
  });

  it('accepts upper-case hex and surrounding spaces', () => {
    expect(parsePanelHash(`  scrypt:${'AB'.repeat(16)}:${'CD'.repeat(32)} `)).not.toBeNull();
  });
});
