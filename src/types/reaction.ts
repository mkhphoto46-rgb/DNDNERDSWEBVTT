import type { ReadiedActionKind } from './readyAction'

export type ReactionKind = 'opportunity-attack' | 'readied-action'
export type ReactionDecision = 'use' | 'decline'

interface ReactionWindowBase {
  id: string
  kind: ReactionKind
  reactorActorId: string
  combatRound: number
  turnActorId: string
  createdAt: string
  expiresAt: string
}

export interface OpportunityAttackReactionWindow extends ReactionWindowBase {
  kind: 'opportunity-attack'
  triggeringActorId: string
  reactorTokenId: string
  triggeringTokenId: string
  eligibleAttackIds: string[]
  triggerDistanceFeet: number
  reactorGridX: number
  reactorGridY: number
  triggerFromGridX: number
  triggerFromGridY: number
  triggerToGridX: number
  triggerToGridY: number
}

export interface ReadiedActionReactionWindow extends ReactionWindowBase {
  kind: 'readied-action'
  readyActionId: string
  readyActionKind: ReadiedActionKind
  readyActionLabel: string
  triggerText: string
  preparedTargetActorId: string | null
  readySpellId: string | null
  readySpellCastLevel: number | null
}

export type ReactionWindow = OpportunityAttackReactionWindow | ReadiedActionReactionWindow
