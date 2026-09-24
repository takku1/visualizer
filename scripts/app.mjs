import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
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
const restartSidecars = process.argv.includes('--restart-sidecars');
const meaningLanguageIndex = process.argv.indexOf('--meaning-language');
const meaningLanguage = meaningLanguageIndex >= 0 ? process.argv[meaningLanguageIndex + 1] : null;
if (meaningLanguage && !meaningLanguage.startsWith('--')) process.env.MEANING_ASR_LANGUAGE = meaningLanguage;
const children = new Set();
let shuttingDown = false;
const STREAM_PORT = 8771;
const MEANING_PORT = 8772;

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

function restartSidecar(port, label) {
  for (const pid of listeningPids(port)) {
    if (pid === process.pid) continue;
    console.warn(`[app] restarting ${label} listener on ${port} (pid ${pid})`);
    try { execFileSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' }); } catch { /* already gone */ }
  }
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
  try {
    const bundle = readFileSync(join(projectRoot, 'dist', 'dev', 'harness.js'));
    process.env.S1_BUILD_HASH = createHash('sha256').update(bundle).digest('hex').slice(0, 8);
  } catch {
    process.env.S1_BUILD_HASH = 'unknown';
  }
  if (withStream) {
    if (restartSidecars) restartSidecar(STREAM_PORT, 'stream sidecar');
    if (existsSync(join(projectRoot, 'models/sd-turbo/unet')) && existsSync(join(projectRoot, 'models/taesd'))) {
      if (await portIsListening(STREAM_PORT)) {
        console.warn(`[app] stream sidecar already listening on ${STREAM_PORT}; reusing it`);
      } else {
        start(python, [join(projectRoot, 'tools/stream-server.py')]).once('error', (err) => console.error(`[app] stream sidecar: ${err.message}`));
      }
    } else {
      console.warn('[app] models missing - run `npm run models` first. Starting without the stream.');
    }
  }
  if (withMeaning) {
    process.env.S1_MEANING_URL = 'ws://127.0.0.1:8772';
    if (restartSidecars) restartSidecar(MEANING_PORT, 'meaning worker');
    if (await portIsListening(MEANING_PORT)) {
      console.warn(`[app] meaning worker already listening on ${MEANING_PORT}; reusing it`);
    } else {
      start(python, [join(projectRoot, 'tools/meaning-server.py')])
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
