import type {
  OpenF1DriverResponse,
  OpenF1IntervalResponse,
  OpenF1LapResponse,
  OpenF1PitResponse,
  OpenF1PositionResponse,
  OpenF1RaceControlResponse,
  OpenF1SessionResponse
} from './rawTypes'
import type {
  RaceControlMessage,
  RaceDriver,
  RaceInterval,
  RaceLap,
  RacePitStop,
  RacePosition,
  RaceSession,
  RaceSessionStatus,
  RaceState
} from './types'

const LIVE_GRACE_MS = 30 * 60 * 1000

function normalizedDate(value: string | null | undefined): string | null {
  if (!value) return null
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString()
}

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function getSessionStatus(
  session: Pick<OpenF1SessionResponse, 'date_start' | 'date_end' | 'is_cancelled'>,
  at: Date
): RaceSessionStatus {
  if (session.is_cancelled) return 'cancelled'
  const startsAt = Date.parse(session.date_start)
  const endsAt = Date.parse(session.date_end)
  if (!Number.isNaN(startsAt) && at.getTime() < startsAt) return 'scheduled'
  if (!Number.isNaN(endsAt) && at.getTime() > endsAt + LIVE_GRACE_MS) return 'completed'
  return 'live'
}

export function normalizeSession(raw: OpenF1SessionResponse, at: Date): RaceSession {
  return {
    sessionKey: raw.session_key,
    meetingKey: raw.meeting_key,
    name: raw.session_name,
    type: raw.session_type,
    circuit: raw.circuit_short_name,
    location: raw.location,
    country: raw.country_name,
    countryCode: raw.country_code,
    year: raw.year,
    startsAt: normalizedDate(raw.date_start) ?? raw.date_start,
    endsAt: normalizedDate(raw.date_end) ?? raw.date_end,
    gmtOffset: raw.gmt_offset,
    status: getSessionStatus(raw, at)
  }
}

export function normalizeDrivers(rows: OpenF1DriverResponse[]): RaceDriver[] {
  return rows
    .filter((row) => Number.isFinite(row.driver_number))
    .map((row) => ({
      driverNumber: row.driver_number,
      broadcastName: row.broadcast_name || row.full_name || String(row.driver_number),
      fullName: row.full_name || row.broadcast_name || String(row.driver_number),
      acronym: row.name_acronym || '',
      teamName: row.team_name || null,
      teamColour: row.team_colour || null,
      headshotUrl: row.headshot_url || null,
      countryCode: row.country_code || null
    }))
    .sort((a, b) => a.driverNumber - b.driverNumber)
}

export function normalizePositions(rows: OpenF1PositionResponse[]): RacePosition[] {
  const latestByDriver = new Map<number, RacePosition>()
  for (const row of rows) {
    const recordedAt = normalizedDate(row.date)
    if (!recordedAt || !Number.isFinite(row.driver_number) || !Number.isFinite(row.position)) continue
    const position = { driverNumber: row.driver_number, position: row.position, recordedAt }
    const current = latestByDriver.get(position.driverNumber)
    if (!current || current.recordedAt <= position.recordedAt) latestByDriver.set(position.driverNumber, position)
  }
  return [...latestByDriver.values()].sort((a, b) => a.position - b.position)
}

export function normalizePositionHistory(rows: OpenF1PositionResponse[]): RacePosition[] {
  return rows
    .map((row) => ({
      driverNumber: row.driver_number,
      position: row.position,
      recordedAt: normalizedDate(row.date)
    }))
    .filter((row): row is RacePosition => (
      row.recordedAt !== null && Number.isFinite(row.driverNumber) && Number.isFinite(row.position)
    ))
    .sort((left, right) => (
      left.recordedAt.localeCompare(right.recordedAt) || left.driverNumber - right.driverNumber
    ))
}

