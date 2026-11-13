import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { APPROVED_REASON, inPeriod, monthsWithData, parseExport, type Period, type Status } from '../lib/model'
import { shortDate, store } from '../lib/ui'
import { PctStats, StatusChip, Pii } from './common'

/**
 * Furnes fotball: bare spillere og oppmøte. Leser en egen CSV i Rubic-eksportformat
 * (lages lokalt med local/rubic-csv.mjs) – lagres bare i denne nettleseren.
 * Overskriftene har kategori og tittel bak klokkeslettet: «15.11.2026 (08:30) Cup · Dala Cup 2026».
 */
const CATS = ['Trening', 'Sommertrening', 'Kamp', 'Treningskamp', 'Cup'] as const
type Cat = (typeof CATS)[number] | 'Alle'
// Egne perioder for Furnes – ikke hockeysesongens høst/vår-inndeling
const PERIODS: { id: Period; label: string }[] = [
  { id: 'alle', label: 'Hele perioden' },
  { id: '30', label: 'Siste 30 dager' },
  { id: '60', label: 'Siste 60 dager' },
]
const isFurnesPeriod = (v: string): v is Period => /^\d{4}-\d{2}$/.test(v) || PERIODS.some(p => p.id === v)

const PLURAL: Record<Cat, string> = {
  Alle: 'aktiviteter', Trening: 'treninger', Sommertrening: 'sommertreninger', Kamp: 'kamper', Treningskamp: 'treningskamper', Cup: 'cuper',
}

