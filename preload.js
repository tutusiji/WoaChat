const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  sendNewMessage: (message) => ipcRenderer.send("new-message", message),
});
