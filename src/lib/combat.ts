import {
  type Actor,
} from '../types/actor'

import {
  INACTIVE_COMBAT_STATE,
  type CombatantEntry,
  type CombatState,
  type InitiativeSource,
} from '../types/combat'

function finiteInteger(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback
}

function clampInitiative(value: unknown): number {
  return Math.max(-100, Math.min(100, finiteInteger(value, 0)))
}

function normalizeInitiativeSource(value: unknown): InitiativeSource {
  return value === 'player-roll' || value === 'dm-roll' || value === 'manual'
    ? value
    : null
}

function normalizeInitiative(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? clampInitiative(parsed) : null
}

export function sortCombatants(
  combatants: CombatantEntry[],
): CombatantEntry[] {
  return [...combatants].sort((left, right) => {
    if (left.initiative === null && right.initiative !== null) return 1
    if (left.initiative !== null && right.initiative === null) return -1

    if (
      left.initiative !== null &&
      right.initiative !== null &&
      right.initiative !== left.initiative
    ) {
      return right.initiative - left.initiative
    }

    if (left.tieOrder !== right.tieOrder) {
      return left.tieOrder - right.tieOrder
    }

    return left.actorId.localeCompare(right.actorId)
  })
}

export function normalizeCombatState(
  value: unknown,
  validActorIds?: Iterable<string>,
): CombatState {
  if (!value || typeof value !== 'object') {
    return { ...INACTIVE_COMBAT_STATE }
  }

  const raw = value as Partial<CombatState>
  const validIds = validActorIds ? new Set(validActorIds) : null
  const seen = new Set<string>()
  const rawCombatants = Array.isArray(raw.combatants) ? raw.combatants : []

  const combatants = sortCombatants(
    rawCombatants
      .map((entry, index): CombatantEntry | null => {
        if (!entry || typeof entry !== 'object') {
          return null
        }

        const candidate = entry as Partial<CombatantEntry>
        const actorId = String(candidate.actorId ?? '').trim()

        if (
          !actorId ||
          seen.has(actorId) ||
          (validIds && !validIds.has(actorId))
        ) {
          return null
        }

        seen.add(actorId)

        return {
          actorId,
          initiative: normalizeInitiative(candidate.initiative),
          tieOrder: finiteInteger(candidate.tieOrder, index),
          initiativeSource: normalizeInitiativeSource(candidate.initiativeSource),
        }
      })
      .filter((entry): entry is CombatantEntry => entry !== null),
  )

  if (combatants.length === 0) {
    return { ...INACTIVE_COMBAT_STATE }
  }

  const requestedPhase = raw.phase
  const legacyActive = raw.active === true
  const isLegacyV1Combat =
    requestedPhase !== 'setup' &&
    requestedPhase !== 'active' &&
    legacyActive

  if (isLegacyV1Combat) {
    return {
      phase: 'setup',
      active: true,
      round: 0,
      currentTurnIndex: -1,
      currentActorId: null,
      combatants: combatants.map((entry, index) => ({
        actorId: entry.actorId,
        initiative: null,
        tieOrder: index,
        initiativeSource: null,
      })),
      startedAt:
        typeof raw.startedAt === 'string' && raw.startedAt
          ? raw.startedAt
          : null,
    }
  }

  const phase =
    requestedPhase === 'setup' || requestedPhase === 'active'
      ? requestedPhase
      : 'inactive'

  if (phase === 'inactive') {
    return {
      ...INACTIVE_COMBAT_STATE,
      combatants,
    }
  }

  const startedAt =
    typeof raw.startedAt === 'string' && raw.startedAt
      ? raw.startedAt
      : null

  if (phase === 'setup') {
    return {
      phase: 'setup',
      active: true,
      round: 0,
      currentTurnIndex: -1,
      currentActorId: null,
      combatants,
      startedAt,
    }
  }

  const readyCombatants = combatants.filter(
    (entry) => entry.initiative !== null,
  )

  if (readyCombatants.length !== combatants.length) {
    return {
      phase: 'setup',
      active: true,
      round: 0,
      currentTurnIndex: -1,
      currentActorId: null,
      combatants,
      startedAt,
    }
  }

  const requestedActorId =
    typeof raw.currentActorId === 'string' && raw.currentActorId
      ? raw.currentActorId
      : null

  const explicitlyHiddenCurrentTurn =
    raw.currentActorId === null &&
    finiteInteger(raw.currentTurnIndex, 0) < 0

  if (explicitlyHiddenCurrentTurn) {
    return {
      phase: 'active',
      active: true,
      round: Math.max(1, finiteInteger(raw.round, 1)),
      currentTurnIndex: -1,
      currentActorId: null,
      combatants,
      startedAt,
    }
  }

  let currentTurnIndex = finiteInteger(raw.currentTurnIndex, 0)

  if (requestedActorId) {
    const actorIndex = combatants.findIndex(
      (entry) => entry.actorId === requestedActorId,
    )

    if (actorIndex >= 0) {
      currentTurnIndex = actorIndex
    }
  }

  currentTurnIndex = Math.max(
    0,
    Math.min(combatants.length - 1, currentTurnIndex),
  )

  return {
    phase: 'active',
    active: true,
    round: Math.max(1, finiteInteger(raw.round, 1)),
    currentTurnIndex,
    currentActorId: combatants[currentTurnIndex]?.actorId ?? null,
    combatants,
    startedAt,
  }
}

