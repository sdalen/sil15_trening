import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { teams, tournaments, type TeamId } from '../data/sil15.js'
import { colorTeam, isApproved, personIceMinutes, personStats, shortName, type Activity, type Person } from '../lib/model'
import { hoursText, longDate, monthLabel, pctText, shortDate, THEME } from '../lib/ui'
import type { Ctx } from '../ctx'
import { ActLabel, Legend, NrBadge, Pct, ExtraNote, PctStats, SplitBar, StatusChip, Pii } from './common'

interface Props {
  ctx: Ctx
  person: Person
  /** Personene man kan bla mellom (forrige/neste), i rekkefølge */
  order: Person[]
  onNavigate: (id: string) => void
  onClose: () => void
  onSetTeam: (t: TeamId | 'none' | 'auto') => void
}

export default function PersonDrawer({ ctx, person: p, order, onNavigate, onClose, onSetTeam }: Props) {
  const pos = order.findIndex(x => x.id === p.id)
  const prev = pos > 0 ? order[pos - 1] : null
  const next = pos >= 0 && pos < order.length - 1 ? order[pos + 1] : null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      // Piltaster blar mellom personer (ikke når man står i et skjemafelt)
      if (e.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return
      if (e.key === 'ArrowLeft' && prev) onNavigate(prev.id)
      if (e.key === 'ArrowRight' && next) onNavigate(next.id)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [onClose, onNavigate, prev, next])

  const s = ctx.stats.get(p.id)!
  const allPast = ctx.model.activities.filter(a => a.hasData && a.at < ctx.now && a.kind !== 'ekstra')
  const sAll = personStats(p, allPast, ctx.noAnswerIsAbsent)
  const sTrening = personStats(p, allPast.filter(x => x.kind === 'trening'), ctx.noAnswerIsAbsent)
  const sKamp = personStats(p, allPast.filter(x => x.kind === 'kamp'), ctx.noAnswerIsAbsent)
  // Historikk: valgte aktiviteter + frivillige ekstratreninger (Early Bird), i tidsrekkefølge
  const mine = [...new Map([...ctx.periodActs, ...ctx.periodExtra].map(a => [a.idx, a])).values()]
    .filter(a => p.statuses[a.idx] !== null)
    .sort((x, y) => x.at.getTime() - y.at.getTime() || x.idx - y.idx)
  const upcoming = ctx.model.activities.filter(a => a.at >= ctx.now && p.statuses[a.idx] !== null)

  // Tid på is: ja-svar på passerte istreninger (ikke kamper/barmark), inkl. frivillige ekstratreninger
  const minMain = personIceMinutes(p, ctx.pastActs.filter(a => a.kind !== 'ekstra'))
  const minExtra = personIceMinutes(p, ctx.periodExtra.filter(a => a.at < ctx.now))

  // Per måned (passerte, i valgt periode)
  const months: { m: string; acts: Activity[] }[] = []
  for (const a of ctx.pastActs) {
    const m = monthLabel(a.at)
    if (months.at(-1)?.m !== m) months.push({ m, acts: [] })
    months.at(-1)!.acts.push(a)
  }

  const ct = colorTeam(p)
  const team = teams.find(t => t.id === ct)
  const todayIso = ctx.now.toISOString().slice(0, 10)
  const nextTournaments = team ? tournaments.filter(t => t.teams.includes(team.name) && t.date >= todayIso).slice(0, 3) : []
  const selectValue = p.overridden ? (p.teamId ?? 'none') : 'auto'
  const autoLabel = p.role ? p.role : team?.short ?? 'uten lag'

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={p.name}>
      <div className="absolute inset-0 bg-navy/40 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto bg-slate-100 shadow-2xl">
        <div className={`sticky top-0 z-10 flex items-center gap-3 px-4 py-4 text-white ${ct === 'gul' ? 'bg-sh-yellow text-navy!' : ct === 'hvit' || !ct ? 'bg-navy' : THEME[ct].bar}`}>
          <NrBadge p={p} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold"><Pii id={p.id}>{p.name}</Pii></h2>
            <p className="text-sm opacity-80">
              {p.inactive && <>Trolig sluttet · </>}
              {p.role && <>{p.role} · </>}
              {team ? team.name : p.role ? 'Felles for alle lag' : 'Uten lag'}
              {p.short && p.short !== p.name.split(' ')[0] && <> · «<Pii>{p.short}</Pii>»</>}
              {p.note && <> · 🥅 keeperdrakt {p.note.replace('K ', 'nr ')}</>}
            </p>
          </div>
          <button onClick={onClose} className="rounded-full bg-black/15 px-3 py-1.5 text-sm font-bold hover:bg-black/25" aria-label="Lukk">✕</button>
        </div>

        {order.length > 1 && (
          <nav className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-1.5 text-sm" aria-label="Bla mellom personer">
            <button disabled={!prev} onClick={() => prev && onNavigate(prev.id)} className="min-w-0 truncate rounded-md px-2 py-1 font-medium text-navy hover:bg-slate-100 disabled:invisible">
              ← <Pii>{prev ? shortName(prev, order) : ''}</Pii>
            </button>
            <span className="mx-auto shrink-0 text-xs text-slate-400 tabular-nums">{pos + 1} av {order.length}</span>
            <button disabled={!next} onClick={() => next && onNavigate(next.id)} className="min-w-0 truncate rounded-md px-2 py-1 font-medium text-navy hover:bg-slate-100 disabled:invisible">
              <Pii>{next ? shortName(next, order) : ''}</Pii> →
            </button>
          </nav>
        )}

        <div className="space-y-4 p-4">
          {p.uncertain && (
            <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
              ⚠️ Usikker kobling: «{p.short}» på {team?.short} kan også være en annen med samme fornavn. Bekreft eller endre lag under.
            </div>
          )}

          <label className="flex items-center gap-2 rounded-xl bg-white p-3 text-sm shadow-sm">
            <span className="font-semibold">Lag</span>
            <select value={selectValue} onChange={e => onSetTeam(e.target.value as TeamId | 'none' | 'auto')} className="ml-auto rounded-md bg-slate-100 px-2 py-1">
              <option value="auto">Automatisk ({p.overridden ? 'fra lagoppsett' : autoLabel})</option>
              {teams.map(t => <option key={t.id} value={t.id}>Spiller på {t.name}</option>)}
              <option value="none">Ikke spiller (støtteapparat/forelder/annet)</option>
            </select>
          </label>

          <div className="grid grid-cols-3 gap-2">
            <Tile label="Oppmøte" value={<PctStats s={s} />} sub={s.godkjent ? 'valgt periode (godkjent fravær holdt utenfor)' : 'valgt periode'} />
            <Tile label="Ja / avslått / ?" value={<span className="text-xl">{s.ja}/{s.nei}/{s.ikkeSvart}</span>} sub={`av ${s.invited}${s.godkjent ? ` · ${s.godkjent} godkjent fravær` : ''}`} />
            <Tile label="Flest på rad" value={s.maxStreak} sub={`ja i valgt periode · nå ${s.streak}`} />
          </div>
          <div className="rounded-xl bg-white p-3 text-xs text-slate-500 shadow-sm">
            Hele perioden: <b className="text-slate-700">{pctText(sAll.pct)}</b> ({sAll.ja} av {sAll.invited}).
            {minMain + minExtra > 0 && (
              <>
                {' '}Tid på is i valgt periode: <b className="text-slate-700">{hoursText(minMain + minExtra)}</b>
                {minExtra > 0 && <> (herav {hoursText(minExtra)} {ctx.extraLabel})</>}.
              </>
            )}
            <ExtraNote s={ctx.extraStats.get(p.id)} label={`${ctx.extraLabel} i valgt periode`} /> Rubic «Totalt»: {p.rubicTotal || '–'}
            <div className="mt-1">
              Treninger: <b className="text-slate-700">{pctText(sTrening.pct)}</b> ({sTrening.ja} av {sTrening.invited}) · Kamper:{' '}
              <b className="text-slate-700">{sKamp.invited ? `${sKamp.ja} av ${sKamp.invited}` : 'ikke innkalt ennå'}</b>
            </div>
          </div>

          {nextTournaments.length > 0 && (
            <Section title={`Neste turneringer for ${team!.name}`}>
              {nextTournaments.map(t => {
                const games = t.games.filter(g => g[2] === team!.name || g[3] === team!.name)
                return (
                  <li key={t.nr} className="px-3 py-2 text-sm">
                    <div className="font-semibold">{longDate(new Date(`${t.date}T12:00`))} · {t.place}</div>
                    <div className="text-xs text-slate-500">
                      {games.length} kamper, første {games[0]?.[0]} · mot {[...new Set(games.map(g => (g[2] === team!.name ? g[3] : g[2])))].join(', ')}
                    </div>
                  </li>
                )
              })}
            </Section>
          )}

          {months.length > 0 && (
            <Section title="Per måned">
              {months.map(({ m, acts }) => {
                const ms = personStats(p, acts, ctx.noAnswerIsAbsent)
                if (!ms.invited) return null
                return (
                  <li key={m} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="w-32 shrink-0">{m}</span>
                    <SplitBar ja={ms.ja} nei={ms.nei} ikkeSvart={ms.ikkeSvart} className="h-2.5 flex-1" />
                    <Pct value={ms.pct} className="w-12 text-right" />
                  </li>
                )
              })}
            </Section>
          )}

          <Section title={`Historikk (${mine.filter(a => a.at < ctx.now).length})`} right={<Legend />}>
            {[...mine].filter(a => a.at < ctx.now).reverse().map(a => <ActRow key={a.idx} a={a} p={p} />)}
          </Section>

          {upcoming.length > 0 && (
            <Section title={`Kommende (${upcoming.length})`}>
              {upcoming.map(a => <ActRow key={a.idx} a={a} p={p} />)}
            </Section>
          )}
        </div>
      </aside>
    </div>
  )
}

