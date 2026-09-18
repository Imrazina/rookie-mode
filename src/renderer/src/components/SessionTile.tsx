import type { DemoSession } from '../demo/sessionDemo'
function SessionTile({ session }: { session: DemoSession }): React.JSX.Element {
  return <article className="session-tile"><div className="live-label"><span /> {session.status}</div><div className="session-copy"><p>{session.event}</p><h2>{session.name}</h2><span>{session.detail}</span></div><button onClick={() => window.api.startRookieMode()} type="button">{session.action} <span>↗</span></button></article>
}
export default SessionTile
