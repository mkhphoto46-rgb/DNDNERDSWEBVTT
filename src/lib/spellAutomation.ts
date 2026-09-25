import { DAMAGE_TYPES, type ActorAbility, type DamageType } from '../types/actor'
import { SRD_SPELLS, type SrdSpellRecord } from '../data/srdSpells.generated'

export type ActionCost = 'action' | 'bonus-action' | 'reaction' | 'long-cast' | 'none'
export type SpellTargetMode = 'none' | 'self' | 'self-area' | 'creatures' | 'point-area'
export type SpellAreaShape = 'sphere' | 'cube' | 'cone' | 'line' | 'other'

export interface SpellTargetRule {
  mode: SpellTargetMode
  minTargets: number
  maxTargets: number
  rangeFeet: number | null
  relation: 'any' | 'ally' | 'enemy'
  radiusFeet: number | null
  areaShape: SpellAreaShape | null
  label: string
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
}
const ABILITIES = new Set<ActorAbility>(['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'])
const DAMAGE_TYPE_SET = new Set<DamageType>(DAMAGE_TYPES)

function rangeFeetFromText(value: string): number | null {
  const text = value.trim().toLowerCase()
  if (!text || text === 'self') return text === 'self' ? 0 : null
  if (text === 'touch') return 5
  const match = text.match(/(\d+)\s*(?:feet|foot|ft)/)
  return match ? Number(match[1]) : null
}

function countFromDescription(description: string): number | null {
  const match = description.match(/up to\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+creatures?/i)
  if (!match) return null
  const raw = match[1].toLowerCase()
  return /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw] ?? null
}

function areaFromSpell(spell: Pick<SrdSpellRecord, 'area' | 'description'>): { size: number; shape: SpellAreaShape } | null {
  const text = `${spell.area} ${spell.description}`.replace(/\s+/g, ' ').trim()
  const match = text.match(/(\d+)[-\s]foot(?:-radius)?\s+(radius\s+)?(Sphere|Cube|Cone|Line)/i)
    ?? text.match(/(\d+)[-\s]foot[-\s](radius|cone|cube|line)/i)
  if (!match) return null
  const shapeText = `${match[3] ?? ''} ${match[2] ?? ''}`.toLowerCase()
  const shape: SpellAreaShape = shapeText.includes('sphere') || shapeText.includes('radius')
    ? 'sphere'
    : shapeText.includes('cube') ? 'cube'
      : shapeText.includes('cone') ? 'cone'
        : shapeText.includes('line') ? 'line' : 'other'
  return { size: Number(match[1]), shape }
}

export function spellSaveAbility(spell: Pick<SrdSpellRecord, 'saveAbility' | 'description'>): ActorAbility | null {
  const direct = spell.saveAbility.trim().toLowerCase() as ActorAbility
  if (ABILITIES.has(direct)) return direct
  const match = spell.description.match(/(?:succeed on a|make a)\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving throw/i)
  if (!match) return null
  const ability = match[1].toLowerCase() as ActorAbility
  return ABILITIES.has(ability) ? ability : null
}

export function spellDamageType(
  spell: Pick<SrdSpellRecord, 'damageType' | 'description'>,
): DamageType | null {
  const direct = spell.damageType.trim().toLowerCase()
  if (DAMAGE_TYPE_SET.has(direct as DamageType)) {
    return direct as DamageType
  }

  const match =
    spell.description.match(/\b(?:\d+d\d+|damage)\s+(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)\s+damage\b/i)
    ?? spell.description.match(/\b(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder) damage\b/i)

  const matchedType = match?.[1]?.toLowerCase()

  return matchedType && DAMAGE_TYPE_SET.has(matchedType as DamageType)
    ? matchedType as DamageType
    : null
}

