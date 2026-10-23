#!/usr/bin/env node
// Leak fixture (B2): echoes its credentials on every channel a report can quote. The secret from
// --api-key / --token= (argv) and $API_TOKEN (--env) go to stdout (SRV-018 quotes non-JSON lines) and stderr;
// stderr also gets the whole argv, so any other secret flag (--accessToken X, --password -X) is echoed too.
// With --crash it writes them to stderr and exits, so they land in the SRV-003 fatal message.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createGoodServer } from './good-server.mjs';

const argv = process.argv.slice(2);
const flag = argv.indexOf('--api-key');
const argSecret = flag >= 0 ? argv[flag + 1] : '';
const eqSecret = argv.find((a) => a.startsWith('--token='))?.slice('--token='.length) ?? '';
const envSecret = process.env.API_TOKEN ?? '';

process.stderr.write(`leaky: starting with key ${argSecret} token ${eqSecret} env ${envSecret}\n`);
process.stderr.write(`leaky: argv ${argv.join(' ')}\n`);
if (argv.includes('--crash')) {
  process.stderr.write(`Error: authentication failed for key ${argSecret} / ${eqSecret} / ${envSecret}\n`);
  process.exit(1);
}
process.stdout.write(`using key ${envSecret} and ${argSecret}\n`);
await createGoodServer().connect(new StdioServerTransport());
