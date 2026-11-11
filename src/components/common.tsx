import type { ReactNode } from 'react'
import type { TeamId } from '../data/sil15.js'
import { colorTeam, type Activity, type Person, type Stats, type Status } from '../lib/model'
import { pctColor, pctText, STATUS, teamShort, THEME } from '../lib/ui'

export function Card({ title, right, children, className = '' }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`overflow-hidden rounded-2xl bg-white shadow-sm ${className}`}>
      {title && (
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="font-bold">{title}</h2>
          {right && <div className="ml-auto text-sm text-slate-500">{right}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function TeamBadge({ teamId, small }: { teamId: TeamId | null; small?: boolean }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-md font-bold ${small ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-xs'} ${THEME[teamId ?? 'none'].pill}`}>
      {teamShort(teamId)}
    </span>
  )
}

export function NrBadge({ p }: { p: Person }) {
  return (
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums ${THEME[colorTeam(p) ?? 'none'].pill}`}>
      {p.nr ?? '–'}
    </span>
  )
}

export function StatusDot({ s, title }: { s: Status; title?: string }) {
  return <span title={title} className={`inline-block h-2.5 w-2.5 rounded-full ${s ? STATUS[s].dot : 'bg-slate-200'}`} />
}

export function StatusChip({ s }: { s: Status }) {
  if (!s) return <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-400">Ikke med</span>
  return <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${STATUS[s].chip}`}>{STATUS[s].label}</span>
}

export function Pct({ value, className = '' }: { value: number | null; className?: string }) {
  return <span className={`font-bold tabular-nums ${pctColor(value)} ${className}`}>{pctText(value)}</span>
}

/** Stablet stolpe ja / nei / ikke svart */
export function SplitBar({ ja, nei, ikkeSvart, className = 'h-2' }: { ja: number; nei: number; ikkeSvart: number; className?: string }) {
  const total = ja + nei + ikkeSvart
  if (!total) return <div className={`rounded-full bg-slate-100 ${className}`} />
  return (
    <div className={`flex gap-px overflow-hidden rounded-full bg-slate-100 ${className}`}>
      <div className={STATUS.ja.cell} style={{ width: `${(ja / total) * 100}%` }} />
      <div className={STATUS.nei.cell} style={{ width: `${(nei / total) * 100}%` }} />
      <div className={STATUS['ikke-svart'].cell} style={{ width: `${(ikkeSvart / total) * 100}%` }} />
    </div>
  )
}

export function StatsBar({ s }: { s: Stats }) {
  return <SplitBar ja={s.ja} nei={s.nei} ikkeSvart={s.ikkeSvart} />
}

export function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
      {(['ja', 'nei', 'ikke-svart'] as const).map(s => (
        <span key={s} className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-sm ${STATUS[s].cell}`} /> {STATUS[s].label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm bg-slate-100 ring-1 ring-slate-200" /> Ikke med
      </span>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-slate-500">{children}</p>
}

/** Lag-merke for en person; for stab vises også rollen */
export function PersonBadge({ p, small }: { p: Person; small?: boolean }) {
  if (!p.role) return <TeamBadge teamId={p.teamId} small={small} />
  return (
    <span className="inline-flex items-center gap-1">
      {p.staffTeam && <TeamBadge teamId={p.staffTeam} small={small} />}
      <span className={`rounded-md bg-navy font-semibold text-white ${small ? 'px-1.5 text-[10px]' : 'px-2 py-0.5 text-xs'}`}>{p.role}</span>
    </span>
  )
}

/** Kort beskrivelse av en aktivitet: kamp (med lag og sted) eller trening */
export function ActLabel({ a }: { a: Activity }) {
  if (a.kind === 'kamp')
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <span className="font-semibold">🏒 Kamp{a.tournament ? ` · ${a.tournament.place}` : ''}</span>
        {a.team && <TeamBadge teamId={a.team} small />}
      </span>
    )
  if (a.tournament)
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        Turneringsdag · {a.tournament.place}
        {a.playingTeams.map(t => <TeamBadge key={t} teamId={t} small />)}
      </span>
    )
  return <span>Trening</span>
}
