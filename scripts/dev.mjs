// `npm run dev`: starts the backend, the gateway and the frontend together, each line prefixed with
// its name. npm runs `--workspaces` scripts one after another, and a dev server never exits, so the
// first one blocked the rest; this starts all three at once. Ctrl+C stops all of them, and when one
// exits the others are stopped too.
import { spawn } from 'node:child_process';

const SERVICES = [
  ['backend', ['--prefix', 'backend', 'run', 'start:dev']],
  ['gateway', ['--prefix', 'gateway', 'run', 'start:dev']],
  ['frontend', ['--prefix', 'frontend', 'run', 'dev']],
];

const children = [];
let stopping = false;

const stopAll = (code) => {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => child.kill());
  process.exitCode = code;
};

const prefixed = (name, stream, target) => {
  let rest = '';
  stream.on('data', (chunk) => {
    const lines = (rest + chunk.toString()).split('\n');
    rest = lines.pop() ?? '';
    lines.forEach((line) => target.write(`[${name}] ${line}\n`));
  });
};

for (const [name, args] of SERVICES) {
  // A shell resolves `npm` on Windows (npm.cmd) as well as elsewhere.
  const child = spawn('npm', args, { shell: true, env: process.env });
  prefixed(name, child.stdout, process.stdout);
  prefixed(name, child.stderr, process.stderr);
  child.on('exit', (code) => {
    if (!stopping) console.error(`[${name}] exited with code ${code}; stopping the others.`);
    stopAll(code ?? 1);
  });
  children.push(child);
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
