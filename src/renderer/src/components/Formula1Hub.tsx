import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  F1HubAlertReplay,
  F1HubData,
  F1HubDriver,
  F1HubPitStop,
  F1HubPosition,
  F1HubRaceControlMessage,
  F1HubRaceState,
  F1HubSession
} from '../../../shared/f1HubTypes'
import type { F1RaceBrief } from '../../../shared/f1RaceBriefTypes'
import {
  ALERT_TYPES,
  FOLLOWED_DRIVER_ALERT_TYPES,
  loadAlertHistory,
  loadAlertPreferences,
  saveAlertHistory,
  saveAlertPreferences,
  type AlertPreferences,
  type RaceAlert,
  type RaceAlertType
} from '../domain/f1HubStore'
import { useF1Data } from '../domain/f1DataContext'
import DemoAction from './DemoAction'
import Formula1StatsPage from './Formula1StatsPage'
import Formula1VocabularyPage from './Formula1VocabularyPage'
import { f1Glossary } from '../domain/f1Glossary'

type HubPage = 'watch' | 'stats' | 'alerts' | 'vocabulary'
type AlertReplayStatus = 'idle' | 'loading' | 'ready' | 'replaying' | 'error'

type AlertReplayCounts = {
  positionChanges: number
  pitStops: number
  raceControl: number
  total: number
}

type AlertReplayPlan = {
  initialState: F1HubRaceState
  frames: F1HubRaceState[]
  counts: AlertReplayCounts
}

type AlertReplayController = {
  selectedSessionKey: number | null
  status: AlertReplayStatus
  plan: AlertReplayPlan | null
  state: F1HubRaceState | null
  drivers: F1HubDriver[]
  selectSession: (sessionKey: number | null) => void
  start: () => void
  stop: () => void
}

function formatSessionName(session: F1HubSession): string {
  if (/grand prix/i.test(session.name)) return session.name
  const place = session.country || session.location
  return place ? `${place} Grand Prix` : session.name
}

function formatDate(value: string, includeTime = true): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date unavailable'
  const datePart = `${date.getDate()} ${date.toLocaleString('en-US', { month: 'short' })} ${date.getFullYear()}`
  if (!includeTime) return datePart
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(date)
  return `${datePart} · ${time}`
}

function eventKey(message: F1HubRaceControlMessage): string {
  return `${message.recordedAt}:${message.category}:${message.driverNumber ?? ''}:${message.message}`
}

function classifyRaceControl(message: F1HubRaceControlMessage): RaceAlertType | null {
  const text = `${message.flag ?? ''} ${message.category} ${message.message}`.toUpperCase()
  if (text.includes('RED FLAG') || message.flag?.toUpperCase() === 'RED') return 'redFlag'
  if (text.includes('SAFETY CAR')) return 'safetyCar'
  if (text.includes('PENALTY')) return 'penalties'
  return null
}

function driverLabel(state: F1HubRaceState, driverNumber: number): string {
  const driver = state.drivers.find((candidate) => candidate.driverNumber === driverNumber)
  return driver?.broadcastName || driver?.fullName || driver?.acronym || `Car ${driverNumber}`
}

function driverAlertLabel(state: F1HubRaceState, driverNumber: number): string | null {
  const driver = state.drivers.find((candidate) => candidate.driverNumber === driverNumber)
  if (!driver) return null
  const broadcastParts = driver.broadcastName.trim().split(/\s+/)
  return (broadcastParts.at(-1) || driver.fullName || driver.acronym).toLocaleUpperCase('en-US')
}

function isValidPosition(position: F1HubPosition): boolean {
  return Number.isInteger(position.driverNumber) && position.driverNumber > 0 &&
    Number.isInteger(position.position) && position.position > 0
}

function positionMap(positions: F1HubPosition[]): Map<number, F1HubPosition> {
  return new Map(positions.filter(isValidPosition).map((position) => [position.driverNumber, position]))
}

function confirmedLeader(
  positions: Map<number, F1HubPosition>,
  previousPositions?: Map<number, F1HubPosition>,
  previousLeader?: number | null
): number | null {
  const leaders = [...positions.values()].filter((position) => position.position === 1)
  if (leaders.length !== 1) return null
  const leader = leaders[0].driverNumber
  if (!previousPositions || !previousLeader || previousLeader === leader) return leader
  const oldLeaderNow = positions.get(previousLeader)?.position
  const newLeaderBefore = previousPositions.get(leader)?.position
  if (!oldLeaderNow || oldLeaderNow === 1 || !newLeaderBefore || newLeaderBefore === 1) return null
  return leader
}

