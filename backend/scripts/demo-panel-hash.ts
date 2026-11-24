// Prints the DEMO_PANEL_PASSWORD_HASH value for a demo panel password (specs/demo/design.md §11, D-110).
// The password is read from standard input, so it stays out of the shell history and the process list:
//   npm --prefix backend run demo:panel-hash
// then type the password and press Enter (or pipe it in). On a terminal nothing is echoed while typing
// (review of treklink-web#541). Only the hash is printed.
import { createInterface } from 'node:readline';
import { hashPanelPassword } from '../src/modules/demo/demo-panel-password';

const MIN_LENGTH = 16;
const ENTER = ['\r', '\n'];
const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const BACKSPACE = ['\u0008', '\u007f'];

// A terminal in raw mode: the keys arrive one by one and the terminal echoes none of them.
const readHidden = (): Promise<string> =>
  new Promise((resolve) => {
    const stdin = process.stdin;
    let typed = '';
    process.stderr.write('Panel password (not shown): ');
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    const onData = (chunk: string) => {
      for (const key of chunk) {
        if (key === CTRL_C) {
          stdin.setRawMode(false);
          process.stderr.write('\n');
          process.exit(130);
        }
        if (ENTER.includes(key) || key === CTRL_D) {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stderr.write('\n');
          resolve(typed);
          return;
        }
        if (BACKSPACE.includes(key)) typed = typed.slice(0, -1);
        else typed += key;
      }
    };
    stdin.on('data', onData);
  });

const readPiped = async (): Promise<string> => {
  const lines = createInterface({ input: process.stdin, terminal: false });
  for await (const line of lines) {
    lines.close();
    return line;
  }
  return '';
};

const main = async () => {
  const password = process.stdin.isTTY ? await readHidden() : await readPiped();
  if (password.length < MIN_LENGTH) {
    process.stderr.write(`Use a password of at least ${MIN_LENGTH} characters.\n`);
    process.exit(1);
  }
  process.stdout.write(`${await hashPanelPassword(password)}\n`);
};

void main();
