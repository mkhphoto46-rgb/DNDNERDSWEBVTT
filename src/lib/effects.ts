import type {
  Actor,
  ActorEffect,
  ActorEffectKind,
  ActorEffectScope,
} from '../types/actor'
import type { GenericDiceMode, GenericDicePurpose } from './dice'

const EFFECT_KINDS = new Set<ActorEffectKind>([
  'advantage',
  'disadvantage',
  'roll-modifier',
  'dice-bonus',
  'speed-modifier',
  'condition',
])

const EFFECT_SCOPES = new Set<ActorEffectScope>([
  'all-d20',
  'attack',
  'saving-throw',
  'attack-save',
  'ability-check',
  'skill-check',
  'spell',
])

export const MECHANICAL_CONDITIONS = [
  'Blinded',
  'Grappled',
  'Invisible',
  'Poisoned',
  'Prone',
  'Restrained',
] as const

const MECHANICAL_CONDITION_SET = new Set<string>(
  MECHANICAL_CONDITIONS.map((condition) => condition.toLowerCase()),
)

export function isMechanicallySupportedCondition(value: unknown): boolean {
  const condition = normalizeConditionName(value).toLowerCase()
  return MECHANICAL_CONDITION_SET.has(condition)
}

export function canonicalMechanicalCondition(value: unknown): string | null {
  const condition = normalizeConditionName(value).toLowerCase()
  return MECHANICAL_CONDITIONS.find(
    (candidate) => candidate.toLowerCase() === condition,
  ) ?? null
}

function finiteInteger(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback
}

function safeScope(value: unknown): ActorEffectScope {
  return EFFECT_SCOPES.has(value as ActorEffectScope)
    ? value as ActorEffectScope
    : 'all-d20'
}

function safeKind(value: unknown): ActorEffectKind | null {
  return EFFECT_KINDS.has(value as ActorEffectKind)
    ? value as ActorEffectKind
    : null
}

export function normalizeConditionName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80)
}

export function normalizeActorEffects(value: unknown): ActorEffect[] {
  if (!Array.isArray(value)) return []

  return value
    .map((entry): ActorEffect | null => {
      if (!entry || typeof entry !== 'object') return null
      const raw = entry as Record<string, unknown>
      const id = String(raw.id ?? '').trim()
      const kind = safeKind(raw.kind)
      const name = normalizeConditionName(raw.name)

      if (!id || !kind || !name) return null

      return {
        id,
        name,
        kind,
        scope: safeScope(raw.scope),
        value: Math.max(-100, Math.min(100, finiteInteger(raw.value, 0))),
        diceCount: Math.max(0, Math.min(10, finiteInteger(raw.diceCount, 0))),
        dieSides: Math.max(0, Math.min(100, finiteInteger(raw.dieSides, 0))),
        sourceRuleId: typeof raw.sourceRuleId === 'string' ? raw.sourceRuleId.trim().slice(0, 120) : '',
        concentration: raw.concentration === true,
        expiresAtRound: Number.isInteger(Number(raw.expiresAtRound)) ? Math.max(0, finiteInteger(raw.expiresAtRound, 0)) : null,
        sourceActorId:
          typeof raw.sourceActorId === 'string' && raw.sourceActorId.trim()
            ? raw.sourceActorId.trim()
            : null,
        sourceActorName: normalizeConditionName(raw.sourceActorName) || 'Unknown source',
        sourceRole: raw.sourceRole === 'dm' ? 'dm' : 'player',
        createdAt:
          typeof raw.createdAt === 'string' && raw.createdAt
            ? raw.createdAt
            : new Date(0).toISOString(),
      }
    })
    .filter((entry): entry is ActorEffect => entry !== null)
    .slice(-100)
}

export function effectScopeMatches(
  scope: ActorEffectScope,
  purpose: GenericDicePurpose,
): boolean {
  if (scope === 'all-d20') {
    return purpose === 'attack' ||
      purpose === 'saving-throw' ||
      purpose === 'ability-check' ||
      purpose === 'skill-check' ||
      purpose === 'spell'
  }

  if (scope === 'attack-save') {
    return purpose === 'attack' || purpose === 'saving-throw'
  }

  return scope === purpose
}

function conditionSet(actor: Actor | null | undefined): Set<string> {
  return new Set(
    (actor?.conditions ?? [])
      .map((entry) => normalizeConditionName(entry).toLowerCase())
      .filter(Boolean),
  )
}

