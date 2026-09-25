export type DiceRollVisibility = 'public' | 'player-dm' | 'dm'
export type DiceRollReason = 'd20' | 'initiative' | 'death-save' | 'concentration'
export type DiceRollerRole = 'dm' | 'player'

export interface DiceRollEntry {
  id: string
  createdAt: string
  visibility: DiceRollVisibility
  rollerRole: DiceRollerRole
  rollerId: string
  rollerName: string
  reason: DiceRollReason
  die: 'd20'
  rawRoll: number
  modifier: number
  total: number
  actorId: string | null
  actorName: string | null
}
