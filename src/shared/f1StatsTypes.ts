export type F1StatsDataType = 'drivers' | 'constructors' | 'races'

export type F1DriverStanding = {
  position: number
  driverName: string
  constructorName: string | null
  points: number | null
  wins: number | null
}

export type F1ConstructorStanding = {
  position: number
  constructorName: string
  points: number | null
  wins: number | null
}

export type F1SeasonRace = {
  round: number
  raceName: string
  date: string | null
  winner: string | null
  polePosition: string | null
  fastestLap: string | null
  results: Array<{
    position: number
    driverName: string
  }>
}

export type F1StatsDataset =
  | { type: 'drivers'; season: number; rows: F1DriverStanding[] }
  | { type: 'constructors'; season: number; rows: F1ConstructorStanding[] }
  | { type: 'races'; season: number; rows: F1SeasonRace[] }
