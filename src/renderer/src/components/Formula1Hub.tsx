function Formula1Hub({ onBack }: { onBack: () => void }): React.JSX.Element {
  return <main className="control-screen hub-screen"><header className="control-brand"><button className="back-button" onClick={onBack} type="button">←</button><span className="brand-mark" /> ROOKIE</header><section className="hub-content"><div className="f1-logo"><span>F</span><b>1</b></div><p>F1 HUB</p><h1>Coming into focus.</h1><span>Alerts, live timing and Rookie settings will live here.</span></section></main>
}
export default Formula1Hub