export function prepareCombatState(
  actors: Actor[],
  actorIds: string[],
  startedAt = new Date().toISOString(),
): CombatState {
  const actorMap = new Map(actors.map((actor) => [actor.id, actor]))
  const selectedActors = [...new Set(actorIds)]
    .map((actorId) => actorMap.get(actorId))
    .filter((actor): actor is Actor => Boolean(actor))

  if (selectedActors.length === 0) {
    return { ...INACTIVE_COMBAT_STATE }
  }

  return {
    phase: 'setup',
    active: true,
    round: 0,
    currentTurnIndex: -1,
    currentActorId: null,
    combatants: selectedActors.map((actor, index) => ({
      actorId: actor.id,
      initiative: null,
      tieOrder: index,
      initiativeSource: null,
    })),
    startedAt,
  }
}

export function beginCombatState(combat: CombatState): CombatState {
  const normalized = normalizeCombatState(combat)

  if (normalized.phase !== 'setup' || normalized.combatants.length === 0) {
    return normalized
  }

  if (normalized.combatants.some((entry) => entry.initiative === null)) {
    return normalized
  }

  const combatants = sortCombatants(normalized.combatants)

  return {
    ...normalized,
    phase: 'active',
    active: true,
    round: 1,
    currentTurnIndex: 0,
    currentActorId: combatants[0]?.actorId ?? null,
    combatants,
  }
}

export function setCombatantInitiative(
  combat: CombatState,
  actorId: string,
  initiative: number,
  initiativeSource: Exclude<InitiativeSource, null> = 'manual',
): CombatState {
  const normalized = normalizeCombatState(combat)

  if (!normalized.combatants.some((entry) => entry.actorId === actorId)) {
    return normalized
  }

  const currentActorId = normalized.currentActorId
  const combatants = sortCombatants(
    normalized.combatants.map((entry) =>
      entry.actorId === actorId
        ? {
            ...entry,
            initiative: clampInitiative(initiative),
            initiativeSource,
          }
        : entry,
    ),
  )

  if (normalized.phase === 'setup') {
    return {
      ...normalized,
      combatants,
    }
  }

  const currentTurnIndex = currentActorId
    ? combatants.findIndex((entry) => entry.actorId === currentActorId)
    : 0

  return {
    ...normalized,
    combatants,
    currentTurnIndex: Math.max(0, currentTurnIndex),
    currentActorId:
      currentActorId && currentTurnIndex >= 0
        ? currentActorId
        : combatants[0]?.actorId ?? null,
  }
}

export function moveTiedCombatant(
  combat: CombatState,
  actorId: string,
  direction: 'up' | 'down',
): CombatState {
  const normalized = normalizeCombatState(combat)
  const combatants = [...normalized.combatants]
  const index = combatants.findIndex((entry) => entry.actorId === actorId)

  if (index < 0) {
    return normalized
  }

  const adjacentIndex = direction === 'up' ? index - 1 : index + 1
  const adjacent = combatants[adjacentIndex]
  const current = combatants[index]

  if (
    !adjacent ||
    current.initiative === null ||
    adjacent.initiative === null ||
    adjacent.initiative !== current.initiative
  ) {
    return normalized
  }

  const currentTieOrder = current.tieOrder

  combatants[index] = {
    ...current,
    tieOrder: adjacent.tieOrder,
  }

  combatants[adjacentIndex] = {
    ...adjacent,
    tieOrder: currentTieOrder,
  }

  const sorted = sortCombatants(combatants)
  const currentActorId = normalized.currentActorId

  if (normalized.phase === 'setup') {
    return {
      ...normalized,
      combatants: sorted,
    }
  }

  const currentTurnIndex = currentActorId
    ? sorted.findIndex((entry) => entry.actorId === currentActorId)
    : 0

  return {
    ...normalized,
    combatants: sorted,
    currentTurnIndex: Math.max(0, currentTurnIndex),
    currentActorId:
      currentActorId && currentTurnIndex >= 0
        ? currentActorId
        : sorted[0]?.actorId ?? null,
  }
}

export function advanceCombatTurn(combat: CombatState): CombatState {
  const normalized = normalizeCombatState(combat)

  if (normalized.phase !== 'active' || normalized.combatants.length === 0) {
    return normalized
  }

  const nextIndex = normalized.currentTurnIndex + 1
  const wrapped = nextIndex >= normalized.combatants.length
  const currentTurnIndex = wrapped ? 0 : nextIndex

  return {
    ...normalized,
    round: wrapped ? normalized.round + 1 : normalized.round,
    currentTurnIndex,
    currentActorId:
      normalized.combatants[currentTurnIndex]?.actorId ?? null,
  }
}

export function rewindCombatTurn(combat: CombatState): CombatState {
  const normalized = normalizeCombatState(combat)

  if (normalized.phase !== 'active' || normalized.combatants.length === 0) {
    return normalized
  }

  const previousIndex = normalized.currentTurnIndex - 1
  const wrapped = previousIndex < 0
  const currentTurnIndex = wrapped
    ? normalized.combatants.length - 1
    : previousIndex

  return {
    ...normalized,
    round:
      wrapped && normalized.round > 1
        ? normalized.round - 1
        : normalized.round,
    currentTurnIndex,
    currentActorId:
      normalized.combatants[currentTurnIndex]?.actorId ?? null,
  }
}

export function endCombatState(): CombatState {
  return { ...INACTIVE_COMBAT_STATE }
}
