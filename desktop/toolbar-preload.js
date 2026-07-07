// Preload for the toolbar view. Exposes the toolbar's command channel (out) and
// state channel (in) to the toolbar.html script.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("toolbarAPI", {
  // Fire a command at the web app, e.g. sendCommand("navigate", { page: "lists" }).
  sendCommand: (type, payload = {}) =>
    ipcRenderer.send("tbai:command", { type, ...payload }),
  // Subscribe to merged state snapshots from the web app. Returns a disposer.
  onState: (cb) => {
    const listener = (_event, state) => cb(state);
    ipcRenderer.on("tbai:state", listener);
    return () => ipcRenderer.removeListener("tbai:state", listener);
  },
});
