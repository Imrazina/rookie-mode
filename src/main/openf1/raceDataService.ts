import { OpenF1ApiClient } from './openF1Client'
import {
  getSessionStatus,
  normalizeDrivers,
  normalizeIntervals,
  normalizeLaps,
  normalizePitStops,
  normalizePositionHistory,
  normalizePositions,
  normalizeRaceControlMessages,
  normalizeRaceState,
  normalizeSession
} from './normalize'
import type {
  OpenF1IntervalResponse,
  OpenF1LapResponse,
  OpenF1PitResponse,
  OpenF1PositionResponse,
  OpenF1RaceControlResponse,
  OpenF1SessionKey,
  OpenF1SessionResponse
} from './rawTypes'
import type { RaceState } from './types'
import type {
  F1HubAlertReplay,
  F1HubData,
  F1HubDriver,
  F1HubRaceState,
  F1HubSession,
  F1LiveDataNeeds
} from '../../shared/f1HubTypes'

const DEFAULT_FAST_POLL_MS = 4_000
const DEFAULT_SLOW_POLL_MS = 10_000
const DEFAULT_DISCOVERY_POLL_MS = 60_000
const HUB_RACE_SEASON = 2026
const LIVE_QUERY_OVERLAP_MS = 5_000
const LAP_QUERY_OVERLAP_MS = 90_000
const NO_LIVE_DATA_NEEDS: F1LiveDataNeeds = {
  positions: false,
  intervals: false,
  laps: false,
  pitStops: false,
  raceControlMessages: false
}

type Timer = ReturnType<typeof setTimeout>
type DatasetName = keyof RaceState['availability']

type EndpointCursors = {
  positions: string | null
  intervals: string | null
  laps: string | null
  pitStops: string | null
  raceControlMessages: string | null
}

