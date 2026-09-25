import assert from 'node:assert/strict'
import test from 'node:test'

import { createBlankPlayerActor } from './actors'

test('a new player character starts owned, editable and with a usable default token portrait', () => {
  const actor = createBlankPlayerActor({
    id: 'actor-player-1',
    name: 'Arin',
    ownerId: 'player-1',
  })

  assert.equal(actor.kind, 'player')
  assert.equal(actor.ownerId, 'player-1')
  assert.equal(actor.name, 'Arin')
  assert.equal(actor.portraitAssetId, 'builtin:adventurer-token')
  assert.equal(actor.portraitUrl, '/assets/tokens/adventurer-token.svg')
  assert.ok(actor.characterSheet)
  assert.deepEqual(actor.characterSheet?.knownSpellIds, [])
  assert.deepEqual(actor.characterSheet?.preparedSpellIds, [])
})
