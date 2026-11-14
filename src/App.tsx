import { useEffect, useMemo, useState } from 'react'
import { teams, type TeamId } from './data/sil15.js'
import {
  buildModel, byTeamNr, colorTeam, fold, mergeExports, mergeRosters, parseExport, inPeriod, isPeriod, matchesType, monthsWithData, namesIn, personStats, PERIODS, rosterFromCsv,
  type ActType, type CsvFile, type Model, type Overrides, type Period, type Person,
} from './lib/model'
import { unlock, type RosterEntry, type SealedEntry } from './lib/rosterCrypto'
import sealedRoster from './data/roster.enc.json'
import { store, THEME } from './lib/ui'
import type { Ctx, Group, TeamFilter } from './ctx'
import Overview from './components/Overview'
import PlayersView from './components/PlayersView'
import ActivitiesView from './components/ActivitiesView'
import MatrixView from './components/MatrixView'
import PersonDrawer from './components/PersonDrawer'
import KamperView from './components/KamperView'
import FurnesView from './components/FurnesView'
import StatsView from './components/StatsView'
import InfoView from './components/InfoView'

// Lagoppsettet ligger kryptert per person – låses opp med navnene i CSV-ene som lastes opp
const SEALED = sealedRoster as SealedEntry[]

type Tab = 'oversikt' | 'spillere' | 'kamper' | 'aktiviteter' | 'matrise' | 'statistikk'
const TABS: { id: Tab; label: string }[] = [
  { id: 'oversikt', label: 'Oversikt' },
  { id: 'spillere', label: 'Spillere' },
  { id: 'kamper', label: 'Kamper' },
  { id: 'aktiviteter', label: 'Aktiviteter' },
  { id: 'matrise', label: 'Matrise' },
  { id: 'statistikk', label: 'Statistikk' },
]

