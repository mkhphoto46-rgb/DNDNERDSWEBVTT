import assert from 'node:assert/strict'
import test from 'node:test'

import {
  extractSimpleDamageTypes,
  normalizeHealthLog,
  resolveHealthOperation,
} from './damage'

import {
  normalizeActor,
} from './actors'

import type { Actor } from '../types/actor'

function actor(overrides: Partial<Actor> = {}): Actor {
  return normalizeActor({
    id: 'target',
    name: 'Target',
    kind: 'enemy',
    ownerId: null,
    portraitAssetId: '',
    portraitUrl: '',
    level: 1,
    challengeRating: null,
    currentHp: 20,
    maxHp: 20,
    tempHp: 0,
    lifeState: 'conscious',
    deathSaveSuccesses: 0,
    deathSaveFailures: 0,
    deathRules: 'monster',
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

test('damage consumes temporary HP before current HP', () => {
  const target = actor({ currentHp: 18, tempHp: 5 })
  const result = resolveHealthOperation(target, {
    operation: 'damage',
    amount: 8,
    damageType: 'slashing',
  })

  assert.equal(result.actor.tempHp, 0)
  assert.equal(result.actor.currentHp, 15)
  assert.equal(result.resolution.absorbedByTempHp, 5)
  assert.equal(result.resolution.hpDamage, 3)
})

test('resistance halves damage before temporary HP absorption', () => {
  const target = actor({ tempHp: 5, damageResistances: ['fire'] })
  const result = resolveHealthOperation(target, {
    operation: 'damage',
    amount: 9,
    damageType: 'fire',
  })

  assert.equal(result.resolution.effectiveDamage, 4)
  assert.equal(result.resolution.resistanceApplied, true)
  assert.equal(result.actor.tempHp, 1)
  assert.equal(result.actor.currentHp, 20)
})

test('immunity prevents typed damage completely', () => {
  const target = actor({ tempHp: 3, damageImmunities: ['poison'] })
  const result = resolveHealthOperation(target, {
    operation: 'damage',
    amount: 40,
    damageType: 'poison',
  })

  assert.equal(result.resolution.immunityApplied, true)
  assert.equal(result.resolution.effectiveDamage, 0)
  assert.equal(result.actor.tempHp, 3)
  assert.equal(result.actor.currentHp, 20)
})

test('vulnerability doubles typed damage', () => {
  const target = actor({ damageVulnerabilities: ['cold'] })
  const result = resolveHealthOperation(target, {
    operation: 'damage',
    amount: 6,
    damageType: 'cold',
  })

  assert.equal(result.resolution.vulnerabilityApplied, true)
  assert.equal(result.resolution.effectiveDamage, 12)
  assert.equal(result.actor.currentHp, 8)
})

test('resistance is applied before vulnerability when both are present', () => {
  const target = actor({
    damageResistances: ['acid'],
    damageVulnerabilities: ['acid'],
  })
  const result = resolveHealthOperation(target, {
    operation: 'damage',
    amount: 5,
    damageType: 'acid',
  })

  assert.equal(result.resolution.effectiveDamage, 4)
  assert.equal(result.actor.currentHp, 16)
})

test('healing caps at max HP and leaves temporary HP unchanged', () => {
  const target = actor({ currentHp: 7, tempHp: 4 })
  const result = resolveHealthOperation(target, {
    operation: 'heal',
    amount: 50,
    damageType: 'untyped',
  })

  assert.equal(result.actor.currentHp, 20)
  assert.equal(result.actor.tempHp, 4)
  assert.equal(result.resolution.healed, 13)
})

test('temporary HP grants keep the larger pool instead of stacking or lowering it', () => {
  const target = actor({ tempHp: 12 })
  const lowerGrant = resolveHealthOperation(target, {
    operation: 'set-temp',
    amount: 3,
    damageType: 'untyped',
  })

  assert.equal(lowerGrant.actor.tempHp, 12)

  const higherGrant = resolveHealthOperation(target, {
    operation: 'set-temp',
    amount: 18,
    damageType: 'untyped',
  })

  assert.equal(higherGrant.actor.tempHp, 18)
  assert.equal(higherGrant.actor.currentHp, 20)
})

test('SRD defense extraction keeps simple types but ignores conditional physical phrases', () => {
  assert.deepEqual(
    extractSimpleDamageTypes([
      'fire',
      'cold, lightning',
      'bludgeoning, piercing, and slashing from nonmagical attacks',
    ]).sort(),
    ['cold', 'fire', 'lightning'],
  )
})


test('health log normalization keeps valid entries and ignores malformed ones', () => {
  const target = actor()
  const result = resolveHealthOperation(target, {
    operation: 'damage',
    amount: 4,
    damageType: 'fire',
  })

  const normalized = normalizeHealthLog([
    null,
    { bad: true },
    {
      id: 'log-1',
      actorId: target.id,
      actorName: target.name,
      createdAt: '2026-09-20T00:00:00.000Z',
      resolution: result.resolution,
    },
  ])

  assert.equal(normalized.length, 1)
  assert.equal(normalized[0].actorId, target.id)
  assert.equal(normalized[0].resolution.effectiveDamage, 4)
})


test('SRD split conditional physical defenses do not leak into unconditional automation', () => {
  assert.deepEqual(
    extractSimpleDamageTypes([
      'acid',
      'cold',
      'fire',
      'lightning',
      'thunder; bludgeoning',
      'piercing',
      'and slashing from nonmagical attacks',
    ]).sort(),
    ['acid', 'cold', 'fire', 'lightning', 'thunder'],
  )
})


test('a player character falling to 0 HP becomes unconscious', () => {
  const target = actor({
    kind: 'player',
    ownerId: 'player-1',
    currentHp: 6,
    maxHp: 20,
    lifeState: 'conscious',
    deathRules: 'character',
  })
  const result = resolveHealthOperation(target, {
    operation: 'damage',
    amount: 8,
    damageType: 'slashing',
  })

  assert.equal(result.actor.currentHp, 0)
  assert.equal(result.actor.lifeState, 'unconscious')
  assert.equal(result.resolution.instantDeath, false)
})

test('a monster dies immediately when it drops to 0 HP under monster death rules', () => {
  const target = actor({ currentHp: 4, maxHp: 20, deathRules: 'monster' })
  const result = resolveHealthOperation(target, {
    operation: 'damage',
    amount: 4,
    damageType: 'slashing',
  })

  assert.equal(result.actor.currentHp, 0)
  assert.equal(result.actor.lifeState, 'dead')
  assert.equal(result.resolution.monsterDeath, true)
})

test('massive overflow damage instantly kills a character', () => {
  const target = actor({
    kind: 'player',
    ownerId: 'player-1',
    currentHp: 6,
    maxHp: 12,
    lifeState: 'conscious',
    deathRules: 'character',
  })
  const result = resolveHealthOperation(target, {
    operation: 'damage',
    amount: 18,
    damageType: 'force',
  })

  assert.equal(result.actor.lifeState, 'dead')
  assert.equal(result.resolution.overflowDamage, 12)
  assert.equal(result.resolution.instantDeath, true)
})

test('damage at 0 HP adds one failed death save or two on a critical hit', () => {
  const target = actor({
    kind: 'player',
    ownerId: 'player-1',
    currentHp: 0,
    maxHp: 20,
    lifeState: 'unconscious',
    deathRules: 'character',
  })
  const normal = resolveHealthOperation(target, {
    operation: 'damage',
    amount: 2,
    damageType: 'slashing',
  })
  assert.equal(normal.actor.deathSaveFailures, 1)
  assert.equal(normal.resolution.deathSaveFailuresAdded, 1)

  const critical = resolveHealthOperation(target, {
    operation: 'damage',
    amount: 2,
    damageType: 'slashing',
    criticalHit: true,
  })
  assert.equal(critical.actor.deathSaveFailures, 2)
  assert.equal(critical.resolution.deathSaveFailuresAdded, 2)
})

test('healing an unconscious character restores consciousness and resets death saves', () => {
  const target = actor({
    kind: 'player',
    ownerId: 'player-1',
    currentHp: 0,
    lifeState: 'unconscious',
    deathRules: 'character',
    deathSaveSuccesses: 1,
    deathSaveFailures: 2,
  })
  const result = resolveHealthOperation(target, {
    operation: 'heal',
    amount: 5,
    damageType: 'untyped',
  })

  assert.equal(result.actor.currentHp, 5)
  assert.equal(result.actor.lifeState, 'conscious')
  assert.equal(result.actor.deathSaveSuccesses, 0)
  assert.equal(result.actor.deathSaveFailures, 0)
})

test('ordinary healing cannot restore a dead character', () => {
  const target = actor({
    kind: 'player',
    ownerId: 'player-1',
    currentHp: 0,
    lifeState: 'dead',
    deathRules: 'character',
  })
  const result = resolveHealthOperation(target, {
    operation: 'heal',
    amount: 20,
    damageType: 'untyped',
  })

  assert.equal(result.actor.currentHp, 0)
  assert.equal(result.actor.lifeState, 'dead')
  assert.equal(result.resolution.healingBlockedByDeath, true)
})
