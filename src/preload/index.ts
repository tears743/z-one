import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  workflow: {
    list: () => ipcRenderer.invoke('workflow:list'),
    get: (id: string) => ipcRenderer.invoke('workflow:get', id),
    create: (request: string, modelConfig?: any) =>
      ipcRenderer.invoke('workflow:create', { request, modelConfig }),
    delete: (id: string) => ipcRenderer.invoke('workflow:delete', id),
    start: (workflowId: string, deviceId?: string, sessionId?: string) =>
      ipcRenderer.invoke('workflow:start', { workflowId, deviceId, sessionId }),
    pause: (runId: string) => ipcRenderer.invoke('workflow:pause', runId),
    resume: (runId: string) => ipcRenderer.invoke('workflow:resume', runId),
    cancel: (runId: string) => ipcRenderer.invoke('workflow:cancel', runId),
    injectMessage: (runId: string, nodeId: string, content: string, source?: string) =>
      ipcRenderer.invoke('workflow:inject-message', { runId, nodeId, content, source }),
    getNodeLogs: (runId: string, nodeId: string) =>
      ipcRenderer.invoke('workflow:get-node-logs', { runId, nodeId }),
    getRuns: (workflowId: string) =>
      ipcRenderer.invoke('workflow:get-runs', workflowId),
    confirmProposal: (proposal: any) =>
      ipcRenderer.invoke('workflow:confirm-proposal', proposal),
    submitInput: (runId: string, nodeId: string, input: string) =>
      ipcRenderer.invoke('workflow:submit-input', { runId, nodeId, input }),
    onEvent: (callback: (event: any) => void) => {
      ipcRenderer.on('workflow:event', (_, event) => callback(event));
      return () => ipcRenderer.removeAllListeners('workflow:event');
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
