import type { CharacterSkill } from './actor'
import type { CoreUtilityAction, HelpUtilityMode } from '../lib/utilityActions'

export type ReadiedActionKind = 'attack' | 'utility' | 'spell'

export interface ReadiedUtilityPayload {
  action: CoreUtilityAction
  helpMode: HelpUtilityMode | null
  targetActorId: string | null
  skill: CharacterSkill | null
  objectName: string | null
}

export interface ReadiedSpellPayload {
  spellId: string
  castLevel: number
}

export interface ReadiedAction {
  id: string
  actorId: string
  kind: ReadiedActionKind
  triggerText: string
  sourceTurnStartedAt: string
  attackId: string | null
  preparedTargetActorId: string | null
  utility: ReadiedUtilityPayload | null
  spell: ReadiedSpellPayload | null
  createdAt: string
}