export default function App() {
  // Sammenslått oppmøteeksport. `files` = filene som er fylt på (nyeste sist).
  const [csv, setCsv] = useState<{ text: string; name: string; files?: string[] } | null>(() => store.get('csv', null))
  // Hemmelig salt for lagoppsettet – skrives inn av brukeren, lagres bare i denne nettleseren
  const [salt, setSalt] = useState<string>(() => store.get('rosterSalt', ''))
  // Med salt: det krypterte lagoppsettet (draktnummer, kallenavn, rettelser). Uten: bare Lag/Rolle fra CSV-en.
  const [useSalt, setUseSalt] = useState<boolean>(() => store.get('useSalt', !!store.get('rosterSalt', '')))
  const [extraMatches, setExtraMatches] = useState<CsvFile[]>(() => store.get('matchCsvs', []))
  const [overrides, setOverrides] = useState<Overrides>(() => store.get('overrides', {}))
  const [tab, setTab] = useState<Tab>(() => store.get('tab', 'oversikt'))
  const [group, setGroup] = useState<Group>(() => store.get('group', 'spillere'))
  const [team, setTeam] = useState<TeamFilter>(() => {
    const t = store.get<string>('team', 'alle')
    // «uten» (Felles) finnes ikke lenger som knapp – de ligger under Alle
    return teams.some(x => x.id === t) ? (t as TeamFilter) : 'alle'
  })
  const [period, setPeriod] = useState<Period>(() => {
    const p = store.get<string>('period', 'host')
    return isPeriod(p) ? p : 'host'
  })
  const [actType, setActType] = useState<ActType>(() => {
    const t = store.get<string>('actType', 'alle')
    return t === 'kamp' || t === 'trening' || t === 'ekstra' ? t : 'alle'
  })
  // «Ikke svart» teller alltid som fravær
  const noAnswerIsAbsent = true
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [navOrder, setNavOrder] = useState<string[] | null>(null)
  const [focusAct, setFocusAct] = useState<number | null>(null)
  const [now, setNow] = useState(() => new Date())
  const [furnes, setFurnes] = useState<boolean>(() => store.get('furnes', false))
  const [showInfo, setShowInfo] = useState(false)
  // Anonymiser: slører alle navn (for skjermdeling). Huskes i nettleseren.
  const [anon, setAnon] = useState<boolean>(() => store.get('anon', false))
  useEffect(() => {
    store.set('anon', anon || undefined)
    document.documentElement.toggleAttribute('data-anon', anon)
  }, [anon])
  // Lagret fane fra før Info ble flyttet til ikon
  useEffect(() => { if (!TABS.some(t => t.id === tab)) setTab('oversikt') }, [tab])
  useEffect(() => store.set('furnes', furnes || undefined), [furnes])

  useEffect(() => store.set('csv', csv ?? undefined), [csv])
  useEffect(() => store.set('rosterSalt', salt || undefined), [salt])
  useEffect(() => store.set('useSalt', useSalt), [useSalt])
  useEffect(() => store.set('matchCsvs', extraMatches), [extraMatches])
  useEffect(() => store.set('overrides', overrides), [overrides])
  useEffect(() => store.set('tab', tab), [tab])
  useEffect(() => store.set('group', group), [group])
  useEffect(() => store.set('team', team), [team])
  useEffect(() => store.set('period', period), [period])
  useEffect(() => store.set('actType', actType), [actType])
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Lås opp lagoppsettet for navnene i filene. Forrige resultat brukes mens nye navn låses opp.
  const [unlocked, setUnlocked] = useState<{ salt: string; roster: Map<string, RosterEntry> } | null>(null)
  useEffect(() => {
    if (!csv || !salt || !useSalt) return
    let names: string[]
    try {
      names = namesIn([csv, ...extraMatches])
    } catch {
      return
    }
    let stop = false
    unlock(SEALED, names, salt).then(r => !stop && setUnlocked({ salt, roster: r }))
    return () => {
      stop = true
    }
  }, [csv, extraMatches, salt, useSalt])
  const sealed = useSalt && salt && unlocked?.salt === salt ? unlocked.roster : null
  // Lag og roller rett fra CSV-en (npm run export_all) – da trengs ikke saltet
  const csvRoster = useMemo(() => {
    if (!csv) return new Map<string, RosterEntry>()
    try {
      return rosterFromCsv([csv, ...extraMatches])
    } catch {
      return new Map<string, RosterEntry>()
    }
  }, [csv, extraMatches])
  const hasCsvRoster = csvRoster.size > 0
  // Tittel fra gruppenavnet i eksporten («Team 2015»), ellers U12
  const title = useMemo(() => {
    try {
      return (csv && parseExport(csv.text).group) || 'U12'
    } catch {
      return 'U12'
    }
  }, [csv])
  useEffect(() => {
    document.title = `${title} – Oppmøte`
  }, [title])
  // Med salt: vent til riktig salt har låst opp lagoppsettet (Lag/Rolle fra CSV-en legges oppå).
  // Uten salt: lagoppsettet fra CSV-en – eller ingenting (vanlig Rubic-eksport), og da vises alle uten lag.
  const roster = useMemo(
    () => (useSalt ? (sealed && sealed.size > 0 ? mergeRosters(csvRoster, sealed) : null) : csvRoster),
    [useSalt, sealed, csvRoster],
  )
  // Uten salt og fila mangler Lag-kolonnen (vanlig Rubic-eksport) – alle vises som spillere uten lag
  const noTeams = !!csv && !useSalt && !hasCsvRoster
  // Ingen treff i det hele tatt = saltet passer ikke (eller fila er fra et annet lag)
  const wrongSalt = !!sealed && sealed.size === 0
  // Personer i det krypterte lagoppsettet som ikke finnes i filene (bare relevant når saltet er brukt)
  const rosterSize = (roster?.size ?? 0) + (sealed && sealed.size > 0 ? SEALED.length - sealed.size : 0)

  const result = useMemo((): { model: Model | null; error?: string } => {
    if (!csv || !roster) return { model: null }
    try {
      return { model: buildModel(csv, extraMatches, overrides, roster, rosterSize, noTeams) }
    } catch (e) {
      return { model: null, error: (e as Error).message }
    }
  }, [csv, extraMatches, overrides, roster, rosterSize, noTeams])
  const model = result.model

  const ctx = useMemo<Ctx | null>(() => {
    if (!model) return null
    const periodActs = model.activities.filter(a => a.hasData && inPeriod(a, period, now) && matchesType(a, actType))
    const pastActs = periodActs.filter(a => a.at < now)
    const q = fold(query)
    // Spillere: kun spillere. Stab: trenere/lagledere/materialforvaltere + andre som ikke er spillere.
    const inGroup = (p: Person) => (group === 'spillere' ? p.kind === 'spiller' : p.kind !== 'spiller')
    const teamFilter = group === 'spillere' && team === 'uten' ? 'alle' : team
    const inTeam = (p: Person) =>
      teamFilter === 'alle' ? true : teamFilter === 'uten' ? colorTeam(p) === null : colorTeam(p) === teamFilter
    const matchesQuery = (p: Person) => {
      const t = colorTeam(p)
      const fields = [p.name, p.short ?? '', p.nr ?? '', p.role ?? '', t ? teams.find(x => x.id === t)!.short : 'uten lag']
      return !q || q.split(' ').every(w => fields.some(f => fold(f).includes(w)))
    }
    const groupPeople = model.people.filter(inGroup)
    const population = groupPeople.filter(inTeam)
    const visible = population.filter(matchesQuery)
    const stats = new Map(model.people.map(p => [p.id, personStats(p, pastActs, noAnswerIsAbsent)]))
    const periodExtra = model.activities.filter(a => a.kind === 'ekstra' && a.hasData && inPeriod(a, period, now))
    const extraActs = periodExtra.filter(a => a.at < now)
    const extraStats = new Map(model.people.map(p => [p.id, personStats(p, extraActs, noAnswerIsAbsent)]))
    const extraLabel = extraActs.find(a => a.title)?.title ?? 'ekstratreninger'
    return {
      model, now, periodActs, pastActs, group, groupPeople, population, visible, stats, extraStats, extraLabel, periodExtra,
      team: teamFilter, query: q, noAnswerIsAbsent,
      openPerson: (id: string, order?: string[]) => {
        setSelected(id)
        setNavOrder(order ?? null)
      },
      openActivity: (idx: number) => {
        setFocusAct(idx)
        setTab('aktiviteter')
      },
      focusAct,
      clearFocus: () => setFocusAct(null),
    }
  }, [model, now, period, actType, group, team, query, noAnswerIsAbsent, focusAct])


  async function addMatchFiles(files: FileList) {
    const added: CsvFile[] = []
    for (const file of Array.from(files)) {
      const text = await file.text()
      try {
        parseExport(text)
        added.push({ name: file.name, text })
      } catch (e) {
        alert(`Kunne ikke lese ${file.name}: ${(e as Error).message}`)
      }
    }
    setExtraMatches(m => [...m.filter(x => !added.some(a => a.name === x.name)), ...added])
  }

  async function onUpload(file: File) {
    const text = await file.text()
    try {
      parseExport(text)
      if (!csv) {
        setCsv({ text, name: file.name, files: [file.name] })
      } else {
        // Fyll på: nye aktiviteter legges til, eksisterende oppdateres fra den nye fila
        const files = [...(csv.files ?? [csv.name]), file.name]
        setCsv({ text: mergeExports(csv.text, text), name: file.name, files })
      }
    } catch (e) {
      alert(`Kunne ikke lese ${file.name}: ${(e as Error).message}`)
    }
  }

  function clearData() {
    if (!confirm('Fjerne opplastede filer og salt fra denne nettleseren?')) return
    setCsv(null)
    setExtraMatches([])
    setSalt('')
    setUnlocked(null)
  }

  const info = showInfo && <InfoModal onClose={() => setShowInfo(false)} />

  const anonButton = <AnonButton on={anon} onClick={() => setAnon(a => !a)} />
  if (furnes) return <FurnesView onBack={() => setFurnes(false)} extra={anonButton} />

  if (!model || !ctx) {
    return (
      <>
      {info}
      <Landing
        onInfo={() => setShowInfo(true)}
        onFurnes={() => setFurnes(true)}
        title={title}
        csvName={csv ? ((csv.files?.length ?? 1) > 1 ? `${csv.files!.length} filer` : csv.name) : null}
        salt={salt}
        wrongSalt={wrongSalt}
        useSalt={useSalt}
        onUseSalt={setUseSalt}
        noTeams={noTeams}
        loading={!!csv && useSalt && !!salt && !sealed}
        error={result.error}
        onSalt={setSalt}
        onUpload={onUpload}
        onClear={clearData}
      />
      </>
    )
  }

  const person = selected ? model.people.find(p => p.id === selected) : undefined

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 bg-navy text-white shadow-lg shadow-navy/20">
        <div className="mx-auto max-w-6xl px-4 py-3">
          <div className="flex items-center gap-3">
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Storhamar Yngres" className="h-9 w-auto shrink-0 drop-shadow sm:h-10" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg leading-tight font-extrabold tracking-tight">
                {title} <span className="text-sh-yellow">Oppmøte</span>
              </h1>
              <p className="truncate text-[11px] text-white/55">
                {csv && (csv.files?.length ?? 1) > 1 ? `${csv.files!.length} Rubic-filer` : (csv?.name ?? 'Rubic-eksport')} · {model.people.filter(p => p.kind === 'spiller').length} {noTeams ? 'personer uten lag' : 'spillere'} · {model.people.filter(p => p.kind === 'stab').length} i støtteapparat · {model.activities.length} aktiviteter
              </p>
            </div>
            <label className={GHOST} title="Legg til CSV">
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" /></svg>
              <span>CSV</span>
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => e.target.files?.[0] && onUpload(e.target.files[0])} />
            </label>
            {anonButton}
            <InfoButton onClick={() => setShowInfo(true)} />
            <button onClick={() => setFurnes(true)} className={`${GHOST} text-emerald-200 ring-emerald-400/40 hover:bg-emerald-400/15`}>
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Furnes
            </button>
            <button
              onClick={() => setUseSalt(s => !s)}
              className="hidden shrink-0 text-[11px] text-white/45 hover:text-white sm:block"
              title={useSalt ? 'Bytt til lag fra CSV-en (uten draktnummer og rettelser)' : 'Bytt til kryptert lagoppsett (draktnummer, kallenavn, rettelser)'}
            >
              {useSalt ? '🔒 Med salt' : '🔓 Uten salt'}
            </button>
            <button onClick={clearData} className="hidden shrink-0 text-[11px] text-white/45 hover:text-white sm:block" title="Fjern opplastede filer fra denne nettleseren">
              Fjern data
            </button>
          </div>

          <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
            <div className="relative w-full md:max-w-md lg:max-w-lg">
              <svg className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-white/45 peer-focus:text-slate-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.45 4.39l3.08 3.08a.75.75 0 11-1.06 1.06l-3.08-3.08A7 7 0 012 9z" clipRule="evenodd" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={group === 'spillere' ? 'Søk etter spiller, draktnummer eller lag …' : 'Søk etter navn, rolle eller lag …'}
                className="h-9 w-full rounded-lg bg-white/10 pr-3 pl-9 text-sm text-white ring-1 ring-white/10 transition placeholder:text-white/45 hover:bg-white/15 focus:bg-white focus:text-slate-900 focus:ring-2 focus:ring-sh-yellow/60 focus:outline-none focus:placeholder:text-slate-400"
              />
            </div>
            <div className="flex shrink-0 gap-2 overflow-x-auto md:ml-auto">
              <div className={SEGMENT} role="radiogroup" aria-label="Vis spillere eller støtteapparat">
                {(['spillere', 'stab'] as const).map(g => (
                  <button
                    key={g}
                    role="radio"
                    aria-checked={group === g}
                    onClick={() => { setGroup(g); setTeam('alle') }}
                    className={segItem(group === g)}
                  >
                    {g === 'spillere' ? 'Spillere' : 'Ledere'}
                  </button>
                ))}
              </div>
              <nav className={SEGMENT} aria-label="Velg lag">
                <button onClick={() => setTeam('alle')} className={segItem(ctx.team === 'alle')}>Alle</button>
                {teams.map(t => (
                  <button key={t.id} onClick={() => setTeam(t.id)} className={segItem(ctx.team === t.id)}>
                    <span className={`h-2 w-2 rounded-full ${THEME[t.id].dot}`} />
                    {t.short}
                  </button>
                ))}
              </nav>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-4 py-4">
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-200 p-1 sm:flex">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 rounded-lg px-2 py-2 text-sm font-semibold whitespace-nowrap transition sm:px-3 ${tab === t.id ? 'bg-white text-navy shadow' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {t.id === 'spillere' && group === 'stab' ? 'Ledere' : t.label}
              </button>
            ))}
          </div>
          {/* Verktøylinje: periode · type · ikke svart – én samlet boks */}
          <div className="flex flex-wrap items-center gap-1 self-stretch rounded-xl bg-white p-1 text-sm shadow-sm sm:flex-nowrap md:self-end">
            <Select
              label="Periode"
              value={period}
              onChange={v => setPeriod(v as Period)}
              options={PERIODS.map(p => [p.id, p.label])}
              groups={[['Måned', monthsWithData(model.activities).map(m => [m.id, m.label])]]}
            />
            <span className="hidden h-6 w-px bg-slate-200 sm:block" />
            <Select
              label="Type"
              value={actType}
              onChange={v => setActType(v as ActType)}
              options={[['alle', 'Kamper og treninger'], ['trening', 'Kun treninger'], ['kamp', 'Kun kamper'], ['ekstra', 'Kun ekstratreninger (Early Bird)']]}
            />
          </div>
        </div>

        {tab === 'oversikt' && <Overview ctx={ctx} />}
        {tab === 'spillere' && <PlayersView ctx={ctx} />}
        {tab === 'kamper' && (
          <KamperView
            ctx={ctx}
            uploaded={extraMatches.map(f => f.name)}
            onAdd={addMatchFiles}
            onRemove={name => setExtraMatches(m => m.filter(f => f.name !== name))}
          />
        )}
        {tab === 'aktiviteter' && <ActivitiesView ctx={ctx} />}
        {tab === 'matrise' && <MatrixView ctx={ctx} />}
        {tab === 'statistikk' && <StatsView ctx={ctx} />}

        <footer className="pt-4 pb-8 text-center text-xs text-slate-400">
          Kilde: Rubic oppmøteeksport + lagoppsett/serieoppsett U12 2026–2027. Statistikk regnes kun for passerte aktiviteter.
        </footer>
      </main>

      {info}
      {person && (
        <PersonDrawer
          key={person.id} // ny person = start øverst i kortet
          ctx={ctx}
          person={person}
          // Forrige/neste: rekkefølgen personen ble åpnet fra, ellers synlige personer sortert på lag og nummer
          order={(navOrder ?? [...ctx.visible].sort(byTeamNr).map(p => p.id))
            .map(id => model.people.find(p => p.id === id))
            .filter((p): p is Person => !!p)}
          onNavigate={id => setSelected(id)}
          onClose={() => setSelected(null)}
          onSetTeam={(t: TeamId | 'none' | 'auto') =>
            setOverrides(o => {
              const next = { ...o }
              if (t === 'auto') delete next[person.id]
              else next[person.id] = t
              return next
            })
          }
        />
      )}
    </div>
  )
}

