import type { F1HubSession } from '../../../shared/f1HubTypes'

export type RaceAlertType =
  | 'safetyCar'
  | 'redFlag'
  | 'pitStops'
  | 'penalties'
  | 'leadChanges'
  | 'positionChanges'

export type RaceAlert = {
  id: string
  type: RaceAlertType
  title: string
  detail: string
  occurredAt: string
  sessionKey: number
  driverNumber?: number
  following?: boolean
}

export type FollowedDriverAlertType = 'positionChanges' | 'pitStops' | 'penalties'

export type AlertPreferences = {
  followCurrentRace: boolean
  enabled: Record<RaceAlertType, boolean>
  followedDriverNumbers: number[]
  followedDriverEnabled: Record<FollowedDriverAlertType, boolean>
}

export const ALERT_TYPES: Array<{ type: RaceAlertType; label: string }> = [
  { type: 'safetyCar', label: 'Safety Car' },
  { type: 'redFlag', label: 'Red Flag' },
  { type: 'pitStops', label: 'Pit Stops' },
  { type: 'penalties', label: 'Penalties' },
  { type: 'leadChanges', label: 'Lead Changes' },
  { type: 'positionChanges', label: 'Position Changes' }
]

export const FOLLOWED_DRIVER_ALERT_TYPES: Array<{
  type: FollowedDriverAlertType
  label: string
}> = [
  { type: 'positionChanges', label: 'Position changes' },
  { type: 'pitStops', label: 'Pit stops' },
  { type: 'penalties', label: 'Penalties' }
]

const HISTORY_KEY = 'rookie:f1-alert-history:v1'
const PREFERENCES_KEY = 'rookie:f1-alert-preferences:v1'
const HISTORICAL_CONTEXT_KEY = 'rookie:f1-historical-context:v1'
const DEFAULT_PREFERENCES: AlertPreferences = {
  followCurrentRace: false,
  enabled: {
    safetyCar: false,
    redFlag: false,
    pitStops: false,
    penalties: false,
    leadChanges: false,
    positionChanges: false
  },
  followedDriverNumbers: [],
  followedDriverEnabled: {
    positionChanges: true,
    pitStops: true,
    penalties: true
  }
}

function readJson(key: string): unknown {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Persistence is optional; keep the in-memory UI usable if storage is blocked.
  }
}

export function loadAlertPreferences(): AlertPreferences {
  const stored = readJson(PREFERENCES_KEY)
  if (!stored || typeof stored !== 'object') return DEFAULT_PREFERENCES
  const value = stored as Partial<AlertPreferences>
  const enabled = value.enabled && typeof value.enabled === 'object' ? value.enabled : {}
  const followedDriverEnabled = value.followedDriverEnabled && typeof value.followedDriverEnabled === 'object'
    ? value.followedDriverEnabled
    : {}
  const followedDriverNumbers = Array.isArray(value.followedDriverNumbers)
    ? [...new Set(value.followedDriverNumbers.filter((driverNumber): driverNumber is number => (
      typeof driverNumber === 'number' && Number.isInteger(driverNumber) && driverNumber > 0
    )))]
    : []
  return {
    followCurrentRace: value.followCurrentRace === true,
    enabled: Object.fromEntries(ALERT_TYPES.map(({ type }) => [type, enabled[type] === true])) as Record<
      RaceAlertType,
      boolean
    >,
    followedDriverNumbers,
    followedDriverEnabled: Object.fromEntries(FOLLOWED_DRIVER_ALERT_TYPES.map(({ type }) => [
      type,
      followedDriverEnabled[type] !== false
    ])) as Record<FollowedDriverAlertType, boolean>
  }
}

export function saveAlertPreferences(preferences: AlertPreferences): void {
  writeJson(PREFERENCES_KEY, preferences)
}

export function loadAlertHistory(): RaceAlert[] {
  const stored = readJson(HISTORY_KEY)
  if (!Array.isArray(stored)) return []
  return stored.filter((value): value is RaceAlert => {
    if (!value || typeof value !== 'object') return false
    const item = value as Partial<RaceAlert>
    return typeof item.id === 'string' && typeof item.type === 'string' &&
      typeof item.title === 'string' && typeof item.detail === 'string' &&
      typeof item.occurredAt === 'string' && typeof item.sessionKey === 'number'
  }).slice(0, 100)
}

export function saveAlertHistory(history: RaceAlert[]): void {
  writeJson(HISTORY_KEY, history.slice(0, 100))
}

export function loadHistoricalContext(): F1HubSession | null {
  const stored = readJson(HISTORICAL_CONTEXT_KEY)
  if (!stored || typeof stored !== 'object') return null
  const value = stored as Partial<F1HubSession>
  return typeof value.sessionKey === 'number' && typeof value.name === 'string'
    ? value as F1HubSession
    : null
}

export function saveHistoricalContext(session: F1HubSession): void {
  writeJson(HISTORICAL_CONTEXT_KEY, session)
}
