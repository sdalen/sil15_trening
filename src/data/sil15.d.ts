// Typer for sil15.js (kopiert fra ../sil15/src/data.js)
export type TeamId = 'hvit' | 'rod' | 'bla' | 'gul'

export interface Team {
  id: TeamId
  name: string
  short: string
}

/** [kampstart, bane, hjemmelag, bortelag] */
export type Game = [string, number, string, string]

export interface Tournament {
  nr: number
  place: string
  date: string
  start: string
  end: string
  iceBreak: string
  teams: string[]
  games: Game[]
}

export const teams: Team[]
export const tournaments: Tournament[]
