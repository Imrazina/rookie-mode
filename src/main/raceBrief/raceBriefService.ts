import { createHash } from 'crypto'
import type { F1RaceBrief } from '../../shared/f1RaceBriefTypes'
import { AzureFoundryChatClient, type AzureFoundryChatMessage } from '../azureFoundryChatClient'

const CACHE_TTL_MS = 20 * 60_000
const TIMEOUT_MS = 8_000
const MAX_TEXT_LENGTH = 280
const MAX_ITEM_LENGTH = 180
const SYSTEM_PROMPT = `You write Rookie's Formula 1 pre-race briefing for viewers who are new to the sport.

Use ONLY the supplied facts.

Your job is not to summarize the dataset.
Select the few facts that make the upcoming race easiest and most interesting to understand.

For WHY, answer this question: "What could meaningfully change because of this race?"
Write 1-2 concise sentences explaining the competitive stakes of THIS race for a newcomer.
Use concrete supplied standings gaps and recent results whenever they support a consequence, such as a lead increasing or shrinking, a close fight for a position, teammates competing, or an opportunity to recover after recent results.

Do NOT merely state who leads the championship, that the race is important, or that a driver has many points or wins. Explain the consequence.

BAD: "This race matters because Antonelli leads the championship."
BETTER: "Antonelli has room at the top, but the fight behind him is tighter. A strong result could let Russell strengthen second while Hamilton and Norris remain close behind."

Never invent circuit characteristics, weather, strategy, rivalry, probabilities, historical facts, or championship scenarios.

Keep language simple and concise.

Return exactly these sections:

WHY:
1-2 short sentences explaining what could meaningfully change because of this race.

WATCH:
- 2 or 3 short things worth watching based only on supplied facts.

DRIVERS:
- Driver name | one short reason
- Driver name | one short reason

No introduction.
No conclusion.
Do not repeat the full schedule.
Do not print a championship table.
Do not mention missing data.`

export type RaceBriefInput = {
  target: {
    grandPrix: string
    circuit?: string
    date?: string
    qualifyingAt?: string
    raceAt?: string
    status: 'live' | 'upcoming' | 'completed'
  }
  championship: Array<{
    position: number
    driver: string
    constructor?: string
    points?: number
    wins?: number
  }>
  recentForm: Array<{
    grandPrix: string
    date?: string
    finishes: Array<{ driver: string; position: number }>
  }>
  previousEdition?: {
    grandPrix: string
    date?: string
    winner?: string
    polePosition?: string
    relevantFinishes?: Array<{ driver: string; position: number }>
  }
}

type CacheEntry = { expiresAt: number; result: Promise<F1RaceBrief | null> }

function normalizeText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim().replace(/\s+/g, ' ')
  if (!text) return null
  if (text.length <= maxLength) return text
  const clipped = text.slice(0, maxLength + 1)
  const boundary = clipped.lastIndexOf(' ')
  return clipped.slice(0, boundary > maxLength * 0.7 ? boundary : maxLength).trim()
}

function compactFacts(input: RaceBriefInput): RaceBriefInput {
  return {
    target: input.target,
    championship: input.championship.slice(0, 4),
    recentForm: input.recentForm.slice(-3),
    ...(input.previousEdition ? { previousEdition: input.previousEdition } : {})
  }
}

type DriverFact = RaceBriefInput['championship'][number]

function ordinal(position: number): string {
  const remainder100 = position % 100
  if (remainder100 >= 11 && remainder100 <= 13) return `${position}th`
  if (position % 10 === 1) return `${position}st`
  if (position % 10 === 2) return `${position}nd`
  if (position % 10 === 3) return `${position}rd`
  return `${position}th`
}

function standingReason(driver: DriverFact): string {
  const points = driver.points === undefined ? '' : ` with ${driver.points} points`
  return driver.position === 1
    ? `Leads the championship${points}.`
    : `${ordinal(driver.position)} in the championship${points}.`
}

