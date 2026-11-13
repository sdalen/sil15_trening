import { teams } from '../data/sil15.js'
import { STATUS, THEME, tinyDate } from '../lib/ui'
import { colorTeam, type Person } from '../lib/model'
import type { Ctx } from '../ctx'
import { Card, Empty, Legend, PctStats, Pii, isAnon } from './common'

const order = (p: Person) => (p.kind === 'stab' ? 50 : 0) + (colorTeam(p) ? teams.findIndex(t => t.id === colorTeam(p)) : 99)

export default function MatrixView({ ctx }: { ctx: Ctx }) {
  const acts = ctx.periodActs
  const rows = [...ctx.visible].sort(
    (a, b) =>
      order(a) - order(b) ||
      a.name.localeCompare(b.name, 'nb'),
  )

  if (!rows.length || !acts.length) {
    return (
      <Card title="Matrise">
        <Empty>Ingen data å vise.</Empty>
      </Card>
    )
  }

  return (
    <Card title="Matrise" right={<Legend />}>
      <div className="max-h-[75vh] overflow-auto">
        <table className="border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-20 bg-white px-3 py-2 text-left font-semibold">Spiller</th>
              <th className="sticky top-0 z-10 bg-white px-2 py-2 text-right font-semibold">%</th>
              {acts.map(a => (
                <th
                  key={a.idx}
                  title={`${a.date} ${a.time}${a.kind === 'kamp' ? ` – kamp${a.tournament ? ` ${a.tournament.place}` : ''}` : ''}`}
                  className={`sticky top-0 z-10 h-20 min-w-6 bg-white px-0.5 align-bottom font-medium ${a.at >= ctx.now ? 'text-sky-700' : 'text-slate-500'}`}
                >
                  <div className="mx-auto w-4 [writing-mode:vertical-rl] rotate-180 whitespace-nowrap tabular-nums">
                    {a.kind === 'kamp' ? '🏒 ' : ''}
                    {tinyDate(a.at)} {a.time}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.id} className="group">
                <td className="sticky left-0 z-10 max-w-44 truncate border-t border-slate-100 bg-white px-3 py-1 group-hover:bg-slate-50">
                  <button onClick={() => ctx.openPerson(p.id)} className="flex items-center gap-1.5 hover:underline">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${THEME[colorTeam(p) ?? 'none'].dot}`} />
                    <span className="truncate"><Pii id={p.id}>{p.short ?? p.name}</Pii></span>
                    {p.nr && <span className="text-slate-400">#{p.nr}</span>}
                  </button>
                </td>
                <td className="border-t border-slate-100 px-2 text-right group-hover:bg-slate-50">
                  <PctStats s={ctx.stats.get(p.id)!} />
                </td>
                {acts.map(a => {
                  const s = p.statuses[a.idx]
                  return (
                    <td key={a.idx} className="border-t border-slate-100 p-0.5 group-hover:bg-slate-50" title={`${isAnon() ? '' : `${p.name} · `}${a.date} ${a.time}: ${s ? STATUS[s].label : 'Ikke med'}${p.corrected[a.idx] ? ` (${p.corrected[a.idx]})` : ''}`}>
                      <div className={`mx-auto h-4 w-4 rounded-sm ${s ? STATUS[s].cell : 'bg-slate-100'} ${a.at >= ctx.now ? 'opacity-50' : ''}`} />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Blå datoer / bleke ruter = kommende aktiviteter (påmelding). 🏒 = kamp.</p>
    </Card>
  )
}
