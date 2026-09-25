export interface MonsterSummary {
  id: string
  name: string
  size: string
  type: string
  cr: string
  crNumeric: number
  armorClass: number
  hitPoints: number
  hitPointFormula: string
  initiativeModifier: number
  source: string
  portraitUrl: string | null
}

export interface MonsterTemplate extends MonsterSummary {
  attribution: string
  statBlock: Record<string, unknown>
}

export interface MonsterCompendiumStatus {
  ready: boolean
  count: number
  source: string
  version: string
  databasePath?: string
  error?: string
}
