#!/usr/bin/env node
// Henter oppmøte fra Rubic for en periode og skriver det i samme CSV-format som Rubic-eksporten,
// slik at fila kan lastes rett inn i appen.
//
// Eksporterte filer inneholder navn – de lagres i local/ (i .gitignore) eller der --dir peker.
//
// Bruk (eller bare: npm run export):
//   node scripts/rubic-csv.mjs --from 2026-08-01 --to 2026-11-12 [--org 7516] [--navn oppmote] [--out local/oppmote.csv]
//
// Innlogging: kopier scripts/.cookie.example til scripts/.cookie og lim inn Cookie-headeren
// fra en innlogget Rubic-fane (eller sett RUBIC_COOKIE). Cookien utløper når du logger ut av Rubic.
// scripts/.cookie står i .gitignore og skal ALDRI i git – den gir full tilgang til Rubic-kontoen din.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASE = 'https://connect.rubic.no'

// Aktivitetslisten («Mine aktiviteter»). Kroppen i listActivities er gjettet ut fra «query»-objektet
// Rubic sender tilbake i svaret – sjekk Payload i Network-fanen hvis den ikke virker.
const LIST_URL = process.env.RUBIC_LIST_URL ?? '/connectApi/api/my-activities'

// ---------- argumenter ----------
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? '' : all[i + 1]]] : acc), []),
)
// --grupper-liste: skriv ut gruppene du har aktiviteter i (siste år + et halvt år frem) og avslutt
const listMode = 'grupper-liste' in args
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
let from = args.from ?? (listMode ? day(-365) : undefined)
// --frem 28: ta med kommende aktiviteter så mange dager frem (når --to ikke er satt)
let to = args.to ?? day(listMode ? 180 : Number(args.frem ?? 0))
// Gyldige typer i gruppefila
const TYPES = ['oppmøte', 'ekstra', 'lag']
// --grupper scripts/grupper.csv: gruppene som skal hentes (erstatter --org og --ekstra)
// --velg: velg barn og grupper interaktivt (gruppefila brukes som forhåndsvalg og oppdateres med valget)
let groups = args.grupper ? readGroups(args.grupper, { allowEmpty: 'velg' in args }) : null
// Settes av applyGroups() – etter et eventuelt interaktivt valg
let orgs = (args.org ?? '7516').split(',').map(Number)
// --ekstra 66490=Early Bird: frivillige ekstratreninger – egen kategori «Ekstra», telles ikke i oppmøte
let EXTRA = new Map((args.ekstra ?? '').split(',').filter(Boolean).map(x => { const [id, ...n] = x.split('='); return [Number(id), n.join('=') || 'Ekstratrening'] }))
// Lag-grupper (type «lag»): org-id -> lagets kortnavn i Rubic («Hvit»). Deltakerne på lagets aktiviteter gir kolonnen «Lag».
let LAG = new Map()
function applyGroups() {
  if (!groups) return
  orgs = groups.map(g => g.id)
  EXTRA = new Map(groups.filter(g => g.type === 'ekstra').map(g => [g.id, g.navn || 'Ekstratrening']))
  console.error('Grupper:', groups.map(g => `${g.id} ${g.navn} (${g.type})`).join(', '))
}
applyGroups()
for (const id of EXTRA.keys()) if (!orgs.includes(id)) orgs.push(id)
// Tidsstempel i filnavnet (norsk tid), så nyeste uttrekk er lett å finne: oppmote_2026-05-01_2026-11-13_kl1142.csv
const stamp = new Intl.DateTimeFormat('nb-NO', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(':', '')
// --dir: mappe for fila (f.eks. ~/Downloads); standard er local/ i repoet
// Funksjon, fordi --velg kan endre perioden
const outFile = () => args.out ?? join(args.dir || join(HERE, '..', 'local'), `${args.navn ?? 'oppmote'}_${from}_${to}_kl${stamp}.csv`)
if (!from) die('Mangler --from åååå-mm-dd')
if (!LIST_URL) die('Sett RUBIC_LIST_URL (eller LIST_URL i skriptet) til URL-en for aktivitetslisten («paged?…»).')

const cookieFile = join(HERE, '.cookie')
// Kommentarlinjer (#) hoppes over, så forklaringen fra .cookie.example kan bli stående
const cookie = (process.env.RUBIC_COOKIE ?? (existsSync(cookieFile) ? readFileSync(cookieFile, 'utf8') : ''))
  .split('\n').filter(l => !l.trim().startsWith('#')).join('').trim()
if (!cookie || /LIM_INN/.test(cookie)) die(`Mangler cookie: kopier ${cookieFile}.example til ${cookieFile} og lim inn Cookie-headeren (se forklaringen i fila).`)

// ---------- HTTP ----------
const EXPIRED = `
  ✋ Cookien til Rubic er utløpt.
     1. Logg inn på https://connect.rubic.no i nettleseren
     2. Åpne utviklerverktøy (⌥⌘I) → Network → klikk et kall til connect.rubic.no
     3. Kopier verdien av «Cookie» under Request Headers
     4. Lim den inn i ${cookieFile} (erstatt alt som står der) og kjør på nytt
`
async function api(url, body, { soft = false } = {}) {
  const res = await fetch(url.startsWith('http') ? url : BASE + url, {
    method: body ? 'POST' : 'GET',
    headers: { cookie, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  // Utløpt cookie gir 401/403, eller en omdirigering til innloggingssiden (HTML i stedet for JSON)
  const isJson = (res.headers.get('content-type') ?? '').includes('json')
  if (res.status === 401 || res.status === 403 || (res.ok && !isJson)) die(EXPIRED)
  // soft: returner null i stedet for å stoppe (f.eks. gamle grupper som er slettet i Rubic)
  if (!res.ok && soft) return null
  if (!res.ok) die(`${res.status} ${res.statusText} for ${url}\n${(await res.text()).slice(0, 500)}`)
  return res.json()
}

// ---------- aktiviteter ----------
async function listActivities({ allOrgs = false } = {}) {
  const all = []
  const seen = new Set()
  for (let skip = 0; ; ) {
    // Bare felter som er testet mot Rubic – flere felter (f.eks. includePostCount) kan gi tomt svar
    // NB: organizationIDs i spørringen sendes IKKE – Rubic-filteret mister grupper som
    // «Felles trening gutter 2014 og 2015» (61925). Vi henter alt og filtrerer selv under.
    const r = await api(LIST_URL, {
      fromDate: `${from}T00:00:00Z`,
      toDate: `${to}T23:59:59Z`,
      take: 100,
      ...(skip ? { activityPaging: { skip } } : {}),
    })
    const page = (r.activities ?? []).filter(a => !seen.has(a.activityID))
    page.forEach(a => seen.add(a.activityID))
    all.push(...page)
    // Sjekk at Rubic faktisk brukte perioden vår (svaret ekko-er spørringen)
    if (skip === 0) console.error('Rubic svarte med query:', JSON.stringify({ fromDate: r.query?.fromDate, toDate: r.query?.toDate, organizationIDs: r.query?.organizationIDs }))
    if (!r.query?.activityPaging?.hasMoreResults || !(r.activities ?? []).length) break
    // Sidene overlapper – bruk skip-verdien Rubic sender tilbake, ikke antall mottatte
    skip = r.query.activityPaging.skip ?? skip + r.activities.length
  }
  // Lista kan inneholde hele feeden (også fotball) – behold bare valgte organisasjoner og perioden
  return all.filter(a => (allOrgs || orgs.includes(a.organizationID)) && local(a.startDate).date >= from && local(a.startDate).date <= to)
}

// ---------- grupper ----------
/**
 * Leser gruppefila: én linje per gruppe, «id,navn,type». type = oppmøte (standard), ekstra eller lag.
 * Linjer som starter med #, tomme linjer og overskriftslinja hoppes over.
 */
function readGroups(file, { allowEmpty = false } = {}) {
  if (!existsSync(file)) return allowEmpty ? [] : die(`Finner ikke gruppefila ${file}`)
  const groups = []
  for (const [n, raw] of readFileSync(file, 'utf8').split('\n').entries()) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const cols = line.split(',').map(c => c.trim())
    if (!/^\d+$/.test(cols[0])) {
      if (n === 0 || /^id$/i.test(cols[0])) continue // overskrift
      die(`${file} linje ${n + 1}: «${cols[0]}» er ikke en gruppe-id`)
    }
    const type = (cols.length >= 3 ? cols.at(-1) : 'oppmøte').toLowerCase().replace('oppmote', 'oppmøte') || 'oppmøte'
    if (!TYPES.includes(type)) die(`${file} linje ${n + 1}: type må være ${TYPES.map(t => `«${t}»`).join(', ')}, ikke «${type}»`)
    groups.push({ id: Number(cols[0]), navn: (cols.length >= 3 ? cols.slice(1, -1) : cols.slice(1)).join(',').trim(), type })
  }
  if (!groups.length && !allowEmpty) die(`Ingen grupper i ${file}`)
  return groups
}

/** Skriver gruppefila på nytt: kommentarene øverst beholdes, valgte grupper først, resten kommentert ut */
function writeGroups(file, chosen, others) {
  const head = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l, i, all) => l.startsWith('#') && all.slice(0, i).every(x => x.startsWith('#'))) : []
  const line = g => `${g.id},${g.navn},${g.type}`
  writeFileSync(file, [...head, 'id,navn,type', ...chosen.map(line), ...others.map(g => `# ${line(g)}`)].join('\n') + '\n')
}

/** «2026-05-01» -> «01.05.26» (norsk format i spørsmålene) */
const nb = iso => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}`

/** «01.05.26», «1.5.2026» eller «2026-05-01» -> «2026-05-01». Tomt svar -> null (behold forhåndsvalget). */
function parseDate(s) {
  if (!s) return null
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  const [y, mo, d] = m ? [m[1], m[2], m[3]] : (m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/)) ? [m[3].length === 2 ? `20${m[3]}` : m[3], m[2], m[1]] : []
  const iso = y && `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  if (!iso || Number.isNaN(Date.parse(iso)) || new Date(iso).toISOString().slice(0, 10) !== iso) {
    console.error(`  Skjønte ikke datoen «${s}» – bruk dd.mm.åå, f.eks. 01.05.26`)
    return null
  }
  return iso
}

