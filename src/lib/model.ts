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
/** ekstra = frivillig ekstratilbud (f.eks. Early Bird) – vises, men telles ikke i oppmøte */
export type ActKind = 'trening' | 'kamp' | 'ekstra'

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
  /** Tittel fra uttrekket (kategori · tittel bak klokkeslettet), f.eks. «Early Bird» */
  title?: string
  tournament?: Tournament
  /** Storhamar-lag som spiller turnering denne datoen */
  playingTeams: TeamId[]
  /** Varighet i minutter (fra local/rubic-csv.mjs, «[60 min]» i overskriften) */
  minutes?: number
  /** Lenke til aktiviteten i Rubic (fra «[rubic:org/id]» i overskriften) */
  rubicUrl?: string
  /** Sted fra Rubic (fra «[sted:CC Amfi]» i overskriften) */
  place?: string
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
  /** Gruppenavnet fra scripts/rubic-csv.mjs («Navn [gruppe:Team 2015]»), brukes som tittel i appen */
  group?: string
  /** label = tekst etter klokkeslettet i overskriften, f.eks. kategorien fra local/rubic-csv.mjs («Cup») */
  cols: { date: string; time: string; label: string }[]
  /**
   * notes = kommentar per aktivitet (f.eks. grunn til avslag), fra celler på formen «5 | Hockeykamp».
   * team/role = kolonnene «Lag» og «Rolle» fra scripts/rubic-csv.mjs (tom streng når de mangler).
   */
  rows: { name: string; total: string; team: string; role: string; codes: Status[]; notes: string[] }[]
}

