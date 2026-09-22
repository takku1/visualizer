// Preload runs with Node access in an isolated context and exposes exactly
// two things to the page: a way to append one log line, and a way to fetch
// the TypeSafe API key the main process resolved from the environment or
// Windows Credential Manager. Nothing else crosses the bridge, so
// contextIsolation stays meaningful.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('s1Log', {
  append(line) {
    ipcRenderer.send('log-append', line);
  },
});

contextBridge.exposeInMainWorld('s1Key', {
  /** Resolves to the key string, or null when none is configured. */
  getKey() {
    return ipcRenderer.invoke('s1-get-key');
  },
});
