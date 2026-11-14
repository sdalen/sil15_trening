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
const from = args.from
// --frem 28: ta med kommende aktiviteter så mange dager frem (når --to ikke er satt)
const to = args.to ?? new Date(Date.now() + Number(args.frem ?? 0) * 86400000).toISOString().slice(0, 10)
const orgs = (args.org ?? '7516').split(',').map(Number)
// --ekstra 66490=Early Bird: frivillige ekstratreninger – egen kategori «Ekstra», telles ikke i oppmøte
const EXTRA = new Map((args.ekstra ?? '').split(',').filter(Boolean).map(x => { const [id, ...n] = x.split('='); return [Number(id), n.join('=') || 'Ekstratrening'] }))
for (const id of EXTRA.keys()) if (!orgs.includes(id)) orgs.push(id)
// Tidsstempel i filnavnet (norsk tid), så nyeste uttrekk er lett å finne: oppmote_2026-05-01_2026-11-13_kl1142.csv
const stamp = new Intl.DateTimeFormat('nb-NO', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(':', '')
// --dir: mappe for fila (f.eks. ~/Downloads); standard er local/ i repoet
const out = args.out ?? join(args.dir || join(HERE, '..', 'local'), `${args.navn ?? 'oppmote'}_${from}_${to}_kl${stamp}.csv`)
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
async function api(url, body) {
  const res = await fetch(url.startsWith('http') ? url : BASE + url, {
    method: body ? 'POST' : 'GET',
    headers: { cookie, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  // Utløpt cookie gir 401/403, eller en omdirigering til innloggingssiden (HTML i stedet for JSON)
  const isJson = (res.headers.get('content-type') ?? '').includes('json')
  if (res.status === 401 || res.status === 403 || (res.ok && !isJson)) die(EXPIRED)
  if (!res.ok) die(`${res.status} ${res.statusText} for ${url}\n${(await res.text()).slice(0, 500)}`)
  return res.json()
}

// ---------- aktiviteter ----------
async function listActivities() {
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
  return all.filter(a => orgs.includes(a.organizationID) && local(a.startDate).date >= from && local(a.startDate).date <= to)
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
for (const [i, a] of keep.entries()) {
  const parts = await api(`/activityapi/organization/${a.organizationID}/activity/${a.activityID}/participants`)
  for (const p of parts) {
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
const header = ['Navn', 'Totalt', ...keep.map(a => `${local(a.startDate).header} ${category(a)} · ${EXTRA.get(a.organizationID) ?? a.title.replace(/\s+/g, ' ').trim()}${meta(a)}`)]
const rows = [...people.values()]
  .sort((x, y) => x.name.localeCompare(y.name, 'nb'))
  .map(p => {
    const n = c => p.codes.filter(x => x === c).length
    return [p.name, `(${n('3')}/${n('1')}/${n('5')})`, ...p.codes]
  })
writeFileSync(out, [header, ...rows].map(r => r.map(cell).join(',')).join('\n') + '\n')
console.error(`Skrev ${rows.length} personer × ${keep.length} aktiviteter til ${out}`)

function die(msg) {
  console.error(msg)
  process.exit(1)
}
