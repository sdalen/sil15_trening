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
  /** Grunn til avslag fra Rubic: aktivitetsindeks -> tekst */
  reasons: Record<number, string>
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

/** Aktiviteter som ble avlyst, men fortsatt ligger i Rubic-eksporten («åååå-mm-dd tt:mm») */
const CANCELLED = new Set([
  '2026-06-02 17:00',
  '2026-06-09 17:00',
  '2026-06-16 17:00',
])

interface ParsedExport {
  /** label = tekst etter klokkeslettet i overskriften, f.eks. kategorien fra local/rubic-csv.mjs («Cup») */
  cols: { date: string; time: string; label: string }[]
  /** notes = kommentar per aktivitet (f.eks. grunn til avslag), fra celler på formen «5 | Hockeykamp» */
  rows: { name: string; total: string; codes: Status[]; notes: string[] }[]
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
    const m = h.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\s*\((\d{1,2}):(\d{2})\)\s*(.*)/)
    if (!m) return
    const [, d, mo, y, hh, mm, label] = m
    colIdx.push(i)
    cols.push({ date: `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`, time: `${hh.padStart(2, '0')}:${mm}`, label: label.trim() })
  })
  if (!cols.length) throw new Error('Fant ingen datokolonner. Er dette en oppmøteeksport fra Rubic?')
  return {
    cols,
    rows: body
      .map(r => ({
        name: norm(r[nameCol] ?? ''),
        total: totalCol >= 0 ? (r[totalCol] ?? '') : '',
        codes: colIdx.map(c => CODES[(r[c] ?? '').split('|')[0].trim()] ?? null),
        notes: colIdx.map(c => (r[c] ?? '').split('|').slice(1).join('|').trim()),
      }))
      // Rader med bare medlemsnummer (slettede/ukjente medlemmer) tas ikke med
      .filter(r => r.name && !/^\d+$/.test(r.name)),
  }
}

const UNCODE: Record<Exclude<Status, null>, string> = { ja: '3', nei: '5', 'ikke-svart': '1' }

/**
 * Slår sammen to Rubic-eksporter til én (som CSV-tekst i samme format).
 * - Aktiviteter (kolonner) fra begge filer tas med, sortert på dato.
 * - For aktiviteter som finnes i begge, vinner den nye fila for personene som står i den
 *   (statuser oppdateres etter hver aktivitet). Personer som ikke står i den nye fila beholder gamle verdier.
 */
