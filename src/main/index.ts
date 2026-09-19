import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, Notification, screen, session, shell } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/rookie_icon_clean_1024.png?asset'
import { AzureSpeechRecognizer } from './azureSpeechRecognizer'
import { AzureFoundryChatClient } from './azureFoundryChatClient'
import {
  AzureFoundryContextExplanationProvider,
  ContextExplanationService,
  RecentTranscriptBuffer
} from './contextExplanation'
import { openF1RaceDataService } from './openf1'
import { jolpicaF1Service } from './jolpica'
import { RaceBriefService, type RaceBriefInput } from './raceBrief'
import type { F1LiveDataNeeds } from '../shared/f1HubTypes'
import type { F1StatsDataType } from '../shared/f1StatsTypes'

// Electron 39's native macOS picker returns display video without a system-audio
// track. Use its ScreenCaptureKit path, which is supported by this Electron line.
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('disable-features', 'MacCatapLoopbackAudioForScreenShare')
}

let controlWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let overlayResizeTimer: NodeJS.Timeout | null = null
let rookieModeActive = false
let rookieWatchMode: 'live' | 'demo' | null = null
let contextExplanationService: ContextExplanationService | null = null
let raceBriefService: RaceBriefService | null = null
let rendererLiveDataNeeds: F1LiveDataNeeds = {
  positions: false,
  intervals: false,
  laps: false,
  pitStops: false,
  raceControlMessages: false
}
const activeAlertNotifications = new Set<Notification>()
const recentTranscriptBuffer = new RecentTranscriptBuffer()
const speechRecognizer = new AzureSpeechRecognizer(
  (transcript) => {
    if (!rookieModeActive) return
    recentTranscriptBuffer.addPartial(transcript)
    sendToWindow(overlayWindow, 'rookie:partial-transcript', transcript)
  },
  (transcript) => {
    if (!rookieModeActive) return
    recentTranscriptBuffer.addFinal(transcript)
    sendToWindow(overlayWindow, 'rookie:transcript', transcript)
  }
)
const windowPreferences = { preload: join(__dirname, '../preload/index.js'), sandbox: false }

function isUsableWindow(window: BrowserWindow | null): window is BrowserWindow {
  return Boolean(window && !window.isDestroyed() && !window.webContents.isDestroyed())
}

function sendToWindow(window: BrowserWindow | null, channel: string, ...args: unknown[]): boolean {
  if (!isUsableWindow(window)) return false
  try {
    window.webContents.send(channel, ...args)
    return true
  } catch (error) {
    console.error(`[runtime] failed to send ${channel}: ${error instanceof Error ? error.message : 'unknown error'}`)
    return false
  }
}

function clearOverlayResizeTimer(): void {
  if (overlayResizeTimer) clearInterval(overlayResizeTimer)
  overlayResizeTimer = null
}

function resetContextRuntime(): void {
  recentTranscriptBuffer.clear()
  contextExplanationService?.reset()
}

function syncOpenF1LiveDataNeeds(): void {
  const liveContextActive = rookieModeActive && rookieWatchMode === 'live'
  openF1RaceDataService.setLiveDataNeeds(liveContextActive ? {
    positions: true,
    intervals: true,
    laps: true,
    pitStops: true,
    raceControlMessages: true
  } : rendererLiveDataNeeds)
}

