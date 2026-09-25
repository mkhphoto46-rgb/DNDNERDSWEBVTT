import { abilityModifier } from '../rules/dnd2024'
import {
  DAMAGE_TYPES,
  type Actor,
  type ActorAbility,
  type DamageType,
} from '../types/actor'
import type {
  ActorAttackProfile,
  DiceFormulaRoll,
} from '../types/combatActions'

const DAMAGE_TYPE_SET = new Set<string>(DAMAGE_TYPES)
const ABILITIES = new Set<ActorAbility>([
  'strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma',
])

function integer(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback
}

function text(value: unknown, fallback = ''): string {
  const result = String(value ?? '').trim().replace(/\s+/g, ' ')
  return (result || fallback).slice(0, 120)
}

export function normalizeDiceFormula(value: unknown, fallback = '1'): string {
  const raw = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '')
  if (!raw || raw.length > 80 || !/^[+\-]?\d+(?:d(?:4|6|8|10|12|20|100))?(?:[+\-]\d+(?:d(?:4|6|8|10|12|20|100))?)*$/.test(raw)) {
    return fallback
  }
  return raw.replace(/^\+/, '')
}

export function rollDiceFormula(
  formulaInput: unknown,
  critical = false,
  randomDie: (sides: number) => number = (sides) => Math.floor(Math.random() * sides) + 1,
): DiceFormulaRoll {
  const formula = normalizeDiceFormula(formulaInput)
  const terms = formula.match(/[+\-]?[^+\-]+/g) ?? ['1']
  const dice: DiceFormulaRoll['dice'] = []
  let modifier = 0
  let total = 0

  for (const term of terms) {
    const sign = term.startsWith('-') ? -1 : 1
    const unsigned = term.replace(/^[+\-]/, '')
    const match = /^(\d+)d(4|6|8|10|12|20|100)$/.exec(unsigned)
    if (!match) {
      const amount = sign * integer(unsigned, 0, 0, 9999)
      modifier += amount
      total += amount
      continue
    }

    const baseCount = integer(match[1], 1, 1, 40)
    const count = baseCount * (critical ? 2 : 1)
    const sides = integer(match[2], 6, 4, 100)
    const rolls = Array.from({ length: count }, () => sign * Math.max(1, Math.min(sides, Math.round(randomDie(sides)))))
    dice.push({ sides, rolls })
    total += rolls.reduce((sum, roll) => sum + roll, 0)
  }

  return { formula, dice, modifier, total: Math.max(0, total), critical }
}

export function normalizeAttackProfile(value: unknown, fallbackId = 'attack'): ActorAttackProfile | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const id = text(raw.id, fallbackId)
  const name = text(raw.name, 'Attack')
  const attackType = raw.attackType === 'ranged' || raw.attackType === 'spell' ? raw.attackType : 'melee'
  const ability = ABILITIES.has(raw.ability as ActorAbility) ? raw.ability as ActorAbility : null
  const rawAttackBonus = raw.attackBonus
  const attackBonus = rawAttackBonus === null || rawAttackBonus === undefined || rawAttackBonus === ''
    ? null
    : integer(rawAttackBonus, 0, -30, 50)
  const damageType = DAMAGE_TYPE_SET.has(String(raw.damageType ?? '').toLowerCase())
    ? String(raw.damageType).toLowerCase() as DamageType
    : 'untyped'

  return {
    id,
    name,
    attackType,
    ability,
    proficient: raw.proficient !== false,
    attackBonus,
    damageFormula: normalizeDiceFormula(raw.damageFormula),
    damageType,
    rangeFeet: integer(raw.rangeFeet, attackType === 'melee' ? 5 : 60, 0, 5000),
    longRangeFeet: raw.longRangeFeet === null || raw.longRangeFeet === undefined
      ? null
      : integer(raw.longRangeFeet, 0, 0, 10000),
    resource: 'action',
  }
}

export function normalizeAttackProfiles(value: unknown): ActorAttackProfile[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((entry, index) => {
    const profile = normalizeAttackProfile(entry, `attack-${index + 1}`)
    if (!profile || seen.has(profile.id)) return []
    seen.add(profile.id)
    return [profile]
  }).slice(0, 50)
}

function monsterAttackProfiles(actor: Actor): ActorAttackProfile[] {
  const block = actor.monsterStatBlock
  if (!block || !Array.isArray(block.actions)) return []

  return block.actions.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return []
    const raw = entry as Record<string, unknown>
    const bonus = Number(raw.attack_bonus)
    const damageEntries = Array.isArray(raw.damage) ? raw.damage : []
    const firstDamage = damageEntries.find((candidate) => candidate && typeof candidate === 'object') as Record<string, unknown> | undefined
    if (!Number.isFinite(bonus) || !firstDamage) return []
    const damageTypeValue = firstDamage.type && typeof firstDamage.type === 'object'
      ? (firstDamage.type as Record<string, unknown>).name
      : firstDamage.type
    const description = String(raw.desc ?? raw.description ?? '').toLowerCase()
    const rangeMatch = /range\s+(\d+)\/(\d+)\s*ft/.exec(description)
    const reachMatch = /reach\s+(\d+)\s*ft/.exec(description)

    const profile = normalizeAttackProfile({
      id: `monster-action-${index}`,
      name: raw.name,
      attackType: rangeMatch ? 'ranged' : 'melee',
      ability: null,
      proficient: true,
      attackBonus: bonus,
      damageFormula: firstDamage.dice,
      damageType: damageTypeValue,
      rangeFeet: rangeMatch ? Number(rangeMatch[1]) : reachMatch ? Number(reachMatch[1]) : 5,
      longRangeFeet: rangeMatch ? Number(rangeMatch[2]) : null,
      resource: 'action',
    }, `monster-action-${index}`)
    return profile ? [profile] : []
  })
}

export function attackBonusForActor(actor: Actor, profile: ActorAttackProfile): number {
  if (profile.attackBonus !== null) return profile.attackBonus
  const ability = profile.ability ?? (profile.attackType === 'ranged' ? 'dexterity' : 'strength')
  return abilityModifier(actor.abilities[ability]) + (profile.proficient ? actor.proficiencyBonus : 0)
}

export function attackProfilesForActor(actor: Actor): ActorAttackProfile[] {
  const stored = normalizeAttackProfiles(actor.combatActions)
  const imported = monsterAttackProfiles(actor)
  const strengthModifier = abilityModifier(actor.abilities.strength)
  const unarmed = normalizeAttackProfile({
    id: 'unarmed-strike',
    name: 'Unarmed Strike',
    attackType: 'melee',
    ability: 'strength',
    proficient: true,
    attackBonus: null,
    damageFormula: String(Math.max(0, 1 + strengthModifier)),
    damageType: 'bludgeoning',
    rangeFeet: 5,
    resource: 'action',
  }, 'unarmed-strike')!

  const result = [...stored, ...imported, unarmed]
  const seen = new Set<string>()
  return result.filter((profile) => !seen.has(profile.id) && seen.add(profile.id))
}
