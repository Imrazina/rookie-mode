import type { RaceState } from '../openf1'

export type ContextExplanationInput = {
  term: string
  staticDefinition: string
  recentTranscript: string
  raceState: RaceState | null
}

export interface ContextExplanationProvider {
  generate(input: ContextExplanationInput, signal: AbortSignal): Promise<string>
}
