// Synthetic stdio server: echoes $DB_PASSWORD (non-ASCII) to stderr in two writes split inside a UTF-8 character, then exits.
// With --stdout it writes that echo to stdout instead (a non-JSON line, SRV-018 quotes it) and then serves as the GOOD fixture.
const out = process.argv.includes('--stdout') ? process.stdout : process.stderr;
const b = Buffer.from(`Error: login failed with password ${process.env.DB_PASSWORD}\n`, 'utf8');
const cut = b.indexOf(0xc3) + 1; // after the first byte of "ü"
out.write(b.subarray(0, cut));
if (out === process.stdout) {
  await new Promise((r) => setTimeout(r, 100));
  out.write(b.subarray(cut));
  const { createGoodServer } = await import('./good-server.mjs');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  await createGoodServer().connect(new StdioServerTransport());
} else {
  setTimeout(() => { out.write(b.subarray(cut)); setTimeout(() => process.exit(1), 50); }, 100);
}
