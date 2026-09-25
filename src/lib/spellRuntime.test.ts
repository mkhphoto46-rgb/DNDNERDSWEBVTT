import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canSpendSpellSlot,
  normalizeRequestedCastLevel,
  spellSlotPool,
  spendSpellSlot,
} from './spellRuntime'

test('full casters receive the standard slot progression', () => {
  assert.deepEqual(spellSlotPool('Wizard', 1).slots, [2])
  assert.deepEqual(spellSlotPool('Cleric', 5).slots, [4, 3, 2])
  assert.deepEqual(spellSlotPool('Druid', 20).slots, [4, 3, 3, 3, 3, 2, 2, 1, 1])
})

test('half casters and pact magic use their own progression', () => {
  assert.deepEqual(spellSlotPool('Paladin', 5).slots, [4, 2])
  assert.deepEqual(spellSlotPool('Ranger', 9).slots, [4, 3, 2])
  assert.deepEqual(spellSlotPool('Warlock', 5), {
    kind: 'pact',
    slots: [0, 0, 2],
    pactSlotLevel: 3,
  })
})

test('slot spending is bounded and cantrips never consume a slot', () => {
  const maximum = [4, 3, 2]
  const spent = spendSpellSlot(maximum, [0, 2, 0], 2)
  assert.deepEqual(spent, [0, 3, 0])
  assert.equal(canSpendSpellSlot(maximum, spent, 2), false)
  assert.deepEqual(spendSpellSlot(maximum, spent, 2), spent)
  assert.deepEqual(spendSpellSlot(maximum, spent, 0), spent)
})


test('requested cast level is validated instead of silently trusting or clamping client input', () => {
  assert.equal(normalizeRequestedCastLevel(0, 9), 0)
  assert.equal(normalizeRequestedCastLevel(1, undefined), 1)
  assert.equal(normalizeRequestedCastLevel(3, '5'), 5)
  assert.throws(() => normalizeRequestedCastLevel(3, 2), /integer from 3 to 9/i)
  assert.throws(() => normalizeRequestedCastLevel(3, 10), /integer from 3 to 9/i)
  assert.throws(() => normalizeRequestedCastLevel(3, 4.5), /integer from 3 to 9/i)
})


test('Artificer and edition-aware half casters use the correct basic slot progression', () => {
  assert.deepEqual(spellSlotPool('Artificer', 1, '2014').slots, [2])
  assert.deepEqual(spellSlotPool('Artificer', 5, '2014').slots, [4, 2])
  assert.deepEqual(spellSlotPool('Ranger', 1, '2014').slots, [])
  assert.deepEqual(spellSlotPool('Paladin', 1, '2014').slots, [])
  assert.deepEqual(spellSlotPool('Ranger', 2, '2014').slots, [2])
  assert.deepEqual(spellSlotPool('Ranger', 1, '2024').slots, [2])
})
