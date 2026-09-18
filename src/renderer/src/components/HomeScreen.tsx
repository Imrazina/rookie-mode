import { useState } from 'react'
import Formula1EntryScreen from './Formula1EntryScreen'
import Formula1Hub from './Formula1Hub'
import SportTile from './SportTile'

type Screen = 'home' | 'f1-entry' | 'f1-hub'

function HomeScreen(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>('home')
  if (screen === 'f1-entry') return <Formula1EntryScreen onBack={() => setScreen('home')} onOpenHub={() => setScreen('f1-hub')} />
  if (screen === 'f1-hub') return <Formula1Hub onBack={() => setScreen('f1-entry')} />
  return <main className="control-screen"><header className="control-brand"><span className="brand-mark" /> ROOKIE</header><section className="profile-selection"><p className="control-tagline">Sports, translated.</p><h1>What are you watching?</h1><div className="sport-profiles"><SportTile sport="Formula 1" available onClick={() => setScreen('f1-entry')} /><SportTile sport="Football" /><SportTile sport="Tennis" /><SportTile sport="Hockey" /></div></section></main>
}
export default HomeScreen