/**
 * --velg: velg barn fra /coreapi/me, deretter hvilke av barnets grupper (og undergrupper) som skal med.
 * Forhåndsvalg og typer hentes fra gruppefila, og valget lagres tilbake dit.
 */
async function chooseGroups(defaults) {
  const { createInterface } = await import('node:readline/promises')
  const tty = process.stdin.isTTY
  const rl = tty ? createInterface({ input: process.stdin, output: process.stderr }) : null
  const ask = async (q, def = '') => (rl ? (await rl.question(q)).trim() : def)
  // Spør til svaret er en gyldig dato; Enter beholder forhåndsvalget
  const askDate = async (label, def) => {
    for (;;) {
      const a = await ask(`${label} (dd.mm.åå) [${nb(def)}]: `)
      if (!a) return def
      const d = parseDate(a)
      if (d) return d
      if (!rl) return def
    }
  }
  const defType = new Map(defaults.map(g => [g.id, g.type]))

  // 1. Barn
  const me = await api('/coreapi/me')
  const kids = (me.person?.children ?? []).filter(k => (k.roles ?? []).length)
  if (!kids.length) die('Fant ingen barn med grupper i Rubic (/coreapi/me).')
  const score = k => (k.roles ?? []).filter(r => defType.has(r.organizationID)).length
  let kid = kids.reduce((best, k) => (score(k) > score(best) ? k : best), kids[0])
  if (kids.length > 1) {
    console.error('\nBarn:')
    kids.forEach((k, i) => console.error(`  ${i + 1}. ${k.firstName} (født ${k.birthDate?.slice(0, 4) ?? '?'})`))
    const a = await ask(`Velg barn [${kids.indexOf(kid) + 1}]: `)
    if (a) kid = kids[Number(a) - 1] ?? die(`Ugyldig valg: ${a}`)
  }
  console.error(`→ ${kid.firstName}`)

  // Periode: forhåndsvalgt fra --from/--to. Norsk format dd.mm.åå (dd.mm.åååå og åååå-mm-dd går også).
  for (;;) {
    from = await askDate('Startdato', from)
    to = await askDate('Sluttdato', to)
    if (from <= to) break
    console.error(`  Startdato ${nb(from)} er etter sluttdato ${nb(to)} – prøv igjen.`)
    if (!rl) die('Startdato er etter sluttdato.')
  }
  console.error(`→ ${nb(from)}–${nb(to)}`)

  // 2. Barnets grupper + undergruppene deres (f.eks. lagene under Team 2015), med antall aktiviteter i perioden
  const counts = new Map()
  for (const a of await listActivities({ allOrgs: true })) counts.set(a.organizationID, (counts.get(a.organizationID) ?? 0) + 1)
  const items = new Map()
  // roleID 0 = medlem av hele klubben – for bredt til å være en aktivitetsgruppe
  for (const id of new Set(kid.roles.filter(r => r.roleID !== 0).map(r => r.organizationID))) {
    const o = await api(`/activityapi/organization/${id}`, undefined, { soft: true })
    if (!o) continue // gruppa finnes ikke lenger (f.eks. Tine 2025)
    if (!items.has(id)) items.set(id, { id, navn: o.organizationName, under: '' })
    for (const c of o.children ?? []) if (!items.has(c.organizationID)) items.set(c.organizationID, { id: c.organizationID, navn: c.organizationName, under: o.organizationName })
  }
  // Grupper i fila som barnet ikke er direkte med i (f.eks. de andre lagene) skal også kunne velges
  for (const g of defaults) if (!items.has(g.id)) items.set(g.id, { id: g.id, navn: g.navn, under: '' })
  const list = [...items.values()].sort((x, y) => Number(defType.has(y.id)) - Number(defType.has(x.id)) || (counts.get(y.id) ?? 0) - (counts.get(x.id) ?? 0))
  const chosen = new Map(list.filter(g => defType.has(g.id)).map(g => [g.id, defType.get(g.id)]))

  // 3. Velg
  const code = { o: 'oppmøte', e: 'ekstra', l: 'lag' }
  for (;;) {
    console.error(`\nGrupper for ${kid.firstName} (${nb(from)}–${nb(to)}):`)
    list.forEach((g, i) => {
      const t = chosen.get(g.id)
      console.error(`  ${t ? '[x]' : '[ ]'} ${String(i + 1).padStart(2)}. ${g.navn}${g.under ? ` (under ${g.under})` : ''} · ${counts.get(g.id) ?? 0} akt.${t ? `  → ${t}` : ''}`)
    })
    console.error('  Skriv nummer for å slå av/på, eller med type: 3o = oppmøte, 3e = ekstra, 3l = lag. Flere: «1 4l 5l».')
    const a = await ask('Endre, eller Enter for å kjøre: ')
    if (!a) break
    for (const tok of a.split(/[\s,]+/)) {
      const m = tok.match(/^(\d+)([oel]?)$/i)
      const g = m && list[Number(m[1]) - 1]
      if (!g) { console.error(`  Skjønte ikke «${tok}»`); continue }
      if (m[2]) chosen.set(g.id, code[m[2].toLowerCase()])
      else if (chosen.has(g.id)) chosen.delete(g.id)
      else chosen.set(g.id, 'oppmøte')
    }
  }
  rl?.close()
  const result = list.filter(g => chosen.has(g.id)).map(g => ({ id: g.id, navn: g.navn, type: chosen.get(g.id) }))
  if (!result.length) die('Ingen grupper valgt.')
  if (args.grupper) writeGroups(args.grupper, result, list.filter(g => !chosen.has(g.id)).map(g => ({ id: g.id, navn: g.navn, type: defType.get(g.id) ?? 'oppmøte' })))
  return result
}

