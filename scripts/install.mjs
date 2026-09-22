import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

/**
 * Copies the built extension into Spicetify's Extensions folder.
 *
 * Deliberately stops there. Enabling it runs `spicetify apply`, which patches
 * the installed Spotify client - that is the user's call to make, not a build
 * script's, so the commands are printed rather than executed.
 */

function extensionsDir() {
  const env = process.env['SPICETIFY_CONFIG'];
  if (env) return join(env, 'Extensions');

  switch (platform()) {
    case 'win32':
      return join(process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'), 'spicetify', 'Extensions');
    case 'darwin':
      return join(homedir(), '.config', 'spicetify', 'Extensions');
    default:
      return join(process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'), 'spicetify', 'Extensions');
  }
}

const src = join(process.cwd(), 'dist', 'system1-visualizer.js');
if (!existsSync(src)) {
  console.error('dist/system1-visualizer.js is missing. Run `npm run build` first.');
  process.exit(1);
}

const dir = extensionsDir();
mkdirSync(dir, { recursive: true });
const dest = join(dir, 'system1-visualizer.js');
copyFileSync(src, dest);

console.log(`\n  installed -> ${dest}\n`);
console.log('  Enable it with:\n');
console.log('    spicetify config extensions system1-visualizer.js');
console.log('    spicetify apply\n');
console.log('  Then Ctrl+Shift+V inside Spotify.\n');
