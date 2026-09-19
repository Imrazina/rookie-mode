import { useEffect, useState } from 'react'
import Formula1EntryScreen from './Formula1EntryScreen'
import Formula1Hub from './Formula1Hub'
import SportTile from './SportTile'

type Screen = 'home' | 'f1-entry' | 'f1-hub'

function HomeScreen(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>('home')
  const [captureError, setCaptureError] = useState<string | null>(null)

  useEffect(() => window.api.onCaptureError((message) => {
    setCaptureError(message)
    window.setTimeout(() => setCaptureError(null), 6_000)
  }), [])

  let content: React.JSX.Element
  if (screen === 'f1-entry') content = <Formula1EntryScreen onBack={() => setScreen('home')} onOpenHub={() => setScreen('f1-hub')} />
  else if (screen === 'f1-hub') content = <Formula1Hub onBack={() => setScreen('f1-entry')} />
  else content = <main className="control-screen"><header className="control-brand"><span className="brand-mark" /> ROOKIE</header><section className="profile-selection"><p className="control-tagline">Sports, translated.</p><h1>What are you watching?</h1><div className="sport-profiles"><SportTile sport="Formula 1" available onClick={() => setScreen('f1-entry')} /><SportTile sport="Football" /><SportTile sport="Hockey" /></div></section></main>

  return <>{content}{captureError ? <p className="capture-error" role="alert">{captureError}</p> : null}</>
}
export default HomeScreen
