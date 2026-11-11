/**
 * Krypterer lagoppsettet: private/roster.json (klartekst, ligger IKKE i git) -> src/data/roster.enc.json
 *
 *   npm run encrypt-roster
 *
 * Spør etter saltet (vises ikke på skjermen, lagres ingen steder). Samme salt må skrives inn i appen.
 * Hver person krypteres med en nøkkel avledet fra fullt navn (som i Rubic) + saltet.
 * Rekkefølgen stokkes så posisjonen i fila ikke røper noe.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { seal, type RosterEntry } from '../src/lib/rosterCrypto.ts'

const src = new URL('../private/roster.json', import.meta.url)
const dst = new URL('../src/data/roster.enc.json', import.meta.url)

/** Leser en linje fra terminalen uten å vise det som skrives */
function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process
    if (!stdin.isTTY) return reject(new Error('Kjør skriptet i en vanlig terminal (trenger tastatur for å skrive saltet).'))
    stdout.write(prompt)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let value = ''
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.off('data', onData)
          stdout.write('\n')
          return resolve(value)
        }
        if (c === '\u0003') process.exit(130) // Ctrl+C
        if (c === '\u007f') value = value.slice(0, -1) // Backspace
        else value += c
      }
    }
    stdin.on('data', onData)
  })
}

const salt = await askHidden('Salt: ')
if (salt.length < 8) throw new Error('Saltet må være minst 8 tegn.')
if ((await askHidden('Gjenta salt: ')) !== salt) throw new Error('Saltene var ikke like – ingenting er endret.')

const entries = JSON.parse(readFileSync(src, 'utf8')) as RosterEntry[]
const sealed = await Promise.all(entries.map(e => seal(e, salt)))
for (let i = sealed.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1))
  ;[sealed[i], sealed[j]] = [sealed[j], sealed[i]]
}
writeFileSync(dst, JSON.stringify(sealed, null, 1) + '\n')
console.log(`Krypterte ${sealed.length} personer -> src/data/roster.enc.json`)
