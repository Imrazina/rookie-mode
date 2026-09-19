export { OpenF1ApiClient, OpenF1RequestError } from './openF1Client'
export { OpenF1RaceDataService } from './raceDataService'
export type { OpenF1SessionKey } from './rawTypes'
export type {
  RaceControlMessage,
  RaceDataAvailability,
  RaceDriver,
  RaceGap,
  RaceInterval,
  RaceLap,
  RacePitStop,
  RacePosition,
  RaceSession,
  RaceSessionStatus,
  RaceState
} from './types'

import { OpenF1RaceDataService } from './raceDataService'
import { OpenF1ApiClient } from './openF1Client'

export const openF1RaceDataService = new OpenF1RaceDataService({
  client: new OpenF1ApiClient({
    accessToken: () => process.env.OPENF1_ACCESS_TOKEN?.trim()
  })
})
