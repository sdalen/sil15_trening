# Sette opp laget

Appen trenger å vite hvilket lag hver spiller går på, og hvem som er trenere og ledere. Det kan komme fra to steder:

| | Fra Rubic (`npm run export_all`) | Kryptert lagoppsett (`npm run encrypt-roster`) |
| --- | --- | --- |
| Oppsett | Ingen: lag og roller hentes fra Rubic | `private/roster.json` som du vedlikeholder selv |
| Lag og rolle | ✓ | ✓ |
| Draktnummer, kallenavn, keeperdrakt | – | ✓ |
| Manuelle rettelser av oppmøte | – | ✓ |
| Skjule spillere som har sluttet | – | ✓ |
| I appen | Uten salt | Med salt (haken «Bruk salt») |

Holder det med lag og roller, trenger du ikke gjøre noe annet enn å kjøre `npm run export_all` (se [README](README.md)). Resten av dette dokumentet handler om det krypterte lagoppsettet og om hvordan lagene er definert i koden.

## 1. Lagoppsettet: `private/roster.json`

`private/` står i `.gitignore`, så fila med navn i klartekst havner aldri i git. Den må kopieres manuelt mellom maskiner.

Fila er en liste med én oppføring per person:

```json
[
  {
    "full": "Ola Nordmann",
    "player": { "team": "hvit", "short": "Ola", "nr": "17" }
  },
  {
    "full": "Per Olsen Hansen",
    "player": { "team": "rod", "short": "Per OH", "nr": "30", "note": "K 1" }
  },
  {
    "full": "Kari Nordmann",
    "staff": { "role": "Hovedtrener", "team": null }
  },
  {
    "full": "Lise Berg",
    "staff": { "role": "Lagleder", "team": "bla" }
  },
  {
    "full": "Jonas Lie",
    "player": { "team": "gul", "short": "Jonas", "nr": null, "uncertain": true },
    "corrections": [
      { "from": "2026-09-01", "to": "2026-09-30", "status": "nei", "note": "Skadet, avtalt med trener" }
    ]
  },
  {
    "full": "Emil Strand",
    "removed": true
  }
]
```

### Felter

