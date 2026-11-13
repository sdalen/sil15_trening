import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { teams, type TeamId } from '../data/sil15.js'
import { average, colorTeam, countsInStats, countStatuses, type Activity, type Person } from '../lib/model'
import { daysUntil, longDate, pctColor, pctText, shortDate, store, THEME } from '../lib/ui'
import type { Ctx } from '../ctx'
import { ActLabel, Card, Empty, Legend, NrBadge, PersonBadge, Pct, ExtraNote, PctStats, SplitBar, StatusChip, TeamBadge, Pii } from './common'

export default function Overview({ ctx }: { ctx: Ctx }) {
  const { pastActs, stats, model, now } = ctx
  const [showAll, setShowAll] = useState(false)
  const [list, setList] = useState<'under50' | 'over80' | null>(null)
  // Grenser for lavt/høyt oppmøte i prosent – justeres med slider, huskes i nettleseren
  const [lowPct, setLowPct] = useState<number>(() => store.get('lowPct', 50))
  const [highPct, setHighPct] = useState<number>(() => store.get('highPct', 80))
  useEffect(() => store.set('lowPct', lowPct), [lowPct])
  useEffect(() => store.set('highPct', highPct), [highPct])
  // Sluttede spillere og lagledere holdes utenfor snitt og rangering
  const population = ctx.population.filter(countsInStats)
  const pcts = population.map(p => stats.get(p.id)!.pct)
  const avg = average(pcts)
  const upcoming = model.activities.filter(a => a.at >= now && a.hasData).slice(0, 4)
  const last = [...pastActs].reverse().slice(0, 1)[0]
  const lastTraining = last?.kind === 'kamp' ? [...pastActs].reverse().find(a => a.kind === 'trening') : undefined
  // Kamper holdes utenfor – der er alle innkalte med, så de blir alltid 100 %
  const trainings = pastActs
    .filter(a => a.kind === 'trening')
    .map(a => {
      const c = countStatuses(population, a)
      const of = c.ja.length + c.nei.length + (ctx.noAnswerIsAbsent ? c['ikke-svart'].length : 0)
      return { a, pct: actPct(population, a, ctx.noAnswerIsAbsent), ja: c.ja.length, of }
    })
    .filter((x): x is { a: Activity; pct: number; ja: number; of: number } => x.pct !== null)
  // Ved likt oppmøte vinner den nyeste treningen
  const best = trainings.reduce<(typeof trainings)[number] | undefined>((m, x) => (!m || x.pct >= m.pct ? x : m), undefined)
  const worst = trainings.reduce<(typeof trainings)[number] | undefined>((m, x) => (!m || x.pct <= m.pct ? x : m), undefined)

  const ranked = population
    .map(p => ({ p, s: stats.get(p.id)! }))
    .filter(x => x.s.pct !== null)
    .sort((a, b) => b.s.pct! - a.s.pct! || b.s.ja - a.s.ja)
  const under50 = ranked.filter(x => x.s.pct! < lowPct / 100)
  const over80 = ranked.filter(x => x.s.pct! >= highPct / 100)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Kpi label="Snitt oppmøte" value={<Pct value={avg} />} sub={`${population.length} personer i utvalget`} />
        <Kpi label="Aktiviteter" value={pastActs.length} sub="passerte i valgt periode" />
        <Kpi
          label="Siste aktivitet"
          onClick={last ? () => ctx.openActivity(last.idx) : undefined}
          value={last ? <Pct value={actPct(population, last, ctx.noAnswerIsAbsent)} /> : '–'}
          sub={
            last ? (
              <span className="flex flex-col gap-0.5">
                <span className="text-slate-700"><ActLabel a={last} /></span>
                <span>{shortDate(last.at)} kl. {last.time}</span>
                {lastTraining && (
                  <span
                    role="link"
                    tabIndex={0}
                    onClick={e => {
                      e.stopPropagation()
                      ctx.openActivity(lastTraining.idx)
                    }}
                    onKeyDown={e => {
                      if (e.key !== 'Enter') return
                      e.stopPropagation()
                      ctx.openActivity(lastTraining.idx)
                    }}
                    className="text-[10px] text-slate-400 underline decoration-dotted hover:text-slate-600"
                  >
                    Siste trening: {pctText(actPct(population, lastTraining, ctx.noAnswerIsAbsent))} · {shortDate(lastTraining.at)}
                  </span>
                )}
              </span>
            ) : (
              'Ingen'
            )
          }
        />
        <Kpi
          label="Beste oppmøte"
          onClick={best ? () => ctx.openActivity(best.a.idx) : undefined}
          value={best ? <Pct value={best.pct} /> : '–'}
          sub={best ? `${best.ja}/${best.of} · Trening ${shortDate(best.a.at)} kl. ${best.a.time}` : 'Ingen treninger'}
        />
        <Kpi
          label="Svakeste oppmøte"
          onClick={worst ? () => ctx.openActivity(worst.a.idx) : undefined}
          value={worst ? <Pct value={worst.pct} /> : '–'}
          sub={worst ? `${worst.ja}/${worst.of} · Trening ${shortDate(worst.a.at)} kl. ${worst.a.time}` : 'Ingen treninger'}
        />
        <Kpi
          label={`Under ${lowPct} %`}
          value={<span className={under50.length ? 'text-rose-700' : ''}>{under50.length}</span>}
          sub={ctx.group === "stab" ? "i støtteapparatet med lavt oppmøte" : "spillere med lavt oppmøte"}
          onClick={() => setList(l => (l === 'under50' ? null : 'under50'))}
          active={list === 'under50'}
        />
        <Kpi
          label={`Minst ${highPct} %`}
          value={<span className={over80.length ? 'text-emerald-700' : ''}>{over80.length}</span>}
          sub={ctx.group === "stab" ? "i støtteapparatet med høyt oppmøte" : "spillere med høyt oppmøte"}
          onClick={() => setList(l => (l === 'over80' ? null : 'over80'))}
          active={list === 'over80'}
        />
      </div>

      {list && (
        <Card
          title={list === 'under50' ? `Under ${lowPct} % oppmøte` : `Minst ${highPct} % oppmøte`}
          right={
            <button onClick={() => setList(null)} className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200">
              Lukk
            </button>
          }
        >
          <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 text-sm">
            <label htmlFor="pct-slider" className="shrink-0 font-semibold text-slate-600">
              {list === 'under50' ? 'Under' : 'Minst'}
            </label>
            <input
              id="pct-slider"
              type="range"
              min={0}
              max={100}
              step={5}
              value={list === 'under50' ? lowPct : highPct}
              onChange={e => (list === 'under50' ? setLowPct : setHighPct)(Number(e.target.value))}
              className={`w-full ${sliderAccent((list === 'under50' ? lowPct : highPct) / 100)}`}
            />
            <span className={`w-12 shrink-0 text-right font-bold tabular-nums ${pctColor((list === 'under50' ? lowPct : highPct) / 100)}`}>
              {list === 'under50' ? lowPct : highPct} %
            </span>
            <span className="hidden shrink-0 text-slate-500 sm:inline">
              · {(list === 'under50' ? under50 : over80).length} spillere
            </span>
          </div>
          <TeamSplit items={list === 'under50' ? [...under50].reverse() : over80} all={ranked} ctx={ctx} bad={list === 'under50'} />
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Kommende aktiviteter" right={<Legend />}>
          {upcoming.length ? (
            <ul className="divide-y divide-slate-100">
              {upcoming.map(a => <Upcoming key={a.idx} a={a} ctx={ctx} />)}
            </ul>
          ) : (
            <Empty>Ingen kommende aktiviteter i eksporten.</Empty>
          )}
        </Card>

        <Card title="Oppmøte per lag" right="snitt av spillernes oppmøte">
          <ul className="divide-y divide-slate-100">
            {teams.map(t => <TeamRow key={t.id} teamId={t.id} ctx={ctx} />)}
          </ul>
        </Card>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card
          title="Høyest oppmøte"
          right={
            ranked.length > 8 && (
              <button onClick={() => setShowAll(v => !v)} className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200">
                {showAll ? 'Vis topp 8' : `Vis alle (${ranked.length})`}
              </button>
            )
          }
        >
          <RankList items={showAll ? ranked : ranked.slice(0, 8)} ctx={ctx} numbered />
        </Card>
        <Card title="Lavest oppmøte">
          <RankList items={ranked.slice(-8).reverse()} ctx={ctx} />
        </Card>
      </div>

      <Unregistered ctx={ctx} />
      <DataQuality ctx={ctx} />
    </div>
  )
}

/** Samme skala som pctColor (grønn ≥ 75 %, gul ≥ 50 %, ellers rød) – for slideren */
function sliderAccent(p: number) {
  if (p >= 0.75) return 'accent-emerald-600'
  if (p >= 0.5) return 'accent-amber-500'
  return 'accent-rose-600'
}

function actPct(people: Person[], a: Activity, noAnswerIsAbsent: boolean) {
  const c = countStatuses(people, a)
  const denom = c.ja.length + c.nei.length + (noAnswerIsAbsent ? c['ikke-svart'].length : 0)
  return denom ? c.ja.length / denom : null
}

function Kpi({ label, value, sub, onClick, active }: { label: string; value: ReactNode; sub: ReactNode; onClick?: () => void; active?: boolean }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-1 text-xs font-semibold tracking-wider text-slate-500 uppercase">
        {label}
        {onClick && <span className="text-slate-300">{active ? '▴' : '›'}</span>}
      </div>
      <div className="mt-1 text-3xl font-black tabular-nums">{value}</div>
      <div className="text-xs text-slate-500">{sub}</div>
    </>
  )
  if (!onClick) return <div className="rounded-2xl bg-white p-4 shadow-sm">{body}</div>
  // div med role=button (ikke <button>) slik at kortet kan ha egne lenker inni seg
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick())}
      className={`cursor-pointer rounded-2xl bg-white p-4 text-left shadow-sm transition hover:ring-2 hover:ring-slate-200 ${active ? 'ring-2 ring-navy' : ''}`}
    >
      {body}
    </div>
  )
}

