import { teams, tournaments, type TeamId, type Tournament } from '../data/sil15.js'
import { parseCsv } from './csv'
import { fold, norm, type RosterEntry, type StaffRole } from './rosterCrypto'

export { fold, norm }
export type { StaffRole }

/**
 * Rubic-koder i eksporten. «Totalt (a/b/c)» = antall 3 / 1 / 5.
 * 3 = påmeldt (ja), 5 = avslått (nei), 1 = ikke svart (ubesvart). Tom celle = ikke invitert til aktiviteten.
 * NB: Dette er påmeldingsstatus i Rubic, ikke nødvendigvis faktisk oppmøte.
 */
export type Status = 'ja' | 'nei' | 'ikke-svart' | null
const CODES: Record<string, Exclude<Status, null>> = { '3': 'ja', '5': 'nei', '1': 'ikke-svart' }

export type Kind = 'spiller' | 'stab' | 'annen'
export type Overrides = Record<string, TeamId | 'none'>
export type ActKind = 'trening' | 'kamp'

export interface Activity {
  idx: number
  date: string // yyyy-mm-dd
  time: string
  at: Date
  /** trening = fra hovedeksporten, kamp = fra egen kampeksport */
  kind: ActKind
  /** Kamp: laget som spilte (utledet fra hvem som er innkalt) */
  team: TeamId | null
  /** Filen aktiviteten kom fra */
  source: string
  tournament?: Tournament
  /** Storhamar-lag som spiller turnering denne datoen */
  playingTeams: TeamId[]
  hasData: boolean
  /** Tom kolonne i hovedeksporten som dekkes av en kampeksport */
  replaced: boolean
}

export interface Person {
  id: string
  name: string
  kind: Kind
  /** Laget personen spiller på (kun spillere) */
  teamId: TeamId | null
  /** For stab: rolle og laget de er knyttet til */
  role: StaffRole | null
  staffTeam: TeamId | null
  short: string | null
  nr: string | null
  note?: string
  uncertain: boolean
  /** Trolig sluttet – holdes utenfor snitt og rangering */
  inactive: boolean
  overridden: boolean
  statuses: Status[]
  /** Manuelle rettelser: aktivitetsindeks -> forklaring */
  corrected: Record<number, string>
  rubicTotal: string
}

export interface Model {
  activities: Activity[]
  people: Person[]
  /** Personer i det krypterte lagoppsettet som ikke fantes i de opplastede filene */
  missing: number
}

export interface CsvFile {
  name: string
  text: string
}


const teamByName = new Map(teams.map(t => [t.name, t.id]))

interface ParsedExport {
  cols: { date: string; time: string }[]
  rows: { name: string; total: string; codes: Status[] }[]
}

/** Leser en Rubic-oppmøteeksport: Navn, Totalt, og én kolonne per aktivitet «dd.mm.åååå (tt:mm)». */
export function parseExport(text: string): ParsedExport {
  const rows = parseCsv(text).filter(r => r.some(c => c.trim()))
  if (rows.length < 2) throw new Error('Fant ingen rader i CSV-filen.')
  const [header, ...body] = rows
  const nameCol = Math.max(0, header.findIndex(h => /navn/i.test(h)))
  const totalCol = header.findIndex(h => /totalt/i.test(h))
  const colIdx: number[] = []
  const cols: ParsedExport['cols'] = []
  header.forEach((h, i) => {
    const m = h.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\s*\((\d{1,2}):(\d{2})\)/)
    if (!m) return
    const [, d, mo, y, hh, mm] = m
    colIdx.push(i)
    cols.push({ date: `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`, time: `${hh.padStart(2, '0')}:${mm}` })
  })
  if (!cols.length) throw new Error('Fant ingen datokolonner. Er dette en oppmøteeksport fra Rubic?')
  return {
    cols,
    rows: body
      .map(r => ({
        name: norm(r[nameCol] ?? ''),
        total: totalCol >= 0 ? (r[totalCol] ?? '') : '',
        codes: colIdx.map(c => CODES[(r[c] ?? '').trim()] ?? null),
      }))
      // Rader med bare medlemsnummer (slettede/ukjente medlemmer) tas ikke med
      .filter(r => r.name && !/^\d+$/.test(r.name)),
  }
}