function rollFlagsFromActor(
  actor: Actor | null | undefined,
  purpose: GenericDicePurpose,
): { advantage: boolean; disadvantage: boolean } {
  let advantage = false
  let disadvantage = false

  for (const effect of normalizeActorEffects(actor?.effects)) {
    if (!effectScopeMatches(effect.scope, purpose)) continue
    if (effect.kind === 'advantage') advantage = true
    if (effect.kind === 'disadvantage') disadvantage = true
  }

  const conditions = conditionSet(actor)

  if (purpose === 'attack') {
    if (conditions.has('poisoned') || conditions.has('blinded') || conditions.has('restrained') || conditions.has('prone')) {
      disadvantage = true
    }
    if (conditions.has('invisible')) {
      advantage = true
    }
  }

  if (
    (purpose === 'ability-check' || purpose === 'skill-check') &&
    conditions.has('poisoned')
  ) {
    disadvantage = true
  }

  return { advantage, disadvantage }
}

function rollFlagsFromTarget(
  target: Actor | null | undefined,
  purpose: GenericDicePurpose,
  targetDistanceFeet: number | null = null,
): { advantage: boolean; disadvantage: boolean } {
  let advantage = false
  let disadvantage = false

  if (purpose !== 'attack') {
    return { advantage, disadvantage }
  }

  const conditions = conditionSet(target)

  if (conditions.has('blinded') || conditions.has('restrained')) {
    advantage = true
  }

  if (conditions.has('invisible')) {
    disadvantage = true
  }

  if (conditions.has('prone')) {
    if (targetDistanceFeet !== null && targetDistanceFeet <= 5) advantage = true
    else disadvantage = true
  }

  return { advantage, disadvantage }
}

function requestedModeFlags(mode: GenericDiceMode): {
  advantage: boolean
  disadvantage: boolean
} {
  return {
    advantage: mode === 'advantage',
    disadvantage: mode === 'disadvantage',
  }
}

export function resolveActorD20Mode(
  actor: Actor | null | undefined,
  purpose: GenericDicePurpose,
  requestedMode: GenericDiceMode = 'normal',
  target: Actor | null | undefined = null,
  targetDistanceFeet: number | null = null,
): GenericDiceMode {
  const requested = requestedModeFlags(requestedMode)
  const source = rollFlagsFromActor(actor, purpose)
  const targetFlags = rollFlagsFromTarget(target, purpose, targetDistanceFeet)

  const hasAdvantage = requested.advantage || source.advantage || targetFlags.advantage
  const hasDisadvantage = requested.disadvantage || source.disadvantage || targetFlags.disadvantage

  if (hasAdvantage === hasDisadvantage) return 'normal'
  return hasAdvantage ? 'advantage' : 'disadvantage'
}

export function actorD20Modifier(
  actor: Actor | null | undefined,
  purpose: GenericDicePurpose,
): number {
  return normalizeActorEffects(actor?.effects)
    .filter(
      (effect) =>
        effect.kind === 'roll-modifier' &&
        effectScopeMatches(effect.scope, purpose),
    )
    .reduce((sum, effect) => sum + effect.value, 0)
}

export interface ActorBonusDie {
  count: number
  sides: number
  name: string
  effectId: string
}

export function actorD20BonusDice(
  actor: Actor | null | undefined,
  purpose: GenericDicePurpose,
): ActorBonusDie[] {
  return normalizeActorEffects(actor?.effects)
    .filter(
      (effect) =>
        effect.kind === 'dice-bonus' &&
        effectScopeMatches(effect.scope, purpose) &&
        (effect.diceCount ?? 0) > 0 &&
        (effect.dieSides ?? 0) > 1,
    )
    .map((effect) => ({
      count: effect.diceCount ?? 1,
      sides: effect.dieSides ?? 4,
      name: effect.name,
      effectId: effect.id,
    }))
}

export function effectiveActorSpeed(actor: Actor): number {
  const conditions = conditionSet(actor)

  if (conditions.has('grappled') || conditions.has('restrained')) {
    return 0
  }

  const delta = normalizeActorEffects(actor.effects)
    .filter((effect) => effect.kind === 'speed-modifier')
    .reduce((sum, effect) => sum + effect.value, 0)

  return Math.max(0, Math.min(500, Math.round(actor.speedFeet + delta)))
}

export function effectDefaultName(
  kind: ActorEffectKind | 'temp-hp',
  scope: ActorEffectScope,
  value: number,
  customName = '',
): string {
  const clean = normalizeConditionName(customName)
  if (clean) return clean

  if (kind === 'advantage') return `Advantage · ${scope}`
  if (kind === 'disadvantage') return `Disadvantage · ${scope}`
  if (kind === 'roll-modifier') return `d20 ${value >= 0 ? '+' : ''}${value} · ${scope}`
  if (kind === 'dice-bonus') return `Bonus Die · ${scope}`
  if (kind === 'speed-modifier') return `Speed ${value >= 0 ? '+' : ''}${value} ft`
  if (kind === 'temp-hp') return `Temporary HP ${value}`
  return 'Condition'
}