export function mergeExports(oldText: string, newText: string): string {
  const a = parseExport(oldText)
  const b = parseExport(newText)
  // Nøkkel = tidspunkt + løpenummer, fordi to aktiviteter kan ha samme dato og klokkeslett (f.eks. turneringsdager)
  const keysOf = (cs: { date: string; time: string }[]) => {
    const seen = new Map<string, number>()
    return cs.map(c => {
      const t = `${c.date} ${c.time}`
      const k = seen.get(t) ?? 0
      seen.set(t, k + 1)
      return `${t} #${k}`
    })
  }
  const aKeys = keysOf(a.cols)
  const bKeys = keysOf(b.cols)
  const all = new Map<string, { date: string; time: string }>()
  a.cols.forEach((c, i) => all.set(aKeys[i], c))
  b.cols.forEach((c, i) => all.set(bKeys[i], c))
  const order = [...all.keys()].sort()
  const cols = order.map(k => all.get(k)!)
  const colPos = new Map(order.map((k, i) => [k, i]))

  const people = new Map<string, { name: string; total: string; codes: Status[]; notes: string[] }>()
  for (const [x, xKeys] of [[a, aKeys], [b, bKeys]] as const) {
    for (const r of x.rows) {
      const k = fold(r.name)
      const p = people.get(k) ?? { name: r.name, total: '', codes: new Array<Status>(cols.length).fill(null), notes: new Array<string>(cols.length).fill('') }
      if (r.total) p.total = r.total
      xKeys.forEach((k, i) => {
        p.codes[colPos.get(k)!] = r.codes[i]
        p.notes[colPos.get(k)!] = r.notes[i]
      })
      people.set(k, p)
    }
  }
  const cell = (v: string) => (/[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const header = ['Navn', 'Totalt', ...cols.map(c => `${c.date.slice(8, 10)}.${c.date.slice(5, 7)}.${c.date.slice(0, 4)} (${c.time})`)]
  const lines = [header, ...[...people.values()].map(p => [p.name, p.total, ...p.codes.map((s, i) => (s ? UNCODE[s] + (p.notes[i] ? ` | ${p.notes[i]}` : '') : ''))])]
  return lines.map(l => l.map(cell).join(',')).join('\n') + '\n'
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
      reasons: {},
      rubicTotal: total,
    }
    byId.set(id, p)
    return p
  }

  for (const r of base.rows) {
    const p = getPerson(r.name, r.total)
    r.codes.forEach((s, i) => (p.statuses[i] = s))
    r.notes.forEach((t, i) => t && (p.reasons[i] = t))
  }
  for (const m of matchCols) {
    for (const r of matches[m.file].x.rows) {
      const s = r.codes[m.col]
      if (!s) continue
      const p = getPerson(r.name, '')
      p.statuses[m.idx] = s
      if (r.notes[m.col]) p.reasons[m.idx] = r.notes[m.col]
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

  // Avlyste aktiviteter regnes som uten data – da holdes de utenfor all statistikk og alle lister
  for (const a of activities) a.hasData = !CANCELLED.has(`${a.date} ${a.time}`) && people.some(p => p.statuses[a.idx] !== null)

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

/** Avslag med godkjent grunn (annen idrett eller sykdom) – brukes av Furnes-siden */
export const APPROVED_REASON = /fotball|futsal|hockey|syk/i

/**
 * Hockeysesongen starter (siste seriekamp i fotball for årgangen var 29.09.2026).
 * Fra og med denne datoen er fotball/futsal ikke lenger godkjent grunn for hockeyfravær.
 */
export const HOCKEY_SEASON_START = '2026-10-01'

/** Godkjent grunn for avslag på en hockeyaktivitet: syk alltid, jobb for støtteapparat, fotball/futsal bare før hockeysesongen */
export function approvedReason(reason: string, date: string, staff = false) {
  if (/syk/i.test(reason)) return true
  if (staff && /jobb/i.test(reason)) return true
  return /fotball|futsal/i.test(reason) && date < HOCKEY_SEASON_START
}
export const isApproved = (p: Person, a: Pick<Activity, 'idx' | 'date'>) => p.statuses[a.idx] === 'nei' && approvedReason(p.reasons[a.idx] ?? '', a.date, p.kind !== 'spiller')

export interface Stats {
  ja: number
  nei: number
  /** Avslag med godkjent grunn – med i invited (totalen) og i pct, men holdes utenfor pctGodkjent */
  godkjent: number
  /** Oppmøte når godkjent fravær ikke telles som fravær */
  pctGodkjent: number | null
  ikkeSvart: number
  invited: number
  pct: number | null
  streak: number
}

export function personStats(p: Person, acts: Activity[], noAnswerIsAbsent: boolean): Stats {
  let ja = 0, nei = 0, ikkeSvart = 0, godkjent = 0
  for (const a of acts) {
    const s = p.statuses[a.idx]
    if (s === 'ja') ja++
    else if (isApproved(p, a)) godkjent++
    else if (s === 'nei') nei++
    else if (s === 'ikke-svart') ikkeSvart++
  }
  // «Riktig» prosent: godkjent fravær er også fravær. pctGodkjent: godkjent fravær holdes utenfor.
  const denom = (noAnswerIsAbsent ? ja + nei + ikkeSvart : ja + nei) + godkjent
  // Sammenhengende «ja» bakover fra siste aktivitet
  let streak = 0
  for (let i = acts.length - 1; i >= 0; i--) {
    const s = p.statuses[acts[i].idx]
    if (s === null || isApproved(p, acts[i])) continue
    if (s !== 'ja') break
    streak++
  }
  return { ja, nei, godkjent, ikkeSvart, invited: ja + nei + ikkeSvart + godkjent, pct: denom ? ja / denom : null, pctGodkjent: denom - godkjent ? ja / (denom - godkjent) : null, streak }
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

/** Faste perioder, eller en måned på formen «åååå-mm» */
export type Period = 'alle' | 'host' | 'var' | '30' | '60' | `${number}-${number}`
export type ActType = 'alle' | 'kamp' | 'trening'

export const PERIODS: { id: Period; label: string }[] = [
  { id: 'host', label: 'Høst 2026 (fra aug.)' },
  { id: 'var', label: 'Vår 2026 (før aug.)' },
  { id: '30', label: 'Siste 30 dager' },
  { id: '60', label: 'Siste 60 dager' },
  { id: 'alle', label: 'Hele perioden' },
]

const SEASON_START = '2026-08-01'

const MONTH = /^\d{4}-\d{2}$/

/** Månedene som har aktiviteter med data, eldste først */
export function monthsWithData(acts: Pick<Activity, 'date' | 'hasData'>[]): { id: Period; label: string }[] {
  const ids = [...new Set(acts.filter(a => a.hasData).map(a => a.date.slice(0, 7)))].sort()
  return ids.map(id => {
    const label = new Date(`${id}-01T12:00:00`).toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' })
    return { id: id as Period, label: label.charAt(0).toUpperCase() + label.slice(1) }
  })
}

export const isPeriod = (v: string): v is Period => MONTH.test(v) || PERIODS.some(p => p.id === v)

export function inPeriod(a: Pick<Activity, 'date' | 'at'>, period: Period, now: Date) {
  if (MONTH.test(period)) return a.date.startsWith(period)
  switch (period) {
    case 'alle': return true
    case 'host': return a.date >= SEASON_START
    case 'var': return a.date < SEASON_START
    case '30':
    case '60': return now.getTime() - a.at.getTime() <= Number(period) * 86400000
    default: return true
  }
}

export function matchesType(a: Activity, t: ActType) {
  return t === 'alle' || a.kind === t
}

/** Laget en person vises med (spillerlag, eller laget en stabsperson er knyttet til) */
export const colorTeam = (p: Person): TeamId | null => p.teamId ?? p.staffTeam

/** Skal personen telle med i snitt og rangering? (Ikke sluttede spillere, ikke lagledere – de forventes ikke å møte) */
export const countsInStats = (p: Person) => !p.inactive && p.role !== 'Lagleder'
