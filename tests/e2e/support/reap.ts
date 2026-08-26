#!/usr/bin/env node
// reap.ts — take down anything the last e2e run left behind, and nothing else.
//
//   node tests/e2e/support/reap.ts
//
// An interrupted Playwright run (Ctrl-C, a killed parent, a crashed worker) does
// not always take its browsers with it. Those instances keep their pages alive,
// and a second run adds its own on top; a few repetitions of that is enough to
// take a workstation down. So every run reaps first — see the `pretest:e2e`
// script in package.json.
//
// The match is deliberately narrow: a process is only a candidate if its command
// line contains THIS repo's server file or the Playwright browser cache. The
// user's own Chrome, and any other node process, look nothing like either.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.join(import.meta.dirname, '..', '..', '..');
const SERVER = path.join(ROOT, 'tests', 'e2e', 'server', 'pages-server.ts');
const BROWSERS = path.join(
  process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), '.cache', 'ms-playwright'),
);

const OWN = new Set([process.pid, process.ppid]);

function processes() {
  try {
    return execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const space = line.indexOf(' ');

        return { pid: Number(line.slice(0, space)), args: line.slice(space + 1) };
      });
  } catch {
    return []; // no `ps` (not Linux/macOS) — nothing to reap, nothing to report
  }
}

const strays = processes().filter(
  (p) =>
    !OWN.has(p.pid) &&
    !p.args.includes('reap.ts') &&
    (p.args.includes(SERVER) || p.args.includes(BROWSERS)),
);

if (!strays.length) {
  console.log('reap: nothing left over.');
  process.exit(0);
}

for (const stray of strays) {
  // Only after the filter above has established what this process is. SIGTERM,
  // so a browser still shutting down cleanly is allowed to finish.
  try {
    process.kill(stray.pid, 'SIGTERM');
    console.log(`reap: SIGTERM ${stray.pid}  ${stray.args.slice(0, 90)}`);
  } catch (error) {
    // ESRCH is the process having exited between the listing and the signal,
    // which is the normal race here and not worth a line of output. Anything
    // else — EPERM, most likely — is worth knowing about.
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
      console.error(`reap: could not signal ${stray.pid}: ${(error as Error).message}`);
    }
  }
}
