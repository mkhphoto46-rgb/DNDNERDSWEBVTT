import {
  DAMAGE_TYPES,
  type Actor,
  type ActorLifeState,
  type DamageType,
} from '../types/actor'

import {
  effectiveDamageDefenses,
} from './characterDefenseAutomation'

export type AppliedDamageType = DamageType | 'untyped'
export type HealthOperation = 'damage' | 'heal' | 'set-temp'

export interface HealthOperationRequest {
  actorId: string
  operation: HealthOperation
  amount: number
  damageType?: AppliedDamageType
  criticalHit?: boolean
}

export interface HealthResolution {
  operation: HealthOperation
  requestedAmount: number
  damageType: AppliedDamageType
  currentHpBefore: number
  currentHpAfter: number
  tempHpBefore: number
  tempHpAfter: number
  effectiveDamage: number
  absorbedByTempHp: number
  hpDamage: number
  healed: number
  immunityApplied: boolean
  resistanceApplied: boolean
  vulnerabilityApplied: boolean
  overflowDamage: number
  criticalHit: boolean
  lifeStateBefore: ActorLifeState
  lifeStateAfter: ActorLifeState
  deathSaveSuccessesBefore: number
  deathSaveSuccessesAfter: number
  deathSaveFailuresBefore: number
  deathSaveFailuresAfter: number
  deathSaveFailuresAdded: number
  instantDeath: boolean
  monsterDeath: boolean
  healingBlockedByDeath: boolean
}

export interface HealthLogEntry {
  id: string
  actorId: string
  actorName: string
  createdAt: string
  resolution: HealthResolution
}

export function normalizeHealthLog(value: unknown): HealthLogEntry[] {
  if (!Array.isArray(value)) return []

  return value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    .map((entry) => {
      const resolution = entry.resolution && typeof entry.resolution === 'object'
        ? entry.resolution as HealthResolution
        : null

      if (!resolution) return null

      return {
        id: String(entry.id ?? ''),
        actorId: String(entry.actorId ?? ''),
        actorName: String(entry.actorName ?? 'Actor'),
        createdAt: String(entry.createdAt ?? ''),
        resolution,
      }
    })
    .filter((entry): entry is HealthLogEntry => Boolean(entry?.id && entry.actorId))
    .slice(-100)
}

const DAMAGE_TYPE_SET = new Set<string>(DAMAGE_TYPES)

function safeAmount(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? Math.max(0, Math.min(9999, Math.round(parsed)))
    : 0
}

export function normalizeAppliedDamageType(value: unknown): AppliedDamageType {
  const candidate = String(value ?? '').trim().toLowerCase()
  return DAMAGE_TYPE_SET.has(candidate)
    ? candidate as DamageType
    : 'untyped'
}

export function normalizeDamageTypeList(value: unknown): DamageType[] {
  if (!Array.isArray(value)) return []

  return [...new Set(
    value
      .map((entry) => String(entry ?? '').trim().toLowerCase())
      .filter((entry): entry is DamageType => DAMAGE_TYPE_SET.has(entry)),
  )]
}

function defenseTextEntries(value: unknown): string[] {
  if (value === null || value === undefined) return []

  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? [trimmed] : []
  }

  if (Array.isArray(value)) {
    return value.flatMap(defenseTextEntries)
  }

  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    const direct = object.type ?? object.name ?? object.damage_type
    return typeof direct === 'string'
      ? defenseTextEntries(direct)
      : []
  }

  return []
}

function clauseHasCondition(clause: string): boolean {
  const normalized = clause.toLowerCase()
  return /\b(from|while|against|except|unless|spell|spells|nonmagical|non magical|silvered|adamantine|magic weapons?|stoneskin|weapon attacks?)\b/.test(normalized)
}

function exactTypesFromClause(clause: string): DamageType[] {
  const cleaned = clause
    .trim()
    .toLowerCase()
    .replace(/\band\b/g, ',')

  if (!cleaned || clauseHasCondition(cleaned)) return []

  const tokens = cleaned
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

  if (tokens.length === 0 || tokens.some((entry) => !DAMAGE_TYPE_SET.has(entry))) {
    return []
  }

  return tokens as DamageType[]
}

