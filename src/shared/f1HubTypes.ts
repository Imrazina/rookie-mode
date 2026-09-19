export type F1HubSessionStatus = 'scheduled' | 'live' | 'completed' | 'cancelled'

export type F1LiveDataNeeds = {
  positions: boolean
  intervals: boolean
  laps: boolean
  pitStops: boolean
  raceControlMessages: boolean
}

export type F1HubSession = {
  sessionKey: number
  meetingKey: number
  name: string
  type: string
  circuit: string
  location: string
  country: string
  year: number
  startsAt: string
  endsAt: string
  status: F1HubSessionStatus
}

export type F1HubDriver = {
  driverNumber: number
  broadcastName: string
  fullName: string
  acronym: string
  teamName: string | null
}

export type F1HubPosition = {
  driverNumber: number
  position: number
  recordedAt: string
}

export type F1HubInterval = {
  driverNumber: number
  gapToLeader: number | string | null
  intervalToAhead: number | string | null
  recordedAt: string
}

export type F1HubLap = {
  driverNumber: number
  lapNumber: number
  startedAt: string | null
  durationSeconds: number | null
}

export type F1HubPitStop = {
  driverNumber: number
  lapNumber: number
  recordedAt: string
}

export type F1HubRaceControlMessage = {
  recordedAt: string
  category: string
  message: string
  driverNumber: number | null
  flag: string | null
  lapNumber: number | null
}

export type F1HubRaceState = {
  session: F1HubSession
  asOf: string
  updatedAt: string
  drivers: F1HubDriver[]
  positions: F1HubPosition[]
  intervals: F1HubInterval[]
  laps: F1HubLap[]
  pitStops: F1HubPitStop[]
  raceControlMessages: F1HubRaceControlMessage[]
  availability: {
    drivers: boolean
    positions: boolean
    intervals: boolean
    laps: boolean
    pitStops: boolean
    raceControlMessages: boolean
  }
}

export type F1HubAlertReplay = {
  session: F1HubSession
  drivers: F1HubDriver[]
  positionEvents: F1HubPosition[]
  pitStops: F1HubPitStop[]
  raceControlMessages: F1HubRaceControlMessage[]
}

export type F1HubData = {
  currentSession: F1HubSession | null
  nextSession: F1HubSession | null
  currentOrNext: F1HubSession | null
  latestCompletedRace: F1HubSession | null
  recentRaces: F1HubSession[]
  races: F1HubSession[]
  currentWeekendSessions: F1HubSession[]
  seasons: number[]
  raceState: F1HubRaceState | null
  dataUnavailable: boolean
  lastSuccessfulUpdate: string | null
}
