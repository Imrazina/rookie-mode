import type { DetectedTerm } from '../types/detectedTerm'
function ExplanationCard({ term }: { term: DetectedTerm }): React.JSX.Element {
  return (
    <article className="explanation-card" aria-live="polite">
      <h1>{term.term}</h1>
      <p className="explanation">{term.explanation}</p>
      {term.context && (
        <p className="context">{term.context}</p>
      )}
      <div className="card-progress" />
    </article>
  )
}
export default ExplanationCard
