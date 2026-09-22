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
const { execFile } = require('node:child_process');

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

// One append-only log file per run, for the real-music evaluation pass. Lives
// in the repo (not userData) so it is easy to find and read back afterward.
// The hash in the filename means a directory listing alone tells you which
// runs share a code state, before opening any of them.
const LOG_DIR = path.join(__dirname, '..', 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_PATH = path.join(
  LOG_DIR,
  `session-${new Date().toISOString().replace(/[:.]/g, '-')}-${BUILD_HASH}.jsonl`,
);
const logStream = fs.createWriteStream(LOG_PATH, { flags: 'a' });
// A non-decision header line, so the hash is visible from the file's content
// too, not only its name - the name can get renamed or copied.
logStream.write(JSON.stringify({ _meta: true, buildHash: BUILD_HASH, startedAt: new Date().toISOString() }) + '\n');

ipcMain.on('log-append', (_event, line) => {
  logStream.write(line + '\n');
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

  console.log(`[electron] ready, build ${BUILD_HASH}, logging decisions to ${LOG_PATH}`);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
