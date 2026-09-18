import { useEffect, useState } from 'react'
import ExplanationCard from './ExplanationCard'
import { slipstreamDemo } from '../demo/overlayDemo'
import { F1TermDetector } from '../domain/termDetector'

const termDetector = new F1TermDetector()
function OverlayApp(): React.JSX.Element {
  const [term, setTerm] = useState<typeof slipstreamDemo | null>(null)
  useEffect(() => {
    window.api.onShowDemo(() => setTerm(slipstreamDemo))
    window.api.onHideExplanation(() => setTerm(null))
    window.api.onRequestTranscript(() => {
      const transcript = window.prompt('Test F1 commentary transcript:')
      if (transcript) window.api.submitTranscript(transcript)
    })
    window.api.onTranscript((transcript) => setTerm(termDetector.detect(transcript)))
  }, [])
  useEffect(() => {
    if (!term) return
    const timeout = window.setTimeout(() => setTerm(null), 7000)
    return () => window.clearTimeout(timeout)
  }, [term])
  useEffect(() => window.api.setOverlayMode(term ? 'explanation' : 'idle'), [term])
  return <main className="overlay-app">{term ? <ExplanationCard term={term} /> : <div className="idle-indicator"><strong>ROOKIE</strong><span className="status-dot" /><span>LISTENING</span></div>}</main>
}
export default OverlayApp
