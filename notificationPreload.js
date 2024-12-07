const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  onUpdateMessage: (callback) => ipcRenderer.on("update-message", callback),
  closeWindow: () => ipcRenderer.send("close-notification-window"),
});
