// 1.1.0, package Q2 review fixes: sh / bash long options before -c.
import { describe, expect, it } from 'vitest';
import { launcherOf, unwrapArgv } from '../src/rules/listing.js';

describe('review Q2: shell options before -c', () => {
  it('bash --login -c and other long options are looked through', () => {
    expect(launcherOf(['bash', '--login', '-c', 'npx foo'])).toMatchObject({ launcher: 'npx', spec: 'foo', pinned: false });
    expect(launcherOf(['bash', '-l', '-c', 'npx foo'])).toMatchObject({ launcher: 'npx', spec: 'foo' });
    expect(unwrapArgv(['bash', '--noprofile', '--norc', '-c', 'npx -y pkg'])).toEqual(['npx', '-y', 'pkg']);
    expect(unwrapArgv(['/bin/bash', '--rcfile', 'x.rc', '-c', 'npx pkg'])).toEqual(['npx', 'pkg']);
    expect(unwrapArgv(['bash', '-o', 'pipefail', '-c', 'npx pkg'])).toEqual(['npx', 'pkg']);
    expect(unwrapArgv(['sh', '-e', '-c', 'npx pkg'])).toEqual(['npx', 'pkg']);
  });

  it('a shell running a script file is not unwrapped', () => {
    expect(unwrapArgv(['bash', '--login', 'start.sh'])).toEqual(['bash', '--login', 'start.sh']);
    expect(launcherOf(['bash', '--norc', 'start.sh', '-c', 'npx foo'])).toBeUndefined();
  });
});
