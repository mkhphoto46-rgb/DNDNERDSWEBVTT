import assert from 'node:assert/strict'
import test from 'node:test'

import { createBlankPlayerActor } from './actors'
import {
  actorAttackLimit,
  applyTurnEconomyOverride,
  combatMovementBudgetApplies,
  endTurnEconomy,
  freshTurnEconomy,
  movementAllowanceFeet,
  standUpMovementCostFeet,
  normalizeTurnEconomy,
  useAttackFromAction,
  useDash,
  useDisengage,
  useDodge,
} from './actionEconomy'

function fighter(level: number) {
  const actor = createBlankPlayerActor({ id: 'fighter', name: 'Fighter', ownerId: 'p1' })
  actor.level = level
  if (actor.characterSheet) actor.characterSheet.className = 'Fighter'
  return actor
}

test('Stage 05R action economy derives Extra Attack without granting extra Actions', () => {
  assert.equal(actorAttackLimit(fighter(4)), 1)
  assert.equal(actorAttackLimit(fighter(5)), 2)
  assert.equal(actorAttackLimit(fighter(11)), 3)
  assert.equal(actorAttackLimit(fighter(20)), 4)

  const start = freshTurnEconomy(fighter(11))
  const first = useAttackFromAction(start)
  const second = useAttackFromAction(first)
  const third = useAttackFromAction(second)
  assert.equal(third.actionUsed, 1)
  assert.equal(third.attackActionsUsed, 1)
  assert.equal(third.attacksUsed, 3)
})


test('a granted extra Action starts a second independent Attack action with a fresh Extra Attack budget', () => {
  const actor = fighter(5)
  let state = applyTurnEconomyOverride(freshTurnEconomy(actor), {
    actionMax: 2,
  })

  state = useAttackFromAction(state)
  assert.equal(state.actionUsed, 1)
  assert.equal(state.attackActionsUsed, 1)
  assert.equal(state.attacksUsed, 1)

  state = useAttackFromAction(state)
  assert.equal(state.actionUsed, 1)
  assert.equal(state.attackActionsUsed, 1)
  assert.equal(state.attacksUsed, 2)

  state = useAttackFromAction(state)
  assert.equal(state.actionUsed, 2)
  assert.equal(state.attackActionsUsed, 2)
  assert.equal(state.attacksUsed, 1)

  state = useAttackFromAction(state)
  assert.equal(state.actionUsed, 2)
  assert.equal(state.attackActionsUsed, 2)
  assert.equal(state.attacksUsed, 2)

  assert.throws(
    () => useAttackFromAction(state),
    /no Action is available to start another Attack action/i,
  )
})

test('a creature without Extra Attack can use each granted Action for a separate Attack action', () => {
  const actor = fighter(4)
  let state = applyTurnEconomyOverride(freshTurnEconomy(actor), {
    actionMax: 2,
  })

  state = useAttackFromAction(state)
  assert.equal(state.actionUsed, 1)
  assert.equal(state.attackActionsUsed, 1)
  assert.equal(state.attacksUsed, 1)

  state = useAttackFromAction(state)
  assert.equal(state.actionUsed, 2)
  assert.equal(state.attackActionsUsed, 2)
  assert.equal(state.attacksUsed, 1)
})

test('remaining attacks in the current Attack action survive spending a different extra Action', () => {
  const actor = fighter(5)
  actor.speedFeet = 30
  let state = applyTurnEconomyOverride(freshTurnEconomy(actor), {
    actionMax: 2,
  })

  state = useAttackFromAction(state)
  state = useDash(state, actor)
  assert.equal(state.actionUsed, 2)
  assert.equal(state.attackActionsUsed, 1)
  assert.equal(state.attacksUsed, 1)

  state = useAttackFromAction(state)
  assert.equal(state.actionUsed, 2)
  assert.equal(state.attackActionsUsed, 1)
  assert.equal(state.attacksUsed, 2)
})

test('legacy persisted attack state migrates to one started Attack action', () => {
  const actor = fighter(5)
  const migrated = normalizeTurnEconomy({
    actorId: actor.id,
    actionMax: 2,
    actionUsed: 1,
    attackLimit: 2,
    attacksUsed: 1,
  }, actor)

  assert.equal(migrated.actionUsed, 1)
  assert.equal(migrated.attackActionsUsed, 1)
  assert.equal(migrated.attacksUsed, 1)
})

test('Stage 06 Dash spends the chosen resource and extends current movement budget', () => {
  const actor = fighter(5)
  actor.speedFeet = 30
  const start = freshTurnEconomy(actor)
  const dashed = useDash(start, actor)
  assert.equal(dashed.actionUsed, 1)
  assert.equal(movementAllowanceFeet(actor, dashed), 60)
})

test('Stage 06 Disengage is tracked for the rest of the turn', () => {
  const actor = fighter(5)
  const state = useDisengage(freshTurnEconomy(actor))
  assert.equal(state.actionUsed, 1)
  assert.equal(state.disengaged, true)
})

