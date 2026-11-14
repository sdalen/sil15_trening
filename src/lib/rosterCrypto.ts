/**
 * Kryptert lagoppsett.
 *
 * Hver person i lagoppsettet krypteres for seg, med en nøkkel avledet fra personens fulle navn
 * (slik det står i Rubic) + et hemmelig salt som brukeren skriver inn. Saltet ligger aldri i koden.
 * Appen kan dermed bare låse opp personer den har navnet på – dvs. de som står i CSV-en brukeren
 * laster opp – og bare med riktig salt. Ingen navn ligger i klartekst i koden.
 *
 * Brukes både av appen (nettleser) og av scripts/encrypt-roster.ts (Node) – derfor ingen andre imports.
 */

const ITERATIONS = 100_000

export type TeamId = 'hvit' | 'rod' | 'bla' | 'gul'
export type StaffRole = 'Hovedtrener' | 'Trener' | 'Lagleder' | 'Materialforvalter'

export interface RosterEntry {
  full: string
  /** team = null: spiller, men laget er ikke kjent ennå (vises «uten lag») */
  player?: { team: TeamId | null; short: string; nr: string | null; note?: string; uncertain?: boolean; inactive?: boolean }
  staff?: { role: StaffRole; team: TeamId | null }
  /** Manuelle rettelser – gjelder bare treninger som står som «ikke svart» */
  corrections?: { from?: string; to?: string; status: 'ja' | 'nei' | null; note: string }[]
  /** Har sluttet – vises ikke noe sted i appen */
  removed?: boolean
}

/** Én kryptert person: id = oppslagsnøkkel avledet fra navnet, iv + ct = AES-GCM (base64) */
export interface SealedEntry {
  id: string
  iv: string
  ct: string
}

export const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim()
export const fold = (s: string) => norm(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

const enc = new TextEncoder()
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))
const hex = (b: Uint8Array) => [...b].map(x => x.toString(16).padStart(2, '0')).join('')

async function derive(name: string, salt: string): Promise<{ id: string; key: CryptoKey }> {
  const { subtle } = globalThis.crypto
  const base = await subtle.importKey('raw', enc.encode(fold(name)), 'PBKDF2', false, ['deriveBits'])
  const bits = new Uint8Array(
    await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(`u12_2015:${salt}`), iterations: ITERATIONS }, base, 512),
  )
  // Første halvdel = AES-nøkkel, andre halvdel = oppslags-id (ikke utledbar fra nøkkelen og omvendt)
  const key = await subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt'])
  return { id: hex(bits.slice(32, 48)), key }
}

export async function seal(entry: RosterEntry, salt: string): Promise<SealedEntry> {
  const { id, key } = await derive(entry.full, salt)
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(entry))))
  return { id, iv: b64(iv), ct: b64(ct) }
}

// Avledning er bevisst treg – husk resultatet per navn så nye kampfiler ikke regner alt på nytt
const cache = new Map<string, Promise<RosterEntry | null>>()

async function openOne(name: string, salt: string, byId: Map<string, SealedEntry>): Promise<RosterEntry | null> {
  const { id, key } = await derive(name, salt)
  const hit = byId.get(id)
  if (!hit) return null
  const pt = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(hit.iv) }, key, unb64(hit.ct))
  return JSON.parse(new TextDecoder().decode(pt)) as RosterEntry
}

/**
 * Låser opp de personene i lagoppsettet som finnes blant `names`. Nøkkel i resultatet = fold(navn).
 * Feil salt gir et tomt resultat (ingen treff), ikke en feil.
 */
export async function unlock(sealed: SealedEntry[], names: string[], salt: string): Promise<Map<string, RosterEntry>> {
  const byId = new Map(sealed.map(s => [s.id, s]))
  const unique = [...new Map(names.map(n => [fold(n), n])).entries()]
  const out = new Map<string, RosterEntry>()
  await Promise.all(
    unique.map(async ([k, n]) => {
      const ck = `${salt}\u0000${k}`
      if (!cache.has(ck)) cache.set(ck, openOne(n, salt, byId).catch(() => null))
      const e = await cache.get(ck)!
      if (e) out.set(k, e)
    }),
  )
  return out
}
