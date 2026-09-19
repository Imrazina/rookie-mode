import { useEffect, useMemo, useRef, useState } from 'react'
import { f1Glossary } from '../domain/f1Glossary'

type Formula1VocabularyPageProps = {
  selectedTerm: string | null
  onSelectTerm: (term: string | null) => void
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase('en-US')
}

function Formula1VocabularyPage({
  selectedTerm,
  onSelectTerm
}: Formula1VocabularyPageProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const detailRef = useRef<HTMLElement>(null)
  const selected = f1Glossary.find((term) => term.canonicalTerm === selectedTerm) ?? null
  const visibleTerms = useMemo(() => {
    const search = normalizeSearch(query)
    if (!search) return f1Glossary
    return f1Glossary.filter((term) => [
      term.canonicalTerm,
      ...term.aliases,
      term.explanation
    ].some((value) => value.toLocaleLowerCase('en-US').includes(search)))
  }, [query])

  useEffect(() => {
    if (selected) detailRef.current?.focus()
  }, [selected])

  return <div className="hub-page vocabulary-page">
    <header className="hub-page-heading vocabulary-heading">
      <p>FORMULA 1</p>
      <h1>VOCABULARY</h1>
      <span>Formula 1, in plain English.</span>
    </header>

    <label className="vocabulary-search">
      <span>SEARCH</span>
      <input
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search Formula 1 terms…"
        type="search"
        value={query}
      />
    </label>

    {selected ? <section className="vocabulary-detail" ref={detailRef} tabIndex={-1}>
      <div>
        <span>SELECTED TERM</span>
        <button onClick={() => onSelectTerm(null)} type="button">BROWSE ALL TERMS</button>
      </div>
      <h2>{selected.canonicalTerm}</h2>
      <p>{selected.explanation}</p>
      {selected.aliases.length > 0 ? <small>ALSO HEARD AS · {selected.aliases.join(' · ')}</small> : null}
    </section> : null}

    <section className="vocabulary-results" aria-live="polite">
      <div className="vocabulary-results-heading">
        <h2>{query ? 'MATCHING TERMS' : 'ALL TERMS'}</h2>
        <span>{visibleTerms.length}</span>
      </div>
      {visibleTerms.length > 0 ? <div className="vocabulary-grid">
        {visibleTerms.map((term) => <button
          aria-pressed={selected?.canonicalTerm === term.canonicalTerm}
          className={selected?.canonicalTerm === term.canonicalTerm ? 'is-selected' : ''}
          key={term.canonicalTerm}
          onClick={() => onSelectTerm(term.canonicalTerm)}
          type="button"
        >
          <strong>{term.canonicalTerm}</strong>
          <span>{term.explanation}</span>
        </button>)}
      </div> : <p className="vocabulary-empty">No matching terms.</p>}
    </section>
  </div>
}

export default Formula1VocabularyPage