test('DM override can grant or remove Action Economy without mutating base actor rules', () => {
  const actor = fighter(5)
  const state = freshTurnEconomy(actor)
  const overridden = applyTurnEconomyOverride(state, {
    actionMax: 3,
    actionUsed: 1,
    bonusActionMax: 0,
    reactionUsed: 1,
    movementOverrideFeet: 95,
    attackLimit: 5,
  })

  assert.equal(overridden.actionMax, 3)
  assert.equal(overridden.actionUsed, 1)
  assert.equal(overridden.bonusActionMax, 0)
  assert.equal(overridden.reactionUsed, 1)
  assert.equal(movementAllowanceFeet(actor, overridden), 95)
  assert.equal(overridden.attackLimit, 5)
})


test('Dodge consumes one Action and keeps a rules state until the actor next resets', () => {
  const actor = fighter(5)
  const state = useDodge(freshTurnEconomy(actor))
  assert.equal(state.actionUsed, 1)
  assert.equal(state.dodging, true)
})

test('end-turn lifecycle clears end-of-turn flags but preserves Dodge until the next start turn', () => {
  const actor = fighter(5)
  actor.speedFeet = 30

  let state = applyTurnEconomyOverride(freshTurnEconomy(actor), {
    actionMax: 3,
    reactionUsed: 1,
    movementOverrideFeet: 95,
  })
  state = useDash(state, actor)
  state = useDisengage(state)
  state = useDodge(state)

  const ended = endTurnEconomy(state, '2026-09-21T00:00:00.000Z')

  assert.equal(ended.ended, true)
  assert.equal(ended.disengaged, false)
  assert.equal(ended.dodging, true)
  assert.equal(ended.movementBonusFeet, 0)
  assert.equal(ended.movementOverrideFeet, null)
  assert.equal(ended.reactionUsed, 1)
  assert.equal(ended.updatedAt, '2026-09-21T00:00:00.000Z')
})

test('start-turn reset refreshes Reaction and expires prior Dodge state', () => {
  const actor = fighter(5)
  const previous = endTurnEconomy(
    applyTurnEconomyOverride(useDodge(freshTurnEconomy(actor)), {
      reactionUsed: 1,
    }),
  )
  const nextTurn = freshTurnEconomy(actor, '2026-09-21T00:01:00.000Z')

  assert.equal(previous.dodging, true)
  assert.equal(previous.reactionUsed, 1)
  assert.equal(previous.ended, true)

  assert.equal(nextTurn.dodging, false)
  assert.equal(nextTurn.disengaged, false)
  assert.equal(nextTurn.reactionUsed, 0)
  assert.equal(nextTurn.turnStartedAt, '2026-09-21T00:01:00.000Z')
  assert.equal(nextTurn.spellSlotExpendedTurnKey, null)
  assert.equal(nextTurn.actionUsed, 0)
  assert.equal(nextTurn.bonusActionUsed, 0)
  assert.equal(nextTurn.attackActionsUsed, 0)
  assert.equal(nextTurn.attacksUsed, 0)
  assert.equal(nextTurn.movementBonusFeet, 0)
  assert.equal(nextTurn.movementOverrideFeet, null)
  assert.equal(nextTurn.ended, false)
})

test('movement budget applies only to the active combatant during active combat', () => {
  assert.equal(combatMovementBudgetApplies(false, null, 'fighter'), false)
  assert.equal(combatMovementBudgetApplies(false, 'fighter', 'fighter'), false)
  assert.equal(combatMovementBudgetApplies(true, 'enemy', 'fighter'), false)
  assert.equal(combatMovementBudgetApplies(true, 'fighter', 'fighter'), true)
})

test('Stand Up costs half Speed and Dash does not increase that cost', () => {
  const actor = fighter(5)
  actor.speedFeet = 30

  const start = freshTurnEconomy(actor)
  const dashed = useDash(start, actor)

  assert.equal(movementAllowanceFeet(actor, start), 30)
  assert.equal(movementAllowanceFeet(actor, dashed), 60)
  assert.equal(standUpMovementCostFeet(actor), 15)
})

test('Stand Up is rejected while effective Speed is 0', () => {
  const actor = fighter(5)
  actor.speedFeet = 30
  actor.conditions = [...actor.conditions, 'Restrained']

  assert.throws(
    () => standUpMovementCostFeet(actor),
    /cannot stand while Speed is 0/i,
  )
})



test('legacy turn economy gains a stable turn identity and no stale spell-slot marker by default', () => {
  const actor = fighter(5)
  const migrated = normalizeTurnEconomy({
    actorId: actor.id,
    updatedAt: '2026-09-21T00:02:00.000Z',
    actionUsed: 1,
  }, actor)

  assert.equal(migrated.turnStartedAt, '2026-09-21T00:02:00.000Z')
  assert.equal(migrated.spellSlotExpendedTurnKey, null)
})