type AlertReplayTimelineEvent =
  | { kind: 'position'; recordedAt: string; value: F1HubPosition }
  | { kind: 'pitStop'; recordedAt: string; value: F1HubPitStop }
  | { kind: 'raceControl'; recordedAt: string; value: F1HubRaceControlMessage }

function replayRaceState(
  replay: F1HubAlertReplay,
  recordedAt: string,
  positions: Map<number, F1HubPosition>,
  pitStops: F1HubPitStop[],
  raceControlMessages: F1HubRaceControlMessage[]
): F1HubRaceState {
  return {
    session: replay.session,
    asOf: recordedAt,
    updatedAt: recordedAt,
    drivers: replay.drivers,
    positions: [...positions.values()].sort((left, right) => left.position - right.position),
    intervals: [],
    laps: [],
    pitStops: [...pitStops],
    raceControlMessages: [...raceControlMessages],
    availability: {
      drivers: replay.drivers.length > 0,
      positions: positions.size > 0,
      intervals: false,
      laps: false,
      pitStops: replay.pitStops.length > 0,
      raceControlMessages: replay.raceControlMessages.length > 0
    }
  }
}

function buildAlertReplayPlan(replay: F1HubAlertReplay): AlertReplayPlan {
  const firstPositionByDriver = new Map<number, F1HubPosition>()
  const timeline: AlertReplayTimelineEvent[] = []
  const realDriverNumbers = new Set(replay.drivers.map((driver) => driver.driverNumber))

  for (const position of replay.positionEvents) {
    if (!isValidPosition(position) || !realDriverNumbers.has(position.driverNumber)) continue
    if (!firstPositionByDriver.has(position.driverNumber)) {
      firstPositionByDriver.set(position.driverNumber, position)
    } else {
      timeline.push({ kind: 'position', recordedAt: position.recordedAt, value: position })
    }
  }
  for (const pitStop of replay.pitStops) {
    timeline.push({ kind: 'pitStop', recordedAt: pitStop.recordedAt, value: pitStop })
  }
  for (const message of replay.raceControlMessages) {
    if (classifyRaceControl(message)) {
      timeline.push({ kind: 'raceControl', recordedAt: message.recordedAt, value: message })
    }
  }
  timeline.sort((left, right) => left.recordedAt.localeCompare(right.recordedAt))

  const positions = new Map(firstPositionByDriver)
  const pitStops: F1HubPitStop[] = []
  const raceControlMessages: F1HubRaceControlMessage[] = []
  const counts: AlertReplayCounts = { positionChanges: 0, pitStops: 0, raceControl: 0, total: 0 }
  const frames: F1HubRaceState[] = []

  for (let index = 0; index < timeline.length;) {
    const recordedAt = timeline[index].recordedAt
    const group: AlertReplayTimelineEvent[] = []
    while (index < timeline.length && timeline[index].recordedAt === recordedAt) {
      group.push(timeline[index])
      index += 1
    }

    const latestPositions = new Map<number, F1HubPosition>()
    for (const event of group) {
      if (event.kind === 'position') latestPositions.set(event.value.driverNumber, event.value)
    }
    let replayable = false
    for (const position of latestPositions.values()) {
      const previous = positions.get(position.driverNumber)
      positions.set(position.driverNumber, position)
      if (!previous || previous.position === position.position ||
        previous.recordedAt === position.recordedAt) continue
      counts.positionChanges += 1
      replayable = true
    }
    for (const event of group) {
      if (event.kind === 'pitStop') {
        pitStops.push(event.value)
        counts.pitStops += 1
        replayable = true
      } else if (event.kind === 'raceControl') {
        raceControlMessages.push(event.value)
        counts.raceControl += 1
        replayable = true
      }
    }
    if (replayable) {
      frames.push(replayRaceState(replay, recordedAt, positions, pitStops, raceControlMessages))
    }
  }

  counts.total = counts.positionChanges + counts.pitStops + counts.raceControl
  return {
    initialState: replayRaceState(
      replay,
      replay.session.startsAt,
      firstPositionByDriver,
      [],
      []
    ),
    frames,
    counts
  }
}

