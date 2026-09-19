export type Ability =
  | 'strength'
  | 'dexterity'
  | 'constitution'
  | 'intelligence'
  | 'wisdom'
  | 'charisma'

export type RollMode =
  | 'normal'
  | 'advantage'
  | 'disadvantage'

export type Cover =
  | 'none'
  | 'half'
  | 'three-quarters'
  | 'total'

export type CreatureSize =
  | 'tiny'
  | 'small'
  | 'medium'
  | 'large'
  | 'huge'
  | 'gargantuan'

export type Condition =
  | 'blinded'
  | 'charmed'
  | 'deafened'
  | 'exhaustion'
  | 'frightened'
  | 'grappled'
  | 'incapacitated'
  | 'invisible'
  | 'paralyzed'
  | 'petrified'
  | 'poisoned'
  | 'prone'
  | 'restrained'
  | 'stunned'
  | 'unconscious'

export type DamageType =
  | 'acid'
  | 'bludgeoning'
  | 'cold'
  | 'fire'
  | 'force'
  | 'lightning'
  | 'necrotic'
  | 'piercing'
  | 'poison'
  | 'psychic'
  | 'radiant'
  | 'slashing'
  | 'thunder'

export type AreaShape =
  | 'cone'
  | 'cube'
  | 'cylinder'
  | 'emanation'
  | 'line'
  | 'sphere'

export const CONDITIONS: Condition[] = [
  'blinded',
  'charmed',
  'deafened',
  'exhaustion',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
]

export const DAMAGE_TYPES: DamageType[] = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
]

export const TOKEN_SIZE_CELLS: Record<CreatureSize, number> = {
  tiny: 0.5,
  small: 1,
  medium: 1,
  large: 2,
  huge: 3,
  gargantuan: 4,
}

export function abilityModifier(score: number): number {
  return Math.floor((Math.max(1, Math.min(30, Math.trunc(score))) - 10) / 2)
}

export function proficiencyBonus(level: number): number {
  const normalized = Math.max(1, Math.min(20, Math.trunc(level)))
  return 2 + Math.floor((normalized - 1) / 4)
}

export function spellSaveDc(
  level: number,
  spellcastingScore: number,
  bonus = 0,
): number {
  return 8 + proficiencyBonus(level) + abilityModifier(spellcastingScore) + bonus
}

export function spellAttackBonus(
  level: number,
  spellcastingScore: number,
  bonus = 0,
): number {
  return proficiencyBonus(level) + abilityModifier(spellcastingScore) + bonus
}

export function resolveRollMode(
  hasAdvantage: boolean,
  hasDisadvantage: boolean,
): RollMode {
  if (hasAdvantage === hasDisadvantage) return 'normal'
  return hasAdvantage ? 'advantage' : 'disadvantage'
}

export function chooseD20(
  first: number,
  second: number,
  mode: RollMode,
): number {
  if (mode === 'advantage') return Math.max(first, second)
  if (mode === 'disadvantage') return Math.min(first, second)
  return first
}

export function coverBonus(cover: Cover): number | null {
  if (cover === 'half') return 2
  if (cover === 'three-quarters') return 5
  if (cover === 'total') return null
  return 0
}

export function exhaustionD20Penalty(level: number): number {
  return -2 * Math.max(0, Math.min(5, Math.trunc(level)))
}

export function exhaustionSpeedPenalty(level: number): number {
  return -5 * Math.max(0, Math.min(5, Math.trunc(level)))
}

export function concentrationDc(damageTaken: number): number {
  return Math.min(30, Math.max(10, Math.floor(Math.max(0, damageTaken) / 2)))
}

export function gridDistanceFeet(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  feetPerCell = 5,
): number {
  return Math.max(Math.abs(toX - fromX), Math.abs(toY - fromY)) * feetPerCell
}

export function isCriticalHit(naturalRoll: number): boolean {
  return naturalRoll === 20
}

export function isAutomaticAttackMiss(naturalRoll: number): boolean {
  return naturalRoll === 1
}

export function doubledCriticalDice(diceCount: number): number {
  return Math.max(0, Math.trunc(diceCount)) * 2
}
