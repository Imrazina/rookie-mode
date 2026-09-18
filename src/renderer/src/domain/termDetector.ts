import { f1Glossary, type GlossaryTerm } from './f1Glossary'
import type { DetectedTerm } from '../types/detectedTerm'

const escapePattern = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function matchesTranscript(transcript: string, term: GlossaryTerm): boolean {
  return term.aliases
    .sort((a, b) => b.length - a.length)
    .some((alias) => new RegExp(`(^|[^a-z0-9])${escapePattern(alias)}(?=$|[^a-z0-9])`, 'i').test(transcript))
}

export class F1TermDetector {
  private lastDetectedAt = new Map<string, number>()

  detect(transcript: string): DetectedTerm | null {
    const now = Date.now()
    const glossaryTerm = f1Glossary.find((term) => matchesTranscript(transcript, term))
    if (!glossaryTerm || now - (this.lastDetectedAt.get(glossaryTerm.canonicalTerm) ?? 0) < 7000) return null
    this.lastDetectedAt.set(glossaryTerm.canonicalTerm, now)
    return { term: glossaryTerm.canonicalTerm, transcript, explanation: glossaryTerm.explanation }
  }
}
