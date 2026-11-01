import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  httpRequest: (payload: unknown) => ipcRenderer.invoke('http-request', payload),
  parseTvboxConfig: (rawText: string) => ipcRenderer.invoke('parse-tvbox-config', rawText),
  downloadEpisode: (url: string, filename: string, taskId: string) => ipcRenderer.invoke('download-episode', { url, filename, taskId }),
  cancelDownload: (taskId: string) => ipcRenderer.send('cancel-download', taskId),
  onDownloadProgress: (cb: (data: { taskId: string, completed: number, total: number }) => void) => {
    ipcRenderer.on('download-progress', (_event, data) => cb(data))
  },
  minimize: () => ipcRenderer.send('window-min'),
  maximize: () => ipcRenderer.send('window-max'),
  close: () => ipcRenderer.send('window-close')
})