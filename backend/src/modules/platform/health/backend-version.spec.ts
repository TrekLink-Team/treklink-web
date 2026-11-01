import { readFileSync } from 'fs';
import { join } from 'path';
import { BACKEND_VERSION } from './backend-version';

describe('BACKEND_VERSION', () => {
  it('equals the version in backend/package.json', () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', '..', '..', '..', 'package.json'), 'utf8'),
    ) as { version: string };

    expect(BACKEND_VERSION).toBe(pkg.version);
  });
});
