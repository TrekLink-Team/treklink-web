// Prints the DEMO_PANEL_PASSWORD_HASH value for a demo panel password (specs/demo/design.md §11, D-110).
// The password is read from standard input, so it stays out of the shell history and the process list:
//   npm --prefix backend run demo:panel-hash
// then type the password and press Enter (or pipe it in). Only the hash is printed.
import { createInterface } from 'node:readline';
import { hashPanelPassword } from '../src/modules/demo/demo-panel-password';

const MIN_LENGTH = 16;

const main = async () => {
  if (process.stdin.isTTY) process.stderr.write('Panel password: ');
  const lines = createInterface({ input: process.stdin, terminal: false });
  const [password = ''] = await (async () => {
    for await (const line of lines) return [line];
    return [''];
  })();
  lines.close();
  if (password.length < MIN_LENGTH) {
    process.stderr.write(`Use a password of at least ${MIN_LENGTH} characters.\n`);
    process.exit(1);
  }
  process.stdout.write(`${await hashPanelPassword(password)}\n`);
};

void main();
