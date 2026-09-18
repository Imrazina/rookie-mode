import OverlayApp from './components/OverlayApp'
import HomeScreen from './components/HomeScreen'

function App(): React.JSX.Element {
  const isOverlay = new URLSearchParams(window.location.search).has('overlay')
  return isOverlay ? <OverlayApp /> : <HomeScreen />
}

export default App
