// cross-spawn 7 ships no types; the one call GroupStdioTransport makes on Windows (the SDK's own launcher there).
declare module 'cross-spawn' {
  import type { ChildProcess, SpawnOptions } from 'node:child_process';
  function spawn(command: string, args?: readonly string[], options?: SpawnOptions): ChildProcess;
  export default spawn;
}