/**
 * Extract only unconditional, explicit damage types from imported SRD data.
 * Conditional B/P/S phrases often span multiple array entries in SRD JSON;
 * when a later entry supplies the condition, any physical types collected in
 * that same semicolon-delimited segment are removed again.
 */
export function extractSimpleDamageTypes(value: unknown): DamageType[] {
  const found = new Set<DamageType>()
  let segmentTypes = new Set<DamageType>()

  const removeConditionalPhysicalTypes = () => {
    for (const type of ['bludgeoning', 'piercing', 'slashing'] as DamageType[]) {
      if (segmentTypes.has(type)) found.delete(type)
    }
  }

  for (const entry of defenseTextEntries(value)) {
    const pieces = entry.split(';')

    for (let index = 0; index < pieces.length; index += 1) {
      if (index > 0) segmentTypes = new Set<DamageType>()

      const piece = pieces[index].trim()
      if (!piece) continue

      if (clauseHasCondition(piece)) {
        const lower = piece.toLowerCase()
        if (
          /\b(bludgeoning|piercing|slashing)\b/.test(lower) ||
          /\bnonmagical\b|\bnon magical\b|\bsilvered\b|\badamantine\b/.test(lower)
        ) {
          removeConditionalPhysicalTypes()
        }
        continue
      }

      for (const type of exactTypesFromClause(piece)) {
        found.add(type)
        segmentTypes.add(type)
      }
    }
  }

  return [...found]
}

