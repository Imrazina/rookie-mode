type CaptureReporter = (message: string) => void

interface AudioStreamConsumer {
  start: (stream: MediaStream) => Promise<boolean>
  stop: () => Promise<void>
}

/**
 * Owns Electron's Windows loopback MediaStream for one Rookie Mode run.
 * The stream is handed to the same PCM/STT consumer used by macOS.
 */
export class WindowsSystemAudioCapture {
  private stream: MediaStream | null = null
  private starting: Promise<void> | null = null
  private startingGeneration: number | null = null
  private stopping: Promise<void> | null = null
  private generation = 0
  private desiredRunning = false

  constructor(
    private readonly report: CaptureReporter,
    private readonly audioConsumer: AudioStreamConsumer,
    private readonly onUnavailable: () => void
  ) {}

  start(): Promise<void> {
    this.desiredRunning = true
    if (this.stopping) {
      return this.stopping.then(() => this.desiredRunning && !this.stream ? this.start() : undefined)
    }
    if (this.stream) return Promise.resolve()
    if (this.starting) {
      return this.startingGeneration !== this.generation
        ? this.starting.then(() => this.desiredRunning && !this.stream ? this.start() : undefined)
        : this.starting
    }

    const generation = ++this.generation
    const starting = this.begin(generation)
    this.starting = starting
    this.startingGeneration = generation
    void starting.then(
      () => {
        if (this.starting === starting) {
          this.starting = null
          this.startingGeneration = null
        }
      },
      () => {
        if (this.starting === starting) {
          this.starting = null
          this.startingGeneration = null
        }
      }
    )
    return starting
  }

  async stop(): Promise<void> {
    const hadActiveCapture = Boolean(this.stream || this.starting)
    this.desiredRunning = false
    this.generation += 1
    const stream = this.stream
    this.stream = null
    stream?.getTracks().forEach((track) => track.stop())
    if (this.stopping) return this.stopping
    const stopping = this.audioConsumer.stop().catch((error) => {
      this.report(`[audio-capture] windows cleanup failed: ${this.errorMessage(error)}`)
    })
    this.stopping = stopping
    await stopping
    if (this.stopping === stopping) this.stopping = null
    if (hadActiveCapture) this.report('[audio-capture] windows loopback stopped')
  }

  private async begin(generation: number): Promise<void> {
    let stream: MediaStream | null = null
    try {
      this.report('[audio-capture] platform=win32 provider=electron-loopback')
      stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })

      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      // Chromium requires display video to establish loopback capture. Rookie
      // never consumes, renders, records, or retains that video track.
      stream.getVideoTracks().forEach((track) => track.stop())
      const [audioTrack] = stream.getAudioTracks()
      if (!audioTrack || audioTrack.readyState !== 'live') {
        throw new Error('Electron did not provide a live loopback audio track')
      }

      this.stream = stream
      const consumerStarted = await this.audioConsumer.start(stream)
      if (!consumerStarted) throw new Error('the shared PCM/STT consumer failed to start')
      if (generation !== this.generation || !this.desiredRunning) {
        if (this.stream === stream) this.stream = null
        stream.getTracks().forEach((track) => track.stop())
        await this.audioConsumer.stop()
        return
      }

      audioTrack.addEventListener('ended', () => {
        if (this.stream !== stream) return
        this.report('[audio-capture] windows loopback track ended')
        this.onUnavailable()
        void this.stop()
      }, { once: true })
      this.report('[audio-capture] windows loopback started')
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop())
      if (this.stream === stream) this.stream = null
      await this.audioConsumer.stop()
      if (generation !== this.generation) return
      this.desiredRunning = false
      this.report(`[audio-capture] windows loopback unavailable: ${this.errorMessage(error)}`)
      this.onUnavailable()
      throw error
    }
  }

  private errorMessage(error: unknown): string {
    if (!(error instanceof Error)) return 'unknown error'
    return error.name && error.name !== 'Error'
      ? `${error.name}: ${error.message}`
      : error.message
  }
}
