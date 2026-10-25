// Loaded with `node --import` before the built CLI, for the Windows signal-exit test: no Windows machine here, so
// process.platform reads 'win32' from the start, and every process.kill the CLI sends to its own pid is logged, one
// signal name per line, to the file named by MRC_KILL_LOG (the signal is still sent).
import { appendFileSync } from 'node:fs';

Object.defineProperty(process, 'platform', { value: 'win32' });
const kill = process.kill.bind(process);
process.kill = (pid, signal) => {
  if (pid === process.pid && process.env.MRC_KILL_LOG) appendFileSync(process.env.MRC_KILL_LOG, `${signal}\n`);
  return kill(pid, signal);
};
