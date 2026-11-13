import { useEffect, useRef, useState } from 'react'
import { teams } from '../data/sil15.js'
import { countStatuses, type Activity } from '../lib/model'
import { colorTeam, fold } from '../lib/model'
import { longDate, monthLabel, pctText, shortDate, THEME } from '../lib/ui'
import type { Ctx } from '../ctx'
import { ActLabel, Card, Empty, Legend, SplitBar, StatusChip, TeamBadge, Pii } from './common'

export default function ActivitiesView({ ctx }: { ctx: Ctx }) {
  const [order, setOrder] = useState<'nyest' | 'eldst'>('nyest')
  // Søket filtrerer på dato/sted hvis det ikke matcher spillere
  const q = ctx.query
  const byText = (a: Activity) =>
    !q || [longDate(a.at), shortDate(a.at), a.date, a.time, a.kind, a.tournament?.place ?? ''].some(f => fold(f).includes(q))
  const filterByText = ctx.visible.length === 0
  const acts = ctx.periodActs.filter(a => !filterByText || byText(a))
  const list = order === 'nyest' ? [...acts].reverse() : acts
  const people = ctx.visible.length ? ctx.visible : ctx.population

  const groups: { month: string; items: Activity[] }[] = []
  for (const a of list) {
    const m = monthLabel(a.at)
    if (groups.at(-1)?.month !== m) groups.push({ month: m, items: [] })
    groups.at(-1)!.items.push(a)
  }

  return (
    <Card
      title="Aktiviteter"
      right={
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline">{acts.length} aktiviteter · {people.length} personer</span>
          <select value={order} onChange={e => setOrder(e.target.value as 'nyest' | 'eldst')} className="rounded-md bg-slate-100 px-2 py-1">
            <option value="nyest">Nyeste først</option>
            <option value="eldst">Eldste først</option>
          </select>
        </div>
      }
    >
      {q && !filterByText && (
        <p className="bg-sky-50 px-4 py-2 text-xs text-sky-900">Tallene gjelder {people.length} person(er) som matcher «{q}».</p>
      )}
      {groups.length === 0 ? (
        <Empty>Ingen aktiviteter i valgt periode.</Empty>
      ) : (
        groups.map(g => (
          <div key={g.month}>
            <h3 className="sticky top-0 bg-slate-50 px-4 py-1.5 text-xs font-bold tracking-wider text-slate-500 uppercase">{g.month}</h3>
            <ul className="divide-y divide-slate-100">
              {g.items.map(a => <Row key={a.idx} a={a} ctx={ctx} people={people} focused={ctx.focusAct === a.idx} />)}
            </ul>
          </div>
        ))
      )}
      <div className="border-t border-slate-100 px-4 py-3"><Legend /></div>
    </Card>
  )
}

function Row({ a, ctx, people, focused }: { a: Activity; ctx: Ctx; people: Ctx['population']; focused: boolean }) {
  const [open, setOpen] = useState(focused)
  const ref = useRef<HTMLLIElement>(null)
  // Kommer fra en lenke på oversikten: åpne raden, scroll dit og nullstill fokus
  useEffect(() => {
    if (!focused) return
    setOpen(true)
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    ctx.clearFocus()
  }, [focused, ctx])
  const c = countStatuses(people, a)
  const future = a.at >= ctx.now
  const denom = c.ja.length + c.nei.length + (ctx.noAnswerIsAbsent ? c['ikke-svart'].length : 0)
  const pct = denom ? c.ja.length / denom : null

  return (
    <li ref={ref} className={future ? 'bg-sky-50/40' : ''}>
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
        <div className="w-28 shrink-0">
          <div className="font-semibold">{shortDate(a.at)}</div>
          <div className="text-xs text-slate-500">kl. {a.time}{a.minutes ? ` · ${a.minutes} min` : ''}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
            <ActLabel a={a} />
            {future && <span className="rounded bg-sky-100 px-1.5 font-semibold text-sky-800">Kommende</span>}
          </div>
          <SplitBar ja={c.ja.length} nei={c.nei.length} ikkeSvart={c['ikke-svart'].length} className="mt-1.5 h-2" />
        </div>
        <div className="w-24 shrink-0 text-right text-xs tabular-nums text-slate-600">
          <div><b className="text-emerald-700">{c.ja.length}</b> / <b className="text-rose-700">{c.nei.length}</b> / <b className="text-amber-700">{c['ikke-svart'].length}</b></div>
          <div className="font-bold">{pctText(pct)}</div>
        </div>
        <span className={`text-slate-400 transition ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && (
        <div className="space-y-3 bg-slate-50 px-4 py-3">
          {a.rubicUrl && (
            <a href={a.rubicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-navy underline-offset-2 hover:underline">
              Åpne i Rubic ↗
            </a>
          )}
          {[...teams.map(t => t.id), null].map(tid => {
            const members = people.filter(p => p.statuses[a.idx] !== null && colorTeam(p) === tid)
            if (!members.length) return null
            return (
              <div key={tid ?? 'none'} className="flex flex-col gap-1.5 sm:flex-row sm:items-start">
                <div className="w-24 shrink-0">
                  {tid === null && ctx.group === 'stab' ? (
                    <span className="rounded-md bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-600">Felles/andre</span>
                  ) : (
                    <TeamBadge teamId={tid} />
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {members
                    .sort((x, y) => ['ja', 'nei', 'ikke-svart'].indexOf(x.statuses[a.idx]!) - ['ja', 'nei', 'ikke-svart'].indexOf(y.statuses[a.idx]!))
                    .map(p => (
                      <button key={p.id} onClick={() => ctx.openPerson(p.id)} className="flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-xs shadow-sm hover:ring-1 hover:ring-slate-300">
                        <span className={`h-2 w-2 rounded-full ${THEME[colorTeam(p) ?? 'none'].dot}`} />
                        <Pii id={p.id}>{p.short ?? p.name}</Pii>
                        <StatusChip s={p.statuses[a.idx]} />
                      </button>
                    ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </li>
  )
}
