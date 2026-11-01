"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  httpRequest: (payload) => electron.ipcRenderer.invoke("http-request", payload),
  parseTvboxConfig: (rawText) => electron.ipcRenderer.invoke("parse-tvbox-config", rawText),
  downloadEpisode: (url, filename, taskId) => electron.ipcRenderer.invoke("download-episode", { url, filename, taskId }),
  cancelDownload: (taskId) => electron.ipcRenderer.send("cancel-download", taskId),
  onDownloadProgress: (cb) => {
    electron.ipcRenderer.on("download-progress", (_event, data) => cb(data));
  },
  minimize: () => electron.ipcRenderer.send("window-min"),
  maximize: () => electron.ipcRenderer.send("window-max"),
  close: () => electron.ipcRenderer.send("window-close")
});
