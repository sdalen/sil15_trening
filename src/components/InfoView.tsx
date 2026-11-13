import type { ReactNode } from 'react'
import { HOCKEY_SEASON_START } from '../lib/model'
import { Card } from './common'

const dato = (iso: string) => new Date(`${iso}T12:00`).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' })
// Dagen før hockeysesongen – siste dag fotball er godkjent grunn
const lastFootballDay = new Date(new Date(`${HOCKEY_SEASON_START}T12:00`).getTime() - 86400000).toISOString().slice(0, 10)

/** Forklaring av hvordan appen er bygd opp og hvordan tallene regnes ut */
export default function InfoView() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Hvor kommer dataene fra?">
        <p>
          Alt bygger på <b>påmeldingene i Rubic</b> – det foreldre/spillere svarer på hver aktivitet. Det er altså
          påmeldingsstatus, ikke faktisk oppmøte (innsjekking brukes ikke).
        </p>
        <p>
          Dataene lastes inn som en <b>CSV-fil</b> med én kolonne per aktivitet og én rad per person. Det kan være
          oppmøteeksporten fra Rubic, eller et uttrekk i samme format som i tillegg har kategori, tittel og grunn til
          avslag. <b>«Legg til CSV»</b> fyller på: nye aktiviteter legges til, og eksisterende oppdateres fra den nyeste fila.
        </p>
        <p>Kamper kan i tillegg lastes inn som egne kampeksporter under fanen <b>Kamper</b>.</p>
      </Section>

      <Section title="Personvern">
        <p>
          Appen er en ren nettside uten server. <b>Filene og saltet lagres bare i nettleseren din</b> og sendes ikke noe sted.
          «Fjern data» sletter dem.
        </p>
        <p>
          Lagoppsettet (lag, draktnummer, roller) ligger <b>kryptert per person</b> i appen. Det låses opp med saltet
          sammen med navnene i fila du laster inn – uten begge deler kan ingen lese det.
        </p>
      </Section>

      <Section title="Statuser">
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Ja</b> – påmeldt.</li>
          <li><b>Avslått</b> – meldt av.</li>
          <li><b>Ikke svart</b> – invitert, men ikke svart. Teller som fravær så lenge «Ikke svart teller som fravær» er på.</li>
          <li><b>Godkjent</b> – avslått med godkjent grunn (se under).</li>
          <li>Tom – ikke invitert, teller ikke.</li>
        </ul>
      </Section>

      <Section title="Godkjent fravær">
        <p>Et avslag er godkjent når grunnen i Rubic er:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Syk</b> og <b>begravelse</b> – alltid, for alle.</li>
          <li><b>Jobb</b> – bare for støtteapparatet (trenere, lagledere osv.), ikke for spillere.</li>
          <li>
            <b>Fotball / futsal</b> – bare så lenge fotballen er i sesong (siste seriekamp var 29. september, så det
            gjelder til og med {dato(lastFootballDay)}).
          </li>
        </ul>
        <p>Godkjent fravær vises med blått merke og egen kolonne. Andre grunner (bortreist, ferie …) er vanlig avslag.</p>
      </Section>

      <Section title="Slik regnes oppmøte">
        <p>
          <b>Oppmøte % = ja ÷ alle invitasjoner</b> – det «riktige» tallet, der også godkjent fravær er fravær. Dette
          brukes til rangering, snitt og grensene for lavt/høyt oppmøte.
        </p>
        <p>
          Har spilleren godkjent fravær, står prosenten <b>uten godkjent fravær i parentes</b>, f.eks.{' '}
          <span className="font-bold text-emerald-700">89 %</span> <span className="font-semibold text-sky-700">(100 %)</span>.
        </p>
        <p>
          Bare <b>passerte</b> aktiviteter teller. Snitt og rangering holder ute spillere som trolig har sluttet og
          lagledere. «På rad» er antall ja bakover fra siste aktivitet (godkjent fravær bryter ikke rekka).
        </p>
      </Section>

      <Section title="Avlyste aktiviteter">
        <p>
          Avlyste aktiviteter ligger fortsatt i Rubic-eksporten med svarene folk ga før avlysningen. De holdes utenfor
          all statistikk: uttrekk med kategori hopper over dem automatisk, og for vanlig Rubic-eksport finnes en fast
          liste i appen.
        </p>
      </Section>

      <Section title="Filtre">
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Spillere / Stab</b> og <b>lag</b> øverst velger hvem som vises.</li>
          <li><b>Periode</b>: høst/vår-sesong, siste 30/60 dager, hele perioden eller én måned.</li>
          <li><b>Kamper og treninger</b>, kun treninger eller kun kamper.</li>
        </ul>
      </Section>

      <Section title="Fanene">
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Oversikt</b> – snitt, siste/beste/dårligste trening, rangering og lavt/høyt oppmøte.</li>
          <li><b>Spillere</b> – tabell med alle tall, sorterbar. Trykk på en spiller for historikk og grunner.</li>
          <li><b>Kamper</b> – kampoppmøte fra kampeksportene.</li>
          <li><b>Aktiviteter</b> og <b>Matrise</b> – hver aktivitet og hvem som svarte hva.</li>
          <li><b>Statistikk</b> – når vi er flest og færrest: ukedag, klokkeslett, hverdag mot helg (bare treninger).</li>
          <li><b>Furnes</b> (grønn knapp) – egen, enkel side for fotballen med egen CSV.</li>
        </ul>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card title={title}>
      <div className="space-y-2 px-4 py-3 text-sm leading-relaxed text-slate-700">{children}</div>
    </Card>
  )
}