function loadRenderer(window: BrowserWindow, overlay = false): void {
  const load = is.dev && process.env['ELECTRON_RENDERER_URL']
    ? window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}${overlay ? '?overlay=1' : ''}`)
    : window.loadFile(join(__dirname, '../renderer/index.html'), overlay ? { query: { overlay: '1' } } : undefined)
  void load.catch((error) => console.error(`[runtime] renderer load failed: ${error instanceof Error ? error.message : 'unknown error'}`))
}

function createControlWindow(): void {
  if (isUsableWindow(controlWindow)) return
  const window = new BrowserWindow({ width: 900, height: 700, minWidth: 760, minHeight: 620, show: false, autoHideMenuBar: true, backgroundColor: '#0c0e12', ...(process.platform === 'linux' ? { icon } : {}), webPreferences: windowPreferences })
  controlWindow = window
  window.on('ready-to-show', () => { if (!rookieModeActive && isUsableWindow(window)) window.show() })
  window.on('closed', () => {
    if (controlWindow !== window) return
    controlWindow = null
    rendererLiveDataNeeds = {
      positions: false,
      intervals: false,
      laps: false,
      pitStops: false,
      raceControlMessages: false
    }
    syncOpenF1LiveDataNeeds()
    if (rookieModeActive) {
      rookieModeActive = false
      rookieWatchMode = null
      syncOpenF1LiveDataNeeds()
      resetContextRuntime()
      sendToWindow(overlayWindow, 'rookie:hide-explanation')
      if (isUsableWindow(overlayWindow)) overlayWindow.hide()
      void speechRecognizer.stop()
    }
  })
  window.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url).catch((error) => console.error(`[runtime] external link failed: ${error instanceof Error ? error.message : 'unknown error'}`))
    return { action: 'deny' }
  })
  loadRenderer(window)
}

function createOverlayWindow(): void {
  if (isUsableWindow(overlayWindow)) return
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const window = new BrowserWindow({ ...display.bounds, show: false, frame: false, fullscreen: false, transparent: true, resizable: false, movable: false, skipTaskbar: true, focusable: false, alwaysOnTop: true, hasShadow: false, backgroundColor: '#00000000', webPreferences: windowPreferences })
  overlayWindow = window
  window.setAlwaysOnTop(true, 'screen-saver')
  window.setIgnoreMouseEvents(true, { forward: true })
  window.on('closed', () => {
    if (overlayWindow !== window) return
    overlayWindow = null
    clearOverlayResizeTimer()
    if (rookieModeActive) {
      rookieModeActive = false
      rookieWatchMode = null
      syncOpenF1LiveDataNeeds()
      resetContextRuntime()
      sendToWindow(controlWindow, 'rookie:stop-system-audio')
      if (isUsableWindow(controlWindow)) {
        controlWindow.show()
        controlWindow.focus()
      }
      void speechRecognizer.stop()
    }
  })
  loadRenderer(window, true)
}

type OverlayMode = 'idle' | 'explanation' | 'explanation-context'

function resizeOverlay(mode: OverlayMode, animate = true): void {
  if (!isUsableWindow(overlayWindow)) return
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { x, y, width, height } = display.workArea
  const rightMargin = 28
  const bottomMargin = 36
  const size = mode === 'idle'
    ? { width: 176, height: 36 }
    : mode === 'explanation-context'
      ? { width: 350, height: 166 }
      : { width: 350, height: 126 }
  const target = {
    x: x + width - rightMargin - size.width,
    y: y + height - bottomMargin - size.height,
    ...size
  }

  if (!animate) {
    overlayWindow.setBounds(target)
    return
  }

  clearOverlayResizeTimer()
  const start = overlayWindow.getBounds()
  const startedAt = Date.now()
  overlayResizeTimer = setInterval(() => {
    if (!isUsableWindow(overlayWindow)) {
      clearOverlayResizeTimer()
      return
    }
    const progress = Math.min((Date.now() - startedAt) / 180, 1)
    const eased = 1 - Math.pow(1 - progress, 3)
    overlayWindow.setBounds({
      x: Math.round(start.x + (target.x - start.x) * eased),
      y: Math.round(start.y + (target.y - start.y) * eased),
      width: Math.round(start.width + (target.width - start.width) * eased),
      height: Math.round(start.height + (target.height - start.height) * eased)
    })
    if (progress === 1) clearOverlayResizeTimer()
  }, 16)
}

function startRookieMode(mode: 'live' | 'demo'): void {
  if (rookieModeActive || !isUsableWindow(controlWindow) || !isUsableWindow(overlayWindow)) return
  resetContextRuntime()
  rookieModeActive = true
  rookieWatchMode = mode
  syncOpenF1LiveDataNeeds()
  resizeOverlay('idle', false)
  controlWindow.hide()
  overlayWindow.showInactive()
}

function stopRookieMode(): void {
  rookieModeActive = false
  rookieWatchMode = null
  syncOpenF1LiveDataNeeds()
  resetContextRuntime()
  clearOverlayResizeTimer()
  sendToWindow(controlWindow, 'rookie:stop-system-audio')
  sendToWindow(overlayWindow, 'rookie:hide-explanation')
  void speechRecognizer.stop()
  if (isUsableWindow(overlayWindow)) overlayWindow.hide()
  if (isUsableWindow(controlWindow)) {
    controlWindow.show()
    controlWindow.focus()
  }
}

function getDemoVideoUrl(): string | null {
  const configured = process.env.DEMO_VIDEO_URL?.trim()
  if (!configured) return null
  try {
    const url = new URL(configured)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

function configureSystemAudioCapture(): void {
  if (process.platform === 'win32') {
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      const controlFrame = isUsableWindow(controlWindow) ? controlWindow.webContents.mainFrame : null
      const isControlFrame = Boolean(
        request.frame &&
        controlFrame &&
        request.frame.processId === controlFrame.processId &&
        request.frame.routingId === controlFrame.routingId
      )
      if (
        !request.userGesture ||
        !request.videoRequested ||
        !request.audioRequested ||
        !isControlFrame
      ) {
        callback({})
        return
      }

      const currentDisplayId = String(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id)
      desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => {
          const source = sources.find((candidate) => candidate.display_id === currentDisplayId) ?? sources[0]
          callback(source ? { video: source, audio: 'loopback' } : {})
        })
        .catch((error) => {
          console.error(`[audio-capture] windows source selection failed: ${error instanceof Error ? error.message : 'unknown error'}`)
          callback({})
        })
    }, { useSystemPicker: false })
    return
  }

  if (process.platform !== 'darwin') return

  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    if (!request.userGesture || !request.videoRequested || !request.audioRequested || request.frame?.parent) {
      callback({})
      return
    }

    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then(([source]) => callback(source ? { video: source, audio: 'loopback' } : {}))
      .catch(() => callback({}))
  }, { useSystemPicker: false })
}

function loadRuntimeEnvironment(): void {
  const envPath = app.isPackaged
    ? join(process.resourcesPath, '.env.judge')
    : join(app.getAppPath(), '.env')
  if (existsSync(envPath)) process.loadEnvFile(envPath)
}

function configureContextExplanation(): void {
  const endpoint = process.env.AZURE_FOUNDRY_ENDPOINT?.trim()
  const apiKey = process.env.AZURE_FOUNDRY_API_KEY?.trim()
  const fallbackModel = process.env.AZURE_FOUNDRY_MODEL?.trim()
  const contextModel = process.env.AZURE_CONTEXT_MODEL?.trim() || fallbackModel
  const raceBriefModel = process.env.AZURE_RACE_BRIEF_MODEL?.trim() || fallbackModel
  if (!endpoint || !apiKey) {
    contextExplanationService = new ContextExplanationService(null)
    raceBriefService = null
    console.debug('[context-ai] unavailable: AZURE_FOUNDRY_ENDPOINT and AZURE_FOUNDRY_API_KEY are required')
    console.debug('[race-brief] unavailable: Azure Foundry is not configured')
    return
  }

  let chatClient: AzureFoundryChatClient
  try {
    chatClient = new AzureFoundryChatClient(endpoint, apiKey)
  } catch (error) {
    contextExplanationService = new ContextExplanationService(null)
    raceBriefService = null
    const message = error instanceof Error ? error.message : 'invalid configuration'
    console.debug(`[context-ai] unavailable: ${message}`)
    console.debug(`[race-brief] unavailable: ${message}`)
    return
  }

  if (contextModel) {
    try {
      const provider = new AzureFoundryContextExplanationProvider(chatClient, contextModel)
      contextExplanationService = new ContextExplanationService(provider)
      const contextController = new AbortController()
      const contextTimeout = setTimeout(() => contextController.abort('timeout'), 5_000)
      void provider.verify(contextController.signal).then(
        () => console.debug(`[context-ai] ready provider=azure-foundry model=${contextModel}`),
        (error) => {
          const message = contextController.signal.reason === 'timeout'
            ? 'diagnostic request timed out'
            : error instanceof Error ? error.message : 'diagnostic request failed'
          console.debug(`[context-ai] unavailable provider=azure-foundry model=${contextModel}: ${message}`)
        }
      ).finally(() => clearTimeout(contextTimeout))
    } catch (error) {
      contextExplanationService = new ContextExplanationService(null)
      const message = error instanceof Error ? error.message : 'invalid configuration'
      console.debug(`[context-ai] unavailable: ${message}`)
    }
  } else {
    contextExplanationService = new ContextExplanationService(null)
    console.debug('[context-ai] unavailable: AZURE_CONTEXT_MODEL is required')
  }

  if (raceBriefModel) {
    try {
      raceBriefService = new RaceBriefService(chatClient, raceBriefModel)
      console.debug(`[race-brief] ready provider=azure-foundry model=${raceBriefModel}`)
    } catch (error) {
      raceBriefService = null
      const message = error instanceof Error ? error.message : 'invalid configuration'
      console.debug(`[race-brief] unavailable: ${message}`)
    }
  } else {
    raceBriefService = null
    console.debug('[race-brief] unavailable: AZURE_RACE_BRIEF_MODEL is required')
  }
}

function raceName(session: { name: string; country: string; location: string }): string {
  if (/grand prix/i.test(session.name)) return session.name
  const place = session.country || session.location
  return place ? `${place} Grand Prix` : session.name
}

function comparableRaceName(value: string): string {
  return value.toLocaleLowerCase('en-US').replace(/\bgrand prix\b/g, '').replace(/[^a-z0-9]+/g, '')
}

async function getRaceBriefInput(): Promise<RaceBriefInput | null> {
  const hubData = await openF1RaceDataService.getHubData()
  const target = hubData.currentOrNext
  if (!target) return null
  const [standings, races, previousSeasonRaces] = await Promise.all([
    jolpicaF1Service.getStats(target.year, 'drivers'),
    jolpicaF1Service.getStats(target.year, 'races'),
    jolpicaF1Service.getStats(target.year - 1, 'races').catch(() => null)
  ])
  if (standings.type !== 'drivers' || races.type !== 'races') return null
  const grandPrix = raceName(target)
  const qualifying = hubData.currentWeekendSessions.find((session) => /qualifying/i.test(`${session.name} ${session.type}`))
  const race = hubData.currentWeekendSessions.find((session) => (
    /^race$/i.test(session.name) || /^race$/i.test(session.type)
  ))
  const championship = standings.rows.slice(0, 4).map((driver) => ({
    position: driver.position,
    driver: driver.driverName,
    ...(driver.constructorName ? { constructor: driver.constructorName } : {}),
    ...(driver.points !== null ? { points: driver.points } : {}),
    ...(driver.wins !== null ? { wins: driver.wins } : {})
  }))
  const relevantDrivers = new Set(championship.map((driver) => driver.driver))
  const now = Date.now()
  const recentForm = races.rows
    .filter((seasonRace) => seasonRace.date && Date.parse(seasonRace.date) < now)
    .slice(-3)
    .flatMap((seasonRace) => {
      const finishes = seasonRace.results
        .filter((result) => relevantDrivers.has(result.driverName))
        .map((result) => ({ driver: result.driverName, position: result.position }))
      return finishes.length > 0 ? [{
        grandPrix: seasonRace.raceName,
        ...(seasonRace.date ? { date: seasonRace.date } : {}),
        finishes
      }] : []
    })
  const previousEdition = previousSeasonRaces?.type === 'races'
    ? previousSeasonRaces.rows.find((seasonRace) => (
      comparableRaceName(seasonRace.raceName) === comparableRaceName(grandPrix)
    ))
    : null
  const previousRelevantFinishes = previousEdition?.results
    .filter((result) => relevantDrivers.has(result.driverName))
    .map((result) => ({ driver: result.driverName, position: result.position })) ?? []
  const previousEditionFacts = previousEdition && (
    previousEdition.winner || previousEdition.polePosition || previousRelevantFinishes.length > 0
  ) ? {
      grandPrix: previousEdition.raceName,
      ...(previousEdition.date ? { date: previousEdition.date } : {}),
      ...(previousEdition.winner ? { winner: previousEdition.winner } : {}),
      ...(previousEdition.polePosition ? { polePosition: previousEdition.polePosition } : {}),
      ...(previousRelevantFinishes.length > 0 ? { relevantFinishes: previousRelevantFinishes } : {})
    } : undefined

  return {
    target: {
      grandPrix,
      ...(target.circuit ? { circuit: target.circuit } : {}),
      ...((race?.startsAt ?? target.startsAt) ? { date: race?.startsAt ?? target.startsAt } : {}),
      ...(qualifying?.startsAt ? { qualifyingAt: qualifying.startsAt } : {}),
      ...(race?.startsAt ? { raceAt: race.startsAt } : {}),
      status: target.status === 'scheduled' ? 'upcoming' : target.status === 'live' ? 'live' : 'completed'
    },
    championship,
    recentForm,
    ...(previousEditionFacts ? { previousEdition: previousEditionFacts } : {})
  }
}

function getContextRequest(value: unknown): {
  term: string
  staticDefinition: string
  partialTranscript: string
} | null {
  if (!value || typeof value !== 'object') return null
  const { term, staticDefinition, partialTranscript } = value as Record<string, unknown>
  if (typeof term !== 'string' || typeof staticDefinition !== 'string') return null
  const normalizedTerm = term.trim()
  const normalizedDefinition = staticDefinition.trim()
  if (!normalizedTerm || !normalizedDefinition || normalizedTerm.length > 100 || normalizedDefinition.length > 1_500) {
    return null
  }
  return {
    term: normalizedTerm,
    staticDefinition: normalizedDefinition,
    partialTranscript: typeof partialTranscript === 'string' ? partialTranscript.trim().slice(0, 1_500) : ''
  }
}

function getAudioBuffer(value: unknown): ArrayBuffer | null {
  if (value instanceof ArrayBuffer) return value
  if (!ArrayBuffer.isView(value)) return null
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
}

function getStatsRequest(value: unknown): { season: number; type: F1StatsDataType } | null {
  if (!value || typeof value !== 'object') return null
  const { season, type } = value as Record<string, unknown>
  if (!Number.isInteger(season) || typeof season !== 'number') return null
  if (type !== 'drivers' && type !== 'constructors' && type !== 'races') return null
  return { season, type }
}

app.whenReady().then(() => {
  loadRuntimeEnvironment()
  configureContextExplanation()
  electronApp.setAppUserModelId('ai.rookie.desktop')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  configureSystemAudioCapture()
  ipcMain.on('rookie:start', (event) => {
    if (event.sender === controlWindow?.webContents) startRookieMode('live')
  })
  ipcMain.handle('rookie:get-demo-configuration', (event) => {
    if (event.sender !== controlWindow?.webContents) return { configured: false }
    return { configured: Boolean(getDemoVideoUrl()) }
  })
  ipcMain.on('rookie:start-demo', (event) => {
    if (event.sender === controlWindow?.webContents && getDemoVideoUrl()) startRookieMode('demo')
  })
  ipcMain.on('rookie:open-demo', (event) => {
    if (event.sender !== controlWindow?.webContents || !rookieModeActive || rookieWatchMode !== 'demo') return
    const videoUrl = getDemoVideoUrl()
    if (!videoUrl) return
    void shell.openExternal(videoUrl).catch((error) => {
      console.error(`[demo] failed to open video: ${error instanceof Error ? error.message : 'unknown error'}`)
    })
  })
  ipcMain.on('rookie:capture-unavailable', (event) => {
    if (event.sender !== controlWindow?.webContents || !rookieModeActive) return
    stopRookieMode()
    if (process.platform === 'win32') {
      sendToWindow(controlWindow, 'rookie:capture-error', "Rookie couldn't capture system audio.")
    }
  })
  ipcMain.on('rookie:system-audio-status', (event, message: unknown) => {
    if (event.sender !== controlWindow?.webContents || typeof message !== 'string') return
    console.debug(message.startsWith('[audio-capture]') ? message : `[system-audio] ${message}`)
  })
  ipcMain.handle('rookie:stt-start', async (event) => {
    if (event.sender !== controlWindow?.webContents || !rookieModeActive) return false
    const key = process.env.AZURE_SPEECH_KEY?.trim()
    const region = process.env.AZURE_SPEECH_REGION?.trim()
    if (!key || !region) {
      console.error('[stt-error] AZURE_SPEECH_KEY and AZURE_SPEECH_REGION are required')
      return false
    }
    return speechRecognizer.start(key, region)
  })
  ipcMain.handle('rookie:stt-audio', (event, audio: unknown) => {
    if (event.sender !== controlWindow?.webContents || !rookieModeActive) return false
    const buffer = getAudioBuffer(audio)
    return buffer ? speechRecognizer.pushAudio(buffer) : false
  })
  ipcMain.on('rookie:stt-stop', (event) => {
    if (event.sender === controlWindow?.webContents) void speechRecognizer.stop()
  })
  ipcMain.on('rookie:stt-status', (event, message: unknown) => {
    if (event.sender === controlWindow?.webContents && typeof message === 'string') console.log(`[stt] ${message}`)
  })
  ipcMain.on('rookie:stt-error', (event, message: unknown) => {
    if (event.sender === controlWindow?.webContents && typeof message === 'string') console.error(`[stt-error] ${message}`)
  })
  ipcMain.handle('rookie:context-explanation', async (event, value: unknown) => {
    if (event.sender !== overlayWindow?.webContents || !rookieModeActive || !contextExplanationService) {
      return null
    }
    const request = getContextRequest(value)
    if (!request) return null

    const isLiveMode = rookieWatchMode === 'live'
    const currentRaceState = isLiveMode ? openF1RaceDataService.getCurrentRaceState() : null
    const now = Date.now()
    const currentRaceIsLive = currentRaceState &&
      Date.parse(currentRaceState.session.startsAt) <= now &&
      Date.parse(currentRaceState.session.endsAt) >= now
    const context = await contextExplanationService.explain({
      ...request,
      recentTranscript: isLiveMode
        ? recentTranscriptBuffer.getRecentTranscript()
        : request.partialTranscript,
      raceState: isLiveMode && currentRaceIsLive
        ? currentRaceState
        : null
    })
    return rookieModeActive ? context : null
  })
  ipcMain.handle('rookie:get-race-brief', async (event) => {
    if (event.sender !== controlWindow?.webContents || !raceBriefService) return null
    try {
      const input = await getRaceBriefInput()
      return input ? await raceBriefService.generate(input) : null
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error'
      console.debug(`[race-brief] unavailable: ${message}`)
      return null
    }
  })
  ipcMain.handle('rookie:get-f1-hub-data', async (event) => {
    if (event.sender !== controlWindow?.webContents) return null
    return openF1RaceDataService.getHubData()
  })
  ipcMain.handle('rookie:get-f1-driver-directory', async (event) => {
    if (event.sender !== controlWindow?.webContents) return []
    return openF1RaceDataService.getDriverDirectory()
  })
  ipcMain.handle('rookie:get-f1-alert-replay', async (event, sessionKey: unknown) => {
    if (event.sender !== controlWindow?.webContents || typeof sessionKey !== 'number' ||
      !Number.isInteger(sessionKey)) return null
    try {
      return await openF1RaceDataService.getAlertReplay(sessionKey)
    } catch (error) {
      console.debug(
        `[openf1] alert replay unavailable session=${sessionKey}: ` +
        `${error instanceof Error ? error.message : 'unknown error'}`
      )
      return null
    }
  })
  ipcMain.on('rookie:cancel-f1-alert-replay', (event, sessionKey: unknown) => {
    if (event.sender === controlWindow?.webContents && typeof sessionKey === 'number' && Number.isInteger(sessionKey)) {
      openF1RaceDataService.cancelAlertReplay(sessionKey)
    }
  })
  ipcMain.on('rookie:set-f1-live-data-needs', (event, value: unknown) => {
    if (event.sender !== controlWindow?.webContents || !value || typeof value !== 'object') return
    const needs = value as Record<string, unknown>
    const keys: Array<keyof F1LiveDataNeeds> = [
      'positions',
      'intervals',
      'laps',
      'pitStops',
      'raceControlMessages'
    ]
    if (!keys.every((key) => typeof needs[key] === 'boolean')) return
    rendererLiveDataNeeds = Object.fromEntries(keys.map((key) => [key, needs[key]])) as F1LiveDataNeeds
    syncOpenF1LiveDataNeeds()
  })
  ipcMain.on('rookie:race-alert-notification', (event, value: unknown) => {
    if (event.sender !== controlWindow?.webContents || !value || typeof value !== 'object') return
    const { type, title, body } = value as Record<string, unknown>
    if (typeof type !== 'string' || typeof title !== 'string' || typeof body !== 'string') return
    console.debug(`[alerts-notification] requested type=${type}`)
    if (!Notification.isSupported()) {
      console.debug('[alerts-notification] unsupported')
      return
    }
    const safeTitle = title.trim().slice(0, 120)
    const safeBody = body.trim().slice(0, 500)
    if (!safeTitle || !safeBody) return
    try {
      const notification = new Notification({ title: `ROOKIE · ${safeTitle}`, body: safeBody })
      if (activeAlertNotifications.size >= 20) {
        const oldest = activeAlertNotifications.values().next().value
        if (oldest) activeAlertNotifications.delete(oldest)
      }
      activeAlertNotifications.add(notification)
      const release = (): void => { activeAlertNotifications.delete(notification) }
      notification.once('show', () => console.debug('[alerts-notification] shown'))
      notification.once('close', release)
      notification.once('failed', (_event, error) => {
        release()
        console.debug(`[alerts-notification] failed: ${error || 'unknown error'}`)
      })
      notification.show()
    } catch (error) {
      console.debug(`[alerts-notification] failed: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  })
  ipcMain.handle('rookie:get-f1-stats', async (event, value: unknown) => {
    if (event.sender !== controlWindow?.webContents) return null
    const request = getStatsRequest(value)
    if (!request) return null
    try {
      return await jolpicaF1Service.getStats(request.season, request.type)
    } catch (error) {
      console.debug(
        `[jolpica] ${request.type} unavailable season=${request.season}: ` +
        `${error instanceof Error ? error.message : 'unknown error'}`
      )
      return null
    }
  })
  ipcMain.on('rookie:set-overlay-mode', (event, mode: unknown) => {
    if (
      event.sender === overlayWindow?.webContents &&
      rookieModeActive &&
      (mode === 'idle' || mode === 'explanation' || mode === 'explanation-context')
    ) {
      resizeOverlay(mode)
    }
  })
  if (is.dev) ipcMain.on('rookie:submit-transcript', (event, transcript: unknown) => {
    if (event.sender === overlayWindow?.webContents && typeof transcript === 'string') {
      recentTranscriptBuffer.addFinal(transcript)
      sendToWindow(overlayWindow, 'rookie:transcript', transcript)
    }
  })
  createControlWindow()
  createOverlayWindow()
  void openF1RaceDataService.start().catch((error) => {
    const message = error instanceof Error ? error.message : 'unknown error'
    console.debug(`[openf1] service unavailable: ${message}`)
  })
  globalShortcut.register('Control+Shift+R', stopRookieMode)
  if (is.dev) globalShortcut.register('Control+Shift+D', () => { sendToWindow(overlayWindow, 'rookie:show-demo') })
  if (is.dev) globalShortcut.register('Control+Shift+T', () => { sendToWindow(overlayWindow, 'rookie:request-transcript') })
  app.on('activate', () => {
    createControlWindow()
    createOverlayWindow()
    if (!rookieModeActive && isUsableWindow(controlWindow)) controlWindow.show()
  })
})

app.on('will-quit', () => {
  rookieModeActive = false
  rookieWatchMode = null
  resetContextRuntime()
  clearOverlayResizeTimer()
  openF1RaceDataService.stop()
  void speechRecognizer.stop()
  globalShortcut.unregisterAll()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
