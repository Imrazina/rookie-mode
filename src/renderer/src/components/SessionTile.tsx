import type { F1HubRaceState, F1HubSession } from '../../../shared/f1HubTypes'
import DemoAction from './DemoAction'

function sessionTitle(session: F1HubSession): string {
  if (/grand prix/i.test(session.name)) return session.name
  const place = session.country || session.location
  return place ? `${place} Grand Prix` : session.name
}

function sessionDetail(session: F1HubSession, raceState: F1HubRaceState | null): string {
  if (session.status === 'live') {
    const latestLap = raceState?.session.sessionKey === session.sessionKey && raceState.availability.laps
      ? Math.max(0, ...raceState.laps.map((lap) => lap.lapNumber))
      : 0
    return latestLap > 0 ? `Lap ${latestLap}` : 'In progress'
  }

  const startsAt = new Date(session.startsAt)
  if (Number.isNaN(startsAt.getTime())) return 'Schedule unavailable'
  const datePart = `${startsAt.getDate()} ${startsAt.toLocaleString('en-US', { month: 'short' })} ${startsAt.getFullYear()}`
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(startsAt)
  return `${datePart} · ${time}`
}

function SessionTile({ session, raceState, loading, unavailable }: {
  session: F1HubSession | null
  raceState: F1HubRaceState | null
  loading: boolean
  unavailable: boolean
}): React.JSX.Element {
  const isLive = !unavailable && session?.status === 'live'
  const showLoading = !isLive && loading
  const showUnavailable = !isLive && !loading && (unavailable || !session)
  return <article className="session-tile">
    <div className="live-label"><span /> {isLive ? 'LIVE NOW' : 'NEXT GRAND PRIX'}</div>
    <div className="session-copy">
      <p>{session?.type || 'Formula 1'}</p>
      <h2>{showLoading ? 'Loading next race…' : showUnavailable ? 'Upcoming race data temporarily unavailable.' : sessionTitle(session!)}</h2>
      <span>{showLoading
        ? 'Checking the current season schedule.'
        : showUnavailable
          ? 'Rookie will retry automatically.'
          : sessionDetail(session!, raceState)}</span>
    </div>
    <div className="session-actions">
      {isLive ? (
        <>
          <button onClick={() => window.api.startRookieMode()} type="button">WATCH WITH ROOKIE <span>↗</span></button>
          <DemoAction />
        </>
      ) : <DemoAction primary />}
    </div>
  </article>
}

export default SessionTile
