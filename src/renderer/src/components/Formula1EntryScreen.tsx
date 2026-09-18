import { liveSession } from '../demo/sessionDemo'
import SessionTile from './SessionTile'
function Formula1EntryScreen({ onBack, onOpenHub }: { onBack: () => void; onOpenHub: () => void }): React.JSX.Element {
  return <main className="control-screen f1-entry"><header className="control-brand"><button className="back-button" onClick={onBack} type="button">←</button><span className="brand-mark" /> ROOKIE</header><section className="f1-choice"><div className="f1-heading"><div className="f1-logo"><span>F</span><b>1</b></div><h1>Formula 1</h1></div><div className="mode-tiles"><SessionTile session={liveSession} /><button className="hub-tile" onClick={onOpenHub} type="button"><span>F1 HUB</span><h2>Everything else,<br />when you need it.</h2><ul><li>Alerts</li><li>Live timing &amp; stats</li><li>Rookie settings</li></ul><span className="tile-arrow">↗</span></button></div></section></main>
}
export default Formula1EntryScreen
