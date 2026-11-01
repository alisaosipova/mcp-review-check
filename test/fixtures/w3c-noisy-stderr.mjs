#!/usr/bin/env node
// W3C fixture: the GOOD server, after writing terminal control sequences to stderr (ESC colour codes, a bare CR
// that would overwrite the line, a right-to-left override and a CRLF line end). --verbose must show them as \u{..}.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createGoodServer } from './good-server.mjs';

process.stderr.write('noisy: \x1b[31mred\x1b[0m\rOVERWRITTEN ‮evil\r\nsecond line\n');
await createGoodServer().connect(new StdioServerTransport());
