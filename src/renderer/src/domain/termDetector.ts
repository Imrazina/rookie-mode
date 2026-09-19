import { f1Glossary, type GlossaryTerm } from './f1Glossary'
import type { DetectedTerm } from '../types/detectedTerm'

const TERM_COOLDOWN_MS = 4000
const escapePattern = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const glossaryAliases = f1Glossary
  .flatMap((term) => term.aliases.map((alias) => ({
    pattern: new RegExp(`(^|[^a-z0-9])${escapePattern(alias)}(?=$|[^a-z0-9])`, 'i'),
    alias,
    term
  })))
  .sort((a, b) => b.alias.length - a.alias.length)

function findGlossaryTerm(transcript: string): GlossaryTerm | null {
  return glossaryAliases.find(({ pattern }) => pattern.test(transcript))?.term ?? null
}

export class F1TermDetector {
  private lastDetectedAt = new Map<string, number>()
  private partialTerms = new Set<string>()

  match(transcript: string): DetectedTerm | null {
    const glossaryTerm = findGlossaryTerm(transcript)
    return glossaryTerm
      ? { term: glossaryTerm.canonicalTerm, transcript, explanation: glossaryTerm.explanation }
      : null
  }

  detect(transcript: string): DetectedTerm | null {
    const detectedTerm = this.match(transcript)
    if (!detectedTerm) return null

    return this.applyCooldown(detectedTerm)
  }

  detectPartial(transcript: string): DetectedTerm | null {
    const detectedTerm = this.match(transcript)
    if (!detectedTerm || this.partialTerms.has(detectedTerm.term)) return null
    this.partialTerms.add(detectedTerm.term)
    return this.applyCooldown(detectedTerm)
  }

  detectFinal(transcript: string): DetectedTerm | null {
    const detectedTerm = this.match(transcript)
    const wasDetectedFromPartial = Boolean(detectedTerm && this.partialTerms.has(detectedTerm.term))
    this.partialTerms.clear()
    return detectedTerm && !wasDetectedFromPartial ? this.applyCooldown(detectedTerm) : null
  }

  reset(): void {
    this.partialTerms.clear()
  }

  private applyCooldown(detectedTerm: DetectedTerm): DetectedTerm | null {
    const now = Date.now()
    if (now - (this.lastDetectedAt.get(detectedTerm.term) ?? 0) < TERM_COOLDOWN_MS) return null
    this.lastDetectedAt.set(detectedTerm.term, now)
    return detectedTerm
  }
}
