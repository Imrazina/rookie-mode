import type {
  F1ConstructorStanding,
  F1DriverStanding,
  F1SeasonRace,
  F1StatsDataset,
  F1StatsDataType
} from '../../shared/f1StatsTypes'

const DEFAULT_BASE_URL = 'https://api.jolpi.ca/ergast/f1'
const REQUEST_TIMEOUT_MS = 12_000
const USER_AGENT = 'Rookie/1.0.0'
const RESULTS_PAGE_SIZE = 100

type RawDriver = {
  givenName?: string
  familyName?: string
}

type RawConstructor = {
  name?: string
}

type RawDriverStanding = {
  position?: string
  points?: string
  wins?: string
  Driver?: RawDriver
  Constructors?: RawConstructor[]
}

type RawConstructorStanding = {
  position?: string
  points?: string
  wins?: string
  Constructor?: RawConstructor
}

type RawRaceResult = {
  position?: string
  Driver?: RawDriver
  FastestLap?: {
    rank?: string
    Time?: { time?: string }
  }
}

type RawRace = {
  round?: string
  raceName?: string
  date?: string
  Results?: RawRaceResult[]
  QualifyingResults?: Array<{
    position?: string
    Driver?: RawDriver
  }>
}

type RawJolpicaResponse = {
  MRData?: {
    limit?: string
    offset?: string
    total?: string
    StandingsTable?: {
      StandingsLists?: Array<{
        DriverStandings?: RawDriverStanding[]
        ConstructorStandings?: RawConstructorStanding[]
      }>
    }
    RaceTable?: {
      Races?: RawRace[]
    }
  }
}

