type StartRecognition = () => Promise<boolean>
type PushAudio = (audio: ArrayBuffer) => Promise<void>
type StopRecognition = () => void

export class AzureSpeechTranscriber {
  private generation = 0
  private audioContext: AudioContext | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private processorNode: ScriptProcessorNode | null = null
  private silentOutput: GainNode | null = null
  private acceptingAudio = false
  private pushInFlight = false
  private receivedAudioFrame = false

  constructor(
    private readonly startRecognition: StartRecognition,
    private readonly pushAudio: PushAudio,
    private readonly stopRecognition: StopRecognition,
    private readonly reportStatus: (message: string) => void,
    private readonly reportError: (message: string) => void
  ) {}

  async start(stream: MediaStream): Promise<boolean> {
    const generation = ++this.generation
    await this.releaseAudioBridge()
    if (generation !== this.generation) return false

    try {
      const context = new AudioContext({ sampleRate: 16000 })
      const sourceNode = context.createMediaStreamSource(stream)
      const processorNode = context.createScriptProcessor(4096, 1, 1)
      const silentOutput = context.createGain()

      processorNode.onaudioprocess = (event) => {
        if (!this.acceptingAudio || this.pushInFlight || generation !== this.generation) return
        const input = event.inputBuffer.getChannelData(0)
        const pcm = new Int16Array(input.length)
        for (let index = 0; index < input.length; index += 1) {
          const sample = Math.max(-1, Math.min(1, input[index]))
          pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
        }

        this.pushInFlight = true
        void this.pushAudio(pcm.buffer as ArrayBuffer).then(() => {
          if (generation !== this.generation) return
          if (!this.receivedAudioFrame) {
            this.receivedAudioFrame = true
            this.reportStatus('PCM frames flowing')
          }
        }).catch((error) => {
          if (generation !== this.generation) return
          this.acceptingAudio = false
          this.reportError(`PCM delivery failed: ${error instanceof Error ? error.message : 'unknown error'}`)
        }).finally(() => {
          if (generation === this.generation) this.pushInFlight = false
        })
      }

      silentOutput.gain.value = 0
      sourceNode.connect(processorNode)
      processorNode.connect(silentOutput)
      silentOutput.connect(context.destination)

      this.audioContext = context
      this.sourceNode = sourceNode
      this.processorNode = processorNode
      this.silentOutput = silentOutput

      await context.resume()
      if (generation !== this.generation) return false
      if (context.sampleRate !== 16000) throw new Error(`expected 16000 Hz audio context, received ${context.sampleRate} Hz`)

      const started = await this.startRecognition()
      if (generation !== this.generation) return false
      if (!started) throw new Error('Azure Speech configuration is unavailable')

      this.acceptingAudio = true
      this.reportStatus('PCM bridge active')
      return true
    } catch (error) {
      if (generation !== this.generation) return false
      await this.releaseAudioBridge()
      this.reportError(`PCM bridge failed: ${error instanceof Error ? error.message : 'unknown error'}`)
      return false
    }
  }

  async stop(): Promise<void> {
    this.generation += 1
    this.stopRecognition()
    await this.releaseAudioBridge()
  }

  private async releaseAudioBridge(): Promise<void> {
    this.acceptingAudio = false
    this.pushInFlight = false
    this.receivedAudioFrame = false
    if (this.processorNode) this.processorNode.onaudioprocess = null
    this.sourceNode?.disconnect()
    this.processorNode?.disconnect()
    this.silentOutput?.disconnect()
    const context = this.audioContext
    this.audioContext = null
    this.sourceNode = null
    this.processorNode = null
    this.silentOutput = null
    if (context && context.state !== 'closed') await context.close().catch(() => undefined)
  }
}