/** --grupper-liste: alle grupper du har aktiviteter i, med undergrupper – klart til å kopiere inn i gruppefila */
async function printGroups() {
  const counts = new Map()
  for (const a of await listActivities({ allOrgs: true })) counts.set(a.organizationID, (counts.get(a.organizationID) ?? 0) + 1)
  console.log(`# Grupper med aktiviteter ${from}–${to} (id,navn,type  # antall aktiviteter)`)
  for (const [id, n] of [...counts].sort((x, y) => y[1] - x[1])) {
    const o = await api(`/activityapi/organization/${id}`)
    console.log(`${id},${o.organizationName},oppmøte  # ${n} aktiviteter`)
    for (const c of o.children ?? []) console.log(`#   undergruppe: ${c.organizationID},${c.organizationName}  # ${counts.get(c.organizationID) ?? 0} aktiviteter`)
  }
}

/** UTC -> norsk lokal dato og klokkeslett */
function local(iso) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('nb-NO', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(iso))
      .map(x => [x.type, x.value]),
  )
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, header: `${p.day}.${p.month}.${p.year} (${p.hour}:${p.minute})` }
}

// ---------- main ----------
if (listMode) {
  await printGroups()
  process.exit(0)
}
if ('velg' in args) {
  groups = await chooseGroups(groups ?? [])
  applyGroups()
}
// Kortnavnet til hvert lag («Hvit») – det er dette appen matcher mot lagene sine
for (const g of groups ?? []) if (g.type === 'lag') LAG.set(g.id, (await api(`/activityapi/organization/${g.id}`)).organizationShortName || g.navn)
const acts = (await listActivities()).sort((a, b) => a.startDate.localeCompare(b.startDate))
const statuses = new Map(acts.map(a => [a.activityStatus, 0]))
for (const a of acts) statuses.set(a.activityStatus, statuses.get(a.activityStatus) + 1)
console.error(`Fant ${acts.length} aktiviteter. activityStatus-fordeling:`, Object.fromEntries(statuses))

