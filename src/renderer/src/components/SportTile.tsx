type Sport = 'Formula 1' | 'Football' | 'Tennis' | 'Hockey'
function SportIcon({ sport }: { sport: Sport }): React.JSX.Element {
  if (sport === 'Formula 1') return <div className="f1-logo" aria-label="Formula 1"><span>F</span><b>1</b></div>
  if (sport === 'Football') return <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 7 50 20l-7 24H21l-7-24L32 7Z M14 20l7 24 11 13 11-13 7-24" /></svg>
  if (sport === 'Tennis') return <svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="23" /><path d="M15 16c14 8 20 24 34 32M49 16C35 24 29 40 15 48" /></svg>
  return <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 24h44M17 18v12M47 18v12M22 36l-7 16M42 36l7 16M18 43h28" /></svg>
}
function SportTile({ sport, available = false, onClick }: { sport: Sport; available?: boolean; onClick?: () => void }): React.JSX.Element {
  const content = <><SportIcon sport={sport} /><span className="sport-name">{sport}</span>{!available && <span className="coming-soon">COMING SOON</span>}{available && <span className="tile-arrow" aria-hidden="true">↗</span>}</>
  return available ? <button className="sport-tile sport-tile--available" onClick={onClick} type="button">{content}</button> : <div className="sport-tile sport-tile--disabled">{content}</div>
}
export default SportTile
