export type RaceSessionStatus = 'scheduled' | 'live' | 'completed' | 'cancelled'
export type RaceGap = number | string | null

export type RaceSession = {
  sessionKey: number
  meetingKey: number
  name: string
  type: string
  circuit: string
  location: string
  country: string
  countryCode: string
  year: number
  startsAt: string
  endsAt: string
  gmtOffset: string
  status: RaceSessionStatus
}

export type RaceDriver = {
  driverNumber: number
  broadcastName: string
  fullName: string
  acronym: string
  teamName: string | null
  teamColour: string | null
  headshotUrl: string | null
  countryCode: string | null
}

export type RacePosition = {
  driverNumber: number
  position: number
  recordedAt: string
}

export type RaceInterval = {
  driverNumber: number
  gapToLeader: RaceGap
  intervalToAhead: RaceGap
  recordedAt: string
}

export type RaceLap = {
  driverNumber: number
  lapNumber: number
  startedAt: string | null
  durationSeconds: number | null
  sectorDurationsSeconds: [number | null, number | null, number | null]
  speedTrapKph: number | null
  isPitOutLap: boolean
}

export type RacePitStop = {
  driverNumber: number
  lapNumber: number
  recordedAt: string
  laneDurationSeconds: number | null
  stopDurationSeconds: number | null
}

export type RaceControlMessage = {
  recordedAt: string
  category: string
  message: string
  driverNumber: number | null
  flag: string | null
  lapNumber: number | null
  scope: string | null
  sector: number | null
  qualifyingPhase: number | string | null
}

export type RaceDataAvailability = {
  drivers: boolean
  positions: boolean
  intervals: boolean
  laps: boolean
  pitStops: boolean
  raceControlMessages: boolean
}

export type RaceState = {
  session: RaceSession
  asOf: string
  updatedAt: string
  drivers: RaceDriver[]
  positions: RacePosition[]
  intervals: RaceInterval[]
  laps: RaceLap[]
  pitStops: RacePitStop[]
  raceControlMessages: RaceControlMessage[]
  availability: RaceDataAvailability
}
