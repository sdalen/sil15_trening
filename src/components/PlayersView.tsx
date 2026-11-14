import type { ReactNode } from 'react'
import { useState } from 'react'
import { personIceMinutes, teamRank, type Person, type Stats } from '../lib/model'
import { hoursText, shortDate } from '../lib/ui'
import type { Ctx } from '../ctx'
import { Card, Empty, Legend, NrBadge, PersonBadge, PctStats, StatsBar, StatusDot, Pii } from './common'

type SortKey = 'name' | 'team' | 'nr' | 'ja' | 'nei' | 'godkjent' | 'ikkeSvart' | 'pct' | 'maxStreak' | 'ice'

export default function PlayersView({ ctx }: { ctx: Ctx }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'team', dir: 1 })
  const last = ctx.pastActs.slice(-8)
  // Tid på is (passerte istreninger i valgt periode) – vises bare når eksporten har varighet
  const pastExtra = ctx.periodExtra.filter(a => a.at < ctx.now)
  const ice = new Map(ctx.visible.map(p => [p.id, { main: personIceMinutes(p, ctx.pastActs.filter(a => a.kind !== 'ekstra')), extra: personIceMinutes(p, pastExtra) }]))
  const showIce = [...ice.values()].some(x => x.main + x.extra > 0)

  const val = (p: Person, s: Stats): number | string => {
    switch (sort.key) {
      case 'name': return p.name
      case 'team': return teamRank(p) * 1000 + (p.nr ? Number(p.nr) : 999)
      case 'nr': return p.nr ? Number(p.nr) : 999
      case 'pct': return s.pct ?? -1
      case 'ice': return (ice.get(p.id)?.main ?? 0) + (ice.get(p.id)?.extra ?? 0)
      default: return s[sort.key]
    }
  }
  const rows = ctx.visible
    .map(p => ({ p, s: ctx.stats.get(p.id)! }))
    .sort((a, b) => {
      const va = val(a.p, a.s), vb = val(b.p, b.s)
      const c = typeof va === 'string' ? va.localeCompare(vb as string, 'nb') : va - (vb as number)
      return c * sort.dir || a.p.name.localeCompare(b.p.name, 'nb')
    })

  const Th = ({ k, children, className = '' }: { k: SortKey; children: ReactNode; className?: string }) => (
    <th className={`px-2 py-2 font-semibold ${className}`}>
      <button
        onClick={() => setSort(s => ({ key: k, dir: s.key === k ? (-s.dir as 1 | -1) : k === 'name' || k === 'team' || k === 'nr' ? 1 : -1 }))}
        className={`inline-flex items-center gap-1 hover:text-navy ${sort.key === k ? 'text-navy' : ''}`}
      >
        {children}
        <span className="text-[10px]">{sort.key === k ? (sort.dir === 1 ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  )

  return (
    <Card title="Spillere" right={`${rows.length} av ${ctx.population.length} · ${ctx.pastActs.length} aktiviteter`}>
      {rows.length === 0 ? (
        <Empty>Ingen treff{ctx.query && <> på «{ctx.query}»</>}.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <Th k="nr" className="pl-3 sm:pl-4">Nr</Th>
                <Th k="name">Navn</Th>
                <Th k="team" className="hidden sm:table-cell">Lag</Th>
                <Th k="ja" className="text-right">Ja</Th>
                <Th k="nei" className="hidden text-right md:table-cell">Avslått</Th>
                <Th k="godkjent" className="hidden text-right sm:table-cell">Godkjent</Th>
                <Th k="ikkeSvart" className="hidden text-right md:table-cell">Ikke svart</Th>
                <th className="hidden w-40 px-2 py-2 font-semibold lg:table-cell">Fordeling</th>
                <th className="hidden px-2 py-2 font-semibold xl:table-cell">Siste {last.length}</th>
                <Th k="maxStreak" className="hidden text-right lg:table-cell">Flest på rad</Th>
                {showIce && <Th k="ice" className="hidden text-right md:table-cell">På is</Th>}
                <Th k="pct" className="pr-3 text-right sm:pr-4">Oppmøte</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(({ p, s }) => (
                <tr key={p.id} onClick={() => ctx.openPerson(p.id, rows.map(r => r.p.id))} className={`cursor-pointer hover:bg-slate-50 ${p.inactive ? "opacity-50" : ""}`}>
                  <td className="py-2 pr-1 pl-3 sm:pr-2 sm:pl-4"><NrBadge p={p} /></td>
                  <td className="px-2 py-2">
                    <div className="font-medium">
                      <Pii id={p.id}>{p.name}</Pii> {p.uncertain && <span title="Usikker kobling til lagoppsett">⚠️</span>}
                      {p.inactive && <span className="ml-1 rounded bg-slate-200 px-1.5 text-xs font-semibold text-slate-600">Trolig sluttet</span>}
                      {p.note && <span className="ml-1 rounded bg-slate-100 px-1.5 text-xs text-slate-600" title="Keeperdrakt">🥅</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500 sm:hidden">
                      <PersonBadge p={p} small />
                      {s.godkjent > 0 && <span className="font-semibold text-sky-700">{s.godkjent} godkjent</span>}
                    </div>
                  </td>
                  <td className="hidden px-2 py-2 sm:table-cell"><PersonBadge p={p} /></td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums text-emerald-700">
                    {s.ja}
                    {!!ctx.extraStats.get(p.id)?.invited && (
                      <div className="text-[11px] font-normal whitespace-nowrap text-violet-700" title={`Frivillig – ${ctx.extraLabel}: ${ctx.extraStats.get(p.id)!.ja} av ${ctx.extraStats.get(p.id)!.invited}, telles ikke i oppmøte`}>
                        ☀️ {ctx.extraStats.get(p.id)!.ja}/{ctx.extraStats.get(p.id)!.invited}
                      </div>
                    )}
                  </td>
                  <td className="hidden px-2 py-2 text-right tabular-nums text-rose-700 md:table-cell">{s.nei}</td>
                  <td className="hidden px-2 py-2 text-right font-semibold tabular-nums text-sky-700 sm:table-cell" title="Avslag med godkjent grunn (fotball, syk …)">{s.godkjent || ''}</td>
                  <td className="hidden px-2 py-2 text-right tabular-nums text-amber-700 md:table-cell">{s.ikkeSvart}</td>
                  <td className="hidden px-2 py-2 lg:table-cell"><StatsBar s={s} /></td>
                  <td className="hidden px-2 py-2 xl:table-cell">
                    <div className="flex gap-1">
                      {last.map(a => <StatusDot key={a.idx} s={p.statuses[a.idx]} title={`${shortDate(a.at)} ${a.time}`} />)}
                    </div>
                  </td>
                  <td className="hidden px-2 py-2 text-right tabular-nums lg:table-cell" title={`Lengste rekke med ja: ${s.maxStreak} · nå: ${s.streak}`}>{s.maxStreak}</td>
                  {showIce && (
                    <td className="hidden px-2 py-2 text-right whitespace-nowrap tabular-nums md:table-cell" title="Tid på is: treninger og Early Bird med ja-svar i valgt periode (ikke kamper/barmark)">
                      {ice.get(p.id)!.main + ice.get(p.id)!.extra ? hoursText(ice.get(p.id)!.main + ice.get(p.id)!.extra) : ''}
                      {ice.get(p.id)!.extra > 0 && (
                        <div className="text-[11px] text-violet-700" title={`Herav ${ctx.extraLabel} (frivillig)`}>☀️ {hoursText(ice.get(p.id)!.extra)}</div>
                      )}
                    </td>
                  )}
                  <td className="py-2 pr-3 pl-1 text-right sm:pr-4 sm:pl-2"><PctStats s={s} stack /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t border-slate-100 px-4 py-3"><Legend /></div>
    </Card>
  )
}
