import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { teams, type TeamId } from './data/sil15.js'
import {
  buildModel, colorTeam, fold, mergeExports, parseExport, inPeriod, isPeriod, matchesType, monthsWithData, namesIn, personStats, PERIODS,
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
  const [extraMatches, setExtraMatches] = useState<CsvFile[]>(() => store.get('matchCsvs', []))
  const [overrides, setOverrides] = useState<Overrides>(() => store.get('overrides', {}))
  const [tab, setTab] = useState<Tab>(() => store.get('tab', 'oversikt'))
  const [group, setGroup] = useState<Group>(() => store.get('group', 'spillere'))
  const [team, setTeam] = useState<TeamFilter>(() => {
    const t = store.get<string>('team', 'alle')
    return t === 'alle' || t === 'uten' || teams.some(x => x.id === t) ? (t as TeamFilter) : 'alle'
  })
  const [period, setPeriod] = useState<Period>(() => {
    const p = store.get<string>('period', 'host')
    return isPeriod(p) ? p : 'host'
  })
  const [actType, setActType] = useState<ActType>(() => {
    const t = store.get<string>('actType', 'alle')
    return t === 'kamp' || t === 'trening' || t === 'ekstra' ? t : 'alle'
  })
  const [noAnswerIsAbsent, setNoAnswerIsAbsent] = useState<boolean>(() => store.get('noAnswerIsAbsent', true))
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [focusAct, setFocusAct] = useState<number | null>(null)
  const [now, setNow] = useState(() => new Date())
  const [furnes, setFurnes] = useState<boolean>(() => store.get('furnes', false))
  const [showInfo, setShowInfo] = useState(false)
  // Lagret fane fra før Info ble flyttet til ikon
  useEffect(() => { if (!TABS.some(t => t.id === tab)) setTab('oversikt') }, [tab])
  useEffect(() => store.set('furnes', furnes || undefined), [furnes])

  useEffect(() => store.set('csv', csv ?? undefined), [csv])
  useEffect(() => store.set('rosterSalt', salt || undefined), [salt])
  useEffect(() => store.set('matchCsvs', extraMatches), [extraMatches])
  useEffect(() => store.set('overrides', overrides), [overrides])
  useEffect(() => store.set('tab', tab), [tab])
  useEffect(() => store.set('group', group), [group])
  useEffect(() => store.set('team', team), [team])
  useEffect(() => store.set('period', period), [period])
  useEffect(() => store.set('actType', actType), [actType])
  useEffect(() => store.set('noAnswerIsAbsent', noAnswerIsAbsent), [noAnswerIsAbsent])
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Lås opp lagoppsettet for navnene i filene. Forrige resultat brukes mens nye navn låses opp.
  const [unlocked, setUnlocked] = useState<{ salt: string; roster: Map<string, RosterEntry> } | null>(null)
  useEffect(() => {
    if (!csv || !salt) return
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
  }, [csv, extraMatches, salt])
  const roster = unlocked?.salt === salt ? unlocked.roster : null
  // Ingen treff i det hele tatt = saltet passer ikke (eller fila er fra et annet lag)
  const wrongSalt = !!roster && roster.size === 0

  const result = useMemo((): { model: Model | null; error?: string } => {
    if (!csv || !roster || roster.size === 0) return { model: null }
    try {
      return { model: buildModel(csv, extraMatches, overrides, roster, SEALED.length) }
    } catch (e) {
      return { model: null, error: (e as Error).message }
    }
  }, [csv, extraMatches, overrides, roster])
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
      team: teamFilter, query: q, noAnswerIsAbsent, openPerson: setSelected,
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

  if (furnes) return <FurnesView onBack={() => setFurnes(false)} />

  if (!model || !ctx) {
    return (
      <>
      {info}
      <Landing
        onInfo={() => setShowInfo(true)}
        onFurnes={() => setFurnes(true)}
        csvName={csv ? ((csv.files?.length ?? 1) > 1 ? `${csv.files!.length} filer` : csv.name) : null}
        salt={salt}
        wrongSalt={wrongSalt}
        loading={!!csv && !!salt && !roster}
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
      <header className="sticky top-0 z-20 bg-navy text-white shadow-lg">
        <div className="mx-auto max-w-6xl px-4 pt-3 pb-3">
          <div className="flex items-center gap-3">
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Storhamar Yngres" className="h-9 w-auto shrink-0 drop-shadow sm:h-11" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-black leading-tight tracking-wide">
                U12 <span className="text-sh-yellow">Oppmøte</span>
              </h1>
              <p className="truncate text-xs text-white/70">
                {csv && (csv.files?.length ?? 1) > 1 ? `${csv.files!.length} Rubic-filer` : (csv?.name ?? 'Rubic-eksport')} · {model.people.filter(p => p.kind === 'spiller').length} spillere · {model.people.filter(p => p.kind === 'stab').length} i stab · {model.activities.length} aktiviteter
              </p>
            </div>
            <label className="shrink-0 cursor-pointer rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold whitespace-nowrap hover:bg-white/25" title="Legg til CSV">
              <span className="sm:hidden">+ CSV</span>
              <span className="hidden sm:inline">Legg til CSV</span>
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => e.target.files?.[0] && onUpload(e.target.files[0])} />
            </label>
            <InfoButton onClick={() => setShowInfo(true)} />
            <button onClick={() => setFurnes(true)} className="shrink-0 rounded-full bg-emerald-700 px-3 py-1.5 text-xs font-semibold whitespace-nowrap hover:bg-emerald-600">
              Furnes
            </button>
            <button onClick={clearData} className="hidden rounded-full px-2 py-1.5 text-xs text-white/70 hover:text-white sm:block" title="Fjern opplastede filer fra denne nettleseren">
              Fjern data
            </button>
          </div>

          <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
            <div className="relative flex-1">
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={group === 'spillere' ? 'Søk etter spiller, draktnummer eller lag …' : 'Søk etter navn, rolle eller lag …'}
                className="w-full rounded-xl bg-white px-4 py-2.5 pl-10 text-sm text-slate-900 placeholder:text-slate-400 focus:ring-4 focus:ring-sh-yellow/50 focus:outline-none"
              />
              <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-slate-400">⌕</span>
            </div>
            <div className="flex shrink-0 rounded-xl bg-white/15 p-1" role="radiogroup" aria-label="Vis spillere eller stab">
              {(['spillere', 'stab'] as const).map(g => (
                <button
                  key={g}
                  role="radio"
                  aria-checked={group === g}
                  onClick={() => { setGroup(g); setTeam('alle') }}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-bold transition ${group === g ? 'bg-white text-navy shadow' : 'text-white/70 hover:text-white'}`}
                >
                  {g === 'spillere' ? 'Spillere' : 'Stab'}
                </button>
              ))}
            </div>
            <nav className="flex gap-1.5 overflow-x-auto p-1" aria-label="Velg lag">
              <TeamButton active={ctx.team === 'alle'} onClick={() => setTeam('alle')} cls="bg-white/15 text-white">Alle lag</TeamButton>
              {teams.map(t => (
                <TeamButton key={t.id} active={ctx.team === t.id} onClick={() => setTeam(t.id)} cls={THEME[t.id].pill}>{t.short}</TeamButton>
              ))}
              {group === 'stab' && (
                <TeamButton active={ctx.team === 'uten'} onClick={() => setTeam('uten')} cls="bg-slate-500 text-white">Felles/andre</TeamButton>
              )}
            </nav>
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
                {t.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm sm:flex sm:flex-wrap sm:items-center md:justify-end">
            <Select
              value={period}
              onChange={v => setPeriod(v as Period)}
              options={PERIODS.map(p => [p.id, p.label])}
              groups={[['Måned', monthsWithData(model.activities).map(m => [m.id, m.label])]]}
            />
            <Select
              value={actType}
              onChange={v => setActType(v as ActType)}
              options={[['alle', 'Kamper og treninger'], ['trening', 'Kun treninger'], ['kamp', 'Kun kamper'], ['ekstra', 'Kun ekstratreninger (Early Bird)']]}
            />
            <label className="col-span-2 flex cursor-pointer items-center gap-2 rounded-lg bg-white px-3 py-2 shadow-sm" title="Hvis av: oppmøte % = ja / (ja + nei)">
              <input type="checkbox" checked={noAnswerIsAbsent} onChange={e => setNoAnswerIsAbsent(e.target.checked)} className="accent-navy" />
              «Ikke svart» teller som fravær
            </label>
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
          ctx={ctx}
          person={person}
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
  loading: boolean
  error?: string
  onSalt: (s: string) => void
  onUpload: (f: File) => void
  onClear: () => void
  onFurnes: () => void
  onInfo: () => void
}) {
  const { csvName, salt, wrongSalt, loading, error, onSalt, onUpload, onClear, onFurnes, onInfo } = props
  const [draft, setDraft] = useState('')
  const needSalt = !salt || wrongSalt
  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-navy p-4 text-white">
      <div className="absolute top-4 right-4"><InfoButton onClick={onInfo} /></div>
      <div className="w-full max-w-md space-y-5 text-center">
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Storhamar Yngres" className="mx-auto h-20 w-auto drop-shadow" />
        <h1 className="text-2xl font-black tracking-wide">
          U12 <span className="text-sh-yellow">Oppmøte</span>
        </h1>
        <p className="text-sm text-white/80">
          Last inn oppmøteeksporten fra Rubic (CSV) og skriv inn saltet du har fått av trenerne. Begge deler lagres bare i denne nettleseren – ingenting sendes noe sted.
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
            <div className="mb-2 text-xs font-bold tracking-wider text-white/60 uppercase">2 · Salt</div>
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
          </li>
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

function InfoButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Om appen"
      title="Om appen – hvordan tallene regnes ut"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 font-serif text-base font-bold italic hover:bg-white/25"
    >
      i
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

function TeamButton({ active, onClick, cls, children }: { active: boolean; onClick: () => void; cls: string; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-xl px-3 py-2 text-sm font-bold transition ${cls} ${active ? 'outline-2 outline-offset-2 outline-white' : 'opacity-55 hover:opacity-80'}`}
    >
      {children}
    </button>
  )
}

function Select({ value, onChange, options, groups = [] }: {
  value: string
  onChange: (v: string) => void
  options: [string, string][]
  groups?: [string, [string, string][]][]
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="w-full min-w-0 rounded-lg bg-white px-3 py-2 shadow-sm sm:w-auto">
      {options.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
      {groups.filter(([, opts]) => opts.length).map(([label, opts]) => (
        <optgroup key={label} label={label}>
          {opts.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
