import { teams, type TeamId } from '../data/sil15.js'
import type { Status } from './model'

export const THEME: Record<TeamId | 'none', { pill: string; dot: string; bar: string; soft: string; text: string; border: string }> = {
  hvit: { pill: 'bg-white text-navy ring-2 ring-slate-300', dot: 'bg-white ring-1 ring-slate-400', bar: 'bg-slate-400', soft: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-300' },
  rod: { pill: 'bg-sh-red text-white', dot: 'bg-sh-red', bar: 'bg-sh-red', soft: 'bg-red-50', text: 'text-sh-red', border: 'border-sh-red' },
  bla: { pill: 'bg-sh-blue text-white', dot: 'bg-sh-blue', bar: 'bg-sh-blue', soft: 'bg-blue-50', text: 'text-sh-blue', border: 'border-sh-blue' },
  gul: { pill: 'bg-sh-yellow text-navy', dot: 'bg-sh-yellow', bar: 'bg-sh-yellow', soft: 'bg-amber-50', text: 'text-amber-700', border: 'border-sh-yellow' },
  none: { pill: 'bg-slate-200 text-slate-600', dot: 'bg-slate-300', bar: 'bg-slate-300', soft: 'bg-slate-50', text: 'text-slate-500', border: 'border-slate-300' },
}

export const teamShort = (id: TeamId | null) => (id ? teams.find(t => t.id === id)!.short : 'Uten lag')

export const STATUS: Record<Exclude<Status, null>, { label: string; cell: string; chip: string; dot: string }> = {
  ja: { label: 'Ja', cell: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500' },
  nei: { label: 'Avslått', cell: 'bg-rose-500', chip: 'bg-rose-100 text-rose-800', dot: 'bg-rose-500' },
  'ikke-svart': { label: 'Ikke svart', cell: 'bg-amber-300', chip: 'bg-amber-100 text-amber-800', dot: 'bg-amber-400' },
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => cap(new Intl.DateTimeFormat('nb-NO', o).format(d))
export const shortDate = (d: Date) => fmt(d, { weekday: 'short', day: 'numeric', month: 'short' })
export const longDate = (d: Date) => fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })
export const tinyDate = (d: Date) => fmt(d, { day: 'numeric', month: 'numeric' })
export const monthLabel = (d: Date) => fmt(d, { month: 'long', year: 'numeric' })

export const pctText = (p: number | null) => (p === null ? '–' : `${Math.round(p * 100)} %`)

export function pctColor(p: number | null) {
  if (p === null) return 'text-slate-400'
  if (p >= 0.75) return 'text-emerald-700'
  if (p >= 0.5) return 'text-amber-700'
  return 'text-rose-700'
}

export function daysUntil(d: Date, now: Date) {
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(d) - day(now)) / 86400000)
  if (diff === 0) return 'I dag'
  if (diff === 1) return 'I morgen'
  return `Om ${diff} dager`
}

export const store = {
  get<T>(k: string, fallback: T): T {
    try {
      const v = localStorage.getItem(k)
      return v === null ? fallback : (JSON.parse(v) as T)
    } catch {
      return fallback
    }
  },
  set(k: string, v: unknown) {
    try {
      if (v === undefined) localStorage.removeItem(k)
      else localStorage.setItem(k, JSON.stringify(v))
    } catch {
      /* ignorer */
    }
  },
}