function useAlertReplay(): AlertReplayController {
  const [selectedSessionKey, selectSession] = useState<number | null>(null)
  const [status, setStatus] = useState<AlertReplayStatus>('idle')
  const [plan, setPlan] = useState<AlertReplayPlan | null>(null)
  const [state, setState] = useState<F1HubRaceState | null>(null)
  const [drivers, setDrivers] = useState<F1HubDriver[]>([])
  const [frameIndex, setFrameIndex] = useState(0)

  useEffect(() => {
    if (selectedSessionKey === null) {
      setStatus('idle')
      setPlan(null)
      setState(null)
      setDrivers([])
      return
    }
    let active = true
    setStatus('loading')
    setPlan(null)
    setState(null)
    setDrivers([])
    void window.api.getF1AlertReplay(selectedSessionKey).then((replay) => {
      if (!active) return
      if (!replay) {
        setStatus('error')
        return
      }
      setDrivers(replay.drivers)
      setPlan(buildAlertReplayPlan(replay))
      setStatus('ready')
    }).catch(() => {
      if (active) setStatus('error')
    })
    return () => {
      active = false
      window.api.cancelF1AlertReplay(selectedSessionKey)
    }
  }, [selectedSessionKey])

  useEffect(() => {
    if (status !== 'replaying' || !plan) return
    if (frameIndex >= plan.frames.length) {
      const completionTimer = window.setTimeout(() => setStatus('ready'), 0)
      return () => window.clearTimeout(completionTimer)
    }
    const timer = window.setTimeout(() => {
      setState(plan.frames[frameIndex])
      setFrameIndex(frameIndex + 1)
    }, 2_300)
    return () => window.clearTimeout(timer)
  }, [frameIndex, plan, status])

  const start = (): void => {
    if (!plan || plan.frames.length === 0) return
    setState(plan.initialState)
    setFrameIndex(0)
    setStatus('replaying')
  }
  const stop = (): void => {
    setStatus(plan ? 'ready' : 'idle')
    setState(null)
  }

  return { selectedSessionKey, status, plan, state, drivers, selectSession, start, stop }
}

