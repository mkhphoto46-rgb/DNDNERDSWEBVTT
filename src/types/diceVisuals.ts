export type DiceSides = 4 | 6 | 8 | 10 | 12 | 20 | 100

export interface DiceVisualResult {
  sides: DiceSides
  value: number
  discarded?: boolean
}

export interface DiceRollPresentation {
  id: string
  rollerName: string
  title: string
  total: number
  dice: DiceVisualResult[]
  detail?: string
}

export interface DiceThemeDefinition {
  id: string
  name: string
  models: Partial<Record<DiceSides, string>>
  material: {
    color: string
    emissive: string
    emissiveIntensity: number
    roughness: number
    metalness: number
  }
  lighting: {
    ambient: number
    key: number
    fill: number
    rim: number
  }
  stage: {
    color: string
    glow: string
    fallHeight: number
    gravity: number
    bounce: number
    spin: number
    durationMs: number
    revealDelayMs: number
    holdMs: number
  }
}

export interface DiceThemeCatalog {
  defaultThemeId: string
  themes: DiceThemeDefinition[]
}
