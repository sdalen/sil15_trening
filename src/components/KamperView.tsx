import type { ReactNode } from 'react'
import { teams } from '../data/sil15.js'
import { average, colorTeam, countsInStats, countStatuses, personStats, type Activity, type Person } from '../lib/model'
import { longDate, pctText, THEME } from '../lib/ui'
import type { Ctx } from '../ctx'
import { Card, Empty, Legend, NrBadge, PersonBadge, Pct, SplitBar, StatusChip, TeamBadge, Pii } from './common'

interface Props {
  ctx: Ctx
  uploaded: string[]
  onAdd: (files: FileList) => void
  onRemove: (name: string) => void
}

const teamIdx = (p: Person) => {
  const t = colorTeam(p)
  return t ? teams.findIndex(x => x.id === t) : 99
}

export default function KamperView({ ctx, uploaded, onAdd, onRemove }: Props) {
  // Kamper vises uavhengig av periode-/typefilteret
  const all = ctx.model.activities.filter(a => a.kind === 'kamp' && a.hasData)
  const kamper = all.filter(a => ctx.team === 'alle' || ctx.team === 'uten' || a.team === ctx.team)

  const rows = ctx.visible
    .map(p => ({ p, s: personStats(p, kamper, ctx.noAnswerIsAbsent) }))
    .filter(x => x.s.invited > 0)
    .sort((a, b) => teamIdx(a.p) - teamIdx(b.p) || (b.s.pct ?? -1) - (a.s.pct ?? -1) || a.p.name.localeCompare(b.p.name, 'nb'))
  const notCalled = ctx.visible.filter(p => !rows.some(r => r.p.id === p.id))
  const avg = average(rows.filter(r => countsInStats(r.p)).map(r => r.s.pct))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Kamper" value={kamper.length} sub="fra uttrekk og kampeksporter" />
        <Kpi label="Snitt kampoppmøte" value={<Pct value={avg} />} sub={`blant ${rows.length} innkalte`} />
        <Kpi label="Lag med kamper" value={new Set(kamper.map(a => a.team)).size} sub="av 4" />
        <div className="flex flex-col justify-center gap-2 rounded-2xl bg-white p-4 shadow-sm">
          <label className="cursor-pointer rounded-lg bg-navy px-3 py-2 text-center text-sm font-semibold text-white hover:bg-navy/90">
            + Legg til kampeksport
            <input
              type="file"
              accept=".csv,text/csv"
              multiple
              className="hidden"
              onChange={e => {
                if (e.target.files?.length) onAdd(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
          <p className="text-[11px] leading-tight text-slate-500">Eksporter oppmøtet for én kamp i Rubic og last den inn her.</p>
        </div>
      </div>

      {kamper.length === 0 ? (
        <Card title="Kamper">
          <Empty>Ingen kamper for valgt lag ennå.</Empty>
        </Card>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {[...kamper].reverse().map(a => <MatchCard key={a.idx} a={a} ctx={ctx} />)}
        </div>
      )}

      <Card title="Kampoppmøte per person" right={<Legend />}>
        {rows.length === 0 ? (
          <Empty>Ingen i utvalget er innkalt til kamp ennå.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="py-2 pr-2 pl-4 font-semibold">Nr</th>
                  <th className="px-2 py-2 font-semibold">Navn</th>
                  <th className="hidden px-2 py-2 font-semibold sm:table-cell">Lag</th>
                  <th className="px-2 py-2 text-right font-semibold">Innkalt</th>
                  <th className="px-2 py-2 text-right font-semibold">Ja</th>
                  <th className="hidden px-2 py-2 text-right font-semibold md:table-cell">Avslått</th>
                  <th className="hidden px-2 py-2 text-right font-semibold md:table-cell">Ikke svart</th>
                  <th className="hidden w-40 px-2 py-2 font-semibold lg:table-cell">Fordeling</th>
                  <th className="py-2 pr-4 pl-2 text-right font-semibold">Oppmøte</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(({ p, s }) => (
                  <tr key={p.id} onClick={() => ctx.openPerson(p.id)} className="cursor-pointer hover:bg-slate-50">
                    <td className="py-2 pr-2 pl-4"><NrBadge p={p} /></td>
                    <td className="px-2 py-2 font-medium"><Pii id={p.id}>{p.name}</Pii></td>
                    <td className="hidden px-2 py-2 sm:table-cell"><PersonBadge p={p} /></td>
                    <td className="px-2 py-2 text-right tabular-nums">{s.invited}</td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums text-emerald-700">{s.ja}</td>
                    <td className="hidden px-2 py-2 text-right tabular-nums text-rose-700 md:table-cell">{s.nei}</td>
                    <td className="hidden px-2 py-2 text-right tabular-nums text-amber-700 md:table-cell">{s.ikkeSvart}</td>
                    <td className="hidden px-2 py-2 lg:table-cell"><SplitBar ja={s.ja} nei={s.nei} ikkeSvart={s.ikkeSvart} /></td>
                    <td className="py-2 pr-4 pl-2 text-right"><Pct value={s.pct} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {notCalled.length > 0 && kamper.length > 0 && (
          <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            Ikke innkalt til noen av kampene: {notCalled.map((p, i) => <span key={p.id}>{i > 0 && ', '}<Pii id={p.id}>{p.short ?? p.name}</Pii></span>)}
          </p>
        )}
      </Card>

      <Card title="Innlastede kampfiler">
        <ul className="divide-y divide-slate-100 text-sm">
          {all.map(a => {
            const own = uploaded.includes(a.source)
            return (
              <li key={a.idx} className="flex items-center gap-2 px-4 py-2">
                <span className="truncate font-mono text-xs text-slate-600">{a.source}</span>
                <span className="text-xs text-slate-500">→ {a.date} {a.time}</span>
                <TeamBadge teamId={a.team} small />
                {own ? (
                  <button onClick={() => onRemove(a.source)} className="ml-auto text-xs text-rose-700 hover:underline">Fjern</button>
                ) : (
                  <span className="ml-auto text-xs text-slate-400">følger med appen</span>
                )}
              </li>
            )
          })}
        </ul>
      </Card>
    </div>
  )
}

function MatchCard({ a, ctx }: { a: Activity; ctx: Ctx }) {
  const people = ctx.groupPeople
  const c = countStatuses(people, a)
  const team = teams.find(t => t.id === a.team)
  const games = team && a.tournament ? a.tournament.games.filter(g => g[2] === team.name || g[3] === team.name) : []
  const players = people.filter(p => p.statuses[a.idx] && p.kind === 'spiller')
  const playersJa = players.filter(p => p.statuses[a.idx] === 'ja').length
  const denom = c.ja.length + c.nei.length + (ctx.noAnswerIsAbsent ? c['ikke-svart'].length : 0)

  return (
    <article className={`overflow-hidden rounded-2xl border-l-8 bg-white shadow-sm ${a.team ? THEME[a.team].border : 'border-slate-300'}`}>
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <TeamBadge teamId={a.team} />
            <h3 className="font-bold">{longDate(a.at)}</h3>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            🏒 {a.tournament ? `Turnering ${a.tournament.nr} · ${a.tournament.place}` : 'Kamp'} · kl. {a.time}
          </p>
          {games.length > 0 && (
            <p className="text-xs text-slate-500">
              {games.length} kamper mot {[...new Set(games.map(g => (g[2] === team!.name ? g[3] : g[2]).replace(/^Storhamar /, 'SH ')))].join(', ')}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-2xl font-black tabular-nums">{pctText(denom ? c.ja.length / denom : null)}</div>
          {ctx.group === 'spillere' && <div className="text-xs text-slate-500">{playersJa} av {players.length} spillere</div>}
        </div>
      </div>
      <div className="px-4">
        <SplitBar ja={c.ja.length} nei={c.nei.length} ikkeSvart={c['ikke-svart'].length} className="h-2.5" />
      </div>
      <div className="grid gap-3 px-4 py-3 sm:grid-cols-3">
        {(['ja', 'nei', 'ikke-svart'] as const).map(s => (
          <div key={s}>
            <div className="mb-1">
              <StatusChip s={s} /> <span className="text-xs text-slate-500">{c[s].length}</span>
            </div>
            <ul className="space-y-0.5 text-sm">
              {c[s].map(p => (
                <li key={p.id}>
                  <button onClick={() => ctx.openPerson(p.id)} className="text-left hover:underline">
                    <Pii id={p.id}>{p.short ?? p.name}</Pii>
                    {p.role && <span className="text-xs text-slate-400"> ({p.role.toLowerCase()})</span>}
                  </button>
                </li>
              ))}
              {c[s].length === 0 && <li className="text-xs text-slate-400">–</li>}
            </ul>
          </div>
        ))}
      </div>
    </article>
  )
}

function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold tracking-wider text-slate-500 uppercase">{label}</div>
      <div className="mt-1 text-3xl font-black tabular-nums">{value}</div>
      <div className="text-xs text-slate-500">{sub}</div>
    </div>
  )
}