function makeActivity(idx: number, date: string, time: string, kind: ActKind, source: string): Activity {
  const tournament = tournaments.find(t => t.date === date)
  return {
    idx, date, time, kind, source,
    at: new Date(`${date}T${time}:00`),
    team: null,
    tournament,
    playingTeams: (tournament?.teams ?? []).map(n => teamByName.get(n)).filter((x): x is TeamId => !!x),
    hasData: false,
    replaced: false,
  }
}

/** Alle navn i en eksport – brukes for å låse opp lagoppsettet */
export function namesIn(files: CsvFile[]): string[] {
  return files.flatMap(f => parseExport(f.text).rows.map(r => r.name))
}

/**
 * @param roster  Opplåst lagoppsett (nøkkel = fold(fullt navn)), se rosterCrypto.unlock
 * @param rosterSize  Antall personer i det krypterte lagoppsettet
 */
export function buildModel(main: CsvFile, matchFiles: CsvFile[], overrides: Overrides, roster: Map<string, RosterEntry>, rosterSize: number): Model {
  const base = parseExport(main.text)
  const matches = matchFiles.map(f => ({ f, x: parseExport(f.text) }))

  const activities: Activity[] = base.cols.map((c, i) => makeActivity(i, c.date, c.time, 'trening', main.name))
  const matchCols: { file: number; col: number; idx: number }[] = []
  matches.forEach(({ f, x }, file) =>
    x.cols.forEach((c, col) => {
      const a = makeActivity(activities.length, c.date, c.time, 'kamp', f.name)
      matchCols.push({ file, col, idx: a.idx })
      activities.push(a)
    }),
  )
  const n = activities.length

  // Lagoppsett (dekryptert): fullt navn -> spillerinfo / stabsrolle
  const players = new Map<string, { teamId: TeamId; short: string; nr: string | null; note?: string; uncertain: boolean; inactive?: boolean }>()
  const staff = new Map<string, { role: StaffRole; team: TeamId | null }>()
  for (const [k, e] of roster) {
    if (e.player) players.set(k, { teamId: e.player.team, short: e.player.short, nr: e.player.nr, note: e.player.note, uncertain: !!e.player.uncertain, inactive: e.player.inactive })
    if (e.staff) staff.set(k, e.staff)
  }

  const byId = new Map<string, Person>()
  const getPerson = (name: string, total: string): Person => {
    const id = fold(name)
    const existing = byId.get(id)
    if (existing) return existing
    const hit = players.get(id)
    const ov = overrides[id]
    const teamId: TeamId | null = ov === 'none' ? null : ov ?? hit?.teamId ?? null
    const st = ov === undefined || ov === 'none' ? staff.get(id) : undefined
    const p: Person = {
      id,
      name,
      kind: teamId ? 'spiller' : st ? 'stab' : 'annen',
      teamId,
      role: st?.role ?? null,
      staffTeam: st?.team ?? null,
      short: hit?.short ?? null,
      nr: hit && hit.teamId === teamId ? hit.nr : null,
      note: hit && hit.teamId === teamId ? hit.note : undefined,
      uncertain: !!hit?.uncertain && ov === undefined,
      inactive: !!hit?.inactive && teamId === hit.teamId,
      overridden: ov !== undefined,
      statuses: new Array<Status>(n).fill(null),
      corrected: {},
      rubicTotal: total,
    }
    byId.set(id, p)
    return p
  }

  for (const r of base.rows) {
    const p = getPerson(r.name, r.total)
    r.codes.forEach((s, i) => (p.statuses[i] = s))
  }
  for (const m of matchCols) {
    for (const r of matches[m.file].x.rows) {
      const s = r.codes[m.col]
      if (s) getPerson(r.name, '').statuses[m.idx] = s
    }
  }
  const people = [...byId.values()]

  // Manuelle rettelser (ligger kryptert i lagoppsettet) – kun treninger som står som «ikke svart»
  for (const [k, e] of roster) for (const c of e.corrections ?? []) {
    const p = byId.get(k)
    if (!p) continue
    for (const a of activities) {
      if (a.kind !== 'trening' || p.statuses[a.idx] !== 'ikke-svart') continue
      if ((c.from && a.date < c.from) || (c.to && a.date > c.to)) continue
      p.statuses[a.idx] = c.status
      p.corrected[a.idx] = c.note
    }
  }

  for (const a of activities) a.hasData = people.some(p => p.statuses[a.idx] !== null)

  // Kamp: laget = flest innkalte spillere
  for (const a of activities.filter(x => x.kind === 'kamp')) {
    const count = new Map<TeamId, number>()
    for (const p of people) if (p.teamId && p.statuses[a.idx]) count.set(p.teamId, (count.get(p.teamId) ?? 0) + 1)
    a.team = [...count].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null
  }
  // Tomme kolonner i hovedeksporten som dekkes av en kampeksport
  for (const a of activities) {
    if (a.kind === 'trening' && !a.hasData) {
      a.replaced = activities.some(k => k.kind === 'kamp' && k.date === a.date && k.time === a.time)
    }
  }

  const missing = rosterSize - roster.size

  // Kampeksporter legges til etter hovedeksporten – sorter kronologisk (statuser slås opp via idx, ikke posisjon)
  activities.sort((a, b) => a.at.getTime() - b.at.getTime() || a.idx - b.idx)

  return { activities, people, missing }
}

