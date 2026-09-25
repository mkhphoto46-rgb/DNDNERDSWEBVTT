import type { Actor, ActorAbility } from '../types/actor'
import type { TurnEconomyState } from '../types/actionEconomy'
import type { GenericDiceMode } from './dice'
import { effectiveActorSpeed, normalizeConditionName } from './effects'

const ACTOR_ABILITIES = new Set<ActorAbility>([
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
])

export function normalizeSavingThrowAbility(value: unknown): ActorAbility | null {
  const ability = String(value ?? '').trim().toLowerCase() as ActorAbility
  return ACTOR_ABILITIES.has(ability) ? ability : null
}

export function dodgeBenefitsActive(
  actor: Actor | null | undefined,
  economy: TurnEconomyState | null | undefined,
): boolean {
  if (!actor || !economy?.dodging) return false
  if (actor.lifeState !== 'conscious') return false
  if (effectiveActorSpeed(actor) <= 0) return false

  const incapacitated = (actor.conditions ?? []).some(
    (condition) => normalizeConditionName(condition).toLowerCase() === 'incapacitated',
  )

  return !incapacitated
}

function addAdvantage(mode: GenericDiceMode): GenericDiceMode {
  if (mode === 'disadvantage') return 'normal'
  return 'advantage'
}

function addDisadvantage(mode: GenericDiceMode): GenericDiceMode {
  if (mode === 'advantage') return 'normal'
  return 'disadvantage'
}

export function applyDodgeAttackMode(
  mode: GenericDiceMode,
  target: Actor | null | undefined,
  targetEconomy: TurnEconomyState | null | undefined,
): GenericDiceMode {
  return dodgeBenefitsActive(target, targetEconomy)
    ? addDisadvantage(mode)
    : mode
}

export function applyDodgeSavingThrowMode(
  mode: GenericDiceMode,
  actor: Actor | null | undefined,
  actorEconomy: TurnEconomyState | null | undefined,
  ability: ActorAbility | null | undefined,
): GenericDiceMode {
  return ability === 'dexterity' && dodgeBenefitsActive(actor, actorEconomy)
    ? addAdvantage(mode)
    : mode
}
