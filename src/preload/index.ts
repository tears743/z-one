import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  workflow: {
    list: () => ipcRenderer.invoke('workflow:list'),
    get: (id: string) => ipcRenderer.invoke('workflow:get', id),
    create: (def: any) => ipcRenderer.invoke('workflow:create', def),
    delete: (id: string) => ipcRenderer.invoke('workflow:delete', id),
    start: (workflowId: string) => ipcRenderer.invoke('workflow:start', { workflowId }),
    pause: (runId: string) => ipcRenderer.invoke('workflow:pause', { runId }),
    resume: (runId: string) => ipcRenderer.invoke('workflow:resume', { runId }),
    injectMessage: (runId: string, nodeId: string, message: string) =>
      ipcRenderer.invoke('workflow:inject-message', { runId, nodeId, message }),
    getRun: (runId: string) => ipcRenderer.invoke('workflow:get-run', runId),
    getRuns: (workflowId: string) => ipcRenderer.invoke('workflow:get-runs', workflowId),
    getVersions: (workflowId: string) => ipcRenderer.invoke('workflow:get-versions', workflowId),
    onEvent: (callback: (event: any) => void) => {
      ipcRenderer.on('workflow:event', (_e, data) => callback(data))
      return () => ipcRenderer.removeAllListeners('workflow:event')
    },
  },
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