export function normalizeIntervals(rows: OpenF1IntervalResponse[]): RaceInterval[] {
  const latestByDriver = new Map<number, RaceInterval>()
  for (const row of rows) {
    const recordedAt = normalizedDate(row.date)
    if (!recordedAt || !Number.isFinite(row.driver_number)) continue
    const interval = {
      driverNumber: row.driver_number,
      gapToLeader: row.gap_to_leader,
      intervalToAhead: row.interval,
      recordedAt
    }
    const current = latestByDriver.get(interval.driverNumber)
    if (!current || current.recordedAt <= interval.recordedAt) latestByDriver.set(interval.driverNumber, interval)
  }
  return [...latestByDriver.values()].sort((a, b) => a.driverNumber - b.driverNumber)
}

export function normalizeLaps(rows: OpenF1LapResponse[]): RaceLap[] {
  return rows
    .filter((row) => Number.isFinite(row.driver_number) && Number.isFinite(row.lap_number))
    .map((row): RaceLap => ({
      driverNumber: row.driver_number,
      lapNumber: row.lap_number,
      startedAt: normalizedDate(row.date_start),
      durationSeconds: finiteNumber(row.lap_duration),
      sectorDurationsSeconds: [
        finiteNumber(row.duration_sector_1),
        finiteNumber(row.duration_sector_2),
        finiteNumber(row.duration_sector_3)
      ],
      speedTrapKph: finiteNumber(row.st_speed),
      isPitOutLap: Boolean(row.is_pit_out_lap)
    }))
    .sort((a, b) => a.lapNumber - b.lapNumber || a.driverNumber - b.driverNumber)
}

export function normalizePitStops(rows: OpenF1PitResponse[]): RacePitStop[] {
  return rows
    .map((row) => ({
      driverNumber: row.driver_number,
      lapNumber: row.lap_number,
      recordedAt: normalizedDate(row.date),
      laneDurationSeconds: finiteNumber(row.lane_duration),
      stopDurationSeconds: finiteNumber(row.stop_duration)
    }))
    .filter((row): row is RacePitStop => (
      row.recordedAt !== null && Number.isFinite(row.driverNumber) && Number.isFinite(row.lapNumber)
    ))
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
}

export function normalizeRaceControlMessages(rows: OpenF1RaceControlResponse[]): RaceControlMessage[] {
  return rows
    .map((row) => ({
      recordedAt: normalizedDate(row.date),
      category: row.category,
      message: row.message,
      driverNumber: finiteNumber(row.driver_number),
      flag: row.flag || null,
      lapNumber: finiteNumber(row.lap_number),
      scope: row.scope || null,
      sector: finiteNumber(row.sector),
      qualifyingPhase: row.qualifying_phase
    }))
    .filter((row): row is RaceControlMessage => row.recordedAt !== null)
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
}

export type OpenF1RaceStateSource = {
  session: OpenF1SessionResponse
  drivers: OpenF1DriverResponse[]
  positions: OpenF1PositionResponse[]
  intervals: OpenF1IntervalResponse[]
  laps: OpenF1LapResponse[]
  pitStops: OpenF1PitResponse[]
  raceControlMessages: OpenF1RaceControlResponse[]
}

export function normalizeRaceState(source: OpenF1RaceStateSource, asOf: Date): RaceState {
  const updatedAt = new Date().toISOString()
  return {
    session: normalizeSession(source.session, asOf),
    asOf: asOf.toISOString(),
    updatedAt,
    drivers: normalizeDrivers(source.drivers),
    positions: normalizePositions(source.positions),
    intervals: normalizeIntervals(source.intervals),
    laps: normalizeLaps(source.laps),
    pitStops: normalizePitStops(source.pitStops),
    raceControlMessages: normalizeRaceControlMessages(source.raceControlMessages),
    availability: {
      drivers: source.drivers.length > 0,
      positions: source.positions.length > 0,
      intervals: source.intervals.length > 0,
      laps: source.laps.length > 0,
      pitStops: source.pitStops.length > 0,
      raceControlMessages: source.raceControlMessages.length > 0
    }
  }
}
