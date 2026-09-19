type TranscriptEntry = {
  text: string
  recordedAt: number
}

const DEFAULT_WINDOW_MS = 8_000
const MAX_TRANSCRIPT_CHARACTERS = 800

function normalizeTranscript(transcript: string): string {
  return transcript.trim().replace(/\s+/g, ' ')
}

export class RecentTranscriptBuffer {
  private readonly windowMs: number
  private finalEntries: TranscriptEntry[] = []
  private partialEntry: TranscriptEntry | null = null

  constructor(windowMs = DEFAULT_WINDOW_MS) {
    this.windowMs = windowMs
  }

  addPartial(transcript: string, now = Date.now()): void {
    const text = normalizeTranscript(transcript)
    if (!text) return
    this.prune(now)
    this.partialEntry = { text, recordedAt: now }
  }

  addFinal(transcript: string, now = Date.now()): void {
    const text = normalizeTranscript(transcript)
    if (!text) return
    this.prune(now)
    const lastEntry = this.finalEntries.at(-1)
    if (lastEntry?.text === text) lastEntry.recordedAt = now
    else this.finalEntries.push({ text, recordedAt: now })
    this.partialEntry = null
  }

  getRecentTranscript(now = Date.now()): string {
    this.prune(now)
    const texts = this.finalEntries.map(({ text }) => text)
    if (this.partialEntry && texts.at(-1) !== this.partialEntry.text)
      texts.push(this.partialEntry.text)
    const combined = texts.join(' ')
    return combined.length <= MAX_TRANSCRIPT_CHARACTERS
      ? combined
      : combined.slice(combined.length - MAX_TRANSCRIPT_CHARACTERS).trimStart()
  }

  clear(): void {
    this.finalEntries = []
    this.partialEntry = null
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs
    this.finalEntries = this.finalEntries.filter(({ recordedAt }) => recordedAt >= cutoff)
    if (this.partialEntry && this.partialEntry.recordedAt < cutoff) this.partialEntry = null
  }
}