function ActRow({ a, p }: { a: Activity; p: Person }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2 text-sm">
      <span className="w-28 shrink-0 font-medium">{shortDate(a.at)}</span>
      <span className="w-12 shrink-0 text-slate-500 tabular-nums">{a.time}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
        <ActLabel a={a} />
      </span>
      {p.corrected[a.idx] && <span title={p.corrected[a.idx]} className="cursor-help text-xs text-slate-400">✎</span>}
      {p.reasons[a.idx] && (
        <span className={`max-w-32 truncate text-xs ${isApproved(p, a) ? 'font-semibold text-sky-700' : 'text-slate-500'}`} title={p.reasons[a.idx]}>
          {p.reasons[a.idx]}
        </span>
      )}
      {isApproved(p, a) ? (
        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">Godkjent</span>
      ) : (
        <StatusChip s={p.statuses[a.idx]} />
      )}
    </li>
  )
}

function Tile({ label, value, sub }: { label: string; value: ReactNode; sub: string }) {
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm">
      <div className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">{label}</div>
      <div className="text-2xl font-black tabular-nums">{value}</div>
      <div className="text-[11px] text-slate-500">{sub}</div>
    </div>
  )
}

function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
        <h3 className="text-sm font-bold">{title}</h3>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      <ul className="divide-y divide-slate-100">{children}</ul>
    </section>
  )
}
