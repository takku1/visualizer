// Preload runs with Node access in an isolated context and exposes exactly
// one thing to the page: a way to append one log line. Nothing else crosses
// the bridge, so contextIsolation stays meaningful.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('s1Log', {
  append(line) {
    ipcRenderer.send('log-append', line);
  },
});