function useRaceAlerts(
  preferences: AlertPreferences,
  state: F1HubRaceState | null,
  history: RaceAlert[],
  setHistory: React.Dispatch<React.SetStateAction<RaceAlert[]>>
): void {
  const baseline = useRef<{
    sessionKey: number
    raceControl: Set<string>
    pitStops: Set<string>
    positions: Map<number, F1HubPosition>
    leaderPositions: Map<number, F1HubPosition>
    leader: number | null
  } | null>(null)
  const seenAlertIds = useRef(new Set(history.map((alert) => alert.id)))

  useEffect(() => {
    for (const alert of history) seenAlertIds.current.add(alert.id)
  }, [history])

  useEffect(() => {
    if (!preferences.followCurrentRace) {
      baseline.current = null
      return
    }
    if (!state) return

    const raceControl = new Set(state.raceControlMessages.map(eventKey))
    const pitStops = new Set(state.pitStops.map((stop) => (
      `${stop.driverNumber}:${stop.lapNumber}:${stop.recordedAt}`
    )))
    const positions = positionMap(state.positions)
    const previous = baseline.current

    if (!previous || previous.sessionKey !== state.session.sessionKey) {
      baseline.current = {
        sessionKey: state.session.sessionKey,
        raceControl,
        pitStops,
        positions,
        leaderPositions: positions,
        leader: confirmedLeader(positions)
      }
      return
    }

    const updates: RaceAlert[] = []
    const followedDrivers = new Set(preferences.followedDriverNumbers)
    for (const message of state.raceControlMessages) {
      const key = eventKey(message)
      if (previous.raceControl.has(key)) continue
      const type = classifyRaceControl(message)
      if (!type) continue
      const followsDriver = type === 'penalties' && message.driverNumber !== null &&
        followedDrivers.has(message.driverNumber) && preferences.followedDriverEnabled.penalties
      if (!preferences.enabled[type] && !followsDriver) continue
      const label = ALERT_TYPES.find((candidate) => candidate.type === type)?.label ?? 'Race update'
      const driverTitle = message.driverNumber === null
        ? null
        : driverAlertLabel(state, message.driverNumber)
      updates.push({
        id: `${state.session.sessionKey}:control:${key}`,
        type,
        title: followsDriver && driverTitle ? `${driverTitle} PENALTY` : label,
        detail: message.message,
        occurredAt: message.recordedAt,
        sessionKey: state.session.sessionKey,
        ...(message.driverNumber === null ? {} : { driverNumber: message.driverNumber }),
        ...(followsDriver ? { following: true } : {})
      })
    }

    for (const stop of state.pitStops) {
      const key = `${stop.driverNumber}:${stop.lapNumber}:${stop.recordedAt}`
      if (previous.pitStops.has(key)) continue
      const followsDriver = followedDrivers.has(stop.driverNumber) &&
        preferences.followedDriverEnabled.pitStops
      if (!preferences.enabled.pitStops && !followsDriver) continue
      const name = driverLabel(state, stop.driverNumber)
      const driverTitle = driverAlertLabel(state, stop.driverNumber)
      updates.push({
        id: `${state.session.sessionKey}:pit:${key}`,
        type: 'pitStops',
        title: followsDriver && driverTitle ? `${driverTitle} PIT STOP` : 'Pit Stop',
        detail: followsDriver ? `${name} enters the pits.` : `${name} pitted on lap ${stop.lapNumber}.`,
        occurredAt: stop.recordedAt,
        sessionKey: state.session.sessionKey,
        driverNumber: stop.driverNumber,
        ...(followsDriver ? { following: true } : {})
      })
    }

    for (const [driverNumber, position] of positions) {
      const oldPosition = previous.positions.get(driverNumber)
      if (!oldPosition || oldPosition.position === position.position ||
        oldPosition.recordedAt === position.recordedAt) continue
      const followsDriver = followedDrivers.has(driverNumber) &&
        preferences.followedDriverEnabled.positionChanges
      if (!preferences.enabled.positionChanges && !followsDriver) continue
      const driverTitle = driverAlertLabel(state, driverNumber)
      if (!driverTitle) continue
      const delta = oldPosition.position - position.position
      updates.push({
        id: `${state.session.sessionKey}:position:${driverNumber}:${position.recordedAt}`,
        type: 'positionChanges',
        title: `${driverTitle} ${delta > 0 ? '+' : ''}${delta}`,
        detail: `P${oldPosition.position} → P${position.position}`,
        occurredAt: position.recordedAt,
        sessionKey: state.session.sessionKey,
        driverNumber,
        ...(followsDriver ? { following: true } : {})
      })
    }

    const leader = confirmedLeader(positions, previous.leaderPositions, previous.leader)
    if (preferences.enabled.leadChanges && previous.leader && leader && previous.leader !== leader) {
      updates.push({
        id: `${state.session.sessionKey}:leader:${leader}:${state.updatedAt}`,
        type: 'leadChanges',
        title: 'Lead Change',
        detail: `${driverLabel(state, leader)} moved into the lead.`,
        occurredAt: state.updatedAt,
        sessionKey: state.session.sessionKey
      })
    }

    baseline.current = {
      sessionKey: state.session.sessionKey,
      raceControl,
      pitStops,
      positions,
      leaderPositions: leader ? positions : previous.leaderPositions,
      leader: leader ?? previous.leader
    }
    if (updates.length > 0) {
      const freshUpdates = updates.filter((alert) => !seenAlertIds.current.has(alert.id))
      if (freshUpdates.length === 0) return
      for (const alert of freshUpdates) {
        seenAlertIds.current.add(alert.id)
        window.api.showRaceAlert({ type: alert.type, title: alert.title, body: alert.detail })
      }
      setHistory((current) => {
        const next = [...freshUpdates, ...current].slice(0, 100)
        saveAlertHistory(next)
        return next
      })
    }
  }, [preferences, setHistory, state])
}

function HubSidebar({ page, onBack, onNavigate }: {
  page: HubPage
  onBack: () => void
  onNavigate: (page: HubPage) => void
}): React.JSX.Element {
  return <aside className="f1-hub-sidebar">
    <div>
      <button className="hub-back" onClick={onBack} type="button" aria-label="Back to sports">←</button>
      <div className="hub-brand"><span className="brand-mark" /><span>ROOKIE</span></div>
      <p>FORMULA 1</p>
    </div>
    <nav aria-label="Formula 1">
      {(['watch', 'stats', 'alerts', 'vocabulary'] as HubPage[]).map((item) => (
        <button className={page === item ? 'is-active' : ''} key={item} onClick={() => onNavigate(item)} type="button">
          {item.toUpperCase()}
        </button>
      ))}
    </nav>
  </aside>
}

