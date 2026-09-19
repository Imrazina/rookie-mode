export type OpenF1SessionKey = number | 'latest'
export type OpenF1Gap = number | string | null

export type OpenF1SessionResponse = {
  circuit_key: number
  circuit_short_name: string
  country_code: string
  country_key: number
  country_name: string
  date_end: string
  date_start: string
  gmt_offset: string
  is_cancelled: boolean
  location: string
  meeting_key: number
  session_key: number
  session_name: string
  session_type: string
  year: number
}

export type OpenF1DriverResponse = {
  broadcast_name: string | null
  country_code?: string | null
  driver_number: number
  first_name: string | null
  full_name: string | null
  headshot_url: string | null
  last_name: string | null
  meeting_key: number
  name_acronym: string | null
  session_key: number
  team_colour: string | null
  team_name: string | null
}

export type OpenF1PositionResponse = {
  date: string
  driver_number: number
  meeting_key: number
  position: number
  session_key: number
}

export type OpenF1IntervalResponse = {
  date: string
  driver_number: number
  gap_to_leader: OpenF1Gap
  interval: OpenF1Gap
  meeting_key: number
  session_key: number
}

export type OpenF1LapResponse = {
  date_start: string | null
  driver_number: number
  duration_sector_1: number | null
  duration_sector_2: number | null
  duration_sector_3: number | null
  i1_speed: number | null
  i2_speed: number | null
  is_pit_out_lap: boolean
  lap_duration: number | null
  lap_number: number
  meeting_key: number
  segments_sector_1?: number[] | null
  segments_sector_2?: number[] | null
  segments_sector_3?: number[] | null
  session_key: number
  st_speed: number | null
}

export type OpenF1PitResponse = {
  date: string
  driver_number: number
  lane_duration: number | null
  lap_number: number
  meeting_key: number
  pit_duration?: number | null
  session_key: number
  stop_duration: number | null
}

export type OpenF1RaceControlResponse = {
  category: string
  date: string
  driver_number: number | null
  flag: string | null
  lap_number: number | null
  meeting_key: number
  message: string
  qualifying_phase: number | string | null
  scope: string | null
  sector: number | null
  session_key: number
}
