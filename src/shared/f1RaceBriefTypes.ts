export type F1RaceBriefDriver = {
  driver: string
  reason: string
}

export type F1RaceBrief = {
  whyThisRaceMatters: string
  whatToWatch: string[]
  driversToWatch: F1RaceBriefDriver[]
}