function numberOrNull(value: string | undefined): number | null {
  if (!value?.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function driverName(driver: RawDriver | undefined): string | null {
  if (!driver) return null
  const name = [driver.givenName, driver.familyName].filter(Boolean).join(' ').trim()
  return name || null
}

function normalizeDriverStandings(body: RawJolpicaResponse): F1DriverStanding[] {
  const standings = body.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings ?? []
  return standings.flatMap((standing) => {
    const position = numberOrNull(standing.position)
    const name = driverName(standing.Driver)
    if (position === null || !name) return []
    return [{
      position,
      driverName: name,
      constructorName: standing.Constructors?.map((constructor) => constructor.name)
        .filter((value): value is string => Boolean(value))
        .join(' / ') || null,
      points: numberOrNull(standing.points),
      wins: numberOrNull(standing.wins)
    }]
  }).sort((left, right) => left.position - right.position)
}

function normalizeConstructorStandings(body: RawJolpicaResponse): F1ConstructorStanding[] {
  const standings = body.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings ?? []
  return standings.flatMap((standing) => {
    const position = numberOrNull(standing.position)
    const name = standing.Constructor?.name?.trim()
    if (position === null || !name) return []
    return [{
      position,
      constructorName: name,
      points: numberOrNull(standing.points),
      wins: numberOrNull(standing.wins)
    }]
  }).sort((left, right) => left.position - right.position)
}

function normalizeRaces(
  scheduleBody: RawJolpicaResponse,
  resultsBody: RawJolpicaResponse,
  qualifyingBody: RawJolpicaResponse
): F1SeasonRace[] {
  const schedule = scheduleBody.MRData?.RaceTable?.Races ?? []
  const results = resultsBody.MRData?.RaceTable?.Races ?? []
  const qualifying = qualifyingBody.MRData?.RaceTable?.Races ?? []
  const resultsByRound = new Map(results.map((race) => [race.round, race]))
  const qualifyingByRound = new Map(qualifying.map((race) => [race.round, race]))

  return schedule.flatMap((race) => {
    const round = numberOrNull(race.round)
    const raceName = race.raceName?.trim()
    if (round === null || !raceName) return []
    const raceResults = resultsByRound.get(race.round)?.Results ?? []
    const winner = driverName(raceResults.find((result) => result.position === '1')?.Driver)
    const qualifyingResults = qualifyingByRound.get(race.round)?.QualifyingResults ?? []
    const polePosition = driverName(
      qualifyingResults.find((result) => result.position === '1')?.Driver
    )
    const fastest = raceResults.find((result) => result.FastestLap?.rank === '1')
    const fastestDriver = driverName(fastest?.Driver)
    const fastestTime = fastest?.FastestLap?.Time?.time?.trim()
    const fastestLap = fastestDriver
      ? fastestTime ? `${fastestDriver} (${fastestTime})` : fastestDriver
      : null
    const normalizedResults = raceResults.flatMap((result) => {
      const position = numberOrNull(result.position)
      const name = driverName(result.Driver)
      return position !== null && name ? [{ position, driverName: name }] : []
    }).sort((left, right) => left.position - right.position)

    return [{
      round,
      raceName,
      date: race.date?.trim() || null,
      winner,
      polePosition,
      fastestLap,
      results: normalizedResults
    }]
  }).sort((left, right) => left.round - right.round)
}

function mergeRacePages(pages: RawJolpicaResponse[]): RawJolpicaResponse {
  const racesByRound = new Map<string, RawRace>()
  for (const page of pages) {
    for (const race of page.MRData?.RaceTable?.Races ?? []) {
      const round = race.round?.trim()
      if (!round) continue
      const existing = racesByRound.get(round)
      if (!existing) {
        racesByRound.set(round, {
          ...race,
          ...(race.Results ? { Results: [...race.Results] } : {}),
          ...(race.QualifyingResults ? { QualifyingResults: [...race.QualifyingResults] } : {})
        })
        continue
      }
      if (race.Results?.length) existing.Results = [...(existing.Results ?? []), ...race.Results]
      if (race.QualifyingResults?.length) {
        existing.QualifyingResults = [...(existing.QualifyingResults ?? []), ...race.QualifyingResults]
      }
    }
  }
  return { MRData: { RaceTable: { Races: [...racesByRound.values()] } } }
}

export class JolpicaF1Service {
  private readonly cache = new Map<string, F1StatsDataset>()
  private readonly inFlight = new Map<string, Promise<F1StatsDataset>>()

  constructor(
    private readonly baseUrl = DEFAULT_BASE_URL,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  getStats(season: number, type: F1StatsDataType): Promise<F1StatsDataset> {
    if (!Number.isInteger(season) || season < 1950 || season > new Date().getUTCFullYear() + 1) {
      return Promise.reject(new TypeError('Invalid Formula 1 season'))
    }

    const key = `${season}:${type}`
    const cached = this.cache.get(key)
    if (cached) return Promise.resolve(cached)
    const existing = this.inFlight.get(key)
    if (existing) return existing

    const request = this.fetchStats(season, type).then((dataset) => {
      this.cache.set(key, dataset)
      return dataset
    }).finally(() => {
      if (this.inFlight.get(key) === request) this.inFlight.delete(key)
    })
    this.inFlight.set(key, request)
    return request
  }

  private async fetchStats(season: number, type: F1StatsDataType): Promise<F1StatsDataset> {
    if (type === 'drivers') {
      const body = await this.request(`${season}/driverstandings/`, 100)
      return { type, season, rows: normalizeDriverStandings(body) }
    }
    if (type === 'constructors') {
      const body = await this.request(`${season}/constructorstandings/`, 100)
      return { type, season, rows: normalizeConstructorStandings(body) }
    }

    const [scheduleResult, resultsResult, qualifyingResult] = await Promise.allSettled([
      this.request(`${season}/`, 100),
      this.requestAllRacePages(`${season}/results/`),
      this.requestAllRacePages(`${season}/qualifying/`)
    ])
    if (scheduleResult.status === 'rejected') throw scheduleResult.reason
    const emptyResponse: RawJolpicaResponse = {}
    return {
      type,
      season,
      rows: normalizeRaces(
        scheduleResult.value,
        resultsResult.status === 'fulfilled' ? resultsResult.value : emptyResponse,
        qualifyingResult.status === 'fulfilled' ? qualifyingResult.value : emptyResponse
      )
    }
  }

  private async request(path: string, limit: number): Promise<RawJolpicaResponse> {
    return this.requestPage(path, limit, 0)
  }

  private async requestAllRacePages(path: string): Promise<RawJolpicaResponse> {
    const pages: RawJolpicaResponse[] = []
    let offset = 0
    while (true) {
      const page = await this.requestPage(path, RESULTS_PAGE_SIZE, offset)
      pages.push(page)

      const metadata = page.MRData
      const total = numberOrNull(metadata?.total)
      const pageLimit = numberOrNull(metadata?.limit)
      const pageOffset = numberOrNull(metadata?.offset)
      if (total === null || pageLimit === null || pageOffset === null || pageOffset + pageLimit >= total) break
      if ((metadata?.RaceTable?.Races?.length ?? 0) === 0) {
        throw new Error('Jolpica pagination ended before all race records were loaded')
      }
      const nextOffset = pageOffset + pageLimit
      if (nextOffset <= offset) throw new Error('Jolpica pagination did not advance')
      offset = nextOffset
    }
    return mergeRacePages(pages)
  }

  private async requestPage(path: string, limit: number, offset: number): Promise<RawJolpicaResponse> {
    const url = new URL(path, `${this.baseUrl}/`)
    url.searchParams.set('limit', String(limit))
    if (offset > 0) url.searchParams.set('offset', String(offset))
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await this.fetchImpl(url, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal: controller.signal
      })
      if (!response.ok) throw new Error(`Jolpica request failed with HTTP ${response.status}`)
      const body: unknown = await response.json()
      if (!body || typeof body !== 'object') throw new Error('Jolpica returned an invalid response')
      return body as RawJolpicaResponse
    } finally {
      clearTimeout(timeout)
    }
  }
}
