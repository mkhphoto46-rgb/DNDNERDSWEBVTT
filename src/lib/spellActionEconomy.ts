import type { CombatState } from '../types/combat'
import type { TurnEconomyState, TurnResource } from '../types/actionEconomy'
import { castingTimeActionCost } from './spellAutomation'

export function spellTurnResource(castingTime: string): TurnResource | null {
  const cost = castingTimeActionCost(castingTime)
  if (cost === 'action') return 'action'
  if (cost === 'bonus-action') return 'bonus-action'
  if (cost === 'reaction') return 'reaction'
  return null
}

export function spellTurnKeyForCombat(
  combat: Pick<CombatState, 'active' | 'round' | 'currentTurnIndex' | 'currentActorId'>,
  currentTurnEconomy: Pick<TurnEconomyState, 'turnStartedAt'> | null,
): string | null {
  if (!combat.active || !combat.currentActorId || !currentTurnEconomy?.turnStartedAt) return null
  return [
    Math.max(0, Math.round(combat.round)),
    Math.round(combat.currentTurnIndex),
    combat.currentActorId,
    currentTurnEconomy.turnStartedAt,
  ].join(':')
}

export function spellSlotAlreadyExpendedThisTurn(
  economy: Pick<TurnEconomyState, 'spellSlotExpendedTurnKey'>,
  turnKey: string | null,
): boolean {
  return Boolean(turnKey && economy.spellSlotExpendedTurnKey === turnKey)
}

export function assertCanExpendSpellSlotThisTurn(
  economy: Pick<TurnEconomyState, 'spellSlotExpendedTurnKey'>,
  turnKey: string | null,
): void {
  if (spellSlotAlreadyExpendedThisTurn(economy, turnKey)) {
    throw new Error('Only one spell slot can be expended to cast a spell on the same turn.')
  }
}

export function markSpellSlotExpendedForTurn(
  economy: TurnEconomyState,
  turnKey: string | null,
  usesSpellSlot: boolean,
  now = new Date().toISOString(),
): TurnEconomyState {
  if (!usesSpellSlot || !turnKey) return economy
  assertCanExpendSpellSlotThisTurn(economy, turnKey)
  return {
    ...economy,
    spellSlotExpendedTurnKey: turnKey,
    updatedAt: now,
  }
}

export function reactionSpellRequiresReactionWindow(castingTime: string): boolean {
  return castingTimeActionCost(castingTime) === 'reaction'
}
