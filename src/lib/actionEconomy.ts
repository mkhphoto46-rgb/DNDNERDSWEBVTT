import type { Actor } from '../types/actor'
import type {
  TurnEconomyByActorId,
  TurnEconomyOverridePatch,
  TurnEconomyState,
  TurnResource,
} from '../types/actionEconomy'
import { characterFeaturesAtLevel } from './progression'
import { effectiveActorSpeed } from './effects'

function integer(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.round(parsed)))
}

export function actorAttackLimit(actor: Pick<Actor, 'level' | 'characterSheet'>): number {
  const sheet = actor.characterSheet
  if (!sheet?.className) return 1

  const features = characterFeaturesAtLevel(
    sheet.className,
    sheet.subclassName,
    actor.level,
  )

  const names = new Set(features.map((feature) => feature.name.toLowerCase()))
  if (names.has('three extra attacks')) return 4
  if (names.has('two extra attacks')) return 3
  if (names.has('extra attack')) return 2
  return 1
}

export function freshTurnEconomy(actor: Actor, now = new Date().toISOString()): TurnEconomyState {
  return {
    actorId: actor.id,
    actionMax: 1,
    actionUsed: 0,
    bonusActionMax: 1,
    bonusActionUsed: 0,
    reactionMax: 1,
    reactionUsed: 0,
    turnStartedAt: now,
    spellSlotExpendedTurnKey: null,
    movementBonusFeet: 0,
    movementOverrideFeet: null,
    attackLimit: actorAttackLimit(actor),
    attackActionsUsed: 0,
    attacksUsed: 0,
    disengaged: false,
    dodging: false,
    ended: false,
    updatedAt: now,
  }
}

export function normalizeTurnEconomy(
  value: unknown,
  actor: Actor,
): TurnEconomyState {
  const base = freshTurnEconomy(actor, new Date(0).toISOString())
  if (!value || typeof value !== 'object') return base
  const raw = value as Partial<TurnEconomyState>

  const actionMax = integer(raw.actionMax, base.actionMax, 0, 20)
  const actionUsed = integer(raw.actionUsed, 0, 0, actionMax)
  const bonusActionMax = integer(raw.bonusActionMax, base.bonusActionMax, 0, 20)
  const reactionMax = integer(raw.reactionMax, base.reactionMax, 0, 20)
  const attackLimit = integer(raw.attackLimit, base.attackLimit, 1, 20)
  const legacyAttacksUsed = integer(raw.attacksUsed, 0, 0, attackLimit)
  const inferredAttackActionsUsed =
    raw.attackActionsUsed === undefined && legacyAttacksUsed > 0
      ? 1
      : 0
  const attackActionsUsed = integer(
    raw.attackActionsUsed,
    inferredAttackActionsUsed,
    0,
    actionUsed,
  )
  const movementOverride = raw.movementOverrideFeet === null || raw.movementOverrideFeet === undefined
    ? null
    : integer(raw.movementOverrideFeet, 0, 0, 5000)
  const turnStartedAt = typeof raw.turnStartedAt === 'string' && raw.turnStartedAt
    ? raw.turnStartedAt
    : typeof raw.updatedAt === 'string' && raw.updatedAt
      ? raw.updatedAt
      : base.turnStartedAt
  const spellSlotExpendedTurnKey = typeof raw.spellSlotExpendedTurnKey === 'string' && raw.spellSlotExpendedTurnKey.trim()
    ? raw.spellSlotExpendedTurnKey.trim().slice(0, 320)
    : null

  return {
    actorId: actor.id,
    actionMax,
    actionUsed,
    bonusActionMax,
    bonusActionUsed: integer(raw.bonusActionUsed, 0, 0, bonusActionMax),
    reactionMax,
    reactionUsed: integer(raw.reactionUsed, 0, 0, reactionMax),
    turnStartedAt,
    spellSlotExpendedTurnKey,
    movementBonusFeet: integer(raw.movementBonusFeet, 0, -5000, 5000),
    movementOverrideFeet: movementOverride,
    attackLimit,
    attackActionsUsed,
    attacksUsed: legacyAttacksUsed,
    disengaged: raw.disengaged === true,
    dodging: raw.dodging === true,
    ended: raw.ended === true,
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt
      ? raw.updatedAt
      : base.updatedAt,
  }
}

export function normalizeTurnEconomyMap(
  value: unknown,
  actors: Actor[],
): TurnEconomyByActorId {
  const raw = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
  return Object.fromEntries(
    actors.map((actor) => [actor.id, normalizeTurnEconomy(raw[actor.id], actor)]),
  )
}

export function remainingTurnResource(
  state: TurnEconomyState,
  resource: TurnResource,
): number {
  if (resource === 'action') return Math.max(0, state.actionMax - state.actionUsed)
  if (resource === 'bonus-action') return Math.max(0, state.bonusActionMax - state.bonusActionUsed)
  return Math.max(0, state.reactionMax - state.reactionUsed)
}