export type OpenF1RaceDataServiceOptions = {
  client?: OpenF1ApiClient
  fastPollMs?: number
  slowPollMs?: number
  discoveryPollMs?: number
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function toHubDrivers(drivers: ReturnType<typeof normalizeDrivers>): F1HubDriver[] {
  return drivers.map((driver) => ({
    driverNumber: driver.driverNumber,
    broadcastName: driver.broadcastName,
    fullName: driver.fullName,
    acronym: driver.acronym,
    teamName: driver.teamName
  }))
}

function latestTimestamp(values: Array<string | null | undefined>): string | null {
  let latest: string | null = null
  for (const value of values) {
    if (!value || Number.isNaN(Date.parse(value))) continue
    const normalized = new Date(value).toISOString()
    if (!latest || latest < normalized) latest = normalized
  }
  return latest
}

function incrementalQuery(field: string, cursor: string | null, overlapMs: number): Record<string, string> {
  if (!cursor) return {}
  const after = new Date(Math.max(0, Date.parse(cursor) - overlapMs)).toISOString()
  return { [`${field}>`]: after }
}

function mergeLatestByDriver<T extends { driverNumber: number; recordedAt: string }>(
  current: T[],
  incoming: T[],
  sort: (left: T, right: T) => number
): { values: T[]; changed: boolean } {
  const merged = new Map(current.map((value) => [value.driverNumber, value]))
  let changed = false

  for (const value of incoming) {
    const existing = merged.get(value.driverNumber)
    if (!existing || existing.recordedAt < value.recordedAt || (
      existing.recordedAt === value.recordedAt && !valuesEqual(existing, value)
    )) {
      merged.set(value.driverNumber, value)
      changed = true
    }
  }

  return { values: [...merged.values()].sort(sort), changed }
}

function mergeEvents<T>(
  current: T[],
  incoming: T[],
  keyFor: (value: T) => string,
  sort: (left: T, right: T) => number
): { values: T[]; changed: boolean } {
  const merged = new Map(current.map((value) => [keyFor(value), value]))
  let changed = false

  for (const value of incoming) {
    const key = keyFor(value)
    const existing = merged.get(key)
    if (!existing || !valuesEqual(existing, value)) {
      merged.set(key, value)
      changed = true
    }
  }

  return { values: [...merged.values()].sort(sort), changed }
}

function toHubSession(session: RaceState['session']): F1HubSession {
  return {
    sessionKey: session.sessionKey,
    meetingKey: session.meetingKey,
    name: session.name,
    type: session.type,
    circuit: session.circuit,
    location: session.location,
    country: session.country,
    year: session.year,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    status: session.status
  }
}

function toHubRaceState(state: RaceState | null): F1HubRaceState | null {
  if (!state) return null
  return {
    session: toHubSession(state.session),
    asOf: state.asOf,
    updatedAt: state.updatedAt,
    drivers: state.drivers.map((driver) => ({
      driverNumber: driver.driverNumber,
      broadcastName: driver.broadcastName,
      fullName: driver.fullName,
      acronym: driver.acronym,
      teamName: driver.teamName
    })),
    positions: state.positions.map((position) => ({
      driverNumber: position.driverNumber,
      position: position.position,
      recordedAt: position.recordedAt
    })),
    intervals: state.intervals.map((interval) => ({
      driverNumber: interval.driverNumber,
      gapToLeader: interval.gapToLeader,
      intervalToAhead: interval.intervalToAhead,
      recordedAt: interval.recordedAt
    })),
    laps: state.laps.map((lap) => ({
      driverNumber: lap.driverNumber,
      lapNumber: lap.lapNumber,
      startedAt: lap.startedAt,
      durationSeconds: lap.durationSeconds
    })),
    pitStops: state.pitStops.map((pitStop) => ({
      driverNumber: pitStop.driverNumber,
      lapNumber: pitStop.lapNumber,
      recordedAt: pitStop.recordedAt
    })),
    raceControlMessages: state.raceControlMessages.map((message) => ({
      recordedAt: message.recordedAt,
      category: message.category,
      message: message.message,
      driverNumber: message.driverNumber,
      flag: message.flag,
      lapNumber: message.lapNumber
    })),
    availability: { ...state.availability }
  }
}

export class OpenF1RaceDataService {
  private readonly client: OpenF1ApiClient
  private readonly fastPollMs: number
  private readonly slowPollMs: number
  private readonly discoveryPollMs: number
  private state: RaceState | null = null
  private rawSession: OpenF1SessionResponse | null = null
  private generation = 0
  private stopped = true
  private autoResolveLatest = false
  private fastPollTimer: Timer | null = null
  private slowPollTimer: Timer | null = null
  private discoveryTimer: Timer | null = null
  private sessionLoad: { sessionKey: number; promise: Promise<RaceState | null> } | null = null
  private seasonRaceSessions: OpenF1SessionResponse[] = []
  private seasonRaceSessionsRequest: Promise<void> | null = null
  private seasonRaceSessionsLoaded = false
  private seasonRaceSessionsAttempted = false
  private driverDirectory: F1HubDriver[] | null = null
  private driverDirectoryRequest: Promise<F1HubDriver[]> | null = null
  private alertReplayCache = new Map<number, F1HubAlertReplay>()
  private alertReplayRequests = new Map<number, Promise<F1HubAlertReplay | null>>()
  private activeAlertReplay: { sessionKey: number; promise: Promise<F1HubAlertReplay | null> } | null = null
  private alertReplayGeneration = 0
  private alertReplayLoading = false
  private liveDataNeeds: F1LiveDataNeeds = { ...NO_LIVE_DATA_NEEDS }
  private driversLoad: { sessionKey: number; promise: Promise<void> } | null = null
  private unavailableLogs = new Set<string>()
  private cursors: EndpointCursors = {
    positions: null,
    intervals: null,
    laps: null,
    pitStops: null,
    raceControlMessages: null
  }

  constructor(options: OpenF1RaceDataServiceOptions = {}) {
    this.client = options.client ?? new OpenF1ApiClient()
    this.fastPollMs = options.fastPollMs ?? DEFAULT_FAST_POLL_MS
    this.slowPollMs = options.slowPollMs ?? DEFAULT_SLOW_POLL_MS
    this.discoveryPollMs = options.discoveryPollMs ?? DEFAULT_DISCOVERY_POLL_MS
  }

  getCurrentRaceState(): RaceState | null {
    return this.state
  }

  getHubRaceState(): F1HubRaceState | null {
    return toHubRaceState(this.state)
  }

  /**
   * A one-time directory for controls that need stable OpenF1 driver numbers
   * outside a live session. This is deliberately not part of live polling.
   */
  async getDriverDirectory(): Promise<F1HubDriver[]> {
    if (this.state?.drivers.length) return toHubDrivers(this.state.drivers)

    for (const replay of this.alertReplayCache.values()) {
      if (replay.drivers.length) return replay.drivers
    }

    if (this.driverDirectory) return this.driverDirectory
    if (this.driverDirectoryRequest) return this.driverDirectoryRequest

    const request = this.loadDriverDirectory().finally(() => {
      if (this.driverDirectoryRequest === request) this.driverDirectoryRequest = null
    })
    this.driverDirectoryRequest = request
    return request
  }

  setLiveDataNeeds(needs: F1LiveDataNeeds): void {
    if (valuesEqual(this.liveDataNeeds, needs)) return
    this.liveDataNeeds = { ...needs }
    if (!this.state || this.state.session.status !== 'live') return
    this.clearPollingTimers()
    if (this.alertReplayLoading) return
    if (this.hasAnyLiveDataNeed()) void this.ensureDrivers(this.generation)
    this.scheduleFastPoll(this.generation, 0)
    this.scheduleSlowPoll(this.generation, 0)
  }

  async getHubData(): Promise<F1HubData> {
    await this.loadSeasonRaceSessions()
    const raceState = this.getHubRaceState()
    const session = raceState?.session ?? null
    const now = new Date()
    const sessionsBySessionKey = new Map(
      this.seasonRaceSessions.map((rawSession) => {
        const normalized = toHubSession(normalizeSession(rawSession, now))
        return [normalized.sessionKey, normalized]
      })
    )
    if (session?.status === 'live') sessionsBySessionKey.set(session.sessionKey, session)
    const seasonSessions = [...sessionsBySessionKey.values()]
    const races = seasonSessions
      .filter((candidate) => candidate.name.toLocaleLowerCase('en-US') === 'race')
      .sort((left, right) => Date.parse(right.startsAt) - Date.parse(left.startsAt))
    const recentRaces = races
      .filter((race) => Date.parse(race.endsAt) < now.getTime())
      .slice(0, 5)
    const liveSession = session?.status === 'live'
      ? session
      : seasonSessions.find((candidate) => candidate.status === 'live') ?? null
    const nextRace = [...races]
      .filter((race) => race.status === 'scheduled')
      .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))[0] ?? null
    const currentOrNext = liveSession ?? nextRace ?? (
      this.seasonRaceSessionsLoaded ? recentRaces[0] ?? null : null
    )
    const currentWeekendSessions = currentOrNext
      ? seasonSessions
        .filter((candidate) => candidate.meetingKey === currentOrNext.meetingKey)
        .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))
      : []

    return {
      currentSession: liveSession,
      nextSession: nextRace,
      currentOrNext,
      latestCompletedRace: recentRaces[0] ?? null,
      recentRaces,
      races,
      currentWeekendSessions,
      seasons: races.length > 0 ? [HUB_RACE_SEASON] : session ? [session.year] : [],
      raceState,
      dataUnavailable: !liveSession && !this.seasonRaceSessionsLoaded,
      lastSuccessfulUpdate: raceState?.updatedAt ?? null
    }
  }

  private loadSeasonRaceSessions(): Promise<void> {
    if (this.seasonRaceSessionsRequest) return this.seasonRaceSessionsRequest
    if (this.seasonRaceSessionsLoaded || this.seasonRaceSessionsAttempted) return Promise.resolve()
    this.seasonRaceSessionsAttempted = true

    const request = this.client
      .getSessions({ year: HUB_RACE_SEASON })
      .then((sessions) => {
        this.seasonRaceSessions = sessions
        this.seasonRaceSessionsLoaded = true
        this.unavailableLogs.delete(`season-races:${HUB_RACE_SEASON}`)
      })
      .catch((error) => {
        this.logUnavailable('season-races', String(HUB_RACE_SEASON), this.errorMessage(error))
      })
      .finally(() => {
        if (this.seasonRaceSessionsRequest === request) this.seasonRaceSessionsRequest = null
      })
    this.seasonRaceSessionsRequest = request
    return request
  }

  private async loadDriverDirectory(): Promise<F1HubDriver[]> {
    await this.loadSeasonRaceSessions()

    const now = new Date()
    const latestCompletedRace = this.seasonRaceSessions
      .map((session) => ({ raw: session, normalized: normalizeSession(session, now) }))
      .filter(({ normalized }) => normalized.name.toLocaleLowerCase('en-US') === 'race' && normalized.status === 'completed')
      .sort((left, right) => Date.parse(right.normalized.startsAt) - Date.parse(left.normalized.startsAt))[0]?.raw

    if (!latestCompletedRace) return []

    try {
      const drivers = toHubDrivers(normalizeDrivers(await this.client.getDrivers({
        session_key: latestCompletedRace.session_key
      })))
      if (drivers.length) this.driverDirectory = drivers
      return drivers
    } catch (error) {
      this.logUnavailable('driver-directory', String(latestCompletedRace.session_key), this.errorMessage(error))
      return []
    }
  }

  async start(sessionKey: OpenF1SessionKey = 'latest'): Promise<RaceState | null> {
    this.stopped = false
    return this.loadSession(sessionKey)
  }

  async loadSession(sessionKey: OpenF1SessionKey): Promise<RaceState | null> {
    this.stopped = false
    this.autoResolveLatest = sessionKey === 'latest'
    this.clearDiscoveryTimer()

    try {
      const session = await this.resolveSession(sessionKey)
      return session ? await this.activateSession(session) : null
    } catch (error) {
      this.logUnavailable('service', String(sessionKey), this.errorMessage(error))
      return null
    } finally {
      if (this.autoResolveLatest) this.scheduleDiscovery()
    }
  }

  async getRaceStateAt(sessionKey: number, timestamp: string | Date): Promise<RaceState | null> {
    const asOf = timestamp instanceof Date ? new Date(timestamp) : new Date(timestamp)
    if (Number.isNaN(asOf.getTime())) throw new TypeError('A valid historical timestamp is required')

    const session = await this.resolveSession(sessionKey)
    if (!session) return null

    const sessionQuery = { session_key: session.session_key }
    const date = asOf.toISOString()
    const [drivers, positions, intervals, laps, pitStops, raceControlMessages] = await Promise.all([
      this.fetchOrEmpty('drivers', session.session_key, () => this.client.getDrivers(sessionQuery)),
      this.fetchOrEmpty('positions', session.session_key, () => this.client.getPositions({ ...sessionQuery, 'date<=': date })),
      this.fetchOrEmpty('intervals', session.session_key, () => this.client.getIntervals({ ...sessionQuery, 'date<=': date })),
      this.fetchOrEmpty('laps', session.session_key, () => this.client.getLaps({ ...sessionQuery, 'date_start<=': date })),
      this.fetchOrEmpty('pitStops', session.session_key, () => this.client.getPitStops({ ...sessionQuery, 'date<=': date })),
      this.fetchOrEmpty('raceControlMessages', session.session_key, () => this.client.getRaceControlMessages({ ...sessionQuery, 'date<=': date }))
    ])

    return normalizeRaceState({
      session,
      drivers,
      positions,
      intervals,
      laps,
      pitStops,
      raceControlMessages
    }, asOf)
  }

  async getAlertReplay(sessionKey: number): Promise<F1HubAlertReplay | null> {
    const cached = this.alertReplayCache.get(sessionKey)
    if (cached) return cached
    const pending = this.alertReplayRequests.get(sessionKey)
    if (pending) return pending

    const generation = ++this.alertReplayGeneration
    const previous = this.activeAlertReplay?.promise
    this.pauseLivePollingForReplay()
    const request = (previous ? previous.catch(() => null) : Promise.resolve(null))
      .then(() => this.loadAlertReplay(sessionKey, generation))
      .finally(() => {
      this.alertReplayRequests.delete(sessionKey)
      if (this.activeAlertReplay?.promise === request) {
        this.activeAlertReplay = null
        this.resumeLivePollingAfterReplay()
      }
    })
    this.alertReplayRequests.set(sessionKey, request)
    this.activeAlertReplay = { sessionKey, promise: request }
    return request
  }

  cancelAlertReplay(sessionKey: number): void {
    if (this.activeAlertReplay?.sessionKey === sessionKey) this.alertReplayGeneration += 1
  }

  private async loadAlertReplay(
    sessionKey: number,
    generation: number
  ): Promise<F1HubAlertReplay | null> {
    if (!this.isAlertReplayCurrent(generation)) return null
    await this.loadSeasonRaceSessions()
    if (!this.isAlertReplayCurrent(generation)) return null
    const session = this.seasonRaceSessions.find((candidate) => candidate.session_key === sessionKey) ??
      await this.resolveSession(sessionKey)
    if (!session || !this.isAlertReplayCurrent(generation)) return null

    const normalizedSession = normalizeSession(session, new Date())
    if (normalizedSession.status !== 'completed') return null
    const query = { session_key: sessionKey }
    const drivers = await this.client.getDrivers(query)
    if (!this.isAlertReplayCurrent(generation)) return null
    const positions = await this.client.getPositions(query)
    if (!this.isAlertReplayCurrent(generation)) return null
    const pitStops = await this.client.getPitStops(query)
    if (!this.isAlertReplayCurrent(generation)) return null
    const raceControlMessages = await this.client.getRaceControlMessages(query)
    if (!this.isAlertReplayCurrent(generation)) return null
    const normalizedDrivers = normalizeDrivers(drivers)
    const replay: F1HubAlertReplay = {
      session: toHubSession(normalizedSession),
      drivers: normalizedDrivers.map((driver) => ({
        driverNumber: driver.driverNumber,
        broadcastName: driver.broadcastName,
        fullName: driver.fullName,
        acronym: driver.acronym,
        teamName: driver.teamName
      })),
      positionEvents: normalizePositionHistory(positions),
      pitStops: normalizePitStops(pitStops).map((pitStop) => ({
        driverNumber: pitStop.driverNumber,
        lapNumber: pitStop.lapNumber,
        recordedAt: pitStop.recordedAt
      })),
      raceControlMessages: normalizeRaceControlMessages(raceControlMessages).map((message) => ({
        recordedAt: message.recordedAt,
        category: message.category,
        message: message.message,
        driverNumber: message.driverNumber,
        flag: message.flag,
        lapNumber: message.lapNumber
      }))
    }
    this.alertReplayCache.set(sessionKey, replay)
    while (this.alertReplayCache.size > 3) {
      const oldestSessionKey = this.alertReplayCache.keys().next().value
      if (typeof oldestSessionKey !== 'number') break
      this.alertReplayCache.delete(oldestSessionKey)
    }
    return replay
  }

  private isAlertReplayCurrent(generation: number): boolean {
    return !this.stopped && generation === this.alertReplayGeneration
  }

  private pauseLivePollingForReplay(): void {
    this.alertReplayLoading = true
    this.clearPollingTimers()
    this.clearDiscoveryTimer()
  }

  private resumeLivePollingAfterReplay(): void {
    this.alertReplayLoading = false
    if (this.state?.session.status === 'live') this.startLivePolling(this.generation)
    this.scheduleDiscovery()
  }

  stop(): void {
    this.stopped = true
    this.autoResolveLatest = false
    this.generation += 1
    this.alertReplayGeneration += 1
    this.alertReplayLoading = false
    this.activeAlertReplay = null
    this.sessionLoad = null
    this.driversLoad = null
    this.clearPollingTimers()
    this.clearDiscoveryTimer()
    this.client.cancelAll()
  }

  private async resolveSession(sessionKey: OpenF1SessionKey): Promise<OpenF1SessionResponse | null> {
    try {
      const sessions = await this.client.getSessions({ session_key: sessionKey })
      const selected = sessions
        .filter((session) => Number.isFinite(session.session_key))
        .sort((left, right) => Date.parse(right.date_start) - Date.parse(left.date_start))[0]
      if (!selected) this.logUnavailable('session', String(sessionKey), 'no matching session data')
      return selected ?? null
    } catch (error) {
      this.logUnavailable('session', String(sessionKey), this.errorMessage(error))
      return null
    }
  }

  private activateSession(session: OpenF1SessionResponse): Promise<RaceState | null> {
    if (this.sessionLoad?.sessionKey === session.session_key) return this.sessionLoad.promise
    if (this.state?.session.sessionKey === session.session_key && this.rawSession) {
      const nextStatus = getSessionStatus(session, new Date())
      if (this.state.session.status !== 'live' && nextStatus === 'live') {
        const generation = ++this.generation
        this.clearPollingTimers()
        const promise = this.loadInitialState(session, generation)
        this.sessionLoad = { sessionKey: session.session_key, promise }
        void promise.then(
          () => { if (this.sessionLoad?.promise === promise) this.sessionLoad = null },
          () => { if (this.sessionLoad?.promise === promise) this.sessionLoad = null }
        )
        return promise
      }
      this.refreshSessionLifecycle()
      return Promise.resolve(this.state)
    }

    const generation = ++this.generation
    this.clearPollingTimers()
    const promise = this.loadInitialState(session, generation)
    this.sessionLoad = { sessionKey: session.session_key, promise }
    void promise.then(
      () => { if (this.sessionLoad?.promise === promise) this.sessionLoad = null },
      () => { if (this.sessionLoad?.promise === promise) this.sessionLoad = null }
    )
    return promise
  }

  private async loadInitialState(session: OpenF1SessionResponse, generation: number): Promise<RaceState | null> {
    const selectedAt = new Date()
    const selectedSession = normalizeSession(session, selectedAt)
    console.debug(`[openf1] selected session ${session.session_key}: ${session.year} ${session.country_name} ${session.session_name} (${selectedSession.status})`)

    const shouldLoadDetails = selectedSession.status === 'live' && this.hasAnyLiveDataNeed()
    const query = { session_key: session.session_key }
    const [drivers, positions, intervals, laps, pitStops, raceControlMessages] = await Promise.all([
      shouldLoadDetails
        ? this.fetchOrEmpty('drivers', session.session_key, () => this.client.getDrivers(query))
        : Promise.resolve([]),
      shouldLoadDetails && this.liveDataNeeds.positions
        ? this.fetchOrEmpty('positions', session.session_key, () => this.client.getPositions(query))
        : Promise.resolve([]),
      shouldLoadDetails && this.liveDataNeeds.intervals
        ? this.fetchOrEmpty('intervals', session.session_key, () => this.client.getIntervals(query))
        : Promise.resolve([]),
      shouldLoadDetails && this.liveDataNeeds.laps
        ? this.fetchOrEmpty('laps', session.session_key, () => this.client.getLaps(query))
        : Promise.resolve([]),
      shouldLoadDetails && this.liveDataNeeds.pitStops
        ? this.fetchOrEmpty('pitStops', session.session_key, () => this.client.getPitStops(query))
        : Promise.resolve([]),
      shouldLoadDetails && this.liveDataNeeds.raceControlMessages
        ? this.fetchOrEmpty('raceControlMessages', session.session_key, () => this.client.getRaceControlMessages(query))
        : Promise.resolve([])
    ])

    if (this.stopped || generation !== this.generation) return null

    this.rawSession = session
    this.driversLoad = null
    this.cursors = {
      positions: latestTimestamp(positions.map((row) => row.date)),
      intervals: latestTimestamp(intervals.map((row) => row.date)),
      laps: latestTimestamp(laps.map((row) => row.date_start)),
      pitStops: latestTimestamp(pitStops.map((row) => row.date)),
      raceControlMessages: latestTimestamp(raceControlMessages.map((row) => row.date))
    }
    this.state = normalizeRaceState({
      session,
      drivers,
      positions,
      intervals,
      laps,
      pitStops,
      raceControlMessages
    }, selectedAt)

    if (shouldLoadDetails) {
      const requested = new Set<DatasetName>(['drivers'])
      for (const [dataset, needed] of Object.entries(this.liveDataNeeds)) {
        if (needed) requested.add(dataset as DatasetName)
      }
      this.reportMissingData(this.state, requested)
    }
    this.logStateUpdate('loaded')
    if (this.state.session.status === 'live') {
      if (this.hasAnyLiveDataNeed() && this.state.drivers.length === 0) void this.ensureDrivers(generation)
      this.startLivePolling(generation)
    }
    return this.state
  }

  private startLivePolling(generation: number): void {
    this.clearPollingTimers()
    if (this.alertReplayLoading) return
    if (this.hasAnyLiveDataNeed()) void this.ensureDrivers(generation)
    this.scheduleFastPoll(generation)
    this.scheduleSlowPoll(generation)
  }

  private async pollFastData(generation: number): Promise<void> {
    if (!this.canPoll(generation)) return
    const sessionKey = this.state!.session.sessionKey
    const baseQuery = { session_key: sessionKey }
    const [positionRows, intervalRows] = await Promise.all([
      this.liveDataNeeds.positions ? this.fetchOrEmpty('positions', sessionKey, () => this.client.getPositions({
        ...baseQuery,
        ...incrementalQuery('date', this.cursors.positions, LIVE_QUERY_OVERLAP_MS)
      })) : Promise.resolve([]),
      this.liveDataNeeds.intervals ? this.fetchOrEmpty('intervals', sessionKey, () => this.client.getIntervals({
        ...baseQuery,
        ...incrementalQuery('date', this.cursors.intervals, LIVE_QUERY_OVERLAP_MS)
      })) : Promise.resolve([])
    ])

    if (!this.canPoll(generation)) return
    this.advanceFastCursors(positionRows, intervalRows)
    const positions = mergeLatestByDriver(
      this.state!.positions,
      normalizePositions(positionRows),
      (left, right) => left.position - right.position
    )
    const intervals = mergeLatestByDriver(
      this.state!.intervals,
      normalizeIntervals(intervalRows),
      (left, right) => left.driverNumber - right.driverNumber
    )
    this.applyLiveUpdate({ positions: positions.values, intervals: intervals.values }, {
      positions: positionRows.length > 0,
      intervals: intervalRows.length > 0
    })
    if (positions.changed || intervals.changed) this.logStateUpdate('updated')
  }

  private async pollSlowData(generation: number): Promise<void> {
    if (!this.canPoll(generation)) return
    const sessionKey = this.state!.session.sessionKey
    const baseQuery = { session_key: sessionKey }
    const [lapRows, pitRows, raceControlRows] = await Promise.all([
      this.liveDataNeeds.laps ? this.fetchOrEmpty('laps', sessionKey, () => this.client.getLaps({
        ...baseQuery,
        ...incrementalQuery('date_start', this.cursors.laps, LAP_QUERY_OVERLAP_MS)
      })) : Promise.resolve([]),
      this.liveDataNeeds.pitStops ? this.fetchOrEmpty('pitStops', sessionKey, () => this.client.getPitStops({
        ...baseQuery,
        ...incrementalQuery('date', this.cursors.pitStops, LIVE_QUERY_OVERLAP_MS)
      })) : Promise.resolve([]),
      this.liveDataNeeds.raceControlMessages ? this.fetchOrEmpty('raceControlMessages', sessionKey, () => this.client.getRaceControlMessages({
        ...baseQuery,
        ...incrementalQuery('date', this.cursors.raceControlMessages, LIVE_QUERY_OVERLAP_MS)
      })) : Promise.resolve([])
    ])

    if (!this.canPoll(generation)) return
    this.advanceSlowCursors(lapRows, pitRows, raceControlRows)
    const laps = mergeEvents(
      this.state!.laps,
      normalizeLaps(lapRows),
      (lap) => `${lap.driverNumber}:${lap.lapNumber}`,
      (left, right) => left.lapNumber - right.lapNumber || left.driverNumber - right.driverNumber
    )
    const pitStops = mergeEvents(
      this.state!.pitStops,
      normalizePitStops(pitRows),
      (pitStop) => `${pitStop.driverNumber}:${pitStop.lapNumber}:${pitStop.recordedAt}`,
      (left, right) => left.recordedAt.localeCompare(right.recordedAt)
    )
    const raceControlMessages = mergeEvents(
      this.state!.raceControlMessages,
      normalizeRaceControlMessages(raceControlRows),
      (message) => `${message.recordedAt}:${message.category}:${message.driverNumber}:${message.message}`,
      (left, right) => left.recordedAt.localeCompare(right.recordedAt)
    )
    this.applyLiveUpdate({
      laps: laps.values,
      pitStops: pitStops.values,
      raceControlMessages: raceControlMessages.values
    }, {
      laps: lapRows.length > 0,
      pitStops: pitRows.length > 0,
      raceControlMessages: raceControlRows.length > 0
    })
    if (laps.changed || pitStops.changed || raceControlMessages.changed) this.logStateUpdate('updated')
  }

  private applyLiveUpdate(
    patch: Partial<Pick<RaceState, 'positions' | 'intervals' | 'laps' | 'pitStops' | 'raceControlMessages'>>,
    available: Partial<RaceState['availability']>
  ): void {
    if (!this.state || !this.rawSession) return
    const now = new Date()
    const status = getSessionStatus(this.rawSession, now)
    this.state = {
      ...this.state,
      ...patch,
      session: { ...this.state.session, status },
      asOf: now.toISOString(),
      updatedAt: now.toISOString(),
      availability: {
        ...this.state.availability,
        ...Object.fromEntries(Object.entries(available).map(([key, value]) => [
          key,
          this.state!.availability[key as DatasetName] || value
        ]))
      }
    }
  }

  private refreshSessionLifecycle(): void {
    if (!this.state || !this.rawSession) return
    const now = new Date()
    const status = getSessionStatus(this.rawSession, now)
    this.state = {
      ...this.state,
      session: { ...this.state.session, status },
      asOf: now.toISOString(),
      updatedAt: now.toISOString()
    }
    if (status === 'live' && !this.fastPollTimer && !this.slowPollTimer) {
      this.startLivePolling(this.generation)
    }
  }

  private canPoll(generation: number): boolean {
    return !this.stopped && generation === this.generation && this.state?.session.status === 'live'
  }

  private hasAnyLiveDataNeed(): boolean {
    return Object.values(this.liveDataNeeds).some(Boolean)
  }

  private hasFastDataNeed(): boolean {
    return this.liveDataNeeds.positions || this.liveDataNeeds.intervals
  }

  private hasSlowDataNeed(): boolean {
    return this.liveDataNeeds.laps || this.liveDataNeeds.pitStops || this.liveDataNeeds.raceControlMessages
  }

  private ensureDrivers(generation: number): Promise<void> {
    if (!this.canPoll(generation) || !this.state || this.state.drivers.length > 0) return Promise.resolve()
    const sessionKey = this.state.session.sessionKey
    if (this.driversLoad?.sessionKey === sessionKey) return this.driversLoad.promise
    const promise = this.fetchOrEmpty('drivers', sessionKey, () => this.client.getDrivers({ session_key: sessionKey }))
      .then((rows) => {
        if (!this.canPoll(generation) || this.state?.session.sessionKey !== sessionKey) return
        const drivers = normalizeDrivers(rows)
        this.state = {
          ...this.state,
          drivers,
          availability: { ...this.state.availability, drivers: drivers.length > 0 },
          updatedAt: new Date().toISOString()
        }
      })
      .finally(() => {
        if (this.driversLoad?.promise === promise) this.driversLoad = null
      })
    this.driversLoad = { sessionKey, promise }
    return promise
  }

  private scheduleFastPoll(generation: number, delayMs = this.fastPollMs): void {
    if (this.fastPollTimer || this.alertReplayLoading || !this.canPoll(generation) || !this.hasFastDataNeed()) return
    this.fastPollTimer = setTimeout(() => {
      this.fastPollTimer = null
      void this.runFastPoll(generation)
    }, delayMs)
  }

  private scheduleSlowPoll(generation: number, delayMs = this.slowPollMs): void {
    if (this.slowPollTimer || this.alertReplayLoading || !this.canPoll(generation) || !this.hasSlowDataNeed()) return
    this.slowPollTimer = setTimeout(() => {
      this.slowPollTimer = null
      void this.runSlowPoll(generation)
    }, delayMs)
  }

  private async runFastPoll(generation: number): Promise<void> {
    try {
      await this.pollFastData(generation)
      if (this.state) this.unavailableLogs.delete(`${this.state.session.sessionKey}:fastPoll`)
    } catch (error) {
      if (this.canPoll(generation)) {
        this.logUnavailable('fastPoll', String(this.state!.session.sessionKey), this.errorMessage(error))
      }
    } finally {
      this.scheduleFastPoll(generation)
    }
  }

  private async runSlowPoll(generation: number): Promise<void> {
    try {
      await this.pollSlowData(generation)
      if (this.state) this.unavailableLogs.delete(`${this.state.session.sessionKey}:slowPoll`)
    } catch (error) {
      if (this.canPoll(generation)) {
        this.logUnavailable('slowPoll', String(this.state!.session.sessionKey), this.errorMessage(error))
      }
    } finally {
      this.scheduleSlowPoll(generation)
    }
  }

  private scheduleDiscovery(): void {
    if (this.discoveryTimer || this.stopped || !this.autoResolveLatest) return
    this.discoveryTimer = setTimeout(() => {
      this.discoveryTimer = null
      void this.discoverLatestSession()
    }, this.discoveryPollMs)
  }

  private async discoverLatestSession(): Promise<void> {
    if (this.stopped || !this.autoResolveLatest) return
    try {
      const session = await this.resolveSession('latest')
      if (session) await this.activateSession(session)
    } catch (error) {
      this.logUnavailable('service', 'latest', this.errorMessage(error))
    } finally {
      this.scheduleDiscovery()
    }
  }

  private advanceFastCursors(
    positions: OpenF1PositionResponse[],
    intervals: OpenF1IntervalResponse[]
  ): void {
    this.cursors.positions = latestTimestamp([this.cursors.positions, ...positions.map((row) => row.date)])
    this.cursors.intervals = latestTimestamp([this.cursors.intervals, ...intervals.map((row) => row.date)])
  }

  private advanceSlowCursors(
    laps: OpenF1LapResponse[],
    pitStops: OpenF1PitResponse[],
    raceControlMessages: OpenF1RaceControlResponse[]
  ): void {
    this.cursors.laps = latestTimestamp([this.cursors.laps, ...laps.map((row) => row.date_start)])
    this.cursors.pitStops = latestTimestamp([this.cursors.pitStops, ...pitStops.map((row) => row.date)])
    this.cursors.raceControlMessages = latestTimestamp([
      this.cursors.raceControlMessages,
      ...raceControlMessages.map((row) => row.date)
    ])
  }

  private async fetchOrEmpty<T>(
    dataset: DatasetName,
    sessionKey: number,
    request: () => Promise<T[]>
  ): Promise<T[]> {
    try {
      const values = await request()
      if (values.length > 0) this.unavailableLogs.delete(`${sessionKey}:${dataset}`)
      return values
    } catch (error) {
      this.logUnavailable(dataset, String(sessionKey), this.errorMessage(error))
      return []
    }
  }

  private reportMissingData(state: RaceState, requested: Set<DatasetName>): void {
    for (const [dataset, available] of Object.entries(state.availability)) {
      if (requested.has(dataset as DatasetName) && !available) {
        this.logUnavailable(dataset, String(state.session.sessionKey), 'no data returned')
      }
    }
  }

  private logUnavailable(dataset: string, sessionKey: string, reason: string): void {
    const key = `${sessionKey}:${dataset}`
    if (this.unavailableLogs.has(key)) return
    this.unavailableLogs.add(key)
    console.debug(`[openf1] ${dataset} unavailable for session=${sessionKey}: ${reason}`)
  }

  private logStateUpdate(action: 'loaded' | 'updated'): void {
    if (!this.state) return
    console.debug(
      `[openf1] race state ${action} session=${this.state.session.sessionKey}` +
      ` positions=${this.state.positions.length}` +
      ` intervals=${this.state.intervals.length}` +
      ` laps=${this.state.laps.length}` +
      ` pits=${this.state.pitStops.length}` +
      ` raceControl=${this.state.raceControlMessages.length}`
    )
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error'
  }

  private clearPollingTimers(): void {
    if (this.fastPollTimer) clearTimeout(this.fastPollTimer)
    if (this.slowPollTimer) clearTimeout(this.slowPollTimer)
    this.fastPollTimer = null
    this.slowPollTimer = null
  }

  private clearDiscoveryTimer(): void {
    if (this.discoveryTimer) clearTimeout(this.discoveryTimer)
    this.discoveryTimer = null
  }
}
