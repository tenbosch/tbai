// Preload for the app view (the tBai web app). It exposes a tiny, safe bridge the
// React frontend uses ONLY when running inside the desktop shell — in a normal
// browser `window.tbaiDesktop` is undefined and the frontend no-ops. Data crosses
// the isolated-world boundary through contextBridge (which proxies functions and
// deep-clones their arguments), not through DOM CustomEvent detail (which is not
// readable across worlds).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tbaiDesktop", {
  // Subscribe to commands coming from the native toolbar. Returns a disposer.
  onCommand: (cb) => {
    const listener = (_event, cmd) => cb(cmd);
    ipcRenderer.on("tbai:command", listener);
    return () => ipcRenderer.removeListener("tbai:command", listener);
  },
  // Push a partial state snapshot up to the toolbar (merged on the toolbar side).
  postState: (partial) => ipcRenderer.send("tbai:state", partial),
});
