import { createContext, useContext } from 'react'
import type { F1HubData } from '../../../shared/f1HubTypes'
import type { F1DriverStanding } from '../../../shared/f1StatsTypes'

export const EMPTY_F1_DATA: F1HubData = {
  currentSession: null,
  nextSession: null,
  currentOrNext: null,
  latestCompletedRace: null,
  recentRaces: [],
  races: [],
  currentWeekendSessions: [],
  seasons: [],
  raceState: null,
  dataUnavailable: false,
  lastSuccessfulUpdate: null
}

export type F1DataValue = {
  data: F1HubData
  loading: boolean
  availabilityMessage: string | null
  demoConfigured: boolean
  driverStandings: F1DriverStanding[] | null
}

export const F1DataContext = createContext<F1DataValue | null>(null)

export function useF1Data(): F1DataValue {
  const context = useContext(F1DataContext)
  if (!context) throw new Error('useF1Data must be used inside F1DataProvider')
  return context
}
