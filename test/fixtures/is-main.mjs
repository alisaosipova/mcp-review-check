// Whether the fixture module at `url` is the script node was started with. Real paths on both sides: the typed path
// can be a Windows C:\... path, go through a link or hold a space, and none of them is `file://` + the path.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function isMain(url) {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(url)); } catch { return false; }
}
