import { useEffect, useState } from 'react'
import type { F1HubData } from '../../../shared/f1HubTypes'
import type { F1DriverStanding } from '../../../shared/f1StatsTypes'
import { EMPTY_F1_DATA, F1DataContext } from './f1DataContext'

const REFRESH_INTERVAL_MS = 5_000

export function F1DataProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [data, setData] = useState<F1HubData>(EMPTY_F1_DATA)
  const [loading, setLoading] = useState(true)
  const [requestFailed, setRequestFailed] = useState(false)
  const [demoConfigured, setDemoConfigured] = useState(false)
  const [driverStandings, setDriverStandings] = useState<F1DriverStanding[] | null>(null)

  useEffect(() => {
    let active = true
    let timer: number | null = null

    const refresh = async (): Promise<void> => {
      try {
        const next = await window.api.getF1HubData()
        if (!active) return
        if (next) {
          setData(next)
          setRequestFailed(false)
        } else {
          setRequestFailed(true)
        }
      } catch {
        if (active) setRequestFailed(true)
      } finally {
        if (active) {
          setLoading(false)
          timer = window.setTimeout(() => { void refresh() }, REFRESH_INTERVAL_MS)
        }
      }
    }

    void Promise.all([
      refresh(),
      window.api.getDemoConfiguration().then((configuration) => {
        if (active) setDemoConfigured(configuration.configured)
      }).catch(() => undefined)
    ])

    return () => {
      active = false
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [])

  const season = data.currentOrNext?.year ?? data.seasons[0] ?? null
  useEffect(() => {
    if (season === null) return
    let active = true
    void window.api.getF1Stats(season, 'drivers').then((dataset) => {
      if (active) setDriverStandings(dataset?.type === 'drivers' ? dataset.rows : null)
    }).catch(() => {
      if (active) setDriverStandings(null)
    })
    return () => { active = false }
  }, [season])

  const availabilityMessage = requestFailed || data.dataUnavailable
    ? 'Live data temporarily unavailable. Rookie will retry automatically.'
    : null

  return <F1DataContext value={{ data, loading, availabilityMessage, demoConfigured, driverStandings }}>
    {children}
  </F1DataContext>
}
