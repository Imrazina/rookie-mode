import type {
  OpenF1DriverResponse,
  OpenF1IntervalResponse,
  OpenF1LapResponse,
  OpenF1PitResponse,
  OpenF1PositionResponse,
  OpenF1RaceControlResponse,
  OpenF1SessionResponse
} from './rawTypes'

const DEFAULT_BASE_URL = 'https://api.openf1.org/v1'
const DEFAULT_TIMEOUT_MS = 12_000
const MAX_REQUESTS_PER_SECOND = 3
const MAX_REQUESTS_PER_MINUTE = 30
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 15_000
const MAX_RATE_LIMIT_BACKOFF_MS = 60_000
const PRESSURE_LOG_INTERVAL_MS = 5_000

type QueryValue = string | number | boolean | null | undefined
export type OpenF1Query = Record<string, QueryValue>

export class OpenF1RequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null
  ) {
    super(message)
    this.name = 'OpenF1RequestError'
  }
}

export type OpenF1ApiClientOptions = {
  baseUrl?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  accessToken?: string | (() => string | undefined)
}

type QueuedRequest = {
  run: () => Promise<unknown[]>
  resolve: (value: unknown[]) => void
  reject: (reason: unknown) => void
}

export class OpenF1ApiClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch
  private readonly accessToken?: string | (() => string | undefined)
  private readonly inFlight = new Map<string, Promise<unknown[]>>()
  private readonly controllers = new Set<AbortController>()
  private readonly queue: QueuedRequest[] = []
  private readonly requestStarts: number[] = []
  private schedulerTimer: ReturnType<typeof setTimeout> | null = null
  private blockedUntil = 0
  private consecutiveRateLimits = 0
  private lastPressureLogAt = 0

  constructor(options: OpenF1ApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetchImpl = options.fetchImpl ?? fetch
    this.accessToken = options.accessToken
  }

  getSessions(query: OpenF1Query): Promise<OpenF1SessionResponse[]> {
    return this.getCollection('sessions', query)
  }

  getDrivers(query: OpenF1Query): Promise<OpenF1DriverResponse[]> {
    return this.getCollection('drivers', query)
  }

  getPositions(query: OpenF1Query): Promise<OpenF1PositionResponse[]> {
    return this.getCollection('position', query)
  }

  getIntervals(query: OpenF1Query): Promise<OpenF1IntervalResponse[]> {
    return this.getCollection('intervals', query)
  }

  getLaps(query: OpenF1Query): Promise<OpenF1LapResponse[]> {
    return this.getCollection('laps', query)
  }

  getPitStops(query: OpenF1Query): Promise<OpenF1PitResponse[]> {
    return this.getCollection('pit', query)
  }

  getRaceControlMessages(query: OpenF1Query): Promise<OpenF1RaceControlResponse[]> {
    return this.getCollection('race_control', query)
  }

  cancelAll(): void {
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
    const cancelled = new OpenF1RequestError('OpenF1 request cancelled')
    for (const queued of this.queue.splice(0)) queued.reject(cancelled)
    if (this.schedulerTimer) clearTimeout(this.schedulerTimer)
    this.schedulerTimer = null
    this.inFlight.clear()
  }

  private getCollection<T>(endpoint: string, query: OpenF1Query): Promise<T[]> {
    const url = new URL(`${this.baseUrl}/${endpoint}`)
    for (const [key, value] of Object.entries(query)) {
      if (value !== null && value !== undefined) url.searchParams.set(key, String(value))
    }

    const requestUrl = url.toString()
    const existingRequest = this.inFlight.get(requestUrl)
    if (existingRequest) return existingRequest as Promise<T[]>

    const request = this.scheduleCollection(requestUrl)
    this.inFlight.set(requestUrl, request)
    void request.then(
      () => { if (this.inFlight.get(requestUrl) === request) this.inFlight.delete(requestUrl) },
      () => { if (this.inFlight.get(requestUrl) === request) this.inFlight.delete(requestUrl) }
    )
    return request as Promise<T[]>
  }

  private scheduleCollection(url: string): Promise<unknown[]> {
    const request = new Promise<unknown[]>((resolve, reject) => {
      this.queue.push({ run: () => this.fetchCollection(url), resolve, reject })
    })
    this.logPressure()
    this.drainQueue()
    return request
  }

  private drainQueue(): void {
    if (this.schedulerTimer) {
      clearTimeout(this.schedulerTimer)
      this.schedulerTimer = null
    }
    if (this.queue.length === 0) return

    const now = Date.now()
    this.pruneRequestStarts(now)
    const secondStarts = this.requestStarts.filter((startedAt) => startedAt > now - 1_000)
    const secondCapacity = MAX_REQUESTS_PER_SECOND - secondStarts.length
    const minuteCapacity = MAX_REQUESTS_PER_MINUTE - this.requestStarts.length
    const available = Math.min(secondCapacity, minuteCapacity)

    if (now < this.blockedUntil || available <= 0) {
      const nextSecond = secondCapacity <= 0 ? secondStarts[0] + 1_000 : now
      const nextMinute = minuteCapacity <= 0 ? this.requestStarts[0] + 60_000 : now
      const resumeAt = Math.max(now, this.blockedUntil, nextSecond, nextMinute)
      this.schedulerTimer = setTimeout(() => this.drainQueue(), Math.max(10, resumeAt - now + 5))
      return
    }

    const starting = Math.min(available, this.queue.length)
    for (let index = 0; index < starting; index += 1) {
      const queued = this.queue.shift()!
      this.requestStarts.push(Date.now())
      void queued.run().then(queued.resolve, queued.reject).finally(() => this.drainQueue())
    }
    this.logPressure()
    if (this.queue.length > 0) this.drainQueue()
  }

  private pruneRequestStarts(now: number): void {
    while (this.requestStarts.length > 0 && this.requestStarts[0] <= now - 60_000) {
      this.requestStarts.shift()
    }
  }

  private logPressure(force = false): void {
    const now = Date.now()
    if (!force && now - this.lastPressureLogAt < PRESSURE_LOG_INTERVAL_MS) return
    this.lastPressureLogAt = now
    this.pruneRequestStarts(now)
    console.debug(`[openf1-http] requests last 60s=${this.requestStarts.length}`)
    console.debug(`[openf1-http] queued=${this.queue.length}`)
  }

  private retryAfterMs(response: Response): number {
    const value = response.headers.get('retry-after')?.trim()
    if (value) {
      const seconds = Number(value)
      if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000)
      const retryAt = Date.parse(value)
      if (Number.isFinite(retryAt)) return Math.max(0, retryAt - Date.now())
    }
    return Math.min(
      MAX_RATE_LIMIT_BACKOFF_MS,
      DEFAULT_RATE_LIMIT_BACKOFF_MS * Math.pow(2, Math.max(0, this.consecutiveRateLimits - 1))
    )
  }

  private async fetchCollection(url: string): Promise<unknown[]> {
    const controller = new AbortController()
    this.controllers.add(controller)
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const accessToken = typeof this.accessToken === 'function' ? this.accessToken() : this.accessToken
      const response = await this.fetchImpl(url, {
        headers: {
          Accept: 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
        },
        signal: controller.signal
      })
      if (response.status === 429) {
        this.consecutiveRateLimits += 1
        this.blockedUntil = Math.max(this.blockedUntil, Date.now() + this.retryAfterMs(response))
        this.logPressure(true)
      }
      if (!response.ok) {
        throw new OpenF1RequestError(`OpenF1 request failed with HTTP ${response.status}`, response.status)
      }

      this.consecutiveRateLimits = 0
      const body: unknown = await response.json()
      if (!Array.isArray(body)) throw new OpenF1RequestError('OpenF1 returned an invalid response')
      return body
    } catch (error) {
      if (error instanceof OpenF1RequestError) throw error
      const message = error instanceof Error ? error.message : 'unknown request error'
      throw new OpenF1RequestError(`OpenF1 request failed: ${message}`)
    } finally {
      clearTimeout(timeout)
      this.controllers.delete(controller)
    }
  }
}
