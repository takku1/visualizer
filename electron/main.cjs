// Electron main process.
//
// `.cjs` deliberately: the rest of the project is `"type": "module"`, but
// Electron's main process has its own module resolution and mixing that in
// with ESM main-process support is more moving parts than this needs.
// CommonJS here is unambiguous regardless of package.json.
const { app, BrowserWindow, session, desktopCapturer, Menu, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');

// This is meant to feel like an app, not a repurposed browser tab - no
// File/Edit/View menu bar.
Menu.setApplicationMenu(null);

// Fingerprint of the actual bundle this run is executing, not a manually
// maintained snapshot that can drift out of sync. Any source change changes
// this bundle's bytes, which changes this hash - so two log files can be
// compared for whether they came from the same code without anyone having to
// remember to re-freeze anything. Short (8 hex chars) because this is for
// "did it change," not for cryptographic identity.
function bundleFingerprint() {
  try {
    const bundlePath = path.join(__dirname, '..', 'dist', 'dev', 'harness.js');
    const bytes = fs.readFileSync(bundlePath);
    return crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  } catch {
    return 'unknown';
  }
}
const BUILD_HASH = bundleFingerprint();

// One JSONL log per run, for the real-music evaluation pass. Rotate sessions so
// an overnight visualizer cannot create one unbounded file.
// The hash in the filename means a directory listing alone tells you which
// runs share a code state, before opening any of them.
const LOG_DIR = path.join(__dirname, '..', 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_MAX_BYTES = positiveEnv('S1_LOG_MAX_BYTES', 16 * 1024 * 1024);
const LOG_MAX_FILES = positiveEnv('S1_LOG_MAX_FILES', 64);
const LOG_MAX_TOTAL_BYTES = positiveEnv('S1_LOG_MAX_TOTAL_BYTES', 512 * 1024 * 1024);
const LOG_STEM = `session-${new Date().toISOString().replace(/[:.]/g, '-')}-${BUILD_HASH}`;
let logPart = 0;
let logPath;
let logStream;
let logBytes = 0;

function positiveEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function logPathFor(part) {
  return path.join(LOG_DIR, part === 0 ? `${LOG_STEM}.jsonl` : `${LOG_STEM}.part-${String(part).padStart(3, '0')}.jsonl`);
}

function openLogPart() {
  logPath = logPathFor(logPart);
  logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const header = JSON.stringify({ _meta: true, buildHash: BUILD_HASH, startedAt: new Date().toISOString(), part: logPart }) + '\n';
  logStream.write(header);
  logBytes = Buffer.byteLength(header);
}

function pruneLogs() {
  const files = fs.readdirSync(LOG_DIR)
    .filter((name) => /^session-.*\.jsonl$/.test(name))
    .map((name) => {
      const full = path.join(LOG_DIR, name);
      const stat = fs.statSync(full);
      return { name, full, size: stat.size, mtime: stat.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  let total = files.reduce((sum, file) => sum + file.size, 0);
  for (let i = files.length - 1; i >= 0; i--) {
    if (i === 0 || (files.length - i <= LOG_MAX_FILES && total <= LOG_MAX_TOTAL_BYTES)) break;
    const file = files[i];
    try {
      fs.unlinkSync(file.full);
      total -= file.size;
    } catch (error) {
      console.warn(`[electron] could not prune log ${file.name}: ${error.message}`);
    }
  }
}

pruneLogs();
openLogPart();

function appendLog(line) {
  const text = line + '\n';
  const bytes = Buffer.byteLength(text);
  if (logBytes + bytes > LOG_MAX_BYTES && logBytes > 0) {
    logStream.end();
    logPart++;
    openLogPart();
  }
  logStream.write(text);
  logBytes += bytes;
}

ipcMain.on('log-append', (_event, line) => {
  appendLog(line);
});

// TypeSafe API key, resolved once per run and never logged. Precedence:
// TYPESAFE_API_KEY in the environment, then the generic Windows credential
// `visualizer/typesafe-apikey` (see scripts/cred-key.ps1 -Store). Absent
// means the renderer falls back to the built-in local engine. The value
// crosses to the renderer only over IPC on this machine - it is never
// written to dist/, logs/, or the repo.
let cachedKey = null; // null = unresolved; string = key; false = none
function readKeyFromCredentialManager() {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(__dirname, '..', 'scripts', 'cred-key.ps1'),
        '-Get',
      ],
      { timeout: 15000, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(false);
        const key = String(stdout).trim();
        resolve(key ? key : false);
      },
    );
  });
}

ipcMain.handle('s1-get-key', async () => {
  if (cachedKey !== null) return cachedKey === false ? null : cachedKey;
  if (process.env['TYPESAFE_API_KEY']) {
    cachedKey = process.env['TYPESAFE_API_KEY'];
    return cachedKey;
  }
  cachedKey = await readKeyFromCredentialManager();
  if (cachedKey === false) console.log('[electron] no TypeSafe key in Credential Manager; using local engine.');
  return cachedKey === false ? null : cachedKey;
});

// What is playing, from the Windows media session (Spotify, browsers, most
// players): title, artist, position. One long-lived PowerShell helper streams
// JSON lines; PowerShell's ~300 ms startup rules out spawning it per poll.
// Local only - it reads the OS media session and makes no network calls.
let mediaHelper = null;
let lastMedia = null;
function startMediaSession(win) {
  if (process.platform !== 'win32') return;
  mediaHelper = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'scripts', 'media-session.ps1')],
    { windowsHide: true },
  );
  let buffer = '';
  mediaHelper.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        lastMedia = JSON.parse(line);
        if (!win.isDestroyed()) win.webContents.send('s1-media', lastMedia);
      } catch { /* partial or non-JSON line */ }
    }
  });
  mediaHelper.on('exit', (code) => {
    mediaHelper = null;
    // Restart unless the app is quitting; a crashed helper just means no
    // track info for a few seconds.
    if (!win.isDestroyed()) setTimeout(() => startMediaSession(win), 3000);
    console.log(`[electron] media session helper exited (${code}); restarting`);
  });
}
ipcMain.handle('s1-media-now', () => lastMedia);
app.on('before-quit', () => mediaHelper?.kill());

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 480,
    minHeight: 320,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // The whole reason to run this as a real process instead of a browser tab:
  // the renderer's console lands straight in this terminal. Chromium's
  // console-message levels are 0=verbose 1=info 2=warning 3=error.
  const LEVELS = ['log', 'info', 'warn', 'error'];
  win.webContents.on('console-message', (_event, level, message) => {
    console.log(`[renderer:${LEVELS[level] ?? 'log'}] ${message}`);
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[electron] renderer process gone: ${details.reason}`);
  });

  win.loadFile(path.join(__dirname, '..', 'dist', 'dev', 'index.html'));
  startMediaSession(win);
  return win;
}

app.whenReady().then(() => {
  // Fulfills navigator.mediaDevices.getDisplayMedia() from the renderer
  // directly, with Windows system-audio loopback - no OS/browser picker
  // dialog, and no persistent "is sharing" banner. That banner is Chrome
  // tab-sharing UI; this window isn't a Chrome tab, so there is nothing to
  // draw it in. LoopbackSource in src/audio/loopback.ts is unmodified: it
  // calls the same web API, this handler is just what answers it here.
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      const source = sources[0];
      if (!source) {
        console.error('[electron] no desktop capture sources available');
        callback({});
        return;
      }
      callback({ video: source, audio: 'loopback' });
    });
  });

  console.log(`[electron] ready, build ${BUILD_HASH}, logging decisions to ${logPath} (max ${LOG_MAX_BYTES} bytes/file)`);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
