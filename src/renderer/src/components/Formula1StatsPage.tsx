import { useEffect, useState } from 'react'
import type { F1StatsDataset, F1StatsDataType } from '../../../shared/f1StatsTypes'

type StatsLoadState = {
  key: string
  dataset: F1StatsDataset | null
  failed: boolean
}

function valueOrDash(value: number | null): string {
  return value === null ? '—' : String(value)
}

function dateOrDash(value: string | null): string {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getDate()} ${date.toLocaleString('en-US', { month: 'short' })} ${date.getFullYear()}`
}

function Formula1StatsPage({ seasons, defaultSeason }: {
  seasons: number[]
  defaultSeason: number | null
}): React.JSX.Element {
  const [dataType, setDataType] = useState<F1StatsDataType>('drivers')
  const [season, setSeason] = useState<number | null>(() => defaultSeason ?? seasons[0] ?? null)
  const [loadState, setLoadState] = useState<StatsLoadState | null>(null)
  const selectedSeason = season ?? seasons[0] ?? null
  const requestKey = selectedSeason === null ? null : `${selectedSeason}:${dataType}`

  useEffect(() => {
    if (selectedSeason === null || requestKey === null) return
    let active = true
    void window.api.getF1Stats(selectedSeason, dataType).then((dataset) => {
      if (active) setLoadState({ key: requestKey, dataset, failed: dataset === null })
    }).catch(() => {
      if (active) setLoadState({ key: requestKey, dataset: null, failed: true })
    })
    return () => { active = false }
  }, [dataType, requestKey, selectedSeason])

  const current = loadState?.key === requestKey ? loadState : null
  const dataset = current?.dataset ?? null
  const unavailable = selectedSeason === null || current?.failed || (dataset?.rows.length === 0)

  return <div className="hub-page stats-page">
    <header className="hub-page-heading"><p>FORMULA 1</p><h1>STATS</h1></header>
    <div className="stats-filters">
      <select aria-label="Data type" value={dataType} onChange={(event) => setDataType(event.target.value as F1StatsDataType)}>
        <option value="drivers">Drivers</option><option value="constructors">Constructors</option><option value="races">Races</option>
      </select>
      <select aria-label="Season" value={selectedSeason ?? ''} onChange={(event) => setSeason(Number(event.target.value))}>
        {seasons.map((year) => <option key={year} value={year}>{year}</option>)}
      </select>
    </div>

    {!current && selectedSeason !== null ? <p className="hub-unavailable">Loading statistics…</p> : null}
    {unavailable && current ? <p className="hub-unavailable">Statistics temporarily unavailable.</p> : null}

    {dataset?.type === 'drivers' && dataset.rows.length > 0 ? <div className="race-list stats-races">
      {dataset.rows.map((driver) => <article className="race-row" key={`${driver.position}:${driver.driverName}`}>
        <div><h3>{driver.position}. {driver.driverName}</h3><p>{driver.constructorName ?? '—'}</p></div>
        <span>{valueOrDash(driver.points)} PTS · {valueOrDash(driver.wins)} WINS</span>
      </article>)}
    </div> : null}

    {dataset?.type === 'constructors' && dataset.rows.length > 0 ? <div className="race-list stats-races">
      {dataset.rows.map((constructor) => <article className="race-row" key={`${constructor.position}:${constructor.constructorName}`}>
        <div><h3>{constructor.position}. {constructor.constructorName}</h3></div>
        <span>{valueOrDash(constructor.points)} PTS · {valueOrDash(constructor.wins)} WINS</span>
      </article>)}
    </div> : null}

    {dataset?.type === 'races' && dataset.rows.length > 0 ? <div className="race-list stats-races">
      {dataset.rows.map((race) => <article className="race-row" key={race.round}>
        <div>
          <h3>{race.round}. {race.raceName}</h3>
          <p>{dateOrDash(race.date)} · Winner: {race.winner ?? '—'} · Pole: {race.polePosition ?? '—'} · Fastest lap: {race.fastestLap ?? '—'}</p>
        </div>
      </article>)}
    </div> : null}
  </div>
}

export default Formula1StatsPage