function isGeneric(value: string): boolean {
  return /^(?:this\b.*\b(?:exciting|interesting|thrilling)\b.*\brace\b|anything can happen(?: in formula 1)?)[.!]?$/i.test(value)
}

function isTableLike(value: string): boolean {
  return /^\|.*\|$/.test(value) || /^(?:position|pos|driver|points|pts)\s*[|:]/i.test(value)
}

function isScheduleRecap(value: string): boolean {
  return /^(?:qualifying|the race|race)\s+(?:is|starts|takes place|begins)\b/i.test(value) ||
    /^(?:qualifying|race)\s*[:|-]\s*\d/i.test(value)
}

function cleanLine(value: string): string {
  return value
    .replace(/^#{1,6}\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
    .trim()
}

function usefulWhy(value: string): string | null {
  const sentences = value.match(/[^.!?]+[.!?]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? []
  const why = normalizeText(sentences.slice(0, 2).join(' '))
  return why && !isGeneric(why) && !isTableLike(why) ? why : null
}

function isTautologicalWhy(value: string): boolean {
  const leaderRestatement = /(?:this race (?:matters|is important) because\b.*\b(?:leads|is leading)\b|^[^.?!]+\b(?:leads|is leading) the championship\b)/i.test(value)
  const consequence = /\b(?:could|can|chance|opportunit|extend|increase|shrink|close|catch|overtake|move|strengthen|recover|gain|lose|fight|battle|within|gap|separat|behind|ahead|position|teammate|constructor)\w*\b/i.test(value)
  return leaderRestatement && !consequence
}

function parseBrief(content: string, allowedDrivers: Map<string, DriverFact>): {
  brief: F1RaceBrief | null
  why: boolean
  watch: number
  drivers: number
} {
  let section: 'why' | 'watch' | 'drivers' | null = null
  const whyLines: string[] = []
  const whatToWatch: string[] = []
  const driversToWatch: F1RaceBrief['driversToWatch'] = []

  const addWhy = (value: string): void => {
    const text = cleanLine(value)
    if (text && !isTableLike(text)) whyLines.push(text)
  }
  const addWatch = (value: string): void => {
    const item = normalizeText(cleanLine(value), MAX_ITEM_LENGTH)
    if (!item || isGeneric(item) || isTableLike(item) || isScheduleRecap(item)) return
    const duplicate = whatToWatch.some(
      (current) => current.toLocaleLowerCase('en-US') === item.toLocaleLowerCase('en-US')
    )
    if (!duplicate && whatToWatch.length < 3) whatToWatch.push(item)
  }
  const addDriver = (value: string): void => {
    const text = cleanLine(value)
    if (!text || isTableLike(text)) return
    const detailed = text.match(/^([^|:]+?)\s*(?:\||:)\s*(.+)$/)
    if (detailed) {
      const fact = allowedDrivers.get(detailed[1].trim().toLocaleLowerCase('en-US'))
      const reason = normalizeText(detailed[2], MAX_ITEM_LENGTH)
      if (fact && reason && !isGeneric(reason) && !driversToWatch.some((item) => item.driver === fact.driver) && driversToWatch.length < 3) {
        driversToWatch.push({ driver: fact.driver, reason })
      }
      return
    }
    for (const candidate of text.split(/\s*,\s*/)) {
      const fact = allowedDrivers.get(candidate.toLocaleLowerCase('en-US'))
      if (fact && !driversToWatch.some((item) => item.driver === fact.driver) && driversToWatch.length < 3) {
        driversToWatch.push({ driver: fact.driver, reason: standingReason(fact) })
      }
    }
  }
  const addContent = (target: typeof section, value: string): void => {
    if (target === 'why') addWhy(value)
    else if (target === 'watch') addWatch(value)
    else if (target === 'drivers') addDriver(value)
  }

  for (const rawLine of content.replace(/```(?:text)?/gi, '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const headingLine = line.replace(/^#{1,6}\s*/, '').replace(/\*\*/g, '').trim()
    const heading = headingLine.match(
      /^(WHY|WATCH|WHAT\s+TO\s+WATCH|DRIVERS|DRIVERS\s+TO\s+WATCH)\s*:\s*(.*)$/i
    )
    if (heading) {
      const label = heading[1].toLocaleLowerCase('en-US')
      section = label === 'why' ? 'why' : label.includes('driver') ? 'drivers' : 'watch'
      if (heading[2].trim()) addContent(section, heading[2])
      continue
    }
    addContent(section, line)
  }

  const whyThisRaceMatters = usefulWhy(whyLines.join(' '))
  const usefulSections = Number(Boolean(whyThisRaceMatters)) +
    Number(whatToWatch.length > 0) + Number(driversToWatch.length > 0)
  const brief = usefulSections >= 2
    ? { whyThisRaceMatters: whyThisRaceMatters ?? '', whatToWatch, driversToWatch }
    : null
  return { brief, why: Boolean(whyThisRaceMatters), watch: whatToWatch.length, drivers: driversToWatch.length }
}

export class RaceBriefService {
  private readonly cache = new Map<string, CacheEntry>()

  constructor(
    private readonly client: AzureFoundryChatClient,
    private readonly model: string
  ) {}

  generate(input: RaceBriefInput): Promise<F1RaceBrief | null> {
    const key = createHash('sha256').update(JSON.stringify(compactFacts(input))).digest('hex')
    const cached = this.cache.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.result
    const result = this.request(input)
    this.cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, result })
    this.pruneCache()
    return result
  }

  private async request(input: RaceBriefInput): Promise<F1RaceBrief | null> {
    console.debug(`[race-brief] generating grandPrix=${input.target.grandPrix}`)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const facts = compactFacts(input)
      const allowedDrivers = new Map(facts.championship.map((driver) => [
        driver.driver.toLocaleLowerCase('en-US'),
        driver
      ]))
      const complete = async (retry = false): Promise<ReturnType<typeof parseBrief>> => {
        const retryInstruction = retry
          ? '\n\nThe previous WHY only restated who leads. Rewrite it to explain what could meaningfully change because of this race, using only the supplied facts.'
          : ''
        const userMessage = `${JSON.stringify(facts, null, 2)}\n\nReturn only WHY:, WATCH:, and DRIVERS: in the exact format requested by the system message.${retryInstruction}`
        const messages: AzureFoundryChatMessage[] = [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage }
        ]
        const completion = await this.client.complete(this.model, messages, 240, 0.15, controller.signal)
        if (completion.finishReason && completion.finishReason !== 'stop') {
          throw new Error(`response ended with ${completion.finishReason}`)
        }
        console.debug(`[race-brief] raw=${JSON.stringify(completion.content)}`)
        const parsed = parseBrief(completion.content, allowedDrivers)
        console.debug(`[race-brief] parsed why=${parsed.why} watch=${parsed.watch} drivers=${parsed.drivers}`)
        return parsed
      }

      let parsed = await complete()
      if (parsed.brief?.whyThisRaceMatters && isTautologicalWhy(parsed.brief.whyThisRaceMatters)) {
        console.debug('[race-brief] retrying: WHY restated standings without a consequence')
        const retry = await complete(true)
        if (retry.brief?.whyThisRaceMatters && !isTautologicalWhy(retry.brief.whyThisRaceMatters)) {
          parsed = retry
        } else {
          parsed = {
            ...parsed,
            brief: { ...parsed.brief, whyThisRaceMatters: '' },
            why: false
          }
        }
      }
      if (!parsed.brief) throw new Error('fewer than two useful brief sections were recovered')
      console.debug(`[race-brief] ready grandPrix=${input.target.grandPrix}`)
      return parsed.brief
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error'
      console.debug(`[race-brief] unavailable: ${message}`)
      return null
    } finally {
      clearTimeout(timeout)
    }
  }

  private pruneCache(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache) if (entry.expiresAt <= now) this.cache.delete(key)
  }
}