// ---------- statistikk ----------

export interface Stats {
  ja: number
  nei: number
  ikkeSvart: number
  invited: number
  pct: number | null
  streak: number
}

export function personStats(p: Person, acts: Activity[], noAnswerIsAbsent: boolean): Stats {
  let ja = 0, nei = 0, ikkeSvart = 0
  for (const a of acts) {
    const s = p.statuses[a.idx]
    if (s === 'ja') ja++
    else if (s === 'nei') nei++
    else if (s === 'ikke-svart') ikkeSvart++
  }
  const denom = noAnswerIsAbsent ? ja + nei + ikkeSvart : ja + nei
  // Sammenhengende «ja» bakover fra siste aktivitet
  let streak = 0
  for (let i = acts.length - 1; i >= 0; i--) {
    const s = p.statuses[acts[i].idx]
    if (s === null) continue
    if (s !== 'ja') break
    streak++
  }
  return { ja, nei, ikkeSvart, invited: ja + nei + ikkeSvart, pct: denom ? ja / denom : null, streak }
}

export function countStatuses(people: Person[], a: Activity) {
  const out = { ja: [] as Person[], nei: [] as Person[], 'ikke-svart': [] as Person[] }
  for (const p of people) {
    const s = p.statuses[a.idx]
    if (s) out[s].push(p)
  }
  return out
}

export function average(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null)
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null
}

// ---------- periode / filtre ----------

export type Period = 'alle' | 'host' | 'var' | '30' | '60'
export type ActType = 'alle' | 'kamp' | 'trening'

export const PERIODS: { id: Period; label: string }[] = [
  { id: 'host', label: 'Høst 2026 (fra aug.)' },
  { id: 'var', label: 'Vår 2026 (før aug.)' },
  { id: '30', label: 'Siste 30 dager' },
  { id: '60', label: 'Siste 60 dager' },
  { id: 'alle', label: 'Hele perioden' },
]

const SEASON_START = '2026-08-01'

export function inPeriod(a: Activity, period: Period, now: Date) {
  switch (period) {
    case 'alle': return true
    case 'host': return a.date >= SEASON_START
    case 'var': return a.date < SEASON_START
    case '30':
    case '60': return now.getTime() - a.at.getTime() <= Number(period) * 86400000
  }
}

export function matchesType(a: Activity, t: ActType) {
  return t === 'alle' || a.kind === t
}

/** Laget en person vises med (spillerlag, eller laget en stabsperson er knyttet til) */
export const colorTeam = (p: Person): TeamId | null => p.teamId ?? p.staffTeam

/** Skal personen telle med i snitt og rangering? (Ikke sluttede spillere, ikke lagledere – de forventes ikke å møte) */
export const countsInStats = (p: Person) => !p.inactive && p.role !== 'Lagleder'