/** Leser en Rubic-oppmøteeksport: Navn, Totalt, og én kolonne per aktivitet «dd.mm.åååå (tt:mm)». */
export function parseExport(text: string): ParsedExport {
  const rows = parseCsv(text).filter(r => r.some(c => c.trim()))
  if (rows.length < 2) throw new Error('Fant ingen rader i CSV-filen.')
  const [header, ...body] = rows
  const nameCol = Math.max(0, header.findIndex(h => /navn/i.test(h)))
  const totalCol = header.findIndex(h => /totalt/i.test(h))
  const teamCol = header.findIndex(h => /^\s*lag\s*$/i.test(h))
  const roleCol = header.findIndex(h => /^\s*rolle\s*$/i.test(h))
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
    group: header[nameCol]?.match(/\[gruppe:([^\]]+)\]/)?.[1]?.trim(),
    cols,
    rows: body
      .map(r => ({
        name: norm(r[nameCol] ?? ''),
        total: totalCol >= 0 ? (r[totalCol] ?? '') : '',
        team: teamCol >= 0 ? norm(r[teamCol] ?? '') : '',
        role: roleCol >= 0 ? norm(r[roleCol] ?? '') : '',
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
  const all = new Map<string, { date: string; time: string; label: string }>()
  a.cols.forEach((c, i) => all.set(aKeys[i], c))
  // Vanlig Rubic-eksport har ingen kategori – behold kategori/tittel fra før
  b.cols.forEach((c, i) => all.set(bKeys[i], { ...c, label: c.label || all.get(bKeys[i])?.label || '' }))
  const order = [...all.keys()].sort()
  const cols = order.map(k => all.get(k)!)
  const colPos = new Map(order.map((k, i) => [k, i]))

  const people = new Map<string, { name: string; total: string; team: string; role: string; codes: Status[]; notes: string[] }>()
  for (const [x, xKeys] of [[a, aKeys], [b, bKeys]] as const) {
    for (const r of x.rows) {
      const k = fold(r.name)
      const p = people.get(k) ?? { name: r.name, total: '', team: '', role: '', codes: new Array<Status>(cols.length).fill(null), notes: new Array<string>(cols.length).fill('') }
      if (r.total) p.total = r.total
      // Lag og rolle: nyeste fil vinner, men en vanlig Rubic-eksport (uten kolonnene) visker ikke ut det vi har
      if (r.team) p.team = r.team
      if (r.role) p.role = r.role
      xKeys.forEach((k, i) => {
        const pos = colPos.get(k)!
        // Vanlig Rubic-eksport har ingen grunner – behold grunnen fra før så lenge statusen er den samme
        const keepNote = !r.notes[i] && p.codes[pos] === r.codes[i]
        p.codes[pos] = r.codes[i]
        if (!keepNote) p.notes[pos] = r.notes[i]
      })
      people.set(k, p)
    }
  }
  const cell = (v: string) => (/[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const extra = [...people.values()].some(p => p.team || p.role)
  // Gruppenavnet (tittelen) følger med: nyeste fil vinner, en vanlig Rubic-eksport uten navn visker det ikke ut
  const group = b.group ?? a.group
  const header = [group ? `Navn [gruppe:${group}]` : 'Navn', 'Totalt', ...(extra ? ['Lag', 'Rolle'] : []), ...cols.map(c => `${c.date.slice(8, 10)}.${c.date.slice(5, 7)}.${c.date.slice(0, 4)} (${c.time})${c.label ? ` ${c.label}` : ''}`)]
  const lines = [header, ...[...people.values()].map(p => [p.name, p.total, ...(extra ? [p.team, p.role] : []), ...p.codes.map((s, i) => (s ? UNCODE[s] + (p.notes[i] ? ` | ${p.notes[i]}` : '') : ''))])]
  return lines.map(l => l.map(cell).join(',')).join('\n') + '\n'
}

/** Ishaller i Hamar: Storhamar Ishall (SI2), CC Amfi (CC2) */
const ICE = /ishall|amfi|^SI\s*\d|^CC\s*\d/i

/**
 * Tid på is: treninger og ekstratreninger med kjent varighet på en isflate.
 * Kamper/cuper holdes utenfor (vanskelig å anslå istid), det samme gjør sommer- og barmarkstrening.
 */
export function iceMinutes(a: Activity): number {
  if (!a.minutes || (a.kind !== 'trening' && a.kind !== 'ekstra')) return 0
  if (/sommer|barmark|løp|styrke|futsal|møte|påmelding|cup|turnering/i.test(a.title ?? '')) return 0
  if (a.place && !ICE.test(a.place)) return 0
  return a.minutes
}

/** Minutter på is for en person: ja-svar på aktivitetene i `acts` */
export const personIceMinutes = (p: Person, acts: Activity[]) =>
  acts.reduce((sum, a) => sum + (p.statuses[a.idx] === 'ja' ? iceMinutes(a) : 0), 0)

/** Skiller ut metadata fra local/rubic-csv.mjs: «Trening · Tittel [60 min] [rubic:7516/uuid]» */
function parseLabel(label: string): { text: string; minutes?: number; rubicUrl?: string; place?: string } {
  const min = label.match(/\[(\d+) min\]/)
  const rubic = label.match(/\[rubic:(\d+)\/([\w-]+)\]/)
  const place = label.match(/\[sted:([^\]]*)\]/)
  return {
    text: label.replace(/\s*\[(\d+ min|rubic:[^\]]*|sted:[^\]]*)\]/g, '').trim(),
    place: place?.[1].trim() || undefined,
    minutes: min ? Number(min[1]) : undefined,
    rubicUrl: rubic ? `https://connect.rubic.no/organization/${rubic[1]}/activity/${rubic[2]}` : undefined,
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

/** Rubic-rolle («SIL - Trener», «Ass. trener», «Hovedtrener» …) -> stabsrolle i appen */
function staffRole(role: string): StaffRole | null {
  if (/hovedtrener/i.test(role)) return 'Hovedtrener'
  if (/trener/i.test(role)) return 'Trener'
  if (/lagleder/i.test(role)) return 'Lagleder'
  if (/materialforvalter/i.test(role)) return 'Materialforvalter'
  return null
}

/**
 * Er dette et lagoppsett (Navn,Lag,Nr,Rolle) og ikke en oppmøteeksport? Kjennes på kolonnene og at det ikke er datokolonner.
 */
export function isRosterCsv(text: string): boolean {
  const header = parseCsv(text)[0] ?? []
  const has = (re: RegExp) => header.some(h => re.test(h.trim()))
  return has(/^navn$/i) && (has(/^lag$/i) || has(/^nr$/i)) && !header.some(h => /\d{1,2}\.\d{1,2}\.\d{4}\s*\(/.test(h))
}

/**
 * Leser et lagoppsett som CSV: «Navn,Lag,Nr,Rolle» (rekkefølgen spiller ingen rolle, bare Navn er påkrevd).
 * Rolle: Spiller (eller tom), Hovedtrener, Trener, Lagleder, Materialforvalter. Lag: kortnavn som «Hvit».
 * Lagoppsettet lagres bare i nettleseren – ingen kryptering trengs.
 */
export function parseRosterCsv(text: string): Map<string, RosterEntry> {
  const rows = parseCsv(text).filter(r => r.some(c => c.trim()))
  if (rows.length < 2) throw new Error('Fant ingen personer i lagoppsettet.')
  const [header, ...body] = rows
  const col = (re: RegExp) => header.findIndex(h => re.test(h.trim()))
  const [nameCol, teamCol, nrCol, roleCol] = [col(/^navn$/i), col(/^lag$/i), col(/^nr$/i), col(/^rolle$/i)]
  if (nameCol < 0) throw new Error('Lagoppsettet mangler kolonnen «Navn».')
  const byFold = new Map(teams.flatMap(t => [[fold(t.short), t.id], [fold(t.name), t.id], [t.id as string, t.id]]))
  const roster = new Map<string, RosterEntry>()
  body.forEach((r, i) => {
    const name = norm(r[nameCol] ?? '')
    if (!name) return
    const cell = (c: number) => (c >= 0 ? norm(r[c] ?? '') : '')
    const teamText = cell(teamCol)
    const team = teamText ? byFold.get(fold(teamText)) : undefined
    if (teamText && !team) throw new Error(`Linje ${i + 2}: ukjent lag «${teamText}». Gyldige lag: ${teams.map(t => t.short).join(', ')}.`)
    const roleText = cell(roleCol)
    const role = roleText && !/^spiller$/i.test(roleText) ? staffRole(roleText) : null
    if (roleText && !role && !/^spiller$/i.test(roleText)) throw new Error(`Linje ${i + 2}: ukjent rolle «${roleText}». Bruk Spiller, Hovedtrener, Trener, Lagleder eller Materialforvalter.`)
    const e: RosterEntry = { full: name }
    if (role) e.staff = { role, team: team ?? null }
    else if (team) e.player = { team, short: name.split(' ')[0], nr: cell(nrCol) || null }
    else return // spiller uten lag – ingenting å legge til
    roster.set(fold(name), e)
  })
  return roster
}

/**
 * Lagoppsett rett fra CSV-en (kolonnene «Lag» og «Rolle» fra scripts/rubic-csv.mjs), uten salt.
 * Lag = kortnavnet på laget i Rubic («Hvit», «Rød» …), som matches mot lagene i sil15.js.
 * Tomt kart når fila ikke har kolonnene (vanlig Rubic-eksport) – da trengs det krypterte lagoppsettet.
 */
export function rosterFromCsv(files: CsvFile[]): Map<string, RosterEntry> {
  const byFold = new Map(teams.map(t => [fold(t.short), t.id]))
  const roster = new Map<string, RosterEntry>()
  for (const f of files) {
    for (const r of parseExport(f.text).rows) {
      const team = r.team ? byFold.get(fold(r.team)) : undefined
      const role = r.role ? staffRole(r.role) : null
      if (!team && !role) continue
      const k = fold(r.name)
      const e = roster.get(k) ?? { full: r.name }
      // Trenere/lagledere står også som deltakere på lagets kamper – med rolle er de stab (for det laget), ikke spillere
      if (role) e.staff = { role, team: team ?? null }
      else if (team) e.player = { team, short: r.name.split(' ')[0], nr: null }
      roster.set(k, e)
    }
  }
  return roster
}

/**
 * Slår sammen lagoppsettet fra CSV-en (Rubic) med det krypterte (draktnummer, kallenavn, rettelser …).
 * Lag og rolle fra Rubic vinner; resten hentes fra det krypterte der det finnes.
 */
export function mergeRosters(fromCsv: Map<string, RosterEntry>, sealed: Map<string, RosterEntry> | null): Map<string, RosterEntry> {
  if (!sealed) return fromCsv
  const out = new Map(sealed)
  for (const [k, c] of fromCsv) {
    const s = sealed.get(k)
    if (!s) out.set(k, c)
    else out.set(k, {
      ...s,
      // Laget kommer fra Rubic, så koblingen er ikke lenger usikker. Draktnummer gjelder bare på samme lag.
      player: c.player ? { ...c.player, ...s.player, team: c.player.team, nr: s.player?.team === c.player.team ? s.player.nr : null, uncertain: false } : c.staff ? undefined : s.player,
      staff: c.staff ?? (c.player ? undefined : s.staff),
    })
  }
  return out
}

/**
 * @param roster  Opplåst lagoppsett (nøkkel = fold(fullt navn)), se rosterCrypto.unlock
 * @param rosterSize  Antall personer i det krypterte lagoppsettet
 * @param allPlayers  Ingen laginfo (Rubic-eksport uten salt): alle uten stabsrolle regnes som spillere, uten lag
 */
export function buildModel(main: CsvFile, matchFiles: CsvFile[], overrides: Overrides, roster: Map<string, RosterEntry>, rosterSize: number, allPlayers = false): Model {
  const base = parseExport(main.text)
  const matches = matchFiles.map(f => ({ f, x: parseExport(f.text) }))

  const activities: Activity[] = base.cols.map((c, i) => {
    const meta = parseLabel(c.label)
    const [cat, ...rest] = meta.text.split(' · ')
    // Kategori fra uttrekket: «Kamp» = kamp (som en kampeksport), «Ekstra» = frivillig ekstratrening
    const a = makeActivity(i, c.date, c.time, cat === 'Ekstra' ? 'ekstra' : cat === 'Kamp' ? 'kamp' : 'trening', main.name)
    if (rest.length) a.title = rest.join(' · ')
    a.minutes = meta.minutes
    a.rubicUrl = meta.rubicUrl
    a.place = meta.place
    return a
  })
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
      kind: teamId ? 'spiller' : st ? 'stab' : allPlayers ? 'spiller' : 'annen',
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
  // Personer som har sluttet (markert i lagoppsettet) vises ikke noe sted.
  // Personer som bare finnes på ekstratreninger (andre årganger på Early Bird) tas heller ikke med.
  const people = [...byId.values()].filter(
    p => !roster.get(p.id)?.removed && activities.some(a => a.kind !== 'ekstra' && p.statuses[a.idx] !== null),
  )

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
  // Samme kamp både i hovedfila og som egen kampeksport (samme tid og lag) – vis den bare én gang
  for (const a of activities) {
    if (a.kind !== 'kamp' || a.source === main.name || !a.hasData) continue
    if (activities.some(b => b.kind === 'kamp' && b.source === main.name && b.hasData && b.date === a.date && b.time === a.time && b.team === a.team)) a.hasData = false
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
export const APPROVED_REASON = /fotball|futsal|hockey|syk|obos/i

/**
 * Hockeysesongen starter (siste seriekamp i fotball for årgangen var 29.09.2026).
 * Fra og med denne datoen er fotball/futsal ikke lenger godkjent grunn for hockeyfravær.
 */
export const HOCKEY_SEASON_START = '2026-10-01'

/** Godkjent grunn for avslag på en hockeyaktivitet: syk, begravelse og Obos-turnering alltid, jobb for støtteapparat, fotball/futsal bare før hockeysesongen */
export function approvedReason(reason: string, date: string, staff = false) {
  if (/syk|begravelse|obos/i.test(reason)) return true
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
  /**
   * Treninger spilleren ikke var invitert til (f.eks. før spilleren begynte). Teller som fravær, så alle
   * spillere har like mange mulige treninger. Med i invited og pct. Gjelder bare spillere og treninger.
   */
  ikkeInvitert: number
  invited: number
  pct: number | null
  /** Sammenhengende «ja» bakover fra siste aktivitet */
  streak: number
  /** Lengste sammenhengende rekke med «ja» i perioden */
  maxStreak: number
}

export function personStats(p: Person, acts: Activity[], noAnswerIsAbsent: boolean): Stats {
  let ja = 0, nei = 0, ikkeSvart = 0, godkjent = 0, ikkeInvitert = 0
  for (const a of acts) {
    const s = p.statuses[a.idx]
    if (s === null) {
      // Alle spillere skal ha like mange mulige treninger – ikke invitert (f.eks. ny spiller) = fravær
      if (p.kind === 'spiller' && a.kind === 'trening') ikkeInvitert++
      continue
    }
    if (s === 'ja') ja++
    else if (isApproved(p, a)) godkjent++
    else if (s === 'nei') nei++
    else if (s === 'ikke-svart') ikkeSvart++
  }
  // «Riktig» prosent: godkjent fravær er også fravær. pctGodkjent: godkjent fravær holdes utenfor.
  const denom = (noAnswerIsAbsent ? ja + nei + ikkeSvart : ja + nei) + godkjent + ikkeInvitert
  // Sammenhengende «ja» bakover fra siste aktivitet
  let streak = 0
  for (let i = acts.length - 1; i >= 0; i--) {
    const s = p.statuses[acts[i].idx]
    if (s === null || isApproved(p, acts[i])) continue
    if (s !== 'ja') break
    streak++
  }
  // Lengste rekke: ikke invitert og godkjent fravær bryter ikke rekken (samme regel som over)
  let maxStreak = 0
  for (let i = 0, run = 0; i < acts.length; i++) {
    const s = p.statuses[acts[i].idx]
    if (s === null || isApproved(p, acts[i])) continue
    run = s === 'ja' ? run + 1 : 0
    maxStreak = Math.max(maxStreak, run)
  }
  return { ja, nei, godkjent, ikkeSvart, ikkeInvitert, invited: ja + nei + ikkeSvart + godkjent + ikkeInvitert, pct: denom ? ja / denom : null, pctGodkjent: denom - godkjent ? ja / (denom - godkjent) : null, streak, maxStreak }
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
export type ActType = 'alle' | 'kamp' | 'trening' | 'ekstra'

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
  // «Alle» = kamper og treninger – ekstratreninger bare når de velges eksplisitt
  return t === 'alle' ? a.kind !== 'ekstra' : a.kind === t
}

/** Laget en person vises med (spillerlag, eller laget en stabsperson er knyttet til) */
export const colorTeam = (p: Person): TeamId | null => p.teamId ?? p.staffTeam

/** Sortering på lag (spillere før stab) og draktnummer – samme som standard i spillerlista */
export const teamRank = (p: Person) => (p.kind === 'stab' ? 50 : 0) + (colorTeam(p) ? teams.findIndex(t => t.id === colorTeam(p)) : 99)
export const byTeamNr = (a: Person, b: Person) =>
  teamRank(a) - teamRank(b) || (a.nr ? Number(a.nr) : 999) - (b.nr ? Number(b.nr) : 999) || a.name.localeCompare(b.name, 'nb')

/** Fornavn, med initialer for resten av navnet når flere i `others` har samme fornavn («Ola ON») */
export function shortName(p: Person, others: Person[]) {
  const [first, ...rest] = p.name.split(/\s+/)
  const dup = others.some(o => o.id !== p.id && o.name.split(/\s+/)[0] === first)
  return dup && rest.length ? `${first} ${rest.map(x => x[0]).join('')}` : first
}

/** Skal personen telle med i snitt og rangering? (Ikke sluttede spillere, ikke lagledere – de forventes ikke å møte) */
export const countsInStats = (p: Person) => !p.inactive && p.role !== 'Lagleder'
