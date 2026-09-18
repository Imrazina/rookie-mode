import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  startRookieMode: (): void => ipcRenderer.send('rookie:start'),
  setOverlayMode: (mode: 'idle' | 'explanation'): void => ipcRenderer.send('rookie:set-overlay-mode', mode),
  onShowDemo: (callback: () => void): void => ipcRenderer.on('rookie:show-demo', callback),
  onRequestTranscript: (callback: () => void): void => ipcRenderer.on('rookie:request-transcript', callback),
  onTranscript: (callback: (transcript: string) => void): void => ipcRenderer.on('rookie:transcript', (_, transcript) => callback(transcript)),
  submitTranscript: (transcript: string): void => ipcRenderer.send('rookie:submit-transcript', transcript),
  onHideExplanation: (callback: () => void): void => ipcRenderer.on('rookie:hide-explanation', callback)
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
