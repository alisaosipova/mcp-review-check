// Loaded with `node --import` (NODE_OPTIONS) before the built CLI, for the cleanup tests in max-duration.test.ts: the
// run's clock (defaultDeps.now in dist/probe/network.js, the module instance the CLI imports too) throws a TypeError.
// On a stdio target the first call is the wire probe's, after the handshake and outside any try, so the check itself
// throws after the handshake (a tool name that String() cannot convert did this until safeStr, A13-01).
import { defaultDeps } from '../../dist/probe/network.js';

defaultDeps.now = () => { throw new TypeError('test: the clock throws after the handshake'); };
