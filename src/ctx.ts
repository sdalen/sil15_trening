import type { TeamId } from './data/sil15.js'
import type { Activity, Model, Person, Stats } from './lib/model'

export type Group = 'spillere' | 'stab'
export type TeamFilter = 'alle' | TeamId | 'uten'

export interface Ctx {
  model: Model
  now: Date
  /** Aktiviteter med data i valgt periode/type (inkl. kommende) */
  periodActs: Activity[]
  /** Passerte aktiviteter i valgt periode/type – grunnlag for statistikk */
  pastActs: Activity[]
  group: Group
  /** Alle personer i valgt gruppe (spillere eller stab), uavhengig av lag */
  groupPeople: Person[]
  /** Personer i valgt gruppe og lag (uten søk) */
  population: Person[]
  /** Personer i valgt gruppe og lag som matcher søket */
  visible: Person[]
  stats: Map<string, Stats>
  /** Frivillige ekstratreninger (Early Bird) i valgt periode – telles for seg, ikke i oppmøte */
  extraStats: Map<string, Stats>
  /** Ekstratreninger med data i valgt periode (inkl. kommende) – for historikk */
  periodExtra: Activity[]
  /** Navn på ekstratreningene, f.eks. «Early Bird» */
  extraLabel: string
  team: TeamFilter
  query: string
  noAnswerIsAbsent: boolean
  /** order = rekkefølgen det ble åpnet fra (f.eks. sortert spillerliste) – brukes til forrige/neste */
  openPerson: (id: string, order?: string[]) => void
  /** Bytt til Aktiviteter-fanen med denne aktiviteten åpen */
  openActivity: (idx: number) => void
  /** Aktivitet som skal åpnes/scrolles til i Aktiviteter-fanen */
  focusAct: number | null
  clearFocus: () => void
}
