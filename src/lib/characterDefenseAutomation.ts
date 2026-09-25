import {
  DAMAGE_TYPES,
  type Actor,
  type DamageType,
} from '../types/actor'

export type DefenseMode = 'resistance' | 'immunity' | 'vulnerability'

export interface CharacterDefenseSource {
  id: string
  label: string
  mode: DefenseMode
  damageTypes: DamageType[]
  active: boolean
  automatic: boolean
  note?: string
}

export interface EffectiveDamageDefenses {
  resistances: DamageType[]
  immunities: DamageType[]
  vulnerabilities: DamageType[]
  sources: CharacterDefenseSource[]
}

export const DEFENSE_FEATURE_RAGE = 'barbarian-rage'
export const DEFENSE_FEATURE_MONK_SUPERIOR_DEFENSE = 'monk-superior-defense'

export const DRAGONBORN_ANCESTRIES = [
  'Black',
  'Blue',
  'Brass',
  'Bronze',
  'Copper',
  'Gold',
  'Green',
  'Red',
  'Silver',
  'White',
] as const

export const TIEFLING_LEGACIES = [
  'Abyssal',
  'Chthonic',
  'Infernal',
] as const

export const FIENDISH_RESILIENCE_OPTIONS = DAMAGE_TYPES.filter(
  (type) => type !== 'force',
)

const DRAGONBORN_DAMAGE: Record<string, DamageType> = {
  black: 'acid',
  blue: 'lightning',
  brass: 'fire',
  bronze: 'lightning',
  copper: 'acid',
  gold: 'fire',
  green: 'poison',
  red: 'fire',
  silver: 'cold',
  white: 'cold',
}

const TIEFLING_DAMAGE: Record<string, DamageType> = {
  abyssal: 'poison',
  chthonic: 'necrotic',
  infernal: 'fire',
}

const DAMAGE_TYPE_SET = new Set<string>(DAMAGE_TYPES)

function key(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function cleanDamageTypes(values: unknown): DamageType[] {
  if (!Array.isArray(values)) return []
  return [...new Set(
    values
      .map((entry) => String(entry ?? '').trim().toLowerCase())
      .filter((entry): entry is DamageType => DAMAGE_TYPE_SET.has(entry)),
  )]
}

function selection(actor: Actor, selectionKey: string): string {
  const selections = actor.characterSheet?.defenseSelections
  if (!selections || typeof selections !== 'object') return ''
  return String(selections[selectionKey] ?? '').trim()
}

function featureActive(actor: Actor, featureKey: string): boolean {
  const active = actor.characterSheet?.activeDefenseFeatures
  return Array.isArray(active) && active.includes(featureKey)
}

function addSource(
  list: CharacterDefenseSource[],
  source: CharacterDefenseSource,
): void {
  if (source.damageTypes.length > 0) list.push(source)
}

export function automaticCharacterDefenseSources(actor: Actor): CharacterDefenseSource[] {
  if (actor.kind !== 'player' || !actor.characterSheet) return []

  const sheet = actor.characterSheet
  const speciesKey = key(sheet.species)
  const classKey = key(sheet.className)
  const sources: CharacterDefenseSource[] = []

  if (speciesKey === 'dwarf') {
    addSource(sources, {
      id: 'species-dwarf-resilience',
      label: 'Dwarven Resilience',
      mode: 'resistance',
      damageTypes: ['poison'],
      active: true,
      automatic: true,
      note: 'Species trait',
    })
  }

  if (speciesKey === 'dragonborn') {
    const ancestry = selection(actor, 'dragonborn-ancestry')
    const damageType = DRAGONBORN_DAMAGE[key(ancestry)]
    if (damageType) {
      addSource(sources, {
        id: 'species-dragonborn-resistance',
        label: `Dragonborn — ${ancestry} ancestry`,
        mode: 'resistance',
        damageTypes: [damageType],
        active: true,
        automatic: true,
        note: 'Species trait',
      })
    }
  }

  if (speciesKey === 'tiefling') {
    const legacy = selection(actor, 'tiefling-legacy')
    const damageType = TIEFLING_DAMAGE[key(legacy)]
    if (damageType) {
      addSource(sources, {
        id: 'species-tiefling-legacy',
        label: `Tiefling — ${legacy} legacy`,
        mode: 'resistance',
        damageTypes: [damageType],
        active: true,
        automatic: true,
        note: 'Species trait',
      })
    }
  }

  const subclassKey = key(sheet.subclassName)

  if (classKey === 'warlock' && ['fiend', 'fiendpatron', 'thefiend'].includes(subclassKey) && actor.level >= 10) {
    const chosen = selection(actor, 'fiendish-resilience').toLowerCase()
    const damageType = DAMAGE_TYPE_SET.has(chosen) && chosen !== 'force'
      ? chosen as DamageType
      : null

    if (damageType) {
      addSource(sources, {
        id: 'warlock-fiendish-resilience',
        label: 'Fiendish Resilience',
        mode: 'resistance',
        damageTypes: [damageType],
        active: true,
        automatic: true,
        note: 'Subclass feature',
      })
    }
  }

  if (classKey === 'barbarian' && actor.level >= 1) {
    const active = featureActive(actor, DEFENSE_FEATURE_RAGE) && actor.lifeState === 'conscious'
    addSource(sources, {
      id: DEFENSE_FEATURE_RAGE,
      label: 'Rage',
      mode: 'resistance',
      damageTypes: ['bludgeoning', 'piercing', 'slashing'],
      active,
      automatic: true,
      note: active ? 'Active class feature' : 'Class feature available but inactive',
    })
  }

  if (classKey === 'monk' && actor.level >= 18) {
    const active = featureActive(actor, DEFENSE_FEATURE_MONK_SUPERIOR_DEFENSE) && actor.lifeState === 'conscious'
    addSource(sources, {
      id: DEFENSE_FEATURE_MONK_SUPERIOR_DEFENSE,
      label: 'Superior Defense',
      mode: 'resistance',
      damageTypes: DAMAGE_TYPES.filter((type) => type !== 'force'),
      active,
      automatic: true,
      note: active ? 'Active class feature' : 'Class feature available but inactive',
    })
  }

  return sources
}

export function effectiveDamageDefenses(actor: Actor): EffectiveDamageDefenses {
  const resistances = new Set(cleanDamageTypes(actor.damageResistances))
  const immunities = new Set(cleanDamageTypes(actor.damageImmunities))
  const vulnerabilities = new Set(cleanDamageTypes(actor.damageVulnerabilities))
  const sources = automaticCharacterDefenseSources(actor)

  for (const source of sources) {
    if (!source.active) continue
    const target = source.mode === 'resistance'
      ? resistances
      : source.mode === 'immunity'
        ? immunities
        : vulnerabilities
    for (const damageType of source.damageTypes) target.add(damageType)
  }

  return {
    resistances: [...resistances],
    immunities: [...immunities],
    vulnerabilities: [...vulnerabilities],
    sources,
  }
}