// Ukjent hvilken verdi som betyr «avlyst» – alt annet enn 0 holdes utenfor og listes, så vi lærer det
const cancelled = acts.filter(a => a.activityStatus !== 0)
for (const a of cancelled) console.error(`  Hopper over (activityStatus=${a.activityStatus}): ${local(a.startDate).header} ${a.title}`)
// Kategori ut fra tittelen. Legges bak datoen i kolonneoverskriften («15.11.2026 (08:30) Cup»);
// appen leser datoen som før og bruker kategorien der den trengs.
// --ekstra 66490=Early Bird: frivillige ekstratreninger – egen kategori «Ekstra», telles ikke i oppmøte

function category(a) {
  if (EXTRA.has(a.organizationID)) return 'Ekstra'
  const t = a.title.toLowerCase()
  // Lagenes egne aktiviteter er kamper («Kamprunde – Skedsmo»), med mindre tittelen sier trening
  if (LAG.has(a.organizationID) && !/trening/.test(t)) return /cup|turnering/.test(t) ? 'Cup' : 'Kamp'
  if (/kiosk|dugnad|møte/.test(t)) return 'Annet'
  if (/treningskamp/.test(t)) return 'Treningskamp'
  if (/cup|turnering|futsal/.test(t)) return 'Cup'
  if (/sommertrening/.test(t)) return 'Sommertrening'
  if (/trening/.test(t)) return 'Trening'
  if (/kamp| - /.test(t)) return 'Kamp'
  // Tittel som «U13/U12» med beskrivelse «Trening»
  if (/^\s*trening/i.test(a.description ?? '')) return 'Trening'
  return 'Annet'
}
const other = acts.filter(a => a.activityStatus === 0 && category(a) === 'Annet')
if (other.length && args.alle === undefined) console.error(`Hopper over ${other.length} «Annet»:`, [...new Set(other.map(a => a.title.trim()))].join(', '))
const only = args['kun-treninger'] !== undefined ? 'Trening' : null
// --alle: behold også «Annet» (påmelding, møter …) – som Rubic-eksporten. Avlyste holdes alltid utenfor.
const keepAll = args.alle !== undefined
const keep = acts.filter(a => a.activityStatus === 0 && (keepAll || category(a) !== 'Annet') && (!only || category(a) === only))
const cats = {}
for (const a of keep) cats[category(a)] = (cats[category(a)] ?? 0) + 1
console.error('Kategorier:', cats)

