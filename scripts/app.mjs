import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// `npm run app` builds, starts the stream sidecar (unless --no-stream or the
// models are missing), and runs Electron. The renderer reconnects to the
// sidecar on its own, so Electron does not wait for the model to load.
const python = process.env.PYTHON ?? 'python';
const withStream = !process.argv.includes('--no-stream');
// Meaning is part of the normal product path. Use --no-meaning only for performance isolation.
const withMeaning = !process.argv.includes('--no-meaning');
const restartSidecars = process.argv.includes('--restart-sidecars');
const evalDirIndex = process.argv.indexOf('--eval-dir');
const evalDir = evalDirIndex >= 0 ? process.argv[evalDirIndex + 1] : null;
const evalEveryIndex = process.argv.indexOf('--eval-every');
const evalEvery = evalEveryIndex >= 0 ? process.argv[evalEveryIndex + 1] : null;
if (evalDir && !evalDir.startsWith('--')) process.env.STREAM_EVAL_DIR = resolve(projectRoot, evalDir);
if (evalEvery && !evalEvery.startsWith('--')) process.env.STREAM_EVAL_EVERY = evalEvery;
const meaningLanguageIndex = process.argv.indexOf('--meaning-language');
const meaningLanguage = meaningLanguageIndex >= 0 ? process.argv[meaningLanguageIndex + 1] : null;
if (meaningLanguage && !meaningLanguage.startsWith('--')) process.env.MEANING_ASR_LANGUAGE = meaningLanguage;
const lyricsIndex = process.argv.indexOf('--lyrics');
const lyricsProvider = lyricsIndex >= 0 ? process.argv[lyricsIndex + 1] : null;
if (lyricsProvider && !lyricsProvider.startsWith('--')) process.env.S1_LYRICS_PROVIDER = lyricsProvider;
if (process.argv.includes('--lyrics-rights=off')) process.env.S1_LYRICS_RIGHTS = 'off';
else if (process.argv.includes('--lyrics-rights=community')) process.env.S1_LYRICS_RIGHTS = 'community';
const children = new Set();
let shuttingDown = false;
const STREAM_PORT = 8771;
const MEANING_PORT = 8772;

// A terminal/PTY can disappear while Electron and the model workers are still
// useful. Never let an inherited stdout pipe take a sidecar down with it.
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});
const sidecarLogDir = join(projectRoot, 'logs');
mkdirSync(sidecarLogDir, { recursive: true });

function sidecarStdio(label) {
  const output = openSync(join(sidecarLogDir, `${label}.out.log`), 'a');
  const errors = openSync(join(sidecarLogDir, `${label}.err.log`), 'a');
  return ['ignore', output, errors];
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    // Python workers can outlive node's soft signal on Windows. Kill only the
    // exact process trees this launcher created; never sweep a shared port.
    if (process.platform === 'win32' && child.pid) {
      try { execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' }); } catch { /* already gone */ }
    } else {
      child.kill();
    }
  }
  process.exitCode = code;
}

function portIsListening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(250, () => finish(false));
  });
}

function listeningPids(port) {
  if (process.platform !== 'win32') return [];
  const output = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
  return [...new Set(output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
    return match && Number(match[1]) === port ? [Number(match[2])] : [];
  }))];
}

async function restartSidecar(port, label) {
  for (const pid of listeningPids(port)) {
    if (pid === process.pid) continue;
    console.warn(`[app] restarting ${label} listener on ${port} (pid ${pid})`);
    try { execFileSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' }); } catch { /* already gone */ }
  }
  // Windows can keep the listener visible briefly after taskkill returns.
  // Do not race the subsequent port check or a restart can falsely “reuse”
  // a dying sidecar and never start its replacement.
  for (let attempt = 0; attempt < 40 && await portIsListening(port); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    stdio: options.stdio ?? 'inherit',
    windowsHide: false,
  });
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
  try {
    const bundle = readFileSync(join(projectRoot, 'dist', 'dev', 'harness.js'));
    process.env.S1_BUILD_HASH = createHash('sha256').update(bundle).digest('hex').slice(0, 8);
  } catch {
    process.env.S1_BUILD_HASH = 'unknown';
  }
  if (withStream) {
    if (restartSidecars) await restartSidecar(STREAM_PORT, 'stream sidecar');
    if (existsSync(join(projectRoot, 'models/sd-turbo/unet')) && existsSync(join(projectRoot, 'models/taesd'))) {
      if (await portIsListening(STREAM_PORT)) {
        console.warn(`[app] stream sidecar already listening on ${STREAM_PORT}; reusing it`);
      } else {
        start(python, [join(projectRoot, 'tools/stream-server.py')], { stdio: sidecarStdio('stream-sidecar') })
          .once('error', (err) => console.error(`[app] stream sidecar: ${err.message}`));
      }
    } else {
      console.warn('[app] models missing - run `npm run models` first. Starting without the stream.');
    }
  }
  if (withMeaning) {
    process.env.S1_MEANING_URL = 'ws://127.0.0.1:8772';
    if (restartSidecars) await restartSidecar(MEANING_PORT, 'meaning worker');
    if (await portIsListening(MEANING_PORT)) {
      console.warn(`[app] meaning worker already listening on ${MEANING_PORT}; reusing it`);
    } else {
      start(python, [join(projectRoot, 'tools/meaning-server.py')], { stdio: sidecarStdio('meaning-sidecar') })
        .once('error', (err) => console.error(`[app] meaning worker: ${err.message}`))
        .once('exit', (code) => {
          if (code !== 0 && !shuttingDown) console.warn(`[app] meaning worker exited (${code}); procedural/metadata mode remains available`);
        });
    }
  }
  await run(process.execPath, [join(projectRoot, 'node_modules/electron/cli.js'), join(projectRoot, 'electron/main.cjs')]);
  shutdown(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  shutdown(1);
}
