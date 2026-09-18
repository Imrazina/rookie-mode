import type { DetectedTerm } from '../types/detectedTerm'
function ExplanationCard({ term }: { term: DetectedTerm }): React.JSX.Element {
  return <article className="explanation-card" aria-live="polite"><div className="card-kicker"><span /> COMMENTARY TERM</div><h1>{term.term}</h1><p className="explanation">{term.explanation}</p>{term.context && <div className="context"><span>RIGHT NOW</span><p>{term.context}</p></div>}<p className="transcript">Heard: <i>“{term.transcript}”</i></p><div className="card-progress" /></article>
}
export default ExplanationCard
