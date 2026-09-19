import { createHash } from 'crypto'
import { raceStateFingerprint } from './raceStateContext'
import type { ContextExplanationInput, ContextExplanationProvider } from './types'

const DEFAULT_TIMEOUT_MS = 4_500
const CACHE_TTL_MS = 20_000
const MAX_CACHE_ENTRIES = 24
const MAX_EXPLANATION_CHARACTERS = 280

type CachedRequest = {
  expiresAt: number
  result: Promise<string | null>
}

function normalizedInput(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

function normalizeExplanation(value: string): string | null {
  const explanation = value.trim()
  if (!explanation || explanation.length > MAX_EXPLANATION_CHARACTERS) return null
  return explanation
}

function requestKey(input: ContextExplanationInput): string {
  const source = [
    normalizedInput(input.term),
    normalizedInput(input.staticDefinition),
    normalizedInput(input.recentTranscript),
    raceStateFingerprint(input.raceState)
  ].join('\n')
  return createHash('sha256').update(source).digest('hex')
}

export class ContextExplanationService {
  private readonly cache = new Map<string, CachedRequest>()
  private readonly activeControllers = new Set<AbortController>()

  constructor(
    private readonly provider: ContextExplanationProvider | null,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS
  ) {}

  explain(input: ContextExplanationInput): Promise<string | null> {
    if (!this.provider) return Promise.resolve(null)
    this.pruneCache()

    const key = requestKey(input)
    const cached = this.cache.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.result

    const result = this.generate(input)
    this.cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, result })
    if (this.cache.size > MAX_CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value!)
    return result
  }

  reset(): void {
    for (const controller of this.activeControllers) controller.abort('reset')
    this.activeControllers.clear()
    this.cache.clear()
  }

  private async generate(input: ContextExplanationInput): Promise<string | null> {
    const controller = new AbortController()
    this.activeControllers.add(controller)
    const timeout = setTimeout(() => controller.abort('timeout'), this.timeoutMs)

    try {
      const rawExplanation = await this.provider!.generate(input, controller.signal)
      const explanation = normalizeExplanation(rawExplanation)
      if (!explanation) throw new Error('provider returned an invalid explanation')
      return explanation
    } catch (error) {
      if (controller.signal.reason === 'reset') return null
      const timedOut = controller.signal.reason === 'timeout'
      const message = error instanceof Error ? error.message : 'unknown error'
      console.debug(
        `[context-ai] ${timedOut ? 'timed out' : 'unavailable'} term=${input.term}: ${message}`
      )
      return null
    } finally {
      clearTimeout(timeout)
      this.activeControllers.delete(controller)
    }
  }

  private pruneCache(): void {
    const now = Date.now()
    for (const [key, cached] of this.cache) {
      if (cached.expiresAt <= now) this.cache.delete(key)
    }
  }
}
