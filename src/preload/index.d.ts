import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      startRookieMode: () => void
      setOverlayMode: (mode: 'idle' | 'explanation') => void
      onShowDemo: (callback: () => void) => void
      onRequestTranscript: (callback: () => void) => void
      onTranscript: (callback: (transcript: string) => void) => void
      submitTranscript: (transcript: string) => void
      onHideExplanation: (callback: () => void) => void
    }
  }
}
