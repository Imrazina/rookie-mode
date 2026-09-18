const comingLater = ['Football', 'Tennis', 'Hockey']
function SportSelector(): React.JSX.Element {
  return <section className="selector-section"><h2>What are you watching?</h2><div className="sport-list"><div className="sport-row sport-row--active"><span className="sport-indicator" /><strong>Formula 1</strong><span className="active-label">Ready now</span></div>{comingLater.map((sport) => <div className="sport-row sport-row--disabled" key={sport}><span className="sport-indicator" /><span>{sport}</span><span>Coming later</span></div>)}</div></section>
}
export default SportSelector
