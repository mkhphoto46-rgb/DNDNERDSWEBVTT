import { normalizeGridIndex } from './mapGridBounds'

export interface TargetingTokenLike {
  actorId?: unknown
  mapId?: unknown
  visible?: unknown
  gridX?: unknown
  gridY?: unknown
}

export type AttackRangeMode = 'normal' | 'disadvantage'

export interface AttackRangeValidation {
  legal: boolean
  mode: AttackRangeMode | null
  maxRangeFeet: number
}

export function activeMapTokenForActor(
  activeMapId: string,
  tokens: readonly TargetingTokenLike[],
  actorId: string,
): TargetingTokenLike | null {
  if (!activeMapId || !actorId) return null
  return tokens.find((token) => (
    String(token.actorId ?? '') === actorId &&
    String(token.mapId ?? '') === activeMapId &&
    token.visible !== false
  )) ?? null
}

export function visibleActorIdsForActiveMap(
  activeMapId: string,
  tokens: readonly TargetingTokenLike[],
): Set<string> {
  if (!activeMapId) return new Set<string>()
  return new Set(
    tokens
      .filter((token) => String(token.mapId ?? '') === activeMapId && token.visible !== false)
      .map((token) => String(token.actorId ?? ''))
      .filter(Boolean),
  )
}

export function actorGridDistanceFeet(
  activeMapId: string,
  tokens: readonly TargetingTokenLike[],
  sourceActorId: string,
  targetActorId: string,
): number | null {
  if (sourceActorId === targetActorId) return 0
  const source = activeMapTokenForActor(activeMapId, tokens, sourceActorId)
  const target = activeMapTokenForActor(activeMapId, tokens, targetActorId)
  if (!source || !target) return null
  const dx = Math.abs(normalizeGridIndex(source.gridX) - normalizeGridIndex(target.gridX))
  const dy = Math.abs(normalizeGridIndex(source.gridY) - normalizeGridIndex(target.gridY))
  return Math.max(dx, dy) * 5
}

export function validateAttackRange(
  distanceFeet: number | null,
  normalRangeFeet: number,
  longRangeFeet: number | null,
): AttackRangeValidation {
  const normal = Math.max(0, Math.round(Number(normalRangeFeet) || 0))
  const long = longRangeFeet === null
    ? null
    : Math.max(normal, Math.round(Number(longRangeFeet) || 0))
  const maxRangeFeet = long ?? normal

  if (distanceFeet === null || !Number.isFinite(distanceFeet) || distanceFeet < 0) {
    return { legal: false, mode: null, maxRangeFeet }
  }
  if (distanceFeet <= normal) {
    return { legal: true, mode: 'normal', maxRangeFeet }
  }
  if (long !== null && distanceFeet <= long) {
    return { legal: true, mode: 'disadvantage', maxRangeFeet }
  }
  return { legal: false, mode: null, maxRangeFeet }
}
