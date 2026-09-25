export type CombatPhase = 'inactive' | 'setup' | 'active'
export type InitiativeSource = 'player-roll' | 'dm-roll' | 'manual' | null

export interface CombatantEntry {
  actorId: string
  initiative: number | null
  tieOrder: number
  initiativeSource: InitiativeSource
}

export interface CombatState {
  phase: CombatPhase
  active: boolean
  round: number
  currentTurnIndex: number
  currentActorId: string | null
  combatants: CombatantEntry[]
  startedAt: string | null
}

export const INACTIVE_COMBAT_STATE: CombatState = {
  phase: 'inactive',
  active: false,
  round: 0,
  currentTurnIndex: -1,
  currentActorId: null,
  combatants: [],
  startedAt: null,
}
