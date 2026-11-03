// Read a file the user named (--baseline, --config) without hanging or reading without bound: opened non-blocking (so a
// FIFO cannot stall the open), checked as a regular file on the descriptor itself (no race with a swap), size-capped.
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';

/** The cap for --baseline and config files (a JSON report of a large server is a few MiB at most). */
export const INPUT_FILE_CAP = 16 * 1024 * 1024;

/** ENOTREG: not a regular file (a pipe or device); E2BIG: over the cap; EISDIR: a directory. */
export class InputFileError extends Error {
  constructor(readonly code: 'ENOTREG' | 'E2BIG' | 'EISDIR') { super(code); }
}

export function readInputFile(file: string, cap = INPUT_FILE_CAP): Buffer {
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const st = fstatSync(fd);
    if (st.isDirectory()) throw new InputFileError('EISDIR');
    if (!st.isFile()) throw new InputFileError('ENOTREG');
    if (st.size > cap) throw new InputFileError('E2BIG');
    const buf = Buffer.alloc(st.size);
    let off = 0;
    while (off < buf.length) {
      const n = readSync(fd, buf, off, buf.length - off, off);
      if (n === 0) break;
      off += n;
    }
    return buf.subarray(0, off);
  } finally {
    closeSync(fd);
  }
}

/** Why a read failed, for a usage message that names the flag and never shows content. */
export function inputFileProblem(e: unknown): string {
  const code = (e as { code?: string }).code;
  switch (code) {
    case 'ENOENT': return 'no such file';
    case 'EISDIR': return 'it is a directory';
    case 'ENOTREG': return 'it is not a regular file (a pipe or a device)';
    case 'E2BIG': return `it is larger than ${INPUT_FILE_CAP / 1024 / 1024} MiB`;
    default: return code ?? 'read failed';
  }
}
