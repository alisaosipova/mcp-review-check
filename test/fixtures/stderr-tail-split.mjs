// Synthetic stdio server for R-10 (MRC-2 review round 2): echoes $DB_PASSWORD (non-ASCII) to stderr in two writes split
// inside a UTF-8 character, then one line long enough that the 4096-character stderr tail starts 12 characters before
// the end of the echo (inside the secret), and exits 1. Masking each chunk alone would leave the secret's end in the tail.
const b = Buffer.from(`Error: login failed with password ${process.env.DB_PASSWORD}\n`, 'utf8');
const cut = b.indexOf(0xc3) + 1; // after the first byte of "ü"
process.stderr.write(b.subarray(0, cut));
setTimeout(() => {
  process.stderr.write(b.subarray(cut));
  setTimeout(() => { process.stderr.write(`${'y'.repeat(4096 - 12 - 1)}\n`); setTimeout(() => process.exit(1), 50); }, 100);
}, 100);
