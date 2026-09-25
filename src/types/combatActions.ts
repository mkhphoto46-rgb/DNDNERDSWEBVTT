import type { ActorAbility, DamageType } from './actor'

export type AttackOutcome = 'miss' | 'hit' | 'critical'
export type AttackOutcomeOverride = 'rules' | AttackOutcome

export interface ActorAttackProfile {
  id: string
  name: string
  attackType: 'melee' | 'ranged' | 'spell'
  ability: ActorAbility | null
  proficient: boolean
  attackBonus: number | null
  damageFormula: string
  damageType: DamageType | 'untyped'
  rangeFeet: number
  longRangeFeet: number | null
  resource: 'action'
}

export interface DiceFormulaRoll {
  formula: string
  dice: Array<{ sides: number; rolls: number[] }>
  modifier: number
  total: number
  critical: boolean
}

export interface AttackResolution {
  id: string
  sourceActorId: string
  sourceActorName: string
  targetActorId: string
  targetActorName: string
  attackId: string
  attackName: string
  attackBonus: number
  targetAc: number
  coverBonus: number
  distanceFeet: number | null
  mode: 'normal' | 'advantage' | 'disadvantage'
  d20Rolls: number[]
  natural: number
  bonusDiceResults?: Array<{ sides: number; value: number }>
  attackTotal: number
  outcome: AttackOutcome
  outcomeOverride: AttackOutcomeOverride
  damage: DiceFormulaRoll | null
  damageType: DamageType | 'untyped'
  effectiveDamage: number
  targetHpBefore: number
  targetHpAfter: number
  targetTempHpBefore: number
  targetTempHpAfter: number
  createdAt: string
}