const CODE = { 3: '3', 5: '5', 1: '1' }
const people = new Map() // personID -> { name, codes[] }
const attendance = new Map()
const teamVotes = new Map() // personID -> Map(lag -> antall lagaktiviteter)
const roles = new Map() // personID -> Set(Rubic-roller som «SIL - Trener»)
for (const [i, a] of keep.entries()) {
  const parts = await api(`/activityapi/organization/${a.organizationID}/activity/${a.activityID}/participants`)
  for (const p of parts) {
    const pid = p.person.personID
    // Lag: spillere (activeParticipant) som er invitert til lagets aktiviteter
    if (LAG.has(a.organizationID) && p.activeParticipant) {
      const v = teamVotes.get(pid) ?? new Map()
      v.set(LAG.get(a.organizationID), (v.get(LAG.get(a.organizationID)) ?? 0) + 1)
      teamVotes.set(pid, v)
    }
    // Rolle: lagledere/trenere står som ikke-spillere med rollenavn
    if (!p.activeParticipant) for (const r of p.roleNames ?? []) if (r !== 'Member') (roles.get(pid) ?? roles.set(pid, new Set()).get(pid)).add(r)
    // --kun-spillere: dropp lagledere/administratorer (activeParticipant = false)
    if ('kun-spillere' in args && !p.activeParticipant) continue
    const id = p.person.personID
    const name = `${p.person.firstName} ${p.person.lastName}`.replace(/\s+/g, ' ').trim()
    const row = people.get(id) ?? { name, codes: new Array(keep.length).fill('') }
    // Kommentar (f.eks. grunn til avslag) legges bak koden: «5 | Hockeykamp». Appen leser koden før «|».
    const comment = (p.declinedReason || p.comment || '').replace(/\s+/g, ' ').replace(/\|/g, '/').trim()
    row.codes[i] = (CODE[p.signupStatus] ?? '') + (comment && CODE[p.signupStatus] ? ` | ${comment}` : '')
    people.set(id, row)
    attendance.set(p.attendanceStatus, (attendance.get(p.attendanceStatus) ?? 0) + 1)
  }
  process.stderr.write(`\r  Deltakere ${i + 1}/${keep.length}`)
}
console.error(`\nattendanceStatus-fordeling:`, Object.fromEntries(attendance))

