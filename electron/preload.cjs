// Preload runs with Node access in an isolated context and exposes exactly
// three things to the page: a way to append one log line, a way to fetch the
// TypeSafe API key the main process resolved from the environment or Windows
// Credential Manager, and a read-only subscription to now-playing info from
// the Windows media session. Nothing else crosses the bridge, so
// contextIsolation stays meaningful.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('s1Log', {
  append(line) {
    ipcRenderer.send('log-append', line);
  },
});

contextBridge.exposeInMainWorld('s1Media', {
  /** Subscribe to now-playing updates from the Windows media session. */
  subscribe(callback) {
    const listener = (_event, info) => callback(info);
    ipcRenderer.on('s1-media', listener);
    ipcRenderer.invoke('s1-media-now').then((info) => info && callback(info));
    return () => ipcRenderer.removeListener('s1-media', listener);
  },
});

contextBridge.exposeInMainWorld('s1Key', {
  /** Resolves to the key string, or null when none is configured. */
  getKey() {
    return ipcRenderer.invoke('s1-get-key');
  },
});