function Landing(props: {
  csvName: string | null
  salt: string
  wrongSalt: boolean
  /** Gruppenavnet fra eksporten («Team 2015»), ellers U12 */
  title: string
  /** Haken «Bruk salt»: kryptert lagoppsett, eller bare Lag/Rolle fra CSV-en */
  useSalt: boolean
  onUseSalt: (v: boolean) => void
  /** Uten salt, men fila har ikke Lag-kolonnen */
  noTeams: boolean
  loading: boolean
  error?: string
  onSalt: (s: string) => void
  onUpload: (f: File) => void
  onClear: () => void
  onFurnes: () => void
  onInfo: () => void
}) {
  const { title, csvName, salt, wrongSalt, useSalt, onUseSalt, noTeams, loading, error, onSalt, onUpload, onClear, onFurnes, onInfo } = props
  const [draft, setDraft] = useState('')
  const needSalt = !salt || wrongSalt
  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-navy p-4 text-white">
      <div className="absolute top-4 right-4"><InfoButton onClick={onInfo} /></div>
      <div className="w-full max-w-md space-y-5 text-center">
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Storhamar Yngres" className="mx-auto h-20 w-auto drop-shadow" />
        <h1 className="text-2xl font-black tracking-wide">
          {title} <span className="text-sh-yellow">Oppmøte</span>
        </h1>
        <p className="text-sm text-white/80">
          Last inn oppmøteeksporten fra Rubic (CSV), og velg om du vil bruke saltet du har fått av trenerne. Alt lagres bare i denne nettleseren – ingenting sendes noe sted.
        </p>

        <ol className="space-y-3 text-left">
          <li className="rounded-xl bg-white/10 p-3">
            <div className="mb-2 text-xs font-bold tracking-wider text-white/60 uppercase">1 · CSV fra Rubic</div>
            <label className="inline-block cursor-pointer rounded-full bg-sh-yellow px-4 py-2 text-sm font-bold text-navy shadow hover:brightness-105">
              {csvName ? 'Legg til fil' : 'Velg fil'}
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => e.target.files?.[0] && onUpload(e.target.files[0])} />
            </label>
            {csvName && <span className="ml-3 text-sm text-white/80">✓ {csvName}</span>}
          </li>
          <li className="rounded-xl bg-white/10 p-3">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={useSalt}
                onChange={e => onUseSalt(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-sh-yellow"
              />
              <span>
                <span className="block text-xs font-bold tracking-wider text-white/60 uppercase">2 · Bruk salt</span>
                <span className="block text-sm text-white/80">
                  {useSalt
                    ? 'Kryptert lagoppsett med draktnummer, kallenavn og rettelser. Krever saltet fra trenerne.'
                    : 'Lag og roller hentes fra CSV-en (npm run export_all). Uten draktnummer og rettelser.'}
                </span>
              </span>
            </label>
            {noTeams && (
              <p className="mt-2 text-sm text-rose-200">
                Fila har ikke kolonnen «Lag» (eksport rett fra Rubic). Alle vises uten lag – bruk en fil fra npm run export_all, eller kryss av for salt, for å få lag.
              </p>
            )}
          </li>
          {useSalt && <li className="rounded-xl bg-white/10 p-3">
            <div className="mb-2 text-xs font-bold tracking-wider text-white/60 uppercase">3 · Salt</div>
            {needSalt ? (
              <form
                className="flex gap-2"
                onSubmit={e => {
                  e.preventDefault()
                  if (draft) onSalt(draft)
                  setDraft('')
                }}
              >
                <input
                  type="password"
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  autoComplete="off"
                  placeholder="Skriv inn salt"
                  className="min-w-0 flex-1 rounded-lg bg-white px-3 py-2 text-sm text-slate-900 focus:ring-4 focus:ring-sh-yellow/50 focus:outline-none"
                />
                <button className="rounded-lg bg-sh-yellow px-4 py-2 text-sm font-bold text-navy hover:brightness-105">OK</button>
              </form>
            ) : (
              <span className="text-sm text-white/80">✓ Lagret i nettleseren</span>
            )}
            {wrongSalt && <p className="mt-2 text-sm text-rose-200">Saltet passer ikke med fila – ingen personer kunne låses opp. Prøv igjen.</p>}
          </li>}
        </ol>

        {loading && <p className="text-sm text-white/80">Låser opp lagoppsettet …</p>}
        {error && (
          <div className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">
            Filen kunne ikke leses ({error}).
          </div>
        )}
        <button onClick={onFurnes} className="block w-full rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold hover:bg-emerald-600">
          Furnes fotball →
        </button>
        {(csvName || salt) && (
          <button onClick={onClear} className="text-xs text-white/60 underline hover:text-white">
            Fjern fil og salt fra denne nettleseren
          </button>
        )}
      </div>
    </div>
  )
}