function UnavailableState({ message }: { message: string }): React.JSX.Element {
  return <p className="hub-unavailable">{message}</p>
}

function formatDateRange(sessions: F1HubSession[]): string | null {
  if (sessions.length === 0) return null
  const first = sessions[0]
  const last = sessions.at(-1) ?? first
  const firstDate = new Date(first.startsAt)
  const lastDate = new Date(last.endsAt)
  if (Number.isNaN(firstDate.getTime()) || Number.isNaN(lastDate.getTime())) return null
  if (firstDate.toDateString() === lastDate.toDateString()) return formatDate(first.startsAt, false)
  if (firstDate.getFullYear() === lastDate.getFullYear() && firstDate.getMonth() === lastDate.getMonth()) {
    const monthAndYear = `${lastDate.toLocaleString('en-US', { month: 'short' })} ${lastDate.getFullYear()}`
    return `${firstDate.getDate()}–${lastDate.getDate()} ${monthAndYear}`
  }
  return `${formatDate(first.startsAt, false)} – ${formatDate(last.endsAt, false)}`
}

function liveMetadata(state: F1HubRaceState | null): string | null {
  if (!state) return null
  const lap = state.laps.reduce((latest, candidate) => Math.max(latest, candidate.lapNumber), 0)
  const leader = state.positions.find((position) => position.position === 1)
  const leaderName = leader ? driverLabel(state, leader.driverNumber) : null
  if (lap && leaderName) return `Lap ${lap} · ${leaderName} leads`
  if (lap) return `Lap ${lap}`
  return leaderName ? `${leaderName} leads` : null
}

function BriefUnavailable({ loading }: { loading: boolean }): React.JSX.Element {
  return <p className="hub-unavailable">{loading ? 'Preparing Rookie brief…' : 'Brief temporarily unavailable.'}</p>
}

function WatchPage({ data, brief, briefLoading, loading, unavailable, preferences, setPreferences, onOpenVocabulary }: {
  data: F1HubData
  brief: F1RaceBrief | null
  briefLoading: boolean
  loading: boolean
  unavailable: boolean
  preferences: AlertPreferences
  setPreferences: React.Dispatch<React.SetStateAction<AlertPreferences>>
  onOpenVocabulary: (term: string) => void
}): React.JSX.Element {
  const current = data.currentOrNext
  const isLive = !unavailable && current?.status === 'live'
  const showLoading = !isLive && loading
  const showUnavailable = !isLive && !loading && (unavailable || !current)
  const isSeasonFallback = !showLoading && !showUnavailable && current?.status === 'completed'
  const glossaryTerms = f1Glossary
    .filter((term) => ['OVERTAKE MODE', 'SLIPSTREAM', 'PIT STOP', 'LOCK-UP'].includes(term.canonicalTerm))
    .map((term) => term.canonicalTerm)
  const updateFollow = (): void => {
    const next = { ...preferences, followCurrentRace: !preferences.followCurrentRace }
    saveAlertPreferences(next)
    setPreferences(next)
  }

  return <div className="hub-page watch-page">
    <header className="hub-page-heading"><p>FORMULA 1</p><h1>WATCH WITH ROOKIE</h1></header>
    <section className="watch-hero">
      <p>{isLive ? 'LIVE NOW' : isSeasonFallback ? 'LATEST GRAND PRIX' : 'NEXT GRAND PRIX'}</p>
      {showLoading ? <>
        <h2>Loading next race…</h2>
        <span>Checking the current season schedule.</span>
      </> : showUnavailable ? <UnavailableState message="Upcoming race data temporarily unavailable." /> : current ? <>
        <h2>{formatSessionName(current)}</h2>
        <span>{isLive
          ? [current.type || current.name, liveMetadata(data.raceState)].filter(Boolean).join(' · ')
          : [current.circuit || null, formatDateRange(data.currentWeekendSessions)].filter(Boolean).join(' · ')}</span>
        <div className="watch-actions">
          {isLive ? <button onClick={() => window.api.startRookieMode()} type="button">WATCH WITH ROOKIE</button> : null}
          <DemoAction primary={!isLive} />
          <button className={preferences.followCurrentRace ? 'is-selected secondary-action' : 'secondary-action'} onClick={updateFollow} type="button">
            {preferences.followCurrentRace ? 'FOLLOWING THIS RACE' : 'FOLLOW THIS RACE'}
          </button>
        </div>
      </> : null}
      {showLoading || showUnavailable ? <DemoAction primary /> : null}
    </section>
    <section className="hub-section">
      <h2>ROOKIE BRIEF</h2>
      <div className="rookie-brief">
        <article><h3>WHY THIS RACE MATTERS</h3>{brief?.whyThisRaceMatters ? <p className="brief-copy">{brief.whyThisRaceMatters}</p> : <BriefUnavailable loading={briefLoading} />}</article>
        <article><h3>WHAT TO WATCH</h3>{brief?.whatToWatch.length ? <ol className="brief-list">{brief.whatToWatch.map((item) => <li key={item}>{item}</li>)}</ol> : <BriefUnavailable loading={briefLoading} />}</article>
        <article><h3>DRIVERS TO WATCH</h3>{brief?.driversToWatch.length ? <ul className="brief-drivers">{brief.driversToWatch.map((driver) => <li key={driver.driver}><strong>{driver.driver}</strong><span>{driver.reason}</span></li>)}</ul> : <BriefUnavailable loading={briefLoading} />}</article>
        <article><h3>TERMS YOU'LL PROBABLY HEAR</h3><ul className="brief-terms">{glossaryTerms.map((term) => <li key={term}><button onClick={() => onOpenVocabulary(term)} type="button">{term}</button></li>)}</ul></article>
      </div>
    </section>
  </div>
}

