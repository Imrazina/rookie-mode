import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk'
import { f1Glossary } from '../renderer/src/domain/f1Glossary'

const RESOURCE_TIMEOUT_MS = 2000
const START_TIMEOUT_MS = 10_000
const PARTIAL_THROTTLE_MS = 100
const MAX_RECONNECT_DELAY_MS = 10_000
const F1_PHRASES = Array.from(new Set(f1Glossary.flatMap(({ canonicalTerm, aliases }) => [canonicalTerm, ...aliases])))

type SpeechCredentials = { key: string; region: string }

function settleWithin(operation: Promise<void>, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs)
    void operation.then(
      () => { clearTimeout(timeout); resolve() },
      () => { clearTimeout(timeout); resolve() }
    )
  })
}

function startRecognizer(recognizer: SpeechSDK.SpeechRecognizer): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback()
    }
    const timeout = setTimeout(() => finish(() => reject(new Error('Azure Speech start timed out'))), START_TIMEOUT_MS)
    recognizer.startContinuousRecognitionAsync(
      () => finish(resolve),
      (error) => finish(() => reject(new Error(error)))
    )
  })
}

function redactSecret(message: string, secret: string): string {
  return message.split(secret).join('[redacted]')
}

export class AzureSpeechRecognizer {
  private generation = 0
  private speechConfig: SpeechSDK.SpeechConfig | null = null
  private audioConfig: SpeechSDK.AudioConfig | null = null
  private audioFormat: SpeechSDK.AudioStreamFormat | null = null
  private pushStream: SpeechSDK.PushAudioInputStream | null = null
  private recognizer: SpeechSDK.SpeechRecognizer | null = null
  private credentials: SpeechCredentials | null = null
  private startOperation: { key: string; region: string; promise: Promise<boolean> } | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectAttempt = 0
  private running = false
  private audioWriteFailureGeneration = -1
  private lastPartialText = ''
  private lastPartialSentAt = 0
  private pendingPartial: string | null = null
  private partialTimer: NodeJS.Timeout | null = null
  private readonly releasingRecognizers = new WeakSet<SpeechSDK.SpeechRecognizer>()

  constructor(
    private readonly onPartialTranscript: (transcript: string) => void,
    private readonly onFinalTranscript: (transcript: string) => void
  ) {}

  start(key: string, region: string): Promise<boolean> {
    if (this.startOperation?.key === key && this.startOperation.region === region) {
      return this.startOperation.promise
    }
    if (this.credentials?.key === key && this.credentials.region === region && (
      this.running || this.recognizer || this.reconnectTimer
    )) return Promise.resolve(true)

    const promise = this.beginStart(key, region)
    this.startOperation = { key, region, promise }
    void promise.then(
      () => { if (this.startOperation?.promise === promise) this.startOperation = null },
      () => { if (this.startOperation?.promise === promise) this.startOperation = null }
    )
    return promise
  }

  private async beginStart(key: string, region: string): Promise<boolean> {
    this.credentials = { key, region }
    this.clearReconnectTimer()
    this.reconnectAttempt = 0
    const generation = ++this.generation
    console.log('[stt] starting')
    const started = await this.startFresh(generation)
    if (!started && generation === this.generation && this.credentials) this.scheduleReconnect(generation)
    return generation === this.generation && this.credentials !== null
  }

  pushAudio(audio: ArrayBuffer): boolean {
    if (!this.running || !this.pushStream) return false
    try {
      this.pushStream.write(audio)
      return true
    } catch (error) {
      if (this.audioWriteFailureGeneration !== this.generation) {
        this.audioWriteFailureGeneration = this.generation
        console.error(`[stt-error] audio push failed: ${error instanceof Error ? error.message : 'unknown error'}`)
      }
      this.running = false
      this.scheduleReconnect(this.generation)
      return false
    }
  }

  async stop(): Promise<void> {
    this.credentials = null
    this.startOperation = null
    this.running = false
    this.generation += 1
    this.clearReconnectTimer()
    await this.releaseResources()
  }

  private async startFresh(generation: number): Promise<boolean> {
    await this.releaseResources()
    const credentials = this.credentials
    if (!credentials || generation !== this.generation) return false

    try {
      const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(credentials.key, credentials.region)
      speechConfig.speechRecognitionLanguage = 'en-US'
      const audioFormat = SpeechSDK.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1)
      const pushStream = SpeechSDK.AudioInputStream.createPushStream(audioFormat)
      const audioConfig = SpeechSDK.AudioConfig.fromStreamInput(pushStream)
      const recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig)
      SpeechSDK.PhraseListGrammar.fromRecognizer(recognizer).addPhrases(F1_PHRASES)

      this.speechConfig = speechConfig
      this.audioFormat = audioFormat
      this.pushStream = pushStream
      this.audioConfig = audioConfig
      this.recognizer = recognizer

