import assert from 'node:assert/strict'
import test from 'node:test'

import {
  activeMapTokenForActor,
  actorGridDistanceFeet,
  validateAttackRange,
  visibleActorIdsForActiveMap,
} from './targetingValidation'

const tokens = [
  { actorId: 'a', mapId: 'map-a', visible: true, gridX: 1, gridY: 1 },
  { actorId: 'b', mapId: 'map-a', visible: true, gridX: 4, gridY: 2 },
  { actorId: 'c', mapId: 'map-b', visible: true, gridX: 2, gridY: 2 },
  { actorId: 'hidden', mapId: 'map-a', visible: false, gridX: 2, gridY: 2 },
]

test('targeting requires an active map and never falls back to tokens from another map', () => {
  assert.equal(activeMapTokenForActor('', tokens, 'a'), null)
  assert.equal(activeMapTokenForActor('map-a', tokens, 'c'), null)
  assert.equal(activeMapTokenForActor('map-a', tokens, 'hidden'), null)
  assert.equal(activeMapTokenForActor('map-a', tokens, 'a')?.actorId, 'a')
  assert.deepEqual([...visibleActorIdsForActiveMap('', tokens)], [])
  assert.deepEqual([...visibleActorIdsForActiveMap('map-a', tokens)].sort(), ['a', 'b'])
})

test('distance is unresolved unless both visible tokens are on the same active map', () => {
  assert.equal(actorGridDistanceFeet('map-a', tokens, 'a', 'b'), 15)
  assert.equal(actorGridDistanceFeet('map-a', tokens, 'a', 'c'), null)
  assert.equal(actorGridDistanceFeet('', tokens, 'a', 'b'), null)
})

test('attack range rejects unresolved/out-of-range targets and marks legal long range as disadvantage', () => {
  assert.deepEqual(validateAttackRange(null, 30, 120), { legal: false, mode: null, maxRangeFeet: 120 })
  assert.deepEqual(validateAttackRange(30, 30, 120), { legal: true, mode: 'normal', maxRangeFeet: 120 })
  assert.deepEqual(validateAttackRange(35, 30, 120), { legal: true, mode: 'disadvantage', maxRangeFeet: 120 })
  assert.deepEqual(validateAttackRange(125, 30, 120), { legal: false, mode: null, maxRangeFeet: 120 })
  assert.deepEqual(validateAttackRange(10, 5, null), { legal: false, mode: null, maxRangeFeet: 5 })
})
