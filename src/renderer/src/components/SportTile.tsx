import f1Logo from '../../../../resources/F1-logo.png'
import footballIcon from '../../../../resources/footballsoccer-ball-icon-transparent.png'
import hockeyIcon from '../../../../resources/hockey.png'

type Sport = 'Formula 1' | 'Football' | 'Hockey'

const sportIcons: Record<Sport, string> = {
  'Formula 1': f1Logo,
  Football: footballIcon,
  Hockey: hockeyIcon
}

function SportIcon({ sport }: { sport: Sport }): React.JSX.Element {
  return <img alt="" aria-hidden="true" className={`sport-icon sport-icon--${sport.toLowerCase().replace(/\s+/g, '-')}`} src={sportIcons[sport]} />
}
function SportTile({ sport, available = false, onClick }: { sport: Sport; available?: boolean; onClick?: () => void }): React.JSX.Element {
  const content = <><SportIcon sport={sport} /><span className="sport-name">{sport}</span>{!available && <span className="coming-soon">COMING SOON</span>}{available && <span className="tile-arrow" aria-hidden="true">↗</span>}</>
  return available ? <button className="sport-tile sport-tile--available" onClick={onClick} type="button">{content}</button> : <div className="sport-tile sport-tile--disabled">{content}</div>
}
export default SportTile