| Felt | Betydning |
| --- | --- |
| `full` | **Fullt navn nøyaktig slik det står i Rubic.** Det er nøkkelen både for krypteringen og for å finne personen i CSV-en. Store og små bokstaver og aksenter spiller ingen rolle, men stavingen må være lik. |
| `player.team` | Laget: `hvit`, `rod`, `bla` eller `gul` (se [Lagene](#3-lagene-srcdatasil15js)) |
| `player.short` | Navnet som vises i lister, for eksempel fornavn eller «Per OH» |
| `player.nr` | Draktnummer som tekst (`"17"`), eller `null` |
| `player.note` | Keeperdrakt, på formen `"K 1"` (vises som «keeperdrakt nr 1») |
| `player.uncertain` | `true` hvis koblingen navn → lag er usikker. Appen viser en advarsel og lar deg bekrefte eller endre laget. |
| `player.inactive` | `true` hvis spilleren trolig har sluttet. Vises fortsatt, men telles ikke i snitt og rangering. |
| `staff.role` | `Hovedtrener`, `Trener`, `Lagleder` eller `Materialforvalter` |
| `staff.team` | Laget treneren eller lederen hører til, eller `null` for hele årgangen |
| `corrections` | Manuelle rettelser. Gjelder bare **treninger** som står som «ikke svart» i perioden `from`–`to` (åååå-mm-dd, begge valgfrie). `status` er `"ja"`, `"nei"` eller `null`, og `note` vises som forklaring (✎) i appen. |
| `removed` | `true` = har sluttet og skal ikke vises noe sted |

En person har enten `player` eller `staff`, ikke begge. Felter som ikke trengs, kan utelates.

## 2. Kryptere: `npm run encrypt-roster`

```sh
npm run encrypt-roster
```

1. Skriptet spør etter et **salt** to ganger. Det må være minst 8 tegn, vises ikke på skjermen og lagres ingen steder.
2. Det leser `private/roster.json` og skriver `src/data/roster.enc.json`.
3. Commit og push `src/data/roster.enc.json`. Fila inneholder ingen lesbare navn.
4. Gi saltet til dem som skal bruke appen (trenere og ledere), utenfor git, for eksempel muntlig eller i en privat melding.

Skriptet må kjøres i en vanlig terminal, fordi saltet skrives inn med tastaturet.

### Slik fungerer krypteringen

- Hver person krypteres for seg (AES-GCM), med en nøkkel avledet fra **fullt navn + saltet** (PBKDF2, 100 000 runder).
- Rekkefølgen i fila stokkes, så posisjonen ikke røper noe.
- Appen låser bare opp personer som står i CSV-en som lastes opp, og bare med riktig salt. Uten både navnet og saltet kan ingen lese en oppføring.
- Feil salt gir ingen treff, og appen sier «Saltet passer ikke med fila».

### Endringer senere

- **Ny spiller, lagbytte, nytt draktnummer:** rediger `private/roster.json`, kjør `npm run encrypt-roster` med **samme salt**, og commit `roster.enc.json`.
- **Nytt salt** (for eksempel når noen ikke lenger skal ha tilgang): kjør skriptet med et nytt salt og gi det nye saltet til dem som skal ha det. Det gamle slutter å virke.
- **Navnet er endret i Rubic:** oppdater `full`. Ellers finner ikke appen personen.

Når CSV-en også har lag og rolle fra Rubic (`npm run export_all`), vinner Rubic for lag og rolle. Draktnummer, kallenavn og rettelser hentes fortsatt fra det krypterte lagoppsettet, men draktnummeret bare så lenge laget er det samme.

## 3. Lagene: `src/data/sil15.js`

Lagene er definert i `teams`:

```js
export const teams = [
  { id: 'hvit', name: 'Storhamar Hvit', short: 'Hvit' },
  { id: 'rod',  name: 'Storhamar Rød',  short: 'Rød' },
  { id: 'bla',  name: 'Storhamar Blå',  short: 'Blå' },
  { id: 'gul',  name: 'Storhamar Gul',  short: 'Gul' },
]
```

| Felt | Brukes til |
| --- | --- |
| `id` | Intern nøkkel: `player.team` og `staff.team` i lagoppsettet, og fargene |
| `name` | Må være skrevet likt som i serieoppsettet (`tournaments`), så kampene kobles til riktig lag |
| `short` | Vises i appen. **Må være likt kortnavnet på laget i Rubic** («Hvit»), fordi kolonnen «Lag» fra `npm run export_all` matches mot det |

### Serieoppsettet

`tournaments` i samme fil inneholder turneringene med kampoppsett, hentet fra serieoppsettet (PDF) for sesongen:

```js
{
  nr: 2, place: 'Skedsmo', date: '2026-11-07', start: '12:30', end: '15:30', iceBreak: '13:50',
  teams: ['Lillehammer Blå', 'Skedsmo Svart', 'Storhamar Hvit', 'Storhamar Rød'],
  games: [
    // [kampstart, bane, hjemmelag, bortelag]
    ['12:50', 1, 'Storhamar Hvit', 'Storhamar Rød'],
  ],
}
```

Typene står i `src/data/sil15.d.ts`.

### Andre lag enn Hvit/Rød/Blå/Gul

Lag-id-ene er låst i koden. For å bytte eller legge til lag må disse endres samtidig:

1. `teams` (og eventuelt `tournaments`) i `src/data/sil15.js`
2. `TeamId` i `src/data/sil15.d.ts` **og** i `src/lib/rosterCrypto.ts`
3. Fargene i `THEME` i `src/lib/ui.ts` (én oppføring per lag-id)
4. `player.team` / `staff.team` i `private/roster.json`, og kjør `npm run encrypt-roster` på nytt

`npx tsc -b` sier fra hvis noe av dette ikke henger sammen.
