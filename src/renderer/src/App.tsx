import OverlayApp from './components/OverlayApp'
import HomeScreen from './components/HomeScreen'
import { F1DataProvider } from './domain/f1Data'

function App(): React.JSX.Element {
  const isOverlay = new URLSearchParams(window.location.search).has('overlay')
  return isOverlay ? <OverlayApp /> : <F1DataProvider><HomeScreen /></F1DataProvider>
}

export default App