function Upcoming({ a, ctx }: { a: Activity; ctx: Ctx }) {
  const [open, setOpen] = useState(false)
  const c = countStatuses(ctx.population, a)
  return (
    <li>
      <button onClick={() => setOpen(o => !o)} className="w-full px-4 py-3 text-left hover:bg-slate-50">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">
              {longDate(a.at)} kl. {a.time}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              <ActLabel a={a} />
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{daysUntil(a.at, ctx.now)}</span>
        </div>
        <div className="mt-2 flex items-center gap-3 text-xs">
          <SplitBar ja={c.ja.length} nei={c.nei.length} ikkeSvart={c['ikke-svart'].length} className="h-2 flex-1" />
          <span className="shrink-0 tabular-nums text-slate-600">
            <b className="text-emerald-700">{c.ja.length}</b> ja · <b className="text-rose-700">{c.nei.length}</b> avslått ·{' '}
            <b className="text-amber-700">{c['ikke-svart'].length}</b> ikke svart
          </span>
        </div>
      </button>
      {open && (
        <div className="grid gap-3 bg-slate-50 px-4 py-3 sm:grid-cols-3">
          {(['ja', 'nei', 'ikke-svart'] as const).map(s => (
            <div key={s}>
              <div className="mb-1">
                <StatusChip s={s} /> <span className="text-xs text-slate-500">{c[s].length}</span>
              </div>
              <ul className="space-y-0.5 text-sm">
                {c[s].map(p => (
                  <li key={p.id}>
                    <button onClick={() => ctx.openPerson(p.id)} className="flex items-center gap-1.5 hover:underline">
                      <span className={`h-2 w-2 rounded-full ${THEME[colorTeam(p) ?? 'none'].dot}`} />
                      <Pii id={p.id}>{p.short ?? p.name}</Pii>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </li>
  )
}

function TeamRow({ teamId, ctx }: { teamId: TeamId; ctx: Ctx }) {
  const members = ctx.groupPeople.filter(p => colorTeam(p) === teamId && countsInStats(p))
  const s = members.map(p => ctx.stats.get(p.id)!)
  const avg = average(s.map(x => x.pct))
  const sum = s.reduce((acc, x) => ({ ja: acc.ja + x.ja, nei: acc.nei + x.nei, ikkeSvart: acc.ikkeSvart + x.ikkeSvart }), { ja: 0, nei: 0, ikkeSvart: 0 })
  const team = teams.find(t => t.id === teamId)!
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className={`w-12 shrink-0 rounded-lg py-1 text-center text-sm font-bold ${THEME[teamId].pill}`}>{team.short}</span>
      <div className="min-w-0 flex-1">
        <SplitBar {...sum} className="h-3" />
        <div className="mt-1 text-xs text-slate-500">
          {members.length} {ctx.group === "stab" ? "i støtteapparatet" : "spillere"} · {sum.ja} ja · {sum.nei} avslått · {sum.ikkeSvart} ikke svart
        </div>
      </div>
      <Pct value={avg} className="w-14 text-right text-lg" />
    </li>
  )
}

type Ranked = { p: Person; s: { pct: number | null; pctGodkjent: number | null; ja: number; invited: number; godkjent: number } }

/** Lista fordelt på lag, med hvor stor andel av lagets spillere (med data) som er med */
function TeamSplit({ items, all, ctx, bad }: { items: Ranked[]; all: Ranked[]; ctx: Ctx; bad: boolean }) {
  const ids: (TeamId | null)[] = [...teams.map(t => t.id), null]
  const groups = ids
    .map(tid => ({
      tid,
      total: all.filter(x => colorTeam(x.p) === tid).length,
      members: items.filter(x => colorTeam(x.p) === tid),
    }))
    .filter(g => g.total > 0)
  return (
    <div className="grid gap-3 p-3 md:grid-cols-2">
      {groups.map(g => {
        const share = g.members.length / g.total
        return (
          <div key={g.tid ?? 'none'} className={`overflow-hidden rounded-xl border-t-4 bg-slate-50 ${THEME[g.tid ?? 'none'].border}`}>
            <div className="px-3 pt-3 pb-2">
              <div className="flex items-center justify-between gap-2">
                <TeamBadge teamId={g.tid} />
                <span className={`text-2xl font-black tabular-nums ${g.members.length ? (bad ? 'text-rose-700' : 'text-emerald-700') : 'text-slate-400'}`}>
                  {pctText(share)}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {g.members.length} av {g.total} spillere på laget
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div className={`h-full ${bad ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: `${share * 100}%` }} />
              </div>
            </div>
            {g.members.length ? (
              <div className="bg-white">
                <RankList items={g.members} ctx={ctx} />
              </div>
            ) : (
              <p className="bg-white px-3 py-3 text-xs text-slate-400">Ingen</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function RankList({ items, ctx, numbered }: { items: { p: Person; s: { pct: number | null; pctGodkjent: number | null; ja: number; invited: number; godkjent: number } }[]; ctx: Ctx; numbered?: boolean }) {
  if (!items.length) return <Empty>Ingen data i valgt periode.</Empty>
  return (
    <ul className="divide-y divide-slate-100">
      {items.map(({ p, s }, i) => (
        <li key={p.id}>
          <button onClick={() => ctx.openPerson(p.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50">
            {numbered && <span className="w-6 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-400">{i + 1}.</span>}
            <NrBadge p={p} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium"><Pii id={p.id}>{p.name}</Pii></div>
              <div className="text-xs text-slate-500">
                {s.ja} av {s.invited} aktiviteter
                <ExtraNote s={ctx.extraStats.get(p.id)} label={ctx.extraLabel} />
                {!!s.godkjent && <span className="ml-1 font-semibold text-sky-700">· {s.godkjent} godkjent fravær</span>}
              </div>
            </div>
            <PersonBadge p={p} />
            <PctStats s={s} className="w-24 text-right" />
          </button>
        </li>
      ))}
    </ul>
  )
}

function DataQuality({ ctx }: { ctx: Ctx }) {
  const { model } = ctx
  const uncertain = model.people.filter(p => p.uncertain)
  const others = model.people.filter(p => p.kind === 'annen')
  const empty = model.activities.filter(a => !a.hasData && !a.replaced)
  if (!uncertain.length && !model.missing && !others.length && !empty.length) return null
  return (
    <Card title="Datakvalitet" right="kobling mellom Rubic og lagoppsett">
      <div className="grid gap-4 p-4 text-sm md:grid-cols-2">
        {uncertain.length > 0 && (
          <Box title="⚠️ Usikre koblinger" hint="Flere i Rubic har samme fornavn. Åpne spilleren og bekreft/endre lag.">
            {uncertain.map(p => (
              <PersonLink key={p.id} p={p} ctx={ctx} extra={`→ ${p.short} (${pctText(ctx.stats.get(p.id)!.pct)})`} />
            ))}
          </Box>
        )}
        {model.missing > 0 && (
          <Box title="Finnes i lagoppsett, men ikke i Rubic" hint="Lagoppsettet er kryptert per navn, så bare antallet kan vises.">
            {model.missing} {model.missing === 1 ? 'person' : 'personer'} i lagoppsettet finnes ikke i de opplastede filene.
          </Box>
        )}
        {others.length > 0 && (
          <Box title={`I Rubic, men verken spiller eller støtteapparat (${others.length})`} hint="Klikk for å legge personen til et lag.">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {others.map(p => <PersonLink key={p.id} p={p} ctx={ctx} />)}
            </div>
          </Box>
        )}
        {empty.length > 0 && (
          <Box title="Aktiviteter uten registreringer">
            {empty.map(a => `${shortDate(a.at)} ${a.time}`).join(', ')}
          </Box>
        )}
      </div>
    </Card>
  )
}

function Box({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="font-semibold">{title}</div>
      {hint && <div className="mb-1 text-xs text-slate-500">{hint}</div>}
      <div className="mt-1 space-y-1">{children}</div>
    </div>
  )
}

function PersonLink({ p, ctx, extra }: { p: Person; ctx: Ctx; extra?: string }) {
  return (
    <button onClick={() => ctx.openPerson(p.id)} className="text-left text-sky-800 hover:underline">
      <Pii id={p.id}>{p.name}</Pii>
      {extra && <span className="pii text-slate-500"> {extra}</span>}
    </button>
  )
}

/** Passerte aktiviteter der noen fortsatt står som «ikke svart» – bør ryddes i Rubic */
function Unregistered({ ctx }: { ctx: Ctx }) {
  const [showAll, setShowAll] = useState(false)
  const people = ctx.population.filter(countsInStats)
  const items = [...ctx.pastActs]
    .reverse()
    .map(a => ({ a, who: people.filter(p => p.statuses[a.idx] === 'ikke-svart') }))
    .filter(x => x.who.length)
  if (!items.length) return null
  const total = items.reduce((n, x) => n + x.who.length, 0)
  const shown = showAll ? items : items.slice(0, 6)
  return (
    <Card
      title="Ikke registrert etter aktiviteten"
      right={
        <span className="flex items-center gap-3">
          <span className="hidden sm:inline">{total} registreringer på {items.length} aktiviteter</span>
          {items.length > 6 && (
            <button onClick={() => setShowAll(v => !v)} className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200">
              {showAll ? 'Vis færre' : `Vis alle (${items.length})`}
            </button>
          )}
        </span>
      }
    >
      <p className="bg-amber-50 px-4 py-2 text-xs text-amber-900">
        Står som «ikke svart» på en passert aktivitet. Sett riktig status i Rubic og last inn ny eksport. Teller som fravær inntil da.
      </p>
      <ul className="divide-y divide-slate-100">
        {shown.map(({ a, who }) => (
          <li key={a.idx} className="flex flex-col gap-1.5 px-4 py-2.5 sm:flex-row sm:items-start">
            <div className="w-44 shrink-0 text-sm">
              <div className="font-semibold">{shortDate(a.at)} kl. {a.time}</div>
              <div className="text-xs text-slate-500"><ActLabel a={a} /></div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {who.map(p => (
                <button key={p.id} onClick={() => ctx.openPerson(p.id)} className="flex items-center gap-1 rounded-lg bg-slate-50 px-2 py-1 text-xs ring-1 ring-slate-200 hover:ring-slate-400">
                  <span className={`h-2 w-2 rounded-full ${THEME[colorTeam(p) ?? 'none'].dot}`} />
                  <Pii id={p.id}>{p.short ?? p.name}</Pii>
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}
