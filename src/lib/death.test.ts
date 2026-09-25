import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyDeathRulesOverride,
  applyLifeStateOverride,
  needsDeathSave,
  resolveDeathSave,
} from './death'

import {
  normalizeActor,
} from './actors'

import type { Actor } from '../types/actor'

function actor(overrides: Partial<Actor> = {}): Actor {
  return normalizeActor({
    id: 'hero',
    name: 'Hero',
    kind: 'player',
    ownerId: 'player-1',
    portraitAssetId: '',
    portraitUrl: '',
    level: 1,
    challengeRating: null,
    currentHp: 0,
    maxHp: 20,
    tempHp: 0,
    lifeState: 'unconscious',
    deathSaveSuccesses: 0,
    deathSaveFailures: 0,
    deathRules: 'character',
    lastDeathSaveRound: null,
    ac: 10,
    speedFeet: 30,
    initiativeBonus: 0,
    proficiencyBonus: 2,
    abilities: {
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    },
    conditions: [],
    resources: [],
    damageResistances: [],
    damageImmunities: [],
    damageVulnerabilities: [],
    sourceTemplateId: null,
    source: null,
    creatureSize: 'Medium',
    creatureType: 'humanoid',
    hitPointFormula: '',
    monsterStatBlock: null,
    characterSheet: null,
    gmNotes: '',
    ...overrides,
  })
}

test('an unconscious character at 0 HP needs a death save', () => {
  assert.equal(needsDeathSave(actor()), true)
  assert.equal(needsDeathSave(actor({ lifeState: 'stable' })), false)
  assert.equal(needsDeathSave(actor({ currentHp: 3 })), false)
})

test('10 or higher records one death save success', () => {
  const result = resolveDeathSave(actor(), 14, 2)
  assert.equal(result.resolution.outcome, 'success')
  assert.equal(result.actor.deathSaveSuccesses, 1)
  assert.equal(result.actor.lastDeathSaveRound, 2)
})

test('a natural 1 records two death save failures', () => {
  const result = resolveDeathSave(actor(), 1, 1)
  assert.equal(result.resolution.outcome, 'failure')
  assert.equal(result.actor.deathSaveFailures, 2)
})

test('a natural 20 restores 1 HP and consciousness', () => {
  const result = resolveDeathSave(actor({ deathSaveFailures: 2 }), 20, 3)
  assert.equal(result.resolution.outcome, 'revived')
  assert.equal(result.actor.currentHp, 1)
  assert.equal(result.actor.lifeState, 'conscious')
  assert.equal(result.actor.deathSaveFailures, 0)
})

test('third success stabilizes and resets death save counters', () => {
  const result = resolveDeathSave(actor({ deathSaveSuccesses: 2 }), 10, 4)
  assert.equal(result.resolution.outcome, 'stable')
  assert.equal(result.actor.lifeState, 'stable')
  assert.equal(result.actor.deathSaveSuccesses, 0)
  assert.equal(result.actor.deathSaveFailures, 0)
})

test('third failure kills the character', () => {
  const result = resolveDeathSave(actor({ deathSaveFailures: 2 }), 4, 4)
  assert.equal(result.resolution.outcome, 'dead')
  assert.equal(result.actor.lifeState, 'dead')
})

test('DM life-state override can stabilize or revive a character', () => {
  const stable = applyLifeStateOverride(actor({ deathSaveFailures: 2 }), 'stable')
  assert.equal(stable.lifeState, 'stable')
  assert.equal(stable.deathSaveFailures, 0)

  const conscious = applyLifeStateOverride(stable, 'conscious')
  assert.equal(conscious.currentHp, 1)
  assert.equal(conscious.lifeState, 'conscious')
})

test('monster death rules kill at 0 while character rules allow death saves', () => {
  const monster = actor({
    kind: 'enemy',
    ownerId: null,
    deathRules: 'monster',
    lifeState: 'dead',
  })

  assert.equal(monster.lifeState, 'dead')

  const characterRules = applyDeathRulesOverride(monster, 'character')
  assert.equal(characterRules.deathRules, 'character')
  assert.equal(characterRules.lifeState, 'unconscious')
})


test('rules bonuses can modify a death save without changing natural 1 or 20 behavior', () => {
  const helped = resolveDeathSave(actor(), 8, 5, 2)
  assert.equal(helped.resolution.total, 10)
  assert.equal(helped.resolution.outcome, 'success')

  const naturalOne = resolveDeathSave(actor(), 1, 5, 20)
  assert.equal(naturalOne.resolution.outcome, 'failure')
  assert.equal(naturalOne.actor.deathSaveFailures, 2)
})