// --stall <org>: bare personer som er invitert til minst halvparten av treningene i den organisasjonen
// (f.eks. 20718 = Gutter 2015). Holder ute 2014-gutter, jenter og andre som bare er med på enkeltaktiviteter.
if (args.stall) {
  const org = Number(args.stall)
  const tr = keep.map((a, i) => (a.organizationID === org && category(a) === 'Trening' ? i : -1)).filter(i => i >= 0)
  const before = people.size
  for (const [id, p] of people) {
    const invited = tr.filter(i => p.codes[i]).length
    if (invited < tr.length / 2) people.delete(id)
  }
  console.error(`--stall ${org}: ${tr.length} treninger, beholdt ${people.size} av ${before} personer`)
}

// Samme format som Rubic-eksporten: Navn, Totalt (påmeldt/ubesvart/avslått), én kolonne per aktivitet
const cell = v => (/[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
// «15.11.2026 (08:30) Cup · Dala Cup 2026 [180 min] [rubic:…]» – kategori, tittel og metadata etter klokkeslettet
// Varighet, sted og Rubic-lenke legges til som «[60 min] [sted:CC Amfi] [rubic:7516/uuid]» – appen skiller dem ut igjen
const minutes = a => (a.endDate && !a.fullDay ? Math.round((new Date(a.endDate) - new Date(a.startDate)) / 60000) : 0)
const place = a => (a.location ?? '').replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim()
const meta = a => `${minutes(a) > 0 ? ` [${minutes(a)} min]` : ''}${place(a) ? ` [sted:${place(a)}]` : ''} [rubic:${a.organizationID}/${a.activityID}]`
// Med gruppefil/--velg: kolonnene «Lag» og «Rolle», så appen kan bygge lagoppsettet uten salt
const withTeams = !!groups
const teamOf = id => [...(teamVotes.get(id) ?? [])].sort((x, y) => y[1] - x[1])[0]?.[0] ?? ''
const roleOf = id => [...(roles.get(id) ?? [])].join(' / ')
for (const [id, p] of people) { p.team = teamOf(id); p.role = roleOf(id) }
if (withTeams) {
  const t = {}
  // Trenere/lagledere står også på lagets kamper – de telles som stab, ikke spillere (appen gjør det samme)
  for (const p of people.values()) if (p.team && !p.role) t[p.team] = (t[p.team] ?? 0) + 1
  console.error(`Spillere per lag fra Rubic:`, t, `· stab med rolle: ${[...people.values()].filter(p => p.role).length}`)
  if (!LAG.size) console.error('  (Ingen grupper med type «lag» valgt – kolonnen «Lag» blir tom.)')
}
const header = ['Navn', 'Totalt', ...(withTeams ? ['Lag', 'Rolle'] : []), ...keep.map(a => `${local(a.startDate).header} ${category(a)} · ${EXTRA.get(a.organizationID) ?? a.title.replace(/\s+/g, ' ').trim()}${meta(a)}`)]
const rows = [...people.values()]
  .sort((x, y) => x.name.localeCompare(y.name, 'nb'))
  .map(p => {
    const n = c => p.codes.filter(x => x === c).length
    return [p.name, `(${n('3')}/${n('1')}/${n('5')})`, ...(withTeams ? [p.team, p.role] : []), ...p.codes]
  })
const out = outFile()
writeFileSync(out, [header, ...rows].map(r => r.map(cell).join(',')).join('\n') + '\n')
console.error(`Skrev ${rows.length} personer × ${keep.length} aktiviteter til ${out}`)

function die(msg) {
  console.error(msg)
  process.exit(1)
}
