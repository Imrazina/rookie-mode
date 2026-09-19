import type { RaceLap, RaceState } from '../openf1'

function latestLapsByDriver(laps: RaceLap[]): RaceLap[] {
  const latest = new Map<number, RaceLap>()
  for (const lap of laps) {
    const current = latest.get(lap.driverNumber)
    if (!current || current.lapNumber < lap.lapNumber) latest.set(lap.driverNumber, lap)
  }
  return [...latest.values()].sort((left, right) => left.driverNumber - right.driverNumber)
}

export function compactRaceState(raceState: RaceState | null): unknown {
  if (!raceState) return null

  return {
    session: raceState.session,
    asOf: raceState.asOf,
    availability: raceState.availability,
    drivers: raceState.drivers.map((driver) => ({
      driverNumber: driver.driverNumber,
      broadcastName: driver.broadcastName,
      fullName: driver.fullName,
      acronym: driver.acronym,
      teamName: driver.teamName
    })),
    positions: raceState.positions,
    intervals: raceState.intervals,
    latestLaps: latestLapsByDriver(raceState.laps),
    recentPitStops: raceState.pitStops.slice(-10),
    recentRaceControlMessages: raceState.raceControlMessages.slice(-10)
  }
}

export function raceStateFingerprint(raceState: RaceState | null): string {
  if (!raceState) return 'no-race-state'
  const compact = compactRaceState(raceState) as Record<string, unknown>
  return JSON.stringify({ ...compact, asOf: undefined })
}
