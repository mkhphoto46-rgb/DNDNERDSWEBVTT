import type { Actor } from '../types/actor'
import type { ActorAttackProfile } from '../types/combatActions'
import type { ReactionWindow } from '../types/reaction'

export const REACTION_WINDOW_TTL_MS = 60_000

function finiteInt(value: unknown, fallback = 0, min = -100000, max = 100000): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback
}

function text(value: unknown, max = 160): string {
  return String(value ?? '').trim().slice(0, max)
}

export function actorsAreOpposedForOpportunity(
  reactor: Pick<Actor, 'kind'>,
  mover: Pick<Actor, 'kind'>,
): boolean {
  return (
    (reactor.kind === 'player' && mover.kind === 'enemy') ||
    (reactor.kind === 'enemy' && mover.kind === 'player')
  )
}

export function eligibleOpportunityAttackIds(
  profiles: ActorAttackProfile[],
  distanceBeforeFeet: number,
  distanceAfterFeet: number,
): string[] {
  const before = Math.max(0, Number(distanceBeforeFeet) || 0)
  const after = Math.max(0, Number(distanceAfterFeet) || 0)
  return profiles
    .filter((profile) => (
      profile.attackType === 'melee' &&
      profile.rangeFeet > 0 &&
      before <= profile.rangeFeet &&
      after > profile.rangeFeet
    ))
    .map((profile) => profile.id)
}

export function reactionWindowExpired(
  window: Pick<ReactionWindow, 'expiresAt'>,
  nowMs = Date.now(),
): boolean {
  const expiresAt = Date.parse(window.expiresAt)
  return !Number.isFinite(expiresAt) || expiresAt <= nowMs
}

export function normalizeReactionWindow(value: unknown): ReactionWindow | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<ReactionWindow> & Record<string, unknown>
  if (raw.kind !== 'opportunity-attack' && raw.kind !== 'readied-action') return null

  const id = text(raw.id)
  const reactorActorId = text(raw.reactorActorId)
  const turnActorId = text(raw.turnActorId)
  const createdAt = text(raw.createdAt)
  const expiresAt = text(raw.expiresAt)

  if (!id || !reactorActorId || !turnActorId || !createdAt || !expiresAt) {
    return null
  }

  const base = {
    id,
    reactorActorId,
    combatRound: finiteInt(raw.combatRound, 0, 0, 100000),
    turnActorId,
    createdAt,
    expiresAt,
  }

  if (raw.kind === 'readied-action') {
    const readyActionId = text(raw.readyActionId)
    const readyActionKind = raw.readyActionKind === 'attack' || raw.readyActionKind === 'utility' || raw.readyActionKind === 'spell'
      ? raw.readyActionKind
      : null
    const readyActionLabel = text(raw.readyActionLabel)
    const triggerText = text(raw.triggerText, 240)
    const preparedTargetActorId = text(raw.preparedTargetActorId) || null
    const readySpellId = text(raw.readySpellId) || null
    const readySpellCastLevel = raw.readySpellCastLevel === null || raw.readySpellCastLevel === undefined
      ? null
      : finiteInt(raw.readySpellCastLevel, -1, 0, 9)
    if (!readyActionId || !readyActionKind || !readyActionLabel || !triggerText) return null
    if (readyActionKind === 'spell' && (!readySpellId || readySpellCastLevel === null || readySpellCastLevel < 0)) return null
    return {
      ...base,
      kind: 'readied-action',
      readyActionId,
      readyActionKind,
      readyActionLabel,
      triggerText,
      preparedTargetActorId,
      readySpellId: readyActionKind === 'spell' ? readySpellId : null,
      readySpellCastLevel: readyActionKind === 'spell' ? readySpellCastLevel : null,
    }
  }

  const triggeringActorId = text(raw.triggeringActorId)
  const reactorTokenId = text(raw.reactorTokenId)
  const triggeringTokenId = text(raw.triggeringTokenId)
  const eligibleAttackIds = Array.isArray(raw.eligibleAttackIds)
    ? [...new Set(raw.eligibleAttackIds.map((entry) => text(entry)).filter(Boolean))].slice(0, 50)
    : []

  if (!triggeringActorId || !reactorTokenId || !triggeringTokenId || eligibleAttackIds.length === 0) return null

  return {
    ...base,
    kind: 'opportunity-attack',
    triggeringActorId,
    reactorTokenId,
    triggeringTokenId,
    eligibleAttackIds,
    triggerDistanceFeet: finiteInt(raw.triggerDistanceFeet, 0, 0, 100000),
    reactorGridX: finiteInt(raw.reactorGridX),
    reactorGridY: finiteInt(raw.reactorGridY),
    triggerFromGridX: finiteInt(raw.triggerFromGridX),
    triggerFromGridY: finiteInt(raw.triggerFromGridY),
    triggerToGridX: finiteInt(raw.triggerToGridX),
    triggerToGridY: finiteInt(raw.triggerToGridY),
  }
}

export function normalizeReactionWindows(
  value: unknown,
  nowMs = Date.now(),
): ReactionWindow[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((entry) => {
    const window = normalizeReactionWindow(entry)
    if (!window || seen.has(window.id) || reactionWindowExpired(window, nowMs)) return []
    seen.add(window.id)
    return [window]
  }).slice(0, 50)
}

export function hasPendingReactionForTriggeringActor(
  windows: ReactionWindow[],
  actorId: string,
): boolean {
  return windows.some((window) => window.kind === 'opportunity-attack' && window.triggeringActorId === actorId)
}