export default function FurnesView({ onBack, extra }: { onBack: () => void; extra?: ReactNode }) {
  const [csv, setCsv] = useState<{ name: string; text: string } | null>(() => store.get('furnesCsv', null))
  useEffect(() => store.set('furnesCsv', csv ?? undefined), [csv])
  const [cat, setCat] = useState<Cat>(() => store.get('furnesCat', 'Trening'))
  useEffect(() => store.set('furnesCat', cat), [cat])
  const [open, setOpen] = useState<string | null>(null)
  const [period, setPeriod] = useState<Period>(() => {
    const p = store.get<string>('furnesPeriod', 'alle')
    return isFurnesPeriod(p) ? p : 'alle'
  })
  useEffect(() => store.set('furnesPeriod', period), [period])

  const result = useMemo(() => {
    if (!csv) return null
    try {
      const x = parseExport(csv.text)
      const now = new Date()
      // Bare passerte aktiviteter teller. Uten kategori i overskriften = trening.
      const acts = x.cols
        .map((c, i) => {
          const [first, ...rest] = c.label.split(' · ')
          const cat = ((CATS as readonly string[]).includes(first) ? first : 'Trening') as Cat
          return { i, cat, title: rest.join(' · ') || cat, date: c.date, at: new Date(`${c.date}T${c.time}:00`), time: c.time, hasData: true }
        })
        .filter(a => a.at < now)
      const months = monthsWithData(acts)
      const inP = acts.filter(a => inPeriod(a, period, now))
      const counts = Object.fromEntries(CATS.map(k => [k, inP.filter(a => a.cat === k).length])) as Record<Cat, number>
      const shown = inP.filter(a => cat === 'Alle' || a.cat === cat)
      const rows = x.rows
        .map(r => {
          let ja = 0, nei = 0, ub = 0, godkjent = 0
          for (const a of shown) {
            const s = r.codes[a.i]
            if (s === 'ja') ja++
            else if (s === 'nei' && APPROVED_REASON.test(r.notes[a.i])) godkjent++
            else if (s === 'nei') nei++
            else if (s === 'ikke-svart') ub++
          }
          const invited = ja + nei + ub + godkjent
          return { name: r.name, codes: r.codes, notes: r.notes, ja, nei, ub, godkjent, invited, pct: invited ? ja / invited : null, pctGodkjent: invited - godkjent ? ja / (invited - godkjent) : null }
        })
        .filter(r => r.invited > 0)
        .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.ja - a.ja || a.name.localeCompare(b.name, 'nb'))
      return { rows, shown, counts, total: inP.length, months }
    } catch (e) {
      return { error: (e as Error).message }
    }
  }, [csv, cat, period])

  async function onUpload(file: File) {
    const text = await file.text()
    try {
      parseExport(text)
      setCsv({ name: file.name, text })
    } catch (e) {
      alert(`Kunne ikke lese ${file.name}: ${(e as Error).message}`)
    }
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 bg-emerald-800 text-white shadow-lg">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <button onClick={onBack} className="rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/25">← Storhamar</button>
          <h1 className="text-lg font-black tracking-wide">Furnes <span className="text-emerald-200">Oppmøte</span></h1>
          <div className="ml-auto">{extra}</div>
          <label className="cursor-pointer rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold whitespace-nowrap hover:bg-white/25">
            {csv ? 'Bytt CSV' : 'Last inn CSV'}
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => e.target.files?.[0] && onUpload(e.target.files[0])} />
          </label>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-4">
        {!result ? (
          <p className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm">Last inn oppmøte-CSV for Furnes.</p>
        ) : 'error' in result ? (
          <p className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-800">Filen kunne ikke leses ({result.error}).</p>
        ) : (
          <>
            <select
              value={period}
              onChange={e => setPeriod(e.target.value as Period)}
              className="mb-3 rounded-lg bg-white px-3 py-2 text-sm shadow-sm"
              aria-label="Periode"
            >
              {PERIODS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              {result.months.length > 0 && (
                <optgroup label="Måned">
                  {result.months.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </optgroup>
              )}
            </select>
            <div className="mb-3 flex gap-1 overflow-x-auto rounded-xl bg-slate-200 p-1">
              {(['Alle', ...CATS.filter(k => result.counts[k] > 0 || k === cat)] as Cat[]).map(k => (
                <button
                  key={k}
                  onClick={() => setCat(k)}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap transition ${cat === k ? 'bg-white text-emerald-800 shadow' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  {k} <span className="text-xs font-normal opacity-70">{k === 'Alle' ? result.total : result.counts[k]}</span>
                </button>
              ))}
            </div>
            <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
              <div className="flex items-center border-b border-slate-100 px-4 py-3">
                <h2 className="font-bold">Spillere</h2>
                <span className="ml-auto text-sm text-slate-500">{result.rows.length} spillere · {result.shown.length} {PLURAL[cat]}</span>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="py-2 pl-4 font-semibold">#</th>
                    <th className="px-2 py-2 font-semibold">Navn</th>
                    <th className="px-2 py-2 text-right font-semibold">Ja</th>
                    <th className="py-2 pr-4 text-right font-semibold">Oppmøte</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.rows.map((r, i) => (
                    <Fragment key={r.name}>
                      <tr onClick={() => setOpen(o => (o === r.name ? null : r.name))} className="cursor-pointer hover:bg-slate-50">
                        <td className="py-2 pl-4 text-slate-400 tabular-nums">{i + 1}.</td>
                        <td className="px-2 py-2 font-medium">
                          <span className="mr-1 inline-block w-3 text-slate-400">{open === r.name ? '▾' : '▸'}</span>
                          <Pii id={`furnes:${r.name}`}>{r.name}</Pii>
                        </td>
                        <td className="px-2 py-2 text-right text-slate-500 tabular-nums">
                          {r.ja} av {r.invited}
                          {r.godkjent > 0 && <div className="text-xs font-semibold text-sky-700">{r.godkjent} godkjent</div>}
                        </td>
                        <td className="py-2 pr-4 text-right"><PctStats s={r} /></td>
                      </tr>
                      {open === r.name && (
                        <tr className="bg-slate-50">
                          <td colSpan={4} className="px-4 pt-1 pb-3">
                            <div className="mb-2 text-xs text-slate-500">
                              {r.ja} ja · {r.nei} avslått · {r.ub} ikke svart{r.godkjent > 0 && ` · ${r.godkjent} godkjent fravær`}
                            </div>
                            <ul className="divide-y divide-slate-200 rounded-xl bg-white">
                              {[...result.shown].reverse().filter(a => r.codes[a.i] !== null).map(a => (
                                <li key={a.i} className="flex items-center gap-3 px-3 py-1.5">
                                  <span className="w-28 shrink-0 text-xs text-slate-500 tabular-nums">{shortDate(a.at)} {a.time}</span>
                                  <span className="min-w-0 flex-1 truncate">{a.title}</span>
                                  {r.notes[a.i] && <span className="max-w-32 truncate text-xs text-slate-500" title={r.notes[a.i]}>{r.notes[a.i]}</span>}
                                  {r.codes[a.i] === 'nei' && APPROVED_REASON.test(r.notes[a.i]) ? (
                                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">Godkjent</span>
                                  ) : (
                                    <StatusChip s={r.codes[a.i] as Status} />
                                  )}
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
