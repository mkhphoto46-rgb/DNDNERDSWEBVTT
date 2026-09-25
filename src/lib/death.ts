import {
  type Actor,
  type ActorLifeState,
  type DeathRulesMode,
} from '../types/actor'

import {
  normalizeActor,
} from './actors'

export type DeathSaveOutcome =
  | 'success'
  | 'failure'
  | 'stable'
  | 'dead'
  | 'revived'

export interface DeathSaveResolution {
  rawRoll: number
  modifier: number
  total: number
  outcome: DeathSaveOutcome
  successesBefore: number
  successesAfter: number
  failuresBefore: number
  failuresAfter: number
  lifeStateBefore: ActorLifeState
  lifeStateAfter: ActorLifeState
  currentHpBefore: number
  currentHpAfter: number
  failuresAdded: number
  successesAdded: number
}

function clampD20(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(20, Math.round(parsed)))
    : 1
}

export function needsDeathSave(
  actor: Pick<Actor, 'currentHp' | 'lifeState' | 'deathRules'>,
): boolean {
  return actor.deathRules === 'character' &&
    actor.currentHp === 0 &&
    actor.lifeState === 'unconscious'
}

export function applyLifeStateOverride(
  actorInput: Actor,
  lifeState: ActorLifeState,
): Actor {
  const actor = normalizeActor(actorInput)

  if (lifeState === 'conscious') {
    return normalizeActor({
      ...actor,
      currentHp: Math.max(1, actor.currentHp),
      lifeState: 'conscious',
      deathSaveSuccesses: 0,
      deathSaveFailures: 0,
      lastDeathSaveRound: null,
    })
  }

  if (lifeState === 'stable') {
    return normalizeActor({
      ...actor,
      currentHp: 0,
      lifeState: 'stable',
      deathRules: 'character',
      deathSaveSuccesses: 0,
      deathSaveFailures: 0,
      lastDeathSaveRound: null,
    })
  }

  if (lifeState === 'unconscious') {
    return normalizeActor({
      ...actor,
      currentHp: 0,
      lifeState: 'unconscious',
      deathRules: 'character',
      deathSaveSuccesses: Math.min(2, actor.deathSaveSuccesses),
      deathSaveFailures: Math.min(2, actor.deathSaveFailures),
      lastDeathSaveRound: null,
    })
  }

  return normalizeActor({
    ...actor,
    currentHp: 0,
    lifeState: 'dead',
    lastDeathSaveRound: null,
  })
}

export function applyDeathRulesOverride(
  actorInput: Actor,
  deathRules: DeathRulesMode,
): Actor {
  const actor = normalizeActor(actorInput)
  const effectiveRules = actor.kind === 'player' ? 'character' : deathRules

  if (effectiveRules === 'monster') {
    return normalizeActor({
      ...actor,
      deathRules: 'monster',
      lifeState: actor.currentHp > 0 ? 'conscious' : 'dead',
      deathSaveSuccesses: 0,
      deathSaveFailures: 0,
      lastDeathSaveRound: null,
    })
  }

  return normalizeActor({
    ...actor,
    deathRules: 'character',
    lifeState:
      actor.currentHp > 0
        ? 'conscious'
        : actor.lifeState === 'dead'
          ? 'unconscious'
          : actor.lifeState,
    deathSaveSuccesses: actor.currentHp > 0 ? 0 : Math.min(2, actor.deathSaveSuccesses),
    deathSaveFailures: actor.currentHp > 0 ? 0 : Math.min(2, actor.deathSaveFailures),
    lastDeathSaveRound: null,
  })
}

export function resolveDeathSave(
  actorInput: Actor,
  rawRollInput: number,
  combatRound: number | null = null,
  saveModifierInput = 0,
): {
  actor: Actor
  resolution: DeathSaveResolution
} {
  const actor = normalizeActor(actorInput)

  if (!needsDeathSave(actor)) {
    throw new Error('This Actor does not currently need a Death Saving Throw.')
  }

  const rawRoll = clampD20(rawRollInput)
  const saveModifier = Math.max(-100, Math.min(100, Math.round(Number(saveModifierInput) || 0)))
  const total = rawRoll + saveModifier
  const successesBefore = actor.deathSaveSuccesses
  const failuresBefore = actor.deathSaveFailures
  const lifeStateBefore = actor.lifeState
  const currentHpBefore = actor.currentHp

  let successesAfter = successesBefore
  let failuresAfter = failuresBefore
  let lifeStateAfter: ActorLifeState = 'unconscious'
  let currentHpAfter = 0
  let outcome: DeathSaveOutcome
  let failuresAdded = 0
  let successesAdded = 0

  if (rawRoll === 20) {
    outcome = 'revived'
    currentHpAfter = 1
    lifeStateAfter = 'conscious'
    successesAfter = 0
    failuresAfter = 0
  } else if (rawRoll === 1) {
    failuresAdded = 2
    failuresAfter = Math.min(3, failuresBefore + 2)
    if (failuresAfter >= 3) {
      outcome = 'dead'
      lifeStateAfter = 'dead'
    } else {
      outcome = 'failure'
    }
  } else if (total >= 10) {
    successesAdded = 1
    successesAfter = Math.min(3, successesBefore + 1)
    if (successesAfter >= 3) {
      outcome = 'stable'
      lifeStateAfter = 'stable'
      successesAfter = 0
      failuresAfter = 0
    } else {
      outcome = 'success'
    }
  } else {
    failuresAdded = 1
    failuresAfter = Math.min(3, failuresBefore + 1)
    if (failuresAfter >= 3) {
      outcome = 'dead'
      lifeStateAfter = 'dead'
    } else {
      outcome = 'failure'
    }
  }

  const actorAfter = normalizeActor({
    ...actor,
    currentHp: currentHpAfter,
    lifeState: lifeStateAfter,
    deathSaveSuccesses: successesAfter,
    deathSaveFailures: failuresAfter,
    lastDeathSaveRound:
      lifeStateAfter === 'unconscious' && combatRound && combatRound > 0
        ? Math.round(combatRound)
        : null,
  })

  return {
    actor: actorAfter,
    resolution: {
      rawRoll,
      modifier: saveModifier,
      total,
      outcome,
      successesBefore,
      successesAfter: actorAfter.deathSaveSuccesses,
      failuresBefore,
      failuresAfter: actorAfter.deathSaveFailures,
      lifeStateBefore,
      lifeStateAfter: actorAfter.lifeState,
      currentHpBefore,
      currentHpAfter: actorAfter.currentHp,
      failuresAdded,
      successesAdded,
    },
  }
}
