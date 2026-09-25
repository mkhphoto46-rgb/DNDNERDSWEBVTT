import type { CharacterSkill } from '../types/actor'
import type { ReactionWindow } from '../types/reaction'
import type { ReadiedAction, ReadiedActionKind, ReadiedSpellPayload, ReadiedUtilityPayload } from '../types/readyAction'
import {
  normalizeCharacterSkill,
  normalizeCoreUtilityAction,
  type HelpUtilityMode,
} from './utilityActions'

function text(value: unknown, max = 240): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
}

function positiveInt(value: unknown, min = 0, max = 9): number | null {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null
  return parsed
}

export function normalizeReadiedActionKind(value: unknown): ReadiedActionKind | null {
  return value === 'attack' || value === 'utility' || value === 'spell' ? value : null
}

export function normalizeReadiedUtilityPayload(value: unknown): ReadiedUtilityPayload | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<ReadiedUtilityPayload>
  const action = normalizeCoreUtilityAction(raw.action)
  if (!action) return null

  const helpMode: HelpUtilityMode | null = raw.helpMode === 'ability-check' || raw.helpMode === 'attack-roll'
    ? raw.helpMode
    : null
  const targetActorId = text(raw.targetActorId, 160) || null
  const skill: CharacterSkill | null = normalizeCharacterSkill(raw.skill)
  const objectName = text(raw.objectName, 100) || null

  return {
    action,
    helpMode,
    targetActorId,
    skill,
    objectName,
  }
}

export function normalizeReadiedSpellPayload(value: unknown): ReadiedSpellPayload | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<ReadiedSpellPayload>
  const spellId = text(raw.spellId, 160)
  const castLevel = positiveInt(raw.castLevel, 0, 9)
  if (!spellId || castLevel === null) return null
  return { spellId, castLevel }
}

export function normalizeReadiedAction(value: unknown): ReadiedAction | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<ReadiedAction>
  const id = text(raw.id, 160)
  const actorId = text(raw.actorId, 160)
  const kind = normalizeReadiedActionKind(raw.kind)
  const triggerText = text(raw.triggerText, 240)
  const sourceTurnStartedAt = text(raw.sourceTurnStartedAt, 160)
  const createdAt = text(raw.createdAt, 160)
  if (!id || !actorId || !kind || !triggerText || !sourceTurnStartedAt || !createdAt) return null

  const attackId = text(raw.attackId, 160) || null
  const preparedTargetActorId = text(raw.preparedTargetActorId, 160) || null
  const utility = normalizeReadiedUtilityPayload(raw.utility)
  const spell = normalizeReadiedSpellPayload(raw.spell)

  if (kind === 'attack' && !attackId) return null
  if (kind === 'utility' && !utility) return null
  if (kind === 'spell' && !spell) return null

  return {
    id,
    actorId,
    kind,
    triggerText,
    sourceTurnStartedAt,
    attackId: kind === 'attack' ? attackId : null,
    preparedTargetActorId: kind === 'attack' ? preparedTargetActorId : null,
    utility: kind === 'utility' ? utility : null,
    spell: kind === 'spell' ? spell : null,
    createdAt,
  }
}

export function normalizeReadiedActions(value: unknown): ReadiedAction[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: ReadiedAction[] = []
  for (const entry of value) {
    const ready = normalizeReadiedAction(entry)
    if (!ready || seen.has(ready.id)) continue
    seen.add(ready.id)
    result.push(ready)
    if (result.length >= 50) break
  }
  return result
}

export function clearReadiedActionsAtActorTurnStart(
  actions: ReadiedAction[],
  actorId: string,
): ReadiedAction[] {
  return actions.filter((action) => action.actorId !== actorId)
}

export function removeReadiedAction(actions: ReadiedAction[], readyActionId: string): ReadiedAction[] {
  return actions.filter((action) => action.id !== readyActionId)
}

export function actorHasReadiedAction(actions: ReadiedAction[], actorId: string): boolean {
  return actions.some((action) => action.actorId === actorId)
}

export function actorHasReadiedSpell(actions: ReadiedAction[], actorId: string): boolean {
  return actions.some((action) => action.actorId === actorId && action.kind === 'spell')
}

export function hasOpenReactionWindowForReadiedAction(
  windows: ReactionWindow[],
  readyActionId: string,
): boolean {
  return windows.some((window) => window.kind === 'readied-action' && window.readyActionId === readyActionId)
}
