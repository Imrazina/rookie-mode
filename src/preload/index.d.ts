import { ElectronAPI } from '@electron-toolkit/preload'
import type { F1HubAlertReplay, F1HubData, F1HubDriver, F1LiveDataNeeds } from '../shared/f1HubTypes'
import type { F1StatsDataset, F1StatsDataType } from '../shared/f1StatsTypes'
import type { F1RaceBrief } from '../shared/f1RaceBriefTypes'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      platform: string
      startRookieMode: () => void
      startDemo: () => void
      getDemoConfiguration: () => Promise<{ configured: boolean }>
      setOverlayMode: (mode: 'idle' | 'explanation' | 'explanation-context') => void
      onShowDemo: (callback: () => void) => () => void
      onRequestTranscript: (callback: () => void) => () => void
      onPartialTranscript: (callback: (transcript: string) => void) => () => void
      onTranscript: (callback: (transcript: string) => void) => () => void
      requestContextExplanation: (request: {
        term: string
        staticDefinition: string
        partialTranscript?: string
      }) => Promise<string | null>
      getF1HubData: () => Promise<F1HubData | null>
      getF1DriverDirectory: () => Promise<F1HubDriver[]>
      getF1AlertReplay: (sessionKey: number) => Promise<F1HubAlertReplay | null>
      cancelF1AlertReplay: (sessionKey: number) => void
      setF1LiveDataNeeds: (needs: F1LiveDataNeeds) => void
      getF1Stats: (season: number, type: F1StatsDataType) => Promise<F1StatsDataset | null>
      getRaceBrief: () => Promise<F1RaceBrief | null>
      showRaceAlert: (alert: { type: string; title: string; body: string }) => void
      submitTranscript: (transcript: string) => void
      onHideExplanation: (callback: () => void) => () => void
      onCaptureError: (callback: (message: string) => void) => () => void
    }
  }
}