function AlertsPage({ preferences, setPreferences, history, clearHistory, drivers, completedRaces, replay, currentSession }: {
  preferences: AlertPreferences
  setPreferences: React.Dispatch<React.SetStateAction<AlertPreferences>>
  history: RaceAlert[]
  clearHistory: () => void
  drivers: F1HubDriver[]
  completedRaces: F1HubSession[]
  replay: AlertReplayController
  currentSession: F1HubSession | null
}): React.JSX.Element {
  const [driverDirectory, setDriverDirectory] = useState<F1HubDriver[]>([])
  const replayDrivers = replay.drivers
  const suppliedDrivers = replayDrivers.length > 0 ? replayDrivers : drivers

  useEffect(() => {
    if (suppliedDrivers.length > 0 || driverDirectory.length > 0) return
    let active = true
    void window.api.getF1DriverDirectory().then((directory) => {
      if (active) setDriverDirectory(directory)
    }).catch(() => {
      if (active) setDriverDirectory([])
    })
    return () => { active = false }
  }, [driverDirectory.length, suppliedDrivers.length])

  const availableDriverSource = [...suppliedDrivers, ...driverDirectory]
  const uniqueDrivers = [...new Map(availableDriverSource.map((driver) => [driver.driverNumber, driver])).values()]
  const updatePreferences = (next: AlertPreferences): void => {
    saveAlertPreferences(next)
    setPreferences(next)
  }
  const driversByNumber = new Map(uniqueDrivers.map((driver) => [driver.driverNumber, driver]))
  const availableDrivers = uniqueDrivers
    .filter((driver) => !preferences.followedDriverNumbers.includes(driver.driverNumber))
    .toSorted((left, right) => left.fullName.localeCompare(right.fullName))
  const addDriver = (driverNumber: number): void => {
    if (!Number.isInteger(driverNumber) || preferences.followedDriverNumbers.includes(driverNumber)) return
    updatePreferences({
      ...preferences,
      followedDriverNumbers: [...preferences.followedDriverNumbers, driverNumber]
    })
  }
  const removeDriver = (driverNumber: number): void => {
    updatePreferences({
      ...preferences,
      followedDriverNumbers: preferences.followedDriverNumbers.filter((value) => value !== driverNumber)
    })
  }

  return <div className="hub-page alerts-page">
    <header className="hub-page-heading"><p>FORMULA 1</p><h1>ALERTS</h1></header>
    {currentSession ? <p className="alert-race-context">{formatSessionName(currentSession)} · {currentSession.status === 'live' ? 'Live now' : formatDate(currentSession.startsAt, false)}</p> : null}
    <section className="alert-controls">
      <label className="follow-race"><input checked={preferences.followCurrentRace} onChange={(event) => updatePreferences({ ...preferences, followCurrentRace: event.target.checked })} type="checkbox" /><span>FOLLOW THIS RACE</span></label>
      <div className="alert-control-group">
        <h2>RACE ALERTS</h2>
        <div className="alert-options">
        {ALERT_TYPES.map(({ type, label }) => <label key={type}><input checked={preferences.enabled[type]} onChange={(event) => updatePreferences({ ...preferences, enabled: { ...preferences.enabled, [type]: event.target.checked } })} type="checkbox" /><span>{label}</span></label>)}
        </div>
      </div>
      <div className="followed-drivers">
        <div className="followed-drivers-heading">
          <h2>DRIVERS TO FOLLOW</h2>
          <select
            aria-label="Add driver to follow"
            disabled={availableDrivers.length === 0}
            onChange={(event) => {
              addDriver(Number(event.target.value))
              event.target.value = ''
            }}
            defaultValue=""
          >
            <option value="">+ ADD DRIVER</option>
            {availableDrivers.map((driver) => (
              <option key={driver.driverNumber} value={driver.driverNumber}>{driver.fullName}</option>
            ))}
          </select>
        </div>
        {preferences.followedDriverNumbers.length > 0 ? <div className="followed-driver-list">
          {preferences.followedDriverNumbers.map((driverNumber) => {
            const driver = driversByNumber.get(driverNumber)
            return <div key={driverNumber}>
              <span>{driver?.fullName || `Driver ${driverNumber}`}</span>
              <button aria-label={`Stop following ${driver?.fullName || `driver ${driverNumber}`}`} onClick={() => removeDriver(driverNumber)} type="button">×</button>
            </div>
          })}
        </div> : <p className="followed-drivers-empty">No drivers selected</p>}
        <h3>FOR FOLLOWED DRIVERS</h3>
        <div className="followed-alert-options">
          {FOLLOWED_DRIVER_ALERT_TYPES.map(({ type, label }) => <label key={type}>
            <input
              checked={preferences.followedDriverEnabled[type]}
              onChange={(event) => updatePreferences({
                ...preferences,
                followedDriverEnabled: {
                  ...preferences.followedDriverEnabled,
                  [type]: event.target.checked
                }
              })}
              type="checkbox"
            />
            <span>{label}</span>
          </label>)}
        </div>
      </div>
    </section>
    <section className="hub-section alert-history">
      <div className="alert-history-heading">
        <h2>RECENT UPDATES</h2>
        {history.length > 0 ? <button onClick={clearHistory} type="button">Clear</button> : null}
      </div>
      <div className="alert-history-list">
        {history.length > 0 ? history.map((alert) => <article key={alert.id}>
          <div><strong>{alert.title}{alert.following ? <span className="following-tag">FOLLOWING</span> : null}</strong><time>{formatDate(alert.occurredAt)}</time></div><p>{alert.detail}</p>
        </article>) : <p className="hub-unavailable">No race updates yet.</p>}
      </div>
    </section>
    <section className="hub-section alert-replay">
      <h2>TRY ALERTS DEMO</h2>
      <div className="alert-replay-panel">
        <div className="alert-replay-controls">
          <select
            aria-label="Completed race"
            disabled={replay.status === 'replaying'}
            onChange={(event) => replay.selectSession(event.target.value ? Number(event.target.value) : null)}
            value={replay.selectedSessionKey ?? ''}
          >
            <option value="">Completed race</option>
            {completedRaces.map((race) => (
              <option key={race.sessionKey} value={race.sessionKey}>
                {formatSessionName(race)} · {race.year}
              </option>
            ))}
          </select>
          {replay.status === 'replaying'
            ? <button className="stop-replay" onClick={replay.stop} type="button">STOP REPLAY</button>
            : <button
              disabled={!replay.plan || replay.plan.frames.length === 0 || replay.status === 'loading'}
              onClick={replay.start}
              type="button"
            >REPLAY ALERTS</button>}
        </div>
        <p className="alert-replay-source">Real historical OpenF1 data</p>
        {replay.status === 'loading' ? <p className="alert-replay-status">Loading historical race data…</p> : null}
        {replay.status === 'error' ? <p className="alert-replay-error">Historical race data temporarily unavailable.</p> : null}
        {replay.plan ? <div className="alert-replay-summary">
          <strong>{formatSessionName(replay.plan.initialState.session)} · {replay.plan.initialState.session.year}</strong>
          <span>{replay.plan.counts.total} replayable events</span>
          <small>
            Position changes · {replay.plan.counts.positionChanges}
            {' · '}Pit stops · {replay.plan.counts.pitStops}
            {' · '}Race control · {replay.plan.counts.raceControl}
          </small>
        </div> : null}
      </div>
    </section>
  </div>
}