export function spendTurnResource(
  state: TurnEconomyState,
  resource: TurnResource,
  count = 1,
): TurnEconomyState {
  const amount = Math.max(1, Math.round(count))
  if (remainingTurnResource(state, resource) < amount) {
    const label = resource === 'bonus-action' ? 'Bonus Action' : resource[0].toUpperCase() + resource.slice(1)
    throw new Error(`${label} is already spent.`)
  }

  const next: TurnEconomyState = {
    ...state,
    updatedAt: new Date().toISOString(),
  }

  if (resource === 'action') next.actionUsed += amount
  else if (resource === 'bonus-action') next.bonusActionUsed += amount
  else next.reactionUsed += amount
  return next
}

export function useAttackFromAction(state: TurnEconomyState): TurnEconomyState {
  const attackLimit = Math.max(1, state.attackLimit)

  // An Attack action that has already started keeps its remaining attacks even
  // if another turn resource was spent between those attacks.
  if (state.attacksUsed > 0 && state.attacksUsed < attackLimit) {
    return {
      ...state,
      attacksUsed: state.attacksUsed + 1,
      updatedAt: new Date().toISOString(),
    }
  }

  // No Attack action is active, or the previous one is complete. Starting the
  // next attack therefore starts a new Attack action and spends another Action.
  if (remainingTurnResource(state, 'action') <= 0) {
    if (state.attacksUsed >= attackLimit) {
      throw new Error('No attacks remain and no Action is available to start another Attack action.')
    }
    throw new Error('Action is already spent.')
  }

  const next = spendTurnResource(state, 'action')
  return {
    ...next,
    attackActionsUsed: next.attackActionsUsed + 1,
    attacksUsed: 1,
    updatedAt: new Date().toISOString(),
  }
}

export function useDash(
  state: TurnEconomyState,
  actor: Actor,
  resource: TurnResource = 'action',
): TurnEconomyState {
  const spent = spendTurnResource(state, resource)
  return {
    ...spent,
    movementBonusFeet: spent.movementBonusFeet + effectiveActorSpeed(actor),
    updatedAt: new Date().toISOString(),
  }
}

export function useDisengage(
  state: TurnEconomyState,
  resource: TurnResource = 'action',
): TurnEconomyState {
  const spent = spendTurnResource(state, resource)
  return {
    ...spent,
    disengaged: true,
    updatedAt: new Date().toISOString(),
  }
}

export function useDodge(
  state: TurnEconomyState,
  resource: TurnResource = 'action',
): TurnEconomyState {
  const spent = spendTurnResource(state, resource)
  return {
    ...spent,
    dodging: true,
    updatedAt: new Date().toISOString(),
  }
}

export function endTurnEconomy(
  state: TurnEconomyState,
  now = new Date().toISOString(),
): TurnEconomyState {
  return {
    ...state,
    movementBonusFeet: 0,
    movementOverrideFeet: null,
    disengaged: false,
    ended: true,
    updatedAt: now,
  }
}

export function movementAllowanceFeet(actor: Actor, state: TurnEconomyState): number {
  if (state.movementOverrideFeet !== null) {
    return Math.max(0, state.movementOverrideFeet)
  }
  return Math.max(0, effectiveActorSpeed(actor) + state.movementBonusFeet)
}

export function standUpMovementCostFeet(actor: Actor): number {
  const speedFeet = effectiveActorSpeed(actor)
  if (speedFeet <= 0) {
    throw new Error(`${actor.name} cannot stand while Speed is 0.`)
  }
  return Math.max(0, Math.floor(speedFeet / 2))
}

export function combatMovementBudgetApplies(
  combatActive: boolean,
  currentActorId: string | null,
  actorId: string,
): boolean {
  return combatActive && currentActorId === actorId
}

export function applyTurnEconomyOverride(
  state: TurnEconomyState,
  patch: TurnEconomyOverridePatch,
): TurnEconomyState {
  const merged = {
    ...state,
    ...patch,
    actorId: state.actorId,
    updatedAt: new Date().toISOString(),
  }

  const actionMax = integer(merged.actionMax, state.actionMax, 0, 20)
  const actionUsed = integer(merged.actionUsed, state.actionUsed, 0, actionMax)
  const bonusActionMax = integer(merged.bonusActionMax, state.bonusActionMax, 0, 20)
  const reactionMax = integer(merged.reactionMax, state.reactionMax, 0, 20)
  const attackLimit = integer(merged.attackLimit, state.attackLimit, 1, 20)

  return {
    ...merged,
    turnStartedAt: state.turnStartedAt,
    spellSlotExpendedTurnKey: state.spellSlotExpendedTurnKey,
    actionMax,
    actionUsed,
    bonusActionMax,
    bonusActionUsed: integer(merged.bonusActionUsed, state.bonusActionUsed, 0, bonusActionMax),
    reactionMax,
    reactionUsed: integer(merged.reactionUsed, state.reactionUsed, 0, reactionMax),
    movementBonusFeet: integer(merged.movementBonusFeet, state.movementBonusFeet, -5000, 5000),
    movementOverrideFeet: merged.movementOverrideFeet === null
      ? null
      : integer(merged.movementOverrideFeet, state.movementOverrideFeet ?? 0, 0, 5000),
    attackLimit,
    attackActionsUsed: integer(
      merged.attackActionsUsed,
      state.attackActionsUsed,
      0,
      actionUsed,
    ),
    attacksUsed: integer(merged.attacksUsed, state.attacksUsed, 0, attackLimit),
    disengaged: merged.disengaged === true,
    dodging: merged.dodging === true,
    ended: merged.ended === true,
  }
}
