export type TurnResource = 'action' | 'bonus-action' | 'reaction'

export interface TurnEconomyState {
  actorId: string
  actionMax: number
  actionUsed: number
  bonusActionMax: number
  bonusActionUsed: number
  reactionMax: number
  reactionUsed: number
  /** Stable identity timestamp for this specific turn instance. */
  turnStartedAt: string
  /** Combat turn key in which this actor most recently expended a spell slot. */
  spellSlotExpendedTurnKey: string | null
  movementBonusFeet: number
  movementOverrideFeet: number | null
  /** Maximum attacks granted by each individual Attack action. */
  attackLimit: number
  /** Number of Attack actions started during this turn. */
  attackActionsUsed: number
  /** Attacks already made inside the currently active Attack action. */
  attacksUsed: number
  disengaged: boolean
  dodging: boolean
  ended: boolean
  updatedAt: string
}

export type TurnEconomyByActorId = Record<string, TurnEconomyState>

export interface TurnEconomyOverridePatch {
  actionMax?: number
  actionUsed?: number
  bonusActionMax?: number
  bonusActionUsed?: number
  reactionMax?: number
  reactionUsed?: number
  movementBonusFeet?: number
  movementOverrideFeet?: number | null
  attackLimit?: number
  attackActionsUsed?: number
  attacksUsed?: number
  disengaged?: boolean
  dodging?: boolean
  ended?: boolean
}