function AnonButton({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      title={on ? 'Vis navn' : 'Anonymiser – slør alle navn'}
      className={`${GHOST} ${on ? 'bg-sh-yellow text-navy ring-sh-yellow hover:bg-sh-yellow/90' : ''}`}
    >
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        {on ? (
          <path fillRule="evenodd" d="M3.28 2.22a.75.75 0 00-1.06 1.06l14.5 14.5a.75.75 0 101.06-1.06l-1.745-1.745a10.03 10.03 0 003.3-4.38 1.65 1.65 0 000-1.19A10.004 10.004 0 009.999 3a9.956 9.956 0 00-4.744 1.194L3.28 2.22zM7.752 6.69l1.092 1.092a2.5 2.5 0 013.374 3.373l1.092 1.092a4 4 0 00-5.558-5.558zM10.748 13.93l2.523 2.523a9.987 9.987 0 01-3.27.547c-4.258 0-7.894-2.66-9.337-6.41a1.651 1.651 0 010-1.186A10.007 10.007 0 012.839 6.02L6.07 9.252a4 4 0 004.678 4.678z" clipRule="evenodd" />
        ) : (
          <>
            <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
            <path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
          </>
        )}
      </svg>
      <span className="hidden sm:inline">{on ? 'Anonym' : 'Anonymiser'}</span>
    </button>
  )
}

function InfoButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label="Om appen" title="Om appen – hvordan tallene regnes ut" className={`${GHOST} w-8 justify-center px-0`}>
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
      </svg>
    </button>
  )
}

function InfoModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" role="dialog" aria-modal="true" aria-label="Om appen">
      <div className="fixed inset-0 bg-navy/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-5xl rounded-2xl bg-slate-100 shadow-2xl">
        <div className="flex items-center gap-3 rounded-t-2xl bg-navy px-4 py-3 text-white">
          <h2 className="text-lg font-bold">Om appen</h2>
          <button onClick={onClose} className="ml-auto rounded-full bg-white/15 px-3 py-1.5 text-sm font-bold hover:bg-white/25" aria-label="Lukk">✕</button>
        </div>
        <div className="p-4"><InfoView /></div>
      </div>
    </div>
  )
}

// Felles stil for knapper i toppfeltet
const GHOST = 'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold whitespace-nowrap ring-1 ring-white/20 transition hover:bg-white/10'
const SEGMENT = 'flex shrink-0 gap-0.5 rounded-lg bg-white/5 p-0.5 ring-1 ring-white/10'
const segItem = (active: boolean) =>
  `inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold whitespace-nowrap transition ${active ? 'bg-white text-navy shadow-sm' : 'text-white/70 hover:bg-white/10 hover:text-white'}`

function Select({ label, value, onChange, options, groups = [] }: {
  label: string
  value: string
  onChange: (v: string) => void
  options: [string, string][]
  groups?: [string, [string, string][]][]
}) {
  return (
    <label className="relative flex min-w-0 flex-1 items-center sm:flex-none">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full min-w-0 cursor-pointer appearance-none truncate rounded-lg bg-transparent py-2 pr-8 pl-3 font-medium text-slate-700 hover:bg-slate-100 focus:ring-2 focus:ring-navy/30 focus:outline-none"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
        {groups.filter(([, opts]) => opts.length).map(([g, opts]) => (
          <optgroup key={g} label={g}>
            {opts.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-2.5 h-4 w-4 text-slate-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
      </svg>
    </label>
  )
}

