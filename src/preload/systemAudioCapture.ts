type CaptureReporter = (message: string) => void

interface AudioStreamConsumer {
  start: (stream: MediaStream) => Promise<boolean>
  stop: () => Promise<void>
}

/**
 * Owns the macOS system-audio MediaStream for one Rookie Mode run. Nothing is
 * played or written to disk.
 */
export class SystemAudioCapture {
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
    if (process.platform !== 'darwin') return Promise.resolve()
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
      this.report(`system audio cleanup failed: ${error instanceof Error ? error.message : 'unknown error'}`)
    })
    this.stopping = stopping
    await stopping
    if (this.stopping === stopping) this.stopping = null
    if (hadActiveCapture) this.report('system audio capture stopped')
  }

  private async begin(generation: number): Promise<void> {
    let stream: MediaStream | null = null
    try {
      this.report('requesting macOS system audio capture')
      stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })

      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      const [audioTrack] = stream.getAudioTracks()
      if (!audioTrack || audioTrack.readyState !== 'live') {
        stream.getTracks().forEach((track) => track.stop())
        this.desiredRunning = false
        this.report('system audio track was not granted')
        this.onUnavailable()
        return
      }

      // macOS grants system audio as part of display capture. We do not
      // retain the selected video track, so Rookie Mode keeps only system audio.
      stream.getVideoTracks().forEach((track) => track.stop())
      this.stream = stream
      const consumerStarted = await this.audioConsumer.start(stream)
      if (!consumerStarted || generation !== this.generation || !this.desiredRunning) {
        if (this.stream === stream) this.stream = null
        stream.getTracks().forEach((track) => track.stop())
        await this.audioConsumer.stop()
        if (!consumerStarted && generation === this.generation) {
          this.desiredRunning = false
          this.report('system audio consumer failed to start')
          this.onUnavailable()
        }
        return
      }

      audioTrack.addEventListener('ended', () => {
        if (this.stream === stream) {
          this.report('system audio track ended')
          this.onUnavailable()
          void this.stop()
        }
      }, { once: true })
      this.report('system audio track is live')
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop())
      if (this.stream === stream) this.stream = null
      await this.audioConsumer.stop()
      if (generation !== this.generation) return
      this.desiredRunning = false
      this.report(`system audio capture unavailable: ${error instanceof Error ? error.name : 'unknown error'}`)
      this.onUnavailable()
    }
  }
}
