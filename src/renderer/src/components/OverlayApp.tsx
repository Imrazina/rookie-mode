import { useEffect, useRef, useState } from 'react'
import ExplanationCard from './ExplanationCard'
import { slipstreamDemo } from '../demo/overlayDemo'
import { F1TermDetector } from '../domain/termDetector'
import type { DetectedTerm } from '../types/detectedTerm'

const termDetector = new F1TermDetector()
function OverlayApp(): React.JSX.Element {
  const isMac = window.api.platform === 'darwin'
  const shortcutLabel = isMac ? '⌃⇧R' : 'Ctrl+Shift+R'
  const shortcutDescription = isMac ? 'Control Shift R stops listening' : 'Ctrl Shift R stops listening'
  const [term, setTerm] = useState<typeof slipstreamDemo | null>(null)
  const explanationRequestId = useRef(0)
  const latestPartialTranscript = useRef('')
  useEffect(() => {
    let pendingContext: number | undefined
    const cancelPendingContext = (): void => {
      window.clearTimeout(pendingContext)
      pendingContext = undefined
    }
    const showDetectedTerm = (detectedTerm: DetectedTerm): void => {
      cancelPendingContext()
      const requestId = ++explanationRequestId.current
      setTerm(detectedTerm)
      pendingContext = window.setTimeout(() => {
        pendingContext = undefined
        if (explanationRequestId.current !== requestId) return
        const currentPartial = latestPartialTranscript.current
        const partialTranscript = termDetector.match(currentPartial)?.term === detectedTerm.term
          ? currentPartial
          : detectedTerm.transcript
        void window.api
          .requestContextExplanation({
            term: detectedTerm.term,
            staticDefinition: detectedTerm.explanation,
            partialTranscript
          })
          .then((context) => {
            if (!context || explanationRequestId.current !== requestId) return
            setTerm((currentTerm) =>
              currentTerm?.term === detectedTerm.term ? { ...currentTerm, context } : currentTerm
            )
          })
          .catch(() => {})
      }, 700)
    }

    const removeShowDemo = window.api.onShowDemo(() => {
      cancelPendingContext()
      explanationRequestId.current += 1
      setTerm(slipstreamDemo)
    })
    const removeHideExplanation = window.api.onHideExplanation(() => {
      cancelPendingContext()
      explanationRequestId.current += 1
      termDetector.reset()
      setTerm(null)
    })
    const removeRequestTranscript = window.api.onRequestTranscript(() => {
      const transcript = window.prompt('Test F1 commentary transcript:')
      if (transcript) window.api.submitTranscript(transcript)
    })
    const removePartialTranscript = window.api.onPartialTranscript((transcript) => {
      latestPartialTranscript.current = transcript
      const detectedTerm = termDetector.detectPartial(transcript)
      if (detectedTerm) showDetectedTerm(detectedTerm)
    })
    const removeTranscript = window.api.onTranscript((transcript) => {
      const detectedTerm = termDetector.detectFinal(transcript)
      if (detectedTerm) {
        showDetectedTerm(detectedTerm)
        return
      }

      const matchedTerm = termDetector.match(transcript)
      if (matchedTerm) {
        setTerm((currentTerm) =>
          currentTerm?.term === matchedTerm.term
            ? { ...matchedTerm, context: currentTerm.context }
            : currentTerm
        )
      }
    })

    return () => {
      cancelPendingContext()
      removeShowDemo()
      removeHideExplanation()
      removeRequestTranscript()
      removePartialTranscript()
      removeTranscript()
      explanationRequestId.current += 1
    }
  }, [])
  useEffect(() => {
    if (!term) return
    const timeout = window.setTimeout(() => {
      explanationRequestId.current += 1
      setTerm(null)
    }, 7000)
    return () => window.clearTimeout(timeout)
  }, [term])
  useEffect(() => {
    window.api.setOverlayMode(term?.context ? 'explanation-context' : term ? 'explanation' : 'idle')
  }, [term])
  return (
    <main className="overlay-app">
      {term ? (
        <ExplanationCard term={term} />
      ) : (
        <div className="idle-indicator">
          <strong className="idle-brand">Rookie</strong>
          <span aria-hidden="true" className="status-dot" />
          <span className="idle-status">Listening</span>
          <kbd aria-label={shortcutDescription} className="idle-shortcut">{shortcutLabel}</kbd>
        </div>
      )}
    </main>
  )
}
export default OverlayApp
