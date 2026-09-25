import assert from 'node:assert/strict'
import test from 'node:test'

import { createBlankPlayerActor } from './actors'
import { freshTurnEconomy, spendTurnResource } from './actionEconomy'
import {
  assertCanExpendSpellSlotThisTurn,
  markSpellSlotExpendedForTurn,
  reactionSpellRequiresReactionWindow,
  spellSlotAlreadyExpendedThisTurn,
  spellTurnKeyForCombat,
  spellTurnResource,
} from './spellActionEconomy'

test('spell casting time maps to authoritative turn resources', () => {
  assert.equal(spellTurnResource('1 Action'), 'action')
  assert.equal(spellTurnResource('Bonus Action'), 'bonus-action')
  assert.equal(spellTurnResource('Reaction, which you take when hit'), 'reaction')
  assert.equal(spellTurnResource('1 Minute'), null)
  assert.equal(reactionSpellRequiresReactionWindow('Reaction, when hit'), true)
  assert.equal(reactionSpellRequiresReactionWindow('1 Action'), false)
})

test('combat turn key remains stable while resources are spent inside the same turn', () => {
  const actor = createBlankPlayerActor({ id: 'caster', name: 'Caster', ownerId: 'p1' })
  const start = freshTurnEconomy(actor, '2026-09-21T03:30:00.000Z')
  const combat = { active: true, round: 2, currentTurnIndex: 1, currentActorId: actor.id }
  const before = spellTurnKeyForCombat(combat, start)
  const after = spellTurnKeyForCombat(combat, spendTurnResource(start, 'action'))
  assert.equal(before, after)
  assert.match(before ?? '', /caster:2026-09-21T03:30:00\.000Z$/)
})

test('only one spell slot can be expended on the same combat turn', () => {
  const actor = createBlankPlayerActor({ id: 'caster', name: 'Caster', ownerId: 'p1' })
  const start = freshTurnEconomy(actor, '2026-09-21T03:31:00.000Z')
  const turnKey = '2:1:enemy:2026-09-21T03:31:00.000Z'
  const marked = markSpellSlotExpendedForTurn(start, turnKey, true)
  assert.equal(spellSlotAlreadyExpendedThisTurn(marked, turnKey), true)
  assert.throws(() => assertCanExpendSpellSlotThisTurn(marked, turnKey), /only one spell slot/i)
  assert.doesNotThrow(() => assertCanExpendSpellSlotThisTurn(marked, `${turnKey}:next`))
})

test('cantrips and out-of-combat casts do not mark the per-turn spell-slot gate', () => {
  const actor = createBlankPlayerActor({ id: 'caster', name: 'Caster', ownerId: 'p1' })
  const start = freshTurnEconomy(actor)
  assert.equal(markSpellSlotExpendedForTurn(start, 'turn-1', false), start)
  assert.equal(markSpellSlotExpendedForTurn(start, null, true), start)
})
