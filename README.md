# Oppmøte fra Rubic

Nettside som viser oppmøte på treninger, kamper og cuper for et lag eller en årgang, basert på påmeldingene i Rubic. Hvilke grupper som tas med, velger du når du eksporterer, og tittelen i appen hentes fra gruppenavnet i Rubic (for eksempel «Team 2015 Oppmøte»).

Appen er en ren nettside uten server (React + Vite), publisert på GitHub Pages. Ingen navn ligger i klartekst i koden: oppmøtet lastes opp som CSV i nettleseren, og lag og roller kommer fra Rubic eller fra et kryptert lagoppsett.

## Slik henger det sammen

```
Rubic ──(npm run export_all + cookie)──▶ oppmote_alle_….csv ──(last opp i appen)──▶ nettleseren
                                                                                    ▲ (valgfritt salt)
private/roster.json ──(npm run encrypt-roster + salt)──▶ src/data/roster.enc.json ──┘
```

1. **Hent oppmøte fra Rubic** med `npm run export_all`. Velg barn og grupper, så lagres en CSV-fil med navn, lag og rolle i `~/Downloads`.
2. **Last opp CSV-en i appen.** «Legg til CSV» fyller på: nye aktiviteter legges til, og eksisterende oppdateres fra den nyeste fila.
3. **Velg med eller uten salt.** Uten salt brukes lag og roller fra CSV-en. Med salt legges draktnummer, kallenavn og rettelser fra det krypterte lagoppsettet på toppen.

Filene og saltet lagres bare i nettleseren (`localStorage`). «Fjern data» i appen sletter dem.

**Alternativ: oppmøteeksporten fra Rubic.** Du kan også logge inn i Rubic og laste ned oppmøteeksporten derfra. Den har navn og påmeldinger, men ikke lag og rolle. **Uten salt** vises da alle som spillere uten lag (også trenere og ledere som står i eksporten). **Med salt** får de lag og rolle fra det krypterte lagoppsettet. Eksporten mangler også det `export_all` legger til:

| | `npm run export_all` | Eksport fra Rubic |
| --- | --- | --- |
| Navn og påmeldinger | ✓ | ✓ |
| Lag og rolle uten salt | ✓ | – (alle vises uten lag) |
| Kategori og tittel (trening, kamp, cup, ekstra) | ✓ | – |
| Varighet, sted og lenke til aktiviteten | ✓ | – |
| Grunn til avslag | ✓ | – |
| Gruppenavn som tittel i appen | ✓ | – (viser «U12») |
| Avlyste aktiviteter holdes utenfor | ✓ | – |

Begge kan kombineres med «Legg til CSV». Lag, rolle, kategori og grunner fra en `export_all`-fil blir stående om du legger en Rubic-eksport oppå.

> **Lagspesifikt:** lagene og fargene deres (Hvit, Rød, Blå, Gul) og serieoppsettet ligger i `src/data/sil15.js`, og logoen i `public/`. Skal appen brukes for et annet lag, må disse byttes ut. Se [LAGOPPSETT.md](LAGOPPSETT.md#3-lagene-srcdatasil15js).

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

Dette henter Team 2015 med Early Bird som ekstratrening, og fila lagres i `~/Downloads` som `oppmote_<fra>_<til>_kl<tid>.csv`.

**Perioden** står i [`scripts/eksport.json`](scripts/eksport.json) i norsk format, og gjelder både `export` og `export_all`:

```json
{ "fra": "01.05.26", "til": "01.04.27" }
```

`--from`/`--to` på kommandolinja overstyrer fila.

### Komplett oversikt med lag, uten salt (`npm run export_all`)

`npm run export_all` er interaktiv:

1. **Velg barn.** Barna hentes fra Rubic-kontoen din (`/coreapi/me`).
2. **Velg grupper.** Du får barnets grupper og undergruppene deres (for eksempel lagene under Team 2015), med antall aktiviteter i perioden. Skriv et nummer for å slå en gruppe av eller på, eller nummer + type: `3o` = oppmøte, `3e` = ekstra, `3l` = lag. Trykk Enter for å kjøre.
3. **Eksporten kjøres** for de valgte gruppene i perioden fra `scripts/eksport.json` og lagres som `oppmote_alle_<fra>_<til>_kl<tid>.csv` i `~/Downloads`.

Valget lagres i [`scripts/grupper.csv`](scripts/grupper.csv) og brukes som forhåndsvalg neste gang. Fila inneholder bare gruppe-id-er og gruppenavn, ingen personer.

| Type | Betydning |
| --- | --- |
| `oppmøte` | Aktivitetene teller i oppmøtet |
| `ekstra` | Frivillig ekstratrening: egen kategori «Ekstra», telles ikke, og navnet brukes som tittel |
| `lag` | Et lag (for eksempel Storhamar U12 - Hvit). Lagets aktiviteter tas med som kamper, og deltakerne får laget i kolonnen **Lag** |

Med gruppefil får CSV-en to ekstra kolonner:

- **Lag:** kortnavnet på laget i Rubic (Blå, Gul, Hvit, Rød), ut fra hvilke lag personen er invitert til kamper med.
- **Rolle:** rollen i Rubic for trenere og ledere (Hovedtrener, SIL - Trener, Ass. trener, Lagleder, Materialforvalter). Trenere og lagledere står også på kampene til laget sitt, så personer med rolle blir stab for det laget, ikke spillere.

Appen bygger lagoppsettet rett fra disse kolonnene, så **saltet trengs ikke**. Haken «Bruk salt» på startskjermen avgjør hva som brukes:

| | Uten salt | Med salt |
| --- | --- | --- |
| Navn, lag og rolle | ✓ fra Rubic (CSV-en) | ✓ fra Rubic, lagt oppå det krypterte |
| Draktnummer | – | ✓ |
| Kallenavn | – (fornavn, med initialer ved like navn) | ✓ |
| Manuelle rettelser (oppmøte som ikke er registrert) | – | ✓ |
| Spillere som har sluttet, skjules | – | ✓ |

**Draktnummer, kallenavn og rettelser finnes ikke i Rubic.** Deltakerlistene har bare navn, og ingen endepunkter med draktnummer er funnet. De ligger derfor bare i det krypterte lagoppsettet (`src/data/roster.enc.json`) og krever salt. Hvis lag og rolle står i både Rubic og det krypterte lagoppsettet, vinner Rubic.

`npm run grupper` lister alle gruppene du har aktiviteter i, med id, navn, undergrupper og antall aktiviteter. Uten tastatur (for eksempel når input sendes inn via en pipe) bruker `export_all` forhåndsvalgene i gruppefila.

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
| `--velg` | Velg barn og grupper interaktivt (sammen med `--grupper`, som lagrer valget) |
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

**Se [LAGOPPSETT.md](LAGOPPSETT.md)** for formatet på `private/roster.json` (med eksempel), alle feltene, hvordan saltet byttes, og hvordan lagene er definert.

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