      recognizer.sessionStarted = () => {
        if (generation !== this.generation || this.releasingRecognizers.has(recognizer)) return
        this.running = true
        this.reconnectAttempt = 0
        console.log('[stt] sessionStarted')
      }
      recognizer.sessionStopped = () => {
        if (generation !== this.generation || this.releasingRecognizers.has(recognizer)) return
        this.running = false
        console.log('[stt] sessionStopped')
        this.scheduleReconnect(generation)
      }
      recognizer.recognizing = (_sender, event) => {
        if (generation !== this.generation || !this.running) return
        const text = event.result.text.trim()
        if (text) this.queuePartial(text, generation)
      }
      recognizer.recognized = (_sender, event) => {
        if (generation !== this.generation || event.result.reason !== SpeechSDK.ResultReason.RecognizedSpeech) return
        const text = event.result.text.trim()
        if (!text) return
        this.clearPartialTimer()
        this.lastPartialText = ''
        console.log(`[stt] ${text}`)
        this.onFinalTranscript(text)
      }
      recognizer.canceled = (_sender, event) => {
        if (generation !== this.generation || this.releasingRecognizers.has(recognizer)) return
        this.running = false
        const reason = SpeechSDK.CancellationReason[event.reason] ?? String(event.reason)
        const errorCode = SpeechSDK.CancellationErrorCode[event.errorCode] ?? String(event.errorCode)
        const details = redactSecret(event.errorDetails || 'none', credentials.key)
        console.error(`[stt-error] canceled: ${reason}`)
        console.error(`[stt-error] cancellation error code: ${errorCode}; details: ${details}`)
        this.scheduleReconnect(generation)
      }

      await startRecognizer(recognizer)
      if (generation !== this.generation || !this.credentials) return false
      this.running = true
      this.reconnectAttempt = 0
      this.audioWriteFailureGeneration = -1
      console.log('[stt] started')
      return true
    } catch (error) {
      if (generation === this.generation && this.credentials) {
        const message = error instanceof Error ? error.message : 'unknown error'
        console.error(`[stt-error] start failed: ${redactSecret(message, credentials.key)}`)
      }
      await this.releaseResources()
      return false
    }
  }

  private scheduleReconnect(generation: number): void {
    if (!this.credentials || generation !== this.generation || this.reconnectTimer) return
    const delay = Math.min(1000 * (2 ** this.reconnectAttempt), MAX_RECONNECT_DELAY_MS)
    this.reconnectAttempt += 1
    console.log(`[stt] reconnecting in ${delay}ms`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.credentials || generation !== this.generation) return
      const nextGeneration = ++this.generation
      void this.startFresh(nextGeneration).then((started) => {
        if (!started) this.scheduleReconnect(nextGeneration)
      }).catch((error) => {
        console.error(`[stt-error] reconnect failed: ${error instanceof Error ? error.message : 'unknown error'}`)
        this.scheduleReconnect(nextGeneration)
      })
    }, delay)
  }

  private queuePartial(text: string, generation: number): void {
    if (text === this.lastPartialText) return
    this.lastPartialText = text
    this.pendingPartial = text
    const remaining = PARTIAL_THROTTLE_MS - (Date.now() - this.lastPartialSentAt)
    if (remaining <= 0) {
      this.emitPendingPartial(generation)
      return
    }
    if (!this.partialTimer) {
      this.partialTimer = setTimeout(() => {
        this.partialTimer = null
        this.emitPendingPartial(generation)
      }, remaining)
    }
  }

  private emitPendingPartial(generation: number): void {
    if (generation !== this.generation || !this.running || !this.pendingPartial) return
    const text = this.pendingPartial
    this.pendingPartial = null
    this.lastPartialSentAt = Date.now()
    console.log(`[stt-partial] ${text}`)
    this.onPartialTranscript(text)
  }

  private clearPartialTimer(): void {
    if (this.partialTimer) clearTimeout(this.partialTimer)
    this.partialTimer = null
    this.pendingPartial = null
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private async releaseResources(): Promise<void> {
    const recognizer = this.recognizer
    const pushStream = this.pushStream
    const audioConfig = this.audioConfig
    const audioFormat = this.audioFormat
    const speechConfig = this.speechConfig

    this.running = false
    this.clearPartialTimer()
    this.lastPartialText = ''
    this.recognizer = null
    this.pushStream = null
    this.audioConfig = null
    this.audioFormat = null
    this.speechConfig = null

    if (recognizer) this.releasingRecognizers.add(recognizer)
    try { pushStream?.close() } catch { /* already closed */ }
    if (recognizer) {
      await settleWithin(new Promise<void>((resolve) => {
        try { recognizer.stopContinuousRecognitionAsync(resolve, () => resolve()) } catch { resolve() }
      }), RESOURCE_TIMEOUT_MS)
      await settleWithin(new Promise<void>((resolve) => {
        try { recognizer.close(resolve, () => resolve()) } catch { resolve() }
      }), RESOURCE_TIMEOUT_MS)
    }
    try { audioConfig?.close() } catch { /* already closed */ }
    try { audioFormat?.close() } catch { /* already closed */ }
    try { speechConfig?.close() } catch { /* already closed */ }
  }
}
