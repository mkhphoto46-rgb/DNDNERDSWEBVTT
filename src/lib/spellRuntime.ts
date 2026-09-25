import { normalizedCatalogKey } from './characterCatalog'

export interface SpellSlotPool {
  kind: 'standard' | 'pact'
  slots: number[]
  pactSlotLevel: number | null
}

const FULL_CASTER_SLOTS: number[][] = [
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1],
  [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2], [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
]

const FULL_CASTERS = new Set(['bard', 'cleric', 'druid', 'sorcerer', 'wizard'])
const HALF_CASTERS = new Set(['paladin', 'ranger'])

function levelIndex(level: number): number {
  return Math.max(1, Math.min(20, Math.round(level))) - 1
}

export function spellSlotPool(className: string, characterLevel: number, rulesVersion: string = '2024'): SpellSlotPool {
  const key = normalizedCatalogKey(className)
  const level = levelIndex(characterLevel) + 1

  if (FULL_CASTERS.has(key)) {
    return { kind: 'standard', slots: [...FULL_CASTER_SLOTS[level - 1]], pactSlotLevel: null }
  }

  if (HALF_CASTERS.has(key)) {
    if (rulesVersion === '2014') {
      if (level < 2) return { kind: 'standard', slots: [], pactSlotLevel: null }
      const effectiveCasterLevel = Math.max(1, Math.floor(level / 2))
      return { kind: 'standard', slots: [...FULL_CASTER_SLOTS[effectiveCasterLevel - 1]], pactSlotLevel: null }
    }

    const effectiveCasterLevel = Math.max(1, Math.ceil(level / 2))
    return { kind: 'standard', slots: [...FULL_CASTER_SLOTS[effectiveCasterLevel - 1]], pactSlotLevel: null }
  }

  if (key === 'artificer') {
    const effectiveCasterLevel = Math.max(1, Math.ceil(level / 2))
    return { kind: 'standard', slots: [...FULL_CASTER_SLOTS[effectiveCasterLevel - 1]], pactSlotLevel: null }
  }

  if (key === 'warlock') {
    const pactSlotLevel = level >= 9 ? 5 : level >= 7 ? 4 : level >= 5 ? 3 : level >= 3 ? 2 : 1
    const count = level >= 17 ? 4 : level >= 11 ? 3 : level >= 2 ? 2 : 1
    const slots = Array.from({ length: pactSlotLevel }, () => 0)
    slots[pactSlotLevel - 1] = count
    return { kind: 'pact', slots, pactSlotLevel }
  }

  return { kind: 'standard', slots: [], pactSlotLevel: null }
}


export function normalizeRequestedCastLevel(spellLevel: number, requested: unknown): number {
  const minimum = Math.max(0, Math.min(9, Math.round(Number(spellLevel) || 0)))
  if (minimum === 0) return 0
  if (requested === undefined || requested === null || requested === '') return minimum
  const parsed = Number(requested)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > 9) {
    throw new Error(`Cast level must be an integer from ${minimum} to 9.`)
  }
  return parsed
}

export function normalizeSpentSlots(maximum: number[], spent: unknown): number[] {
  const source = Array.isArray(spent) ? spent : []
  return maximum.map((max, index) => Math.max(0, Math.min(max, Math.round(Number(source[index]) || 0))))
}

export function canSpendSpellSlot(maximum: number[], spent: number[], slotLevel: number): boolean {
  if (slotLevel <= 0) return true
  const index = slotLevel - 1
  return (maximum[index] ?? 0) - (spent[index] ?? 0) > 0
}

export function spendSpellSlot(maximum: number[], spent: number[], slotLevel: number): number[] {
  const normalized = normalizeSpentSlots(maximum, spent)
  if (slotLevel <= 0) return normalized
  if (!canSpendSpellSlot(maximum, normalized, slotLevel)) return normalized
  const next = [...normalized]
  next[slotLevel - 1] += 1
  return next
}
