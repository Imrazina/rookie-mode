import { AzureFoundryChatClient, type AzureFoundryChatMessage } from '../azureFoundryChatClient'
import type { ContextExplanationInput, ContextExplanationProvider } from './types'

const MAX_EXPLANATION_WORDS = 25
const SYSTEM_PROMPT = `You write the RIGHT NOW line for Rookie, an Formula 1 broadcast companion.

The user already sees a separate definition of the detected term.
Never define the term.

Describe only what is happening in the supplied commentary at this moment.

Rules:
- Output exactly one sentence.
- Maximum 20 words.
- No introduction.
- No definition.
- No headings.
- No markdown.
- No JSON.
- No quotation marks around the answer.
- Use only facts directly supported by the supplied commentary.
- Never invent positions, gaps, lap numbers, tyres, weather, strategy, track sections, race events, or driver identities.
- If an identity is uncertain, use neutral wording such as "the car ahead" or "the following car".
- Ignore unrelated or obviously mistranscribed transcript fragments.
- Return only the sentence that should appear under RIGHT NOW.

Bad outputs:
"The detected term SLIPSTREAM refers to..."
"Slipstream is..."
"In Formula 1, slipstream means..."

Good output:
"Hamilton is using the car ahead to reduce drag and close rapidly down the straight."`

function removeSurroundingQuotes(value: string): string {
  return value
    .replace(/^["'“”‘’]+/, '')
    .replace(/["'“”‘’]+$/, '')
    .trim()
}

function isIntroduction(sentence: string): boolean {
  const withoutPunctuation = sentence.replace(/[.!?]+$/, '').trim()
  return /^(sure|certainly|of course|here(?:'s| is)(?: the)?(?: answer|explanation)?|right now)$/i.test(
    withoutPunctuation
  )
}

function firstUsefulSentence(value: string, input: ContextExplanationInput): string {
  const collapsed = removeSurroundingQuotes(value.trim()).replace(/\s+/g, ' ')
  const sentences = collapsed.split(/(?<=[.!?])["”’]?\s+/).map(removeSurroundingQuotes)
  return (
    sentences.find(
      (sentence) =>
        sentence &&
        !isIntroduction(sentence) &&
        !isDefinition(sentence, input.term, input.staticDefinition) &&
        !/^(?:right now|output|answer)\s*:|[`*#]|^[->{[]/i.test(sentence)
    ) ?? ''
  )
}

function isDefinition(sentence: string, term: string, staticDefinition: string): boolean {
  const normalized = sentence.toLocaleLowerCase('en-US')
  if (/^(?:the detected term|in formula 1\b|in f1\b)/.test(normalized)) return true
  const normalizedTerm = term
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const definitionPattern = new RegExp(
    `^(?:in (?:formula 1|f1),?\\s+)?(?:the detected term|the term ["']?${normalizedTerm}["']?|(?:a|an|the)?\\s*${normalizedTerm})\\s+(?:is|means|refers to|describes)\\b`,
    'i'
  )
  if (definitionPattern.test(sentence)) return true

  const normalizedStaticDefinition = staticDefinition
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/, '')
    .toLocaleLowerCase('en-US')
  return normalized.replace(/[.!?]+$/, '') === normalizedStaticDefinition
}

export class AzureFoundryContextExplanationProvider implements ContextExplanationProvider {
  constructor(
    private readonly client: AzureFoundryChatClient,
    private readonly model: string
  ) {}

  async generate(input: ContextExplanationInput, signal: AbortSignal): Promise<string> {
    const messages: AzureFoundryChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `TERM:\n${input.term}\n\nRECENT COMMENTARY:\n${input.recentTranscript || '(unavailable)'}\n\nTASK:\nDescribe what is happening RIGHT NOW in one short sentence.`
      }
    ]
    // Log message content only; never serialize request options or headers.
    console.debug(`[context-ai] messages=${this.client.sanitizeLog(JSON.stringify(messages))}`)
    const completion = await this.client.complete(this.model, messages, 64, 0.1, signal)

    console.debug(`[context-ai] finish_reason=${completion.finishReason ?? 'unknown'}`)
    console.debug(`[context-ai] raw=${this.client.sanitizeLog(JSON.stringify(completion.content))}`)
    const normalized = firstUsefulSentence(completion.content, input)
    console.debug(`[context-ai] normalized=${this.client.sanitizeLog(JSON.stringify(normalized))}`)
    const wordCount = normalized.match(/\S+/g)?.length ?? 0
    const invalidDefinition = isDefinition(normalized, input.term, input.staticDefinition)
    const invalidHeading = /^(?:right now|output|answer)\s*:/i.test(normalized)
    const result =
      (!completion.finishReason || completion.finishReason === 'stop') &&
      wordCount > 0 &&
      wordCount <= MAX_EXPLANATION_WORDS &&
      !invalidDefinition &&
      !invalidHeading
        ? normalized
        : ''
    console.debug(`[context-ai] result=${this.client.sanitizeLog(JSON.stringify(result))}`)

    if (completion.finishReason === 'length') {
      console.debug('[context-ai] finish_reason=length; output was truncated')
      throw new Error('Azure Foundry response was truncated (finish_reason=length)')
    }
    if (completion.finishReason && completion.finishReason !== 'stop') {
      throw new Error(`Azure Foundry response ended with ${completion.finishReason}`)
    }
    if (!normalized) throw new Error('Azure Foundry returned no useful situational sentence')
    if (wordCount > MAX_EXPLANATION_WORDS)
      throw new Error('Azure Foundry returned an explanation over 25 words')
    if (invalidDefinition)
      throw new Error('Azure Foundry returned a glossary definition instead of situational context')
    if (invalidHeading)
      throw new Error('Azure Foundry returned a heading instead of situational context')
    return result
  }

  async verify(signal: AbortSignal): Promise<void> {
    const completion = await this.client.complete(
      this.model,
      [{ role: 'user', content: 'Reply with exactly OK.' }],
      8,
      0,
      signal
    )
    if (!completion.content.trim()) throw new Error('Azure Foundry diagnostic returned no text')
    if (completion.finishReason && completion.finishReason !== 'stop') {
      throw new Error(`Azure Foundry diagnostic ended with ${completion.finishReason}`)
    }
  }

}
