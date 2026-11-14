# SIL 15 – oppmøte

Nettside som viser oppmøte på treninger, kamper og cuper for Storhamar gutter 2015 (U12), basert på påmeldingene i Rubic.

Appen er en ren nettside uten server (React + Vite), publisert på GitHub Pages. Ingen navn ligger i klartekst i koden: oppmøtet lastes opp som CSV i nettleseren, og lagoppsettet ligger kryptert.

## Slik henger det sammen

```
Rubic ──(npm run export + cookie)──▶ oppmote_….csv ──(last opp i appen)──▶ nettleseren
                                                                            ▲
private/roster.json ──(npm run encrypt-roster + salt)──▶ src/data/roster.enc.json
```

1. **Hent oppmøte fra Rubic** med `npm run export`. Det gir en CSV-fil i `~/Downloads`.
2. **Last opp CSV-en i appen.** «Legg til CSV» fyller på: nye aktiviteter legges til, og eksisterende oppdateres fra den nyeste fila.
3. **Skriv inn saltet** i appen. Da låses lagoppsettet (lag, draktnummer, trenere) opp for personene som står i CSV-en.

Filene og saltet lagres bare i nettleseren (`localStorage`). «Fjern data» i appen sletter dem.

## Kom i gang

```sh
npm install
npm run dev        # lokal utviklingsserver
npm run build      # typesjekk + bygg til dist/
```

## Hente oppmøte fra Rubic (`npm run export`)

Skriptet `scripts/rubic-csv.mjs` logger inn i Rubic med cookien fra nettleseren din, henter aktivitetene og deltakerne, og skriver en CSV i samme format som Rubics egen oppmøteeksport, med litt ekstra informasjon.

### Første gang: legg inn cookien

```sh
cp scripts/.cookie.example scripts/.cookie
```

1. Logg inn på <https://connect.rubic.no> i nettleseren.
2. Åpne utviklerverktøyene (⌥⌘I / F12), gå til **Network** og klikk på et kall til `connect.rubic.no`.
3. Kopier verdien av **Cookie** under *Request Headers*.
4. Lim den inn i `scripts/.cookie` i stedet for `LIM_INN_COOKIE_HER`. Linjer som starter med `#` blir ignorert.

> ⚠️ `scripts/.cookie` står i `.gitignore` og skal **aldri** i git. Cookien gir full tilgang til Rubic-kontoen din.

Cookien slutter å virke når du logger ut av Rubic, eller når økta går ut. Da sier skriptet fra med `✋ Cookien til Rubic er utløpt`, og du gjentar stegene over. Alternativt kan cookien settes i miljøvariabelen `RUBIC_COOKIE`.

### Kjøre eksporten

```sh
npm run export
```

Dette kjører med faste valg fra `package.json`: perioden 01.05.2026–01.04.2027, Early Bird som ekstratrening, og fila lagres i `~/Downloads` som `oppmote_<fra>_<til>_kl<tid>.csv`.

### Velge grupper selv (`npm run export_all`)

`npm run export_all` henter gruppene som står i [`scripts/grupper.csv`](scripts/grupper.csv), ikke de faste fra `package.json`. Fila lagres som `oppmote_alle_<fra>_<til>_kl<tid>.csv` i `~/Downloads`.

```
id,navn,type
7516,Team 2015 (Storhamar U12),oppmøte
66490,Early Bird,ekstra
# 66733,Storhamar U12 - Hvit,oppmøte
```

- `type` er `oppmøte` (teller i oppmøtet) eller `ekstra` (egen kategori «Ekstra», telles ikke, og navnet brukes som tittel).
- Linjer som starter med `#` hoppes over. Fjern `#` for å ta med en gruppe.
- `npm run grupper` lister alle gruppene du har aktiviteter i, med id, navn, undergrupper og antall aktiviteter, klart til å kopiere inn i fila.

### Egne valg

Skriptet kan også kjøres direkte med egne valg:

```sh
node scripts/rubic-csv.mjs --from 2026-08-01 --to 2026-11-12
```

| Valg | Betydning |
| --- | --- |
| `--from åååå-mm-dd` | Startdato (påkrevd) |
| `--to åååå-mm-dd` | Sluttdato. Uten denne brukes i dag + `--frem` dager |
| `--frem 28` | Ta med kommende aktiviteter så mange dager frem |
| `--org 7516` | Rubic-organisasjon(er), kommaseparert (standard `7516`) |
| `--ekstra 66490=Early Bird` | Frivillige ekstratreninger: egen kategori «Ekstra», telles ikke i oppmøtet |
| `--grupper scripts/grupper.csv` | Hent gruppene i fila (erstatter `--org` og `--ekstra`) |
| `--grupper-liste` | List gruppene du har aktiviteter i, og avslutt |
| `--dir ~/Downloads` | Mappe for fila (standard `local/`, som ligger i `.gitignore`) |
| `--out fil.csv` / `--navn oppmote` | Eksakt filnavn / prefiks for filnavnet |
| `--alle` | Ta også med «Annet» (kiosk, dugnad, møter) |
| `--kun-treninger` | Bare treninger |
| `--kun-spillere` | Dropp lagledere og administratorer |
| `--stall 20718` | Bare personer som er invitert til minst halvparten av treningene i den organisasjonen |

Avlyste aktiviteter holdes alltid utenfor. Kategori (Trening, Kamp, Cup, Treningskamp, Sommertrening, Ekstra, Annet) bestemmes ut fra tittelen og legges bak datoen i kolonneoverskriften, sammen med varighet, sted og Rubic-lenke. Appen leser dette tilbake.

## Lagoppsettet (`npm run encrypt-roster`)

Lagoppsettet (hvilket lag hver spiller går på, draktnummer, trenerroller og manuelle rettelser) ligger i klartekst i `private/roster.json`. Den fila ligger i `.gitignore` og finnes bare lokalt.

```sh
npm run encrypt-roster
```

Skriptet spør etter et salt (minst 8 tegn, vises ikke og lagres ingen steder) og skriver `src/data/roster.enc.json`. Hver person krypteres for seg med en nøkkel avledet fra fullt navn, slik det står i Rubic, pluss saltet. Appen kan derfor bare låse opp personer som står i CSV-en som lastes opp, og bare med riktig salt. Commit `roster.enc.json` etterpå, og bruk samme salt i appen.

## Publisering

Push til `main` bygger og publiserer appen på GitHub Pages via `.github/workflows/pages.yml`.

## Filer som aldri skal i git

| Fil/mappe | Innhold |
| --- | --- |
| `scripts/.cookie` | Rubic-innloggingen din |
| `private/` | Lagoppsettet i klartekst (navn) |
| `local/` | Eksporterte oppmøtefiler (navn) |
| `.env`, `.env.*` | Lokale innstillinger |

Siden disse ikke er i git, blir de **ikke med** når repoet klones. På en ny maskin må `private/roster.json` kopieres over manuelt, og cookien legges inn på nytt.

## Kode

- `src/App.tsx`: tilstand, opplasting og opplåsing av lagoppsettet
- `src/lib/model.ts`: tolker CSV-en, slår sammen eksporter og regner ut oppmøte og statistikk
- `src/lib/csv.ts`: CSV-parser (komma eller semikolon)
- `src/lib/rosterCrypto.ts`: kryptering og dekryptering av lagoppsettet (brukes av både app og skript)
- `src/data/sil15.js`: lag og serieoppsett for U12-sesongen 2026–2027
- `src/components/`: visningene (oversikt, spillere, aktiviteter, kamper, statistikk, info)
