import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { AzureSpeechTranscriber } from './azureSpeechTranscriber'
import { SystemAudioCapture } from './systemAudioCapture'
import { WindowsSystemAudioCapture } from './windowsSystemAudioCapture'
import type { F1HubAlertReplay, F1HubData, F1HubDriver, F1LiveDataNeeds } from '../shared/f1HubTypes'
import type { F1StatsDataset, F1StatsDataType } from '../shared/f1StatsTypes'
import type { F1RaceBrief } from '../shared/f1RaceBriefTypes'

const speechTranscriber = new AzureSpeechTranscriber(
  () => ipcRenderer.invoke('rookie:stt-start'),
  async (audio) => {
    await ipcRenderer.invoke('rookie:stt-audio', audio)
  },
  () => ipcRenderer.send('rookie:stt-stop'),
  (message) => ipcRenderer.send('rookie:stt-status', message),
  (message) => ipcRenderer.send('rookie:stt-error', message)
)
const systemAudioCapture = new (process.platform === 'win32' ? WindowsSystemAudioCapture : SystemAudioCapture)(
  (message) => ipcRenderer.send('rookie:system-audio-status', message),
  speechTranscriber,
  () => ipcRenderer.send('rookie:capture-unavailable')
)

function subscribe<T extends unknown[]>(
  channel: string,
  callback: (...args: T) => void
): () => void {
  const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void =>
    callback(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// Custom APIs for renderer
const api = {
  platform: process.platform,
  startRookieMode: (): void => {
    if (process.platform === 'win32') {
      ipcRenderer.send('rookie:start')
      void systemAudioCapture.start().catch((error) => {
        ipcRenderer.send(
          'rookie:system-audio-status',
          `capture start failed: ${error instanceof Error ? error.message : 'unknown error'}`
        )
      })
      return
    }

    // Start this while the session button's user gesture is still active so
    // macOS can show its display/system-audio consent UI when needed.
    void systemAudioCapture.start().catch((error) => {
      ipcRenderer.send(
        'rookie:system-audio-status',
        `capture start failed: ${error instanceof Error ? error.message : 'unknown error'}`
      )
    })
    ipcRenderer.send('rookie:start')
  },
  startDemo: (): void => {
    if (process.platform === 'win32') {
      ipcRenderer.send('rookie:start-demo')
      const starting = systemAudioCapture.start()
      void starting
        .then(() => ipcRenderer.send('rookie:open-demo'))
        .catch((error) => {
          ipcRenderer.send(
            'rookie:system-audio-status',
            `capture start failed: ${error instanceof Error ? error.message : 'unknown error'}`
          )
        })
      return
    }

    const starting = systemAudioCapture.start().catch((error) => {
      ipcRenderer.send(
        'rookie:system-audio-status',
        `capture start failed: ${error instanceof Error ? error.message : 'unknown error'}`
      )
    })
    ipcRenderer.send('rookie:start-demo')
    void starting.then(() => ipcRenderer.send('rookie:open-demo'))
  },
  getDemoConfiguration: (): Promise<{ configured: boolean }> =>
    ipcRenderer.invoke('rookie:get-demo-configuration'),
  setOverlayMode: (mode: 'idle' | 'explanation' | 'explanation-context'): void =>
    ipcRenderer.send('rookie:set-overlay-mode', mode),
  onShowDemo: (callback: () => void): (() => void) => subscribe('rookie:show-demo', callback),
  onRequestTranscript: (callback: () => void): (() => void) =>
    subscribe('rookie:request-transcript', callback),
  onPartialTranscript: (callback: (transcript: string) => void): (() => void) =>
    subscribe('rookie:partial-transcript', callback),
  onTranscript: (callback: (transcript: string) => void): (() => void) =>
    subscribe('rookie:transcript', callback),
  requestContextExplanation: (request: {
    term: string
    staticDefinition: string
    partialTranscript?: string
  }): Promise<string | null> => ipcRenderer.invoke('rookie:context-explanation', request),
  getF1HubData: (): Promise<F1HubData | null> => ipcRenderer.invoke('rookie:get-f1-hub-data'),
  getF1DriverDirectory: (): Promise<F1HubDriver[]> => ipcRenderer.invoke('rookie:get-f1-driver-directory'),
  getF1AlertReplay: (sessionKey: number): Promise<F1HubAlertReplay | null> =>
    ipcRenderer.invoke('rookie:get-f1-alert-replay', sessionKey),
  cancelF1AlertReplay: (sessionKey: number): void =>
    ipcRenderer.send('rookie:cancel-f1-alert-replay', sessionKey),
  setF1LiveDataNeeds: (needs: F1LiveDataNeeds): void =>
    ipcRenderer.send('rookie:set-f1-live-data-needs', needs),
  getF1Stats: (season: number, type: F1StatsDataType): Promise<F1StatsDataset | null> =>
    ipcRenderer.invoke('rookie:get-f1-stats', { season, type }),
  getRaceBrief: (): Promise<F1RaceBrief | null> => ipcRenderer.invoke('rookie:get-race-brief'),
  showRaceAlert: (alert: { type: string; title: string; body: string }): void =>
    ipcRenderer.send('rookie:race-alert-notification', alert),
  submitTranscript: (transcript: string): void =>
    ipcRenderer.send('rookie:submit-transcript', transcript),
  onHideExplanation: (callback: () => void): (() => void) =>
    subscribe('rookie:hide-explanation', callback),
  onCaptureError: (callback: (message: string) => void): (() => void) =>
    subscribe('rookie:capture-error', callback)
}

ipcRenderer.on('rookie:stop-system-audio', () => {
  void systemAudioCapture.stop()
})
window.addEventListener(
  'beforeunload',
  () => {
    void systemAudioCapture.stop()
  },
  { once: true }
)

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
