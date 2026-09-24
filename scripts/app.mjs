import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// `npm run app` builds, starts the stream sidecar (unless --no-stream or the
// models are missing), and runs Electron. The renderer reconnects to the
// sidecar on its own, so Electron does not wait for the model to load.
const python = process.env.PYTHON ?? 'python';
const withStream = !process.argv.includes('--no-stream');
// Meaning is part of the normal product path. Use --no-meaning only for performance isolation.
const withMeaning = !process.argv.includes('--no-meaning');
const meaningLanguageIndex = process.argv.indexOf('--meaning-language');
const meaningLanguage = meaningLanguageIndex >= 0 ? process.argv[meaningLanguageIndex + 1] : null;
if (meaningLanguage && !meaningLanguage.startsWith('--')) process.env.MEANING_ASR_LANGUAGE = meaningLanguage;
const children = new Set();
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) if (child.exitCode === null) child.kill();
  process.exitCode = code;
}

function start(command, args) {
  const child = spawn(command, args, { cwd: projectRoot, stdio: 'inherit', windowsHide: false });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = start(command, args);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`${command} terminated by ${signal}`));
      else if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

process.once('SIGINT', () => shutdown(130));
process.once('SIGTERM', () => shutdown(143));

try {
  await run(process.execPath, [join(projectRoot, 'build.mjs')]);
  if (withStream) {
    if (existsSync(join(projectRoot, 'models/sd-turbo/unet')) && existsSync(join(projectRoot, 'models/taesd'))) {
      start(python, [join(projectRoot, 'tools/stream-server.py')]).once('error', (err) => console.error(`[app] stream sidecar: ${err.message}`));
    } else {
      console.warn('[app] models missing - run `npm run models` first. Starting without the stream.');
    }
  }
  if (withMeaning) {
    process.env.S1_MEANING_URL = 'ws://127.0.0.1:8772';
    start(python, [join(projectRoot, 'tools/meaning-server.py')])
      .once('error', (err) => console.error(`[app] meaning worker: ${err.message}`))
      .once('exit', (code) => {
        if (code !== 0 && !shuttingDown) console.warn(`[app] meaning worker exited (${code}); procedural/metadata mode remains available`);
      });
  }
  await run(process.execPath, [join(projectRoot, 'node_modules/electron/cli.js'), join(projectRoot, 'electron/main.cjs')]);
  shutdown(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  shutdown(1);
}