function Formula1Hub({ onBack }: { onBack: () => void }): React.JSX.Element {
  const [page, setPage] = useState<HubPage>('watch')
  const [selectedVocabularyTerm, setSelectedVocabularyTerm] = useState<string | null>(null)
  const { data, driverStandings, loading, availabilityMessage } = useF1Data()
  const [preferences, setPreferences] = useState<AlertPreferences>(() => loadAlertPreferences())
  const [history, setHistory] = useState<RaceAlert[]>(() => loadAlertHistory())
  const [raceBrief, setRaceBrief] = useState<F1RaceBrief | null>(null)
  const [raceBriefLoading, setRaceBriefLoading] = useState(false)
  const alertReplay = useAlertReplay()
  const replayPreferences = useMemo<AlertPreferences>(() => ({
    ...preferences,
    followCurrentRace: alertReplay.status === 'replaying'
  }), [alertReplay.status, preferences])
  const completedRaces = useMemo(() => data.races
    .filter((race) => race.status === 'completed')
    .toSorted((left, right) => Date.parse(right.startsAt) - Date.parse(left.startsAt)), [data.races])
  const clearHistory = (): void => {
    setHistory([])
    saveAlertHistory([])
  }
  const openVocabulary = (term: string): void => {
    setSelectedVocabularyTerm(term)
    setPage('vocabulary')
  }
  useRaceAlerts(preferences, data.raceState, history, setHistory)
  useRaceAlerts(replayPreferences, alertReplay.state, history, setHistory)
  const briefSourceVersion = [
    data.currentOrNext?.meetingKey,
    data.currentOrNext?.status,
    ...data.currentWeekendSessions.map((session) => `${session.sessionKey}:${session.startsAt}`),
    ...((driverStandings ?? []).slice(0, 4).map((driver) => `${driver.position}:${driver.points}:${driver.wins}`))
  ].join('|')

  useEffect(() => {
    const alertsActive = preferences.followCurrentRace
    window.api.setF1LiveDataNeeds({
      positions: page === 'watch' || alertsActive,
      intervals: false,
      laps: page === 'watch',
      pitStops: alertsActive,
      raceControlMessages: alertsActive
    })
    return () => window.api.setF1LiveDataNeeds({
      positions: false,
      intervals: false,
      laps: false,
      pitStops: false,
      raceControlMessages: false
    })
  }, [page, preferences.followCurrentRace])

  useEffect(() => {
    if (!data.currentOrNext) return
    let active = true
    setRaceBrief(null)
    setRaceBriefLoading(true)
    void window.api.getRaceBrief().then((brief) => {
      if (active) setRaceBrief(brief)
    }).catch(() => {
      if (active) setRaceBrief(null)
    }).finally(() => {
      if (active) setRaceBriefLoading(false)
    })
    return () => { active = false }
  }, [briefSourceVersion])

  return <main className="f1-hub-shell">
    <HubSidebar page={page} onBack={onBack} onNavigate={setPage} />
    <section className="f1-hub-main">
      {availabilityMessage && page !== 'watch' && page !== 'vocabulary' ? <p className="hub-data-notice" role="status">{availabilityMessage}</p> : null}
      {page === 'watch' ? <WatchPage
        brief={raceBrief}
        briefLoading={raceBriefLoading}
        data={data}
        loading={loading}
        preferences={preferences}
        setPreferences={setPreferences}
        unavailable={availabilityMessage !== null}
        onOpenVocabulary={openVocabulary}
      /> : page === 'vocabulary' ? <Formula1VocabularyPage
        onSelectTerm={setSelectedVocabularyTerm}
        selectedTerm={selectedVocabularyTerm}
      /> : loading ? <p className="hub-loading">Loading race data…</p> : <>
        {page === 'stats' && <Formula1StatsPage defaultSeason={data.currentOrNext?.year ?? null} seasons={data.seasons} />}
        {page === 'alerts' && <AlertsPage
          clearHistory={clearHistory}
          completedRaces={completedRaces}
          currentSession={data.currentOrNext}
          drivers={data.raceState?.drivers ?? []}
          history={history}
          preferences={preferences}
          replay={alertReplay}
          setPreferences={setPreferences}
        />}
      </>}
    </section>
  </main>
}

export default Formula1Hub