export function resolveHealthOperation(
  actorInput: Actor,
  request: Omit<HealthOperationRequest, 'actorId'>,
): {
  actor: Actor
  resolution: HealthResolution
} {
  const actor = actorInput
  const amount = safeAmount(request.amount)
  const operation: HealthOperation =
    request.operation === 'heal' || request.operation === 'set-temp'
      ? request.operation
      : 'damage'
  const damageType = normalizeAppliedDamageType(request.damageType)
  const criticalHit = request.criticalHit === true

  const currentHpBefore = Math.max(0, Math.min(actor.maxHp, Math.round(actor.currentHp)))
  const tempHpBefore = Math.max(0, Math.round(actor.tempHp))
  const lifeStateBefore = actor.lifeState
  const deathSaveSuccessesBefore = Math.max(0, Math.min(3, Math.round(actor.deathSaveSuccesses)))
  const deathSaveFailuresBefore = Math.max(0, Math.min(3, Math.round(actor.deathSaveFailures)))

  let currentHpAfter = currentHpBefore
  let tempHpAfter = tempHpBefore
  let effectiveDamage = 0
  let absorbedByTempHp = 0
  let hpDamage = 0
  let healed = 0
  let immunityApplied = false
  let resistanceApplied = false
  let vulnerabilityApplied = false
  let overflowDamage = 0
  let lifeStateAfter = lifeStateBefore
  let deathSaveSuccessesAfter = deathSaveSuccessesBefore
  let deathSaveFailuresAfter = deathSaveFailuresBefore
  let deathSaveFailuresAdded = 0
  let instantDeath = false
  let monsterDeath = false
  let healingBlockedByDeath = false
  let lastDeathSaveRound = actor.lastDeathSaveRound

  if (operation === 'damage') {
    const defenses = effectiveDamageDefenses(actor)
    const resistances = new Set(defenses.resistances)
    const immunities = new Set(defenses.immunities)
    const vulnerabilities = new Set(defenses.vulnerabilities)

    const typed = damageType !== 'untyped'
    immunityApplied = typed && immunities.has(damageType)
    resistanceApplied = typed && !immunityApplied && resistances.has(damageType)
    vulnerabilityApplied = typed && !immunityApplied && vulnerabilities.has(damageType)

    effectiveDamage = immunityApplied ? 0 : amount

    if (resistanceApplied) {
      effectiveDamage = Math.floor(effectiveDamage / 2)
    }

    if (vulnerabilityApplied) {
      effectiveDamage *= 2
    }

    absorbedByTempHp = Math.min(tempHpBefore, effectiveDamage)
    tempHpAfter = tempHpBefore - absorbedByTempHp

    const remainingDamage = Math.max(0, effectiveDamage - absorbedByTempHp)
    hpDamage = Math.min(currentHpBefore, remainingDamage)
    currentHpAfter = currentHpBefore - hpDamage
    overflowDamage = Math.max(0, remainingDamage - currentHpBefore)

    if (effectiveDamage > 0 && lifeStateBefore !== 'dead') {
      if (currentHpBefore > 0 && currentHpAfter === 0) {
        if (actor.deathRules === 'monster') {
          lifeStateAfter = 'dead'
          monsterDeath = true
          deathSaveSuccessesAfter = 0
          deathSaveFailuresAfter = 0
          lastDeathSaveRound = null
        } else if (overflowDamage >= actor.maxHp) {
          lifeStateAfter = 'dead'
          instantDeath = true
          deathSaveSuccessesAfter = 0
          deathSaveFailuresAfter = 0
          lastDeathSaveRound = null
        } else {
          lifeStateAfter = 'unconscious'
          deathSaveSuccessesAfter = 0
          deathSaveFailuresAfter = 0
          lastDeathSaveRound = null
        }
      } else if (currentHpBefore === 0 && actor.deathRules === 'character') {
        if (effectiveDamage >= actor.maxHp) {
          lifeStateAfter = 'dead'
          instantDeath = true
          lastDeathSaveRound = null
        } else {
          lifeStateAfter = 'unconscious'
          deathSaveFailuresAdded = criticalHit ? 2 : 1
          deathSaveFailuresAfter = Math.min(
            3,
            deathSaveFailuresBefore + deathSaveFailuresAdded,
          )

          if (deathSaveFailuresAfter >= 3) {
            lifeStateAfter = 'dead'
            lastDeathSaveRound = null
          } else if (lifeStateBefore === 'stable') {
            deathSaveSuccessesAfter = 0
            lastDeathSaveRound = null
          }
        }
      }
    }
  }

  if (operation === 'heal') {
    if (lifeStateBefore === 'dead') {
      healingBlockedByDeath = true
    } else {
      currentHpAfter = Math.min(actor.maxHp, currentHpBefore + amount)
      healed = currentHpAfter - currentHpBefore

      if (healed > 0) {
        lifeStateAfter = 'conscious'
        deathSaveSuccessesAfter = 0
        deathSaveFailuresAfter = 0
        lastDeathSaveRound = null
      }
    }
  }

  if (operation === 'set-temp') {
    // D&D temporary HP do not stack. When a new effect grants a lower
    // pool, keep the larger existing pool by default.
    tempHpAfter = Math.max(tempHpBefore, amount)
  }

  const nextActor: Actor = {
    ...actor,
    currentHp: currentHpAfter,
    tempHp: tempHpAfter,
    lifeState: lifeStateAfter,
    deathSaveSuccesses: deathSaveSuccessesAfter,
    deathSaveFailures: deathSaveFailuresAfter,
    lastDeathSaveRound,
  }

  return {
    actor: nextActor,
    resolution: {
      operation,
      requestedAmount: amount,
      damageType,
      currentHpBefore,
      currentHpAfter,
      tempHpBefore,
      tempHpAfter,
      effectiveDamage,
      absorbedByTempHp,
      hpDamage,
      healed,
      immunityApplied,
      resistanceApplied,
      vulnerabilityApplied,
      overflowDamage,
      criticalHit,
      lifeStateBefore,
      lifeStateAfter,
      deathSaveSuccessesBefore,
      deathSaveSuccessesAfter,
      deathSaveFailuresBefore,
      deathSaveFailuresAfter,
      deathSaveFailuresAdded,
      instantDeath,
      monsterDeath,
      healingBlockedByDeath,
    },
  }
}
