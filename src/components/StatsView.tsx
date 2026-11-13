import { countStatuses, countsInStats, iceMinutes, personIceMinutes, type Activity, type Person } from '../lib/model'
import { hoursText, pctText, shortDate } from '../lib/ui'
import type { Ctx } from '../ctx'
import { Card, Empty, NrBadge, Pii } from './common'

/** Når er vi flest og færrest på trening? Bare passerte treninger i valgt periode, lag og gruppe. */
const DAYS = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag']
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const num = (x: number) => x.toLocaleString('nb-NO', { maximumFractionDigits: 1 })

type Row = { a: Activity; ja: number; of: number; pct: number | null }
type Group = { key: string; label: string; rows: Row[]; avgJa: number; avgPct: number | null }

function group(rows: Row[], keyOf: (r: Row) => string, labelOf: (r: Row) => string): Group[] {
  const m = new Map<string, Row[]>()
  for (const r of rows) m.set(keyOf(r), [...(m.get(keyOf(r)) ?? []), r])
  return [...m].map(([key, rs]) => {
    const pcts = rs.map(r => r.pct).filter((x): x is number => x !== null)
    return {
      key,
      label: labelOf(rs[0]),
      rows: rs,
      avgJa: rs.reduce((s, r) => s + r.ja, 0) / rs.length,
      avgPct: pcts.length ? pcts.reduce((s, x) => s + x, 0) / pcts.length : null,
    }
  })
}