export function spellDamageFormula(
  spell: Pick<SrdSpellRecord, 'level' | 'damageAtSlotLevel' | 'damageAtCharacterLevel' | 'higherLevel' | 'description'>,
  castLevel: number,
  characterLevel: number,
): string | null {
  const level = Math.max(0, Math.round(castLevel))
  const character = Math.max(1, Math.round(characterLevel))
  let formula: string | undefined
  if (spell.level === 0) {
    const breakpoints = Object.keys(spell.damageAtCharacterLevel)
      .map(Number).filter((threshold) => Number.isFinite(threshold) && threshold <= character).sort((a, b) => b - a)
    formula = breakpoints.length ? spell.damageAtCharacterLevel[String(breakpoints[0])] : spell.damageAtCharacterLevel['1']
    if (!formula) {
      const upgradeText = spell.description.split(/Cantrip Upgrade\./i)[1] ?? ''
      const upgrades = [...upgradeText.matchAll(/(?:levels?\s*)?(5|11|17)\s*\((\d+d\d+)\)/gi)]
      const selected = upgrades
        .map((entry) => ({ level: Number(entry[1]), formula: entry[2].toLowerCase() }))
        .filter((entry) => entry.level <= character)
        .sort((a, b) => b.level - a.level)[0]
      formula = selected?.formula ?? spell.damageAtSlotLevel['0']
    }
  } else {
    formula = spell.damageAtSlotLevel[String(level)]
      ?? spell.damageAtSlotLevel[String(spell.level)]
    if (formula && level > spell.level) {
      const scalingText = `${spell.higherLevel} ${spell.description}`
      const perLevel = scalingText.match(/(?:an additional|one additional|increases? by|\+)\s*(\d+d\d+)(?:\s+damage)?\s+for each slot level above/i)
        ?? scalingText.match(/\+\s*(\d+d\d+)\s+for each slot level above/i)
      if (perLevel) formula = `${formula}+${Array.from({ length: level - spell.level }, () => perLevel[1].toLowerCase()).join('+')}`
    }
  }
  if (!formula) {
    const match = spell.description.match(/(?:takes|deals|take)\s+(\d+d\d+(?:\s*[+-]\s*\d+)?)\s+(?:\w+\s+)?damage/i)
    formula = match?.[1]
  }
  if (!formula) return null
  const normalized = formula.replace(/\s+/g, '').toLowerCase()
  const multiplied = normalized.match(/^(\d+d\d+)\*(\d+)$/)
  if (multiplied) {
    const dice = multiplied[1].match(/^(\d+)d(\d+)$/)
    if (dice) return `${Number(dice[1]) * Number(multiplied[2])}d${dice[2]}`
  }
  return /^[+\-]?\d+(?:d(?:4|6|8|10|12|20|100))?(?:[+\-]\d+(?:d(?:4|6|8|10|12|20|100))?)*$/.test(normalized)
    ? normalized.replace(/^\+/, '')
    : null
}

export function spellHealingFormula(
  spell: Pick<SrdSpellRecord, 'level' | 'healAtSlotLevel' | 'higherLevel' | 'description'>,
  castLevel: number,
  spellcastingModifier: number,
): string | null {
  const level = Math.max(0, Math.round(castLevel))
  let formula: string | undefined = spell.healAtSlotLevel[String(level)]
    ?? spell.healAtSlotLevel[String(spell.level)]
  const descriptionFormula = spell.description.match(/(?:regains?|restore)\s+(?:a number of )?(?:Hit Points|hit points)\s+equal to\s+(\d+d\d+)/i)
    ?? spell.description.match(/(?:equal to|regain)\s+(\d+d\d+)\s+plus\s+your spellcasting ability modifier/i)
  formula ??= descriptionFormula?.[1]
  if (!formula) return null
  if (level > spell.level) {
    const higher = spell.higherLevel.match(/(?:healing increases by|increases by)\s+(\d+d\d+)\s+for each spell slot level above/i)
    if (higher) formula = `${formula}+${Array.from({ length: level - spell.level }, () => higher[1].toLowerCase()).join('+')}`
  }
  if (/spellcasting ability modifier/i.test(spell.description)) formula = `${formula}+${Math.max(-5, Math.min(10, Math.round(spellcastingModifier)))}`
  return /^[+\-]?\d+(?:d(?:4|6|8|10|12|20|100))?(?:[+\-]\d+(?:d(?:4|6|8|10|12|20|100))?)*$/i.test(formula.replace(/\s+/g, ''))
    ? formula.replace(/\s+/g, '').toLowerCase().replace(/^\+/, '')
    : null
}

