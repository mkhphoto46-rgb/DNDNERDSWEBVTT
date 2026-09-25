import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createBlankPlayerActor,
  normalizeActor,
} from './actors'

import {
  savingThrowModifier,
  skillModifier,
} from './characterSheet'

test('player character derives proficiency bonus and initiative from level and Dexterity', () => {
  const actor = createBlankPlayerActor({
    id: 'actor-player-1',
    name: 'Kael',
    ownerId: 'player-1',
  })

  const updated = normalizeActor({
    ...actor,
    level: 5,
    abilities: {
      ...actor.abilities,
      dexterity: 16,
      wisdom: 14,
    },
  })

  assert.equal(updated.proficiencyBonus, 3)
  assert.equal(updated.initiativeBonus, 3)
})

test('saving throw proficiency and skill expertise are derived automatically', () => {
  const base = createBlankPlayerActor({
    id: 'actor-player-2',
    name: 'Mara',
    ownerId: 'player-2',
  })

  const actor = normalizeActor({
    ...base,
    level: 5,
    abilities: {
      ...base.abilities,
      dexterity: 16,
      wisdom: 14,
    },
    characterSheet: {
      ...base.characterSheet!,
      savingThrowProficiencies: ['dexterity'],
      skillProficiencies: ['perception', 'stealth'],
      skillExpertise: ['stealth'],
    },
  })

  assert.equal(savingThrowModifier(actor, 'dexterity'), 6)
  assert.equal(skillModifier(actor, 'perception'), 5)
  assert.equal(skillModifier(actor, 'stealth'), 9)
})

test('assigning an owner makes an actor player-controlled and derives player initiative', () => {
  const actor = normalizeActor({
    ...createBlankPlayerActor({
      id: 'actor-owner-normalize',
      name: 'Owned Hero',
      ownerId: 'player-owner',
    }),
    kind: 'enemy',
    abilities: {
      strength: 10,
      dexterity: 14,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    },
  })

  assert.equal(actor.kind, 'player')
  assert.equal(actor.ownerId, 'player-owner')
  assert.equal(actor.initiativeBonus, 2)
  assert.ok(actor.characterSheet)
})

test('an unowned enemy remains DM-controlled', () => {
  const actor = normalizeActor({
    ...createBlankPlayerActor({
      id: 'actor-dm-controlled',
      name: 'DM Enemy',
      ownerId: 'temporary-player',
    }),
    kind: 'enemy',
    ownerId: null,
    characterSheet: null,
    initiativeBonus: 4,
  })

  assert.equal(actor.kind, 'enemy')
  assert.equal(actor.ownerId, null)
  assert.equal(actor.initiativeBonus, 4)
})