export default function StatsView({ ctx }: { ctx: Ctx }) {
  const people: Person[] = ctx.population.filter(countsInStats)
  const rows: Row[] = ctx.pastActs
    .filter(a => a.kind === 'trening')
    .map(a => {
      const c = countStatuses(people, a)
      const of = c.ja.length + c.nei.length + (ctx.noAnswerIsAbsent ? c['ikke-svart'].length : 0)
      return { a, ja: c.ja.length, of, pct: of ? c.ja.length / of : null }
    })
    .filter(r => r.of > 0)

  if (!rows.length) return <Card title="Statistikk"><Empty>Ingen passerte treninger i valgt periode.</Empty></Card>

  const byDay = group(rows, r => String(r.a.at.getDay()), r => cap(DAYS[r.a.at.getDay()]))
    .sort((x, y) => DAY_ORDER.indexOf(Number(x.key)) - DAY_ORDER.indexOf(Number(y.key)))
  const byMonth = group(rows, r => r.a.date.slice(0, 7), r => cap(r.a.at.toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' })))
    .sort((x, y) => x.key.localeCompare(y.key))
  const byTime = group(rows, r => r.a.time, r => `kl. ${r.a.time}`).sort((x, y) => x.key.localeCompare(y.key))
  const bySlot = group(rows, r => `${r.a.at.getDay()} ${r.a.time}`, r => `${cap(DAYS[r.a.at.getDay()])} ${r.a.time}`)
    .sort((x, y) => y.avgJa - x.avgJa)
  // Faste tidspunkt = minst to treninger; enkeltstående tas ikke med i flest/færrest
  const regular = bySlot.filter(g => g.rows.length >= 2)
  const most = regular[0]
  const least = regular.at(-1)
  // Hverdag (man–fre) mot helg (lør–søn)
  const [weekday, weekend] = [false, true].map(helg => {
    const g = group(rows.filter(r => [0, 6].includes(r.a.at.getDay()) === helg), () => 'x', () => (helg ? 'Helg' : 'Hverdag'))
    return g[0] ?? null
  })
  const sorted = [...rows].sort((x, y) => y.ja - x.ja || x.a.at.getTime() - y.a.at.getTime())
  const max = Math.max(...rows.map(r => r.ja))
  // Samlet istid (treninger på is med kjent varighet fra local/rubic-csv.mjs)
  const trainingMin = rows.reduce((sum, r) => sum + iceMinutes(r.a), 0)

  // Istid per person: passerte istreninger + frivillige ekstratreninger (Early Bird) med ja-svar
  const trainActs = rows.map(r => r.a)
  const extraActs = ctx.periodExtra.filter(a => a.at < ctx.now)
  const ice = people
    .map(p => ({ p, main: personIceMinutes(p, trainActs), extra: personIceMinutes(p, extraActs) }))
    .map(x => ({ ...x, total: x.main + x.extra }))
    .sort((x, y) => y.total - x.total || x.p.name.localeCompare(y.p.name, 'nb'))
  const hasIce = ice.some(x => x.total > 0)
  const iceMax = Math.max(1, ...ice.map(x => x.total))
  // Snitt istid per spiller per måned, og hvor mye istid som ble tilbudt (vanlige treninger)
  const iceMonths = [...new Set([...trainActs, ...extraActs].map(a => a.date.slice(0, 7)))].sort().map(m => {
    const tr = trainActs.filter(a => a.date.startsWith(m))
    const ex = extraActs.filter(a => a.date.startsWith(m))
    const avg = people.length ? people.reduce((sum, p) => sum + personIceMinutes(p, tr) + personIceMinutes(p, ex), 0) / people.length : 0
    const offered = tr.reduce((sum, a) => sum + iceMinutes(a), 0)
    const label = cap(new Date(`${m}-01T12:00:00`).toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' }))
    return { m, label, avg, offered }
  }).filter(x => x.offered > 0 || x.avg > 0)
  const monthMax = Math.max(1, ...iceMonths.map(x => Math.max(x.avg, x.offered)))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Treninger" value={rows.length} sub={`passerte i valgt periode${trainingMin ? ` · ${hoursText(trainingMin)} på is` : ''}`} />
        <Tile label="Snitt på trening" value={num(rows.reduce((s, r) => s + r.ja, 0) / rows.length)} sub={`av ${people.length} i utvalget`} />
        <Tile label="Flest (fast tid)" value={most ? num(most.avgJa) : '–'} sub={most ? `${most.label} · ${most.rows.length} treninger` : 'for lite data'} />
        <Tile label="Færrest (fast tid)" value={least && least !== most ? num(least.avgJa) : '–'} sub={least && least !== most ? `${least.label} · ${least.rows.length} treninger` : 'for lite data'} />
      </div>

      {weekday && weekend && (
        <Card title="Hverdag mot helg">
          <Bars groups={[weekday, weekend]} max={max} />
          <p className="border-t border-slate-100 px-4 py-2 text-sm text-slate-600">
            {weekday.avgJa >= weekend.avgJa ? 'Hverdager' : 'Helger'} har i snitt{' '}
            <b className="text-slate-900">{num(Math.abs(weekday.avgJa - weekend.avgJa))}</b> flere på trening
            {weekday.avgPct !== null && weekend.avgPct !== null && (
              <> ({Math.round(Math.abs(weekday.avgPct - weekend.avgPct) * 100)} prosentpoeng høyere oppmøte)</>
            )}
            .
          </p>
        </Card>
      )}

      {byMonth.length > 1 && (
        <Card title="Per måned">
          <Bars groups={byMonth} max={max} />
        </Card>
      )}

      {hasIce && (
        <>
          <Card title="Snitt istid per måned" right="per spiller · av tilbudt">
            <ul className="divide-y divide-slate-100">
              {iceMonths.map(x => (
                <li key={x.m} className="flex items-center gap-3 px-4 py-2 text-sm" title={`${x.label}: ${hoursText(x.avg)} i snitt per spiller av ${hoursText(x.offered)} tilbudt (vanlige treninger; Early Bird kommer i tillegg)`}>
                  <span className="w-32 shrink-0 font-medium">{x.label}</span>
                  <span className="relative h-3 flex-1">
                    <span className="absolute inset-y-0 left-0 rounded-r bg-slate-200" style={{ width: `${(x.offered / monthMax) * 100}%` }} />
                    <span className="absolute inset-y-0 left-0 rounded-r bg-navy" style={{ width: `${(x.avg / monthMax) * 100}%` }} />
                  </span>
                  <span className="w-14 shrink-0 text-right font-bold tabular-nums">{hoursText(x.avg)}</span>
                  <span className="w-16 shrink-0 text-right text-xs text-slate-400 tabular-nums">av {hoursText(x.offered)}</span>
                </li>
              ))}
            </ul>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Mest istid" right="treninger + Early Bird">
              <IceList rows={ice.slice(0, 10)} max={iceMax} ctx={ctx} />
            </Card>
            <Card title="Minst istid" right="treninger + Early Bird">
              <IceList rows={ice.slice(-10).reverse()} max={iceMax} ctx={ctx} />
            </Card>
          </div>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Per ukedag">
          <Bars groups={byDay} max={max} />
        </Card>
        <Card title="Per klokkeslett">
          <Bars groups={byTime} max={max} />
        </Card>
      </div>

      <Card title="Ukedag og klokkeslett" right="flest øverst">
        <Bars groups={bySlot} max={max} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Flest på trening">
          <ActList rows={sorted.slice(0, 5)} ctx={ctx} />
        </Card>
        <Card title="Færrest på trening">
          <ActList rows={sorted.slice(-5).reverse()} ctx={ctx} />
        </Card>
      </div>
    </div>
  )
}

function Bars({ groups, max }: { groups: Group[]; max: number }) {
  return (
    <ul className="divide-y divide-slate-100">
      <li className="flex items-center gap-3 px-4 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-slate-400 uppercase" aria-hidden="true">
        <span className="flex-1" />
        <span className="w-14 shrink-0 text-right">Snitt ja</span>
        <span className="w-14 shrink-0 text-right">Oppmøte</span>
        <span className="hidden w-16 shrink-0 text-right sm:inline">Treninger</span>
      </li>
      {groups.map(g => {
        const tip = `${g.label}: ${num(g.avgJa)} sa ja i snitt · ${pctText(g.avgPct)} oppmøte · ${g.rows.length} treninger`
        return (
          <li key={g.key} className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-slate-50" title={tip}>
            <span className="w-28 shrink-0 font-medium">{g.label}</span>
            <span className="relative h-3 flex-1">
              <span className="absolute inset-y-0 left-0 rounded-r bg-navy" style={{ width: `${max ? (g.avgJa / max) * 100 : 0}%` }} />
            </span>
            <span className="w-14 shrink-0 text-right font-bold tabular-nums">{num(g.avgJa)}</span>
            <span className="w-14 shrink-0 text-right text-xs text-slate-500 tabular-nums">{pctText(g.avgPct)}</span>
            <span className="hidden w-16 shrink-0 text-right text-xs text-slate-400 tabular-nums sm:inline">{g.rows.length}</span>
          </li>
        )
      })}
    </ul>
  )
}

function IceList({ rows, max, ctx }: { rows: { p: Person; main: number; extra: number; total: number }[]; max: number; ctx: Ctx }) {
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map(x => (
        <li key={x.p.id}>
          <button onClick={() => ctx.openPerson(x.p.id)} className="flex w-full items-center gap-3 px-4 py-1.5 text-left text-sm hover:bg-slate-50">
            <NrBadge p={x.p} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium"><Pii id={x.p.id}>{x.p.name}</Pii></span>
              <span className="relative mt-1 block h-1.5">
                <span className="absolute inset-y-0 left-0 rounded-r bg-navy" style={{ width: `${(x.main / max) * 100}%` }} />
                <span className="absolute inset-y-0 rounded-r bg-violet-400" style={{ left: `${(x.main / max) * 100}%`, width: `${(x.extra / max) * 100}%` }} />
              </span>
            </span>
            <span className="w-14 shrink-0 text-right">
              <span className="block font-bold tabular-nums">{hoursText(x.total)}</span>
              {x.extra > 0 && <span className="block text-[11px] text-violet-700 tabular-nums">☀️ {hoursText(x.extra)}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function ActList({ rows, ctx }: { rows: Row[]; ctx: Ctx }) {
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map(r => (
        <li key={r.a.idx}>
          <button onClick={() => ctx.openActivity(r.a.idx)} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-slate-50">
            <span className="w-28 shrink-0 font-medium">{shortDate(r.a.at)}</span>
            <span className="w-12 shrink-0 text-slate-500 tabular-nums">{r.a.time}</span>
            <span className="flex-1" />
            <span className="font-bold tabular-nums">{r.ja}</span>
            <span className="w-12 text-right text-xs text-slate-500 tabular-nums">{pctText(r.pct)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold tracking-wider text-slate-500 uppercase">{label}</div>
      <div className="mt-1 text-3xl font-black tabular-nums">{value}</div>
      <div className="text-xs text-slate-500">{sub}</div>
    </div>
  )
}