export function castingTimeActionCost(castingTime: string): ActionCost {
  const text = castingTime.trim().toLowerCase()
  if (text === 'action' || text.startsWith('1 action')) return 'action'
  if (text === 'bonus action' || text.startsWith('1 bonus action')) return 'bonus-action'
  if (text === 'reaction' || text.startsWith('reaction')) return 'reaction'
  if (/minute|hour/.test(text)) return 'long-cast'
  return 'none'
}

export function spellTargetRule(
  spell: Pick<SrdSpellRecord, 'id' | 'name' | 'range' | 'area' | 'description'>,
  castLevel = 0,
): SpellTargetRule {
  const rangeFeet = rangeFeetFromText(spell.range)
  const description = spell.description.replace(/\s+/g, ' ').trim()
  const area = areaFromSpell(spell)
  const explicitCount = countFromDescription(description)

  if (spell.id === 'bless') {
    const maxTargets = 3 + Math.max(0, Math.round(castLevel) - 1)
    return { mode: 'creatures', minTargets: 1, maxTargets, rangeFeet: 30, relation: 'any', radiusFeet: null, areaShape: null, label: `Choose up to ${maxTargets} creatures within 30 ft` }
  }

  if (/^self$/i.test(spell.range.trim()) && area) {
    return {
      mode: 'self-area', minTargets: 0, maxTargets: 999, rangeFeet: area.size,
      relation: 'any', radiusFeet: area.size, areaShape: area.shape,
      label: `Self · ${area.size}-ft ${area.shape}`,
    }
  }

  if (/^self$/i.test(spell.range.trim())) {
    return { mode: 'self', minTargets: 1, maxTargets: 1, rangeFeet: 0, relation: 'any', radiusFeet: null, areaShape: null, label: 'Self' }
  }

  const pointAreaText = /point you can see within range|point within range/i.test(description)
  if (area && pointAreaText) {
    return {
      mode: 'point-area', minTargets: 0, maxTargets: explicitCount ?? 999, rangeFeet,
      relation: 'any', radiusFeet: area.size, areaShape: area.shape,
      label: `${area.size}-ft ${area.shape} area${explicitCount ? ` · up to ${explicitCount} chosen creatures` : ''}`,
    }
  }

  if (explicitCount !== null) {
    return { mode: 'creatures', minTargets: 1, maxTargets: explicitCount, rangeFeet, relation: 'any', radiusFeet: null, areaShape: null, label: `Choose up to ${explicitCount} creatures${rangeFeet !== null ? ` within ${rangeFeet} ft` : ''}` }
  }

  const appearsTargeted = /\btarget\b|\ba creature\b|\bone creature\b|\bcreature you can see\b/i.test(description)
  if (appearsTargeted && rangeFeet !== null) {
    return { mode: 'creatures', minTargets: 1, maxTargets: 1, rangeFeet, relation: 'any', radiusFeet: null, areaShape: null, label: `Choose 1 creature within ${rangeFeet} ft` }
  }

  if (area) {
    return { mode: 'point-area', minTargets: 0, maxTargets: explicitCount ?? 999, rangeFeet, relation: 'any', radiusFeet: area.size, areaShape: area.shape, label: `${area.size}-ft ${area.shape} area` }
  }

  return { mode: 'none', minTargets: 0, maxTargets: 0, rangeFeet, relation: 'any', radiusFeet: null, areaShape: null, label: 'No map target required' }
}

const AUTOMATED_SPELL_RULE_IDS = new Set([
  'bless',
])

export function spellHasAutomatedRule(spellId: string): boolean {
  return AUTOMATED_SPELL_RULE_IDS.has(spellId)
}

export function spellRuleLabel(spellId: string): string {
  const spell = SRD_SPELLS.find((entry) => entry.id === spellId)
  if (!spell) return 'Spell rules unavailable'
  if (spell.id === 'bless') return 'Bless · automatic +1d4 to attacks and saving throws'
  const damage = spellDamageFormula(spell, Math.max(1, spell.level), 1)
  if (damage && spellDamageType(spell)) return `${spell.attackType ? 'Spell attack' : spellSaveAbility(spell) ? 'Saving throw' : 'Damage'} · ${damage} ${spellDamageType(spell)}`
  return `${spell.range} range · ${spell.castingTime} · effect recorded for the table`
}
