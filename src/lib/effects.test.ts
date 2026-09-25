import assert from 'node:assert/strict'
import test from 'node:test'

import {
  actorD20BonusDice,
  actorD20Modifier,
  canonicalMechanicalCondition,
  effectiveActorSpeed,
  isMechanicallySupportedCondition,
  normalizeActorEffects,
  resolveActorD20Mode,
} from './effects'
import { normalizeActor } from './actors'
import type { Actor } from '../types/actor'

function actor(patch: Partial<Actor> = {}): Actor {
  return normalizeActor({
    id: 'actor-a',
    name: 'Actor A',
    kind: 'player',
    ownerId: 'player-a',
    portraitAssetId: '',
    portraitUrl: '',
    level: 5,
    challengeRating: null,
    currentHp: 20,
    maxHp: 20,
    tempHp: 0,
    lifeState: 'conscious',
    deathSaveSuccesses: 0,
    deathSaveFailures: 0,
    deathRules: 'character',
    lastDeathSaveRound: null,
    ac: 15,
    speedFeet: 30,
    initiativeBonus: 0,
    proficiencyBonus: 3,
    abilities: {
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    },
    conditions: [],
    effects: [],
    resources: [],
    sourceTemplateId: null,
    source: null,
    creatureSize: 'Medium',
    creatureType: 'humanoid',
    hitPointFormula: '',
    monsterStatBlock: null,
    characterSheet: null,
    gmNotes: '',
    ...patch,
  })
}

test('Stage 05 explicit advantage and disadvantage cancel mechanically', () => {
  const source = actor({
    effects: [
      {
        id: 'adv',
        name: 'Blessed Aim',
        kind: 'advantage',
        scope: 'attack',
        value: 0,
        sourceActorId: 'caster',
        sourceActorName: 'Caster',
        sourceRole: 'player',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'dis',
        name: 'Hindered',
        kind: 'disadvantage',
        scope: 'attack',
        value: 0,
        sourceActorId: 'enemy',
        sourceActorName: 'Enemy',
        sourceRole: 'dm',
        createdAt: new Date().toISOString(),
      },
    ],
  })

  assert.equal(resolveActorD20Mode(source, 'attack'), 'normal')
})

test('Stage 05 target conditions affect attack rolls', () => {
  const source = actor()
  const blindedTarget = actor({ id: 'target', conditions: ['Blinded'] })
  const invisibleTarget = actor({ id: 'target', conditions: ['Invisible'] })

  assert.equal(resolveActorD20Mode(source, 'attack', 'normal', blindedTarget), 'advantage')
  assert.equal(resolveActorD20Mode(source, 'attack', 'normal', invisibleTarget), 'disadvantage')
})

test('Stage 05 roll modifiers and speed buffs apply deterministically', () => {
  const source = actor({
    effects: [
      {
        id: 'roll',
        name: 'Bless-like flat bonus',
        kind: 'roll-modifier',
        scope: 'saving-throw',
        value: 2,
        sourceActorId: 'caster',
        sourceActorName: 'Caster',
        sourceRole: 'player',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'speed',
        name: 'Haste step',
        kind: 'speed-modifier',
        scope: 'all-d20',
        value: 10,
        sourceActorId: 'caster',
        sourceActorName: 'Caster',
        sourceRole: 'player',
        createdAt: new Date().toISOString(),
      },
    ],
  })

  assert.equal(actorD20Modifier(source, 'saving-throw'), 2)
  assert.equal(effectiveActorSpeed(source), 40)
})

test('Stage 05 poisoned and restrained conditions have safe deterministic mechanics', () => {
  const poisoned = actor({ conditions: ['Poisoned'] })
  const restrained = actor({ conditions: ['Restrained'] })
  const grappled = actor({ conditions: ['Grappled'] })

  assert.equal(resolveActorD20Mode(poisoned, 'attack'), 'disadvantage')
  assert.equal(resolveActorD20Mode(poisoned, 'ability-check'), 'disadvantage')
  assert.equal(resolveActorD20Mode(poisoned, 'skill-check'), 'disadvantage')
  assert.equal(resolveActorD20Mode(restrained, 'attack'), 'disadvantage')
  assert.equal(effectiveActorSpeed(restrained), 0)
  assert.equal(effectiveActorSpeed(grappled), 0)
})

test('Stage 05 manual condition list contains only conditions with implemented mechanics', () => {
  for (const condition of ['Blinded', 'Grappled', 'Invisible', 'Poisoned', 'Prone', 'Restrained']) {
    assert.equal(isMechanicallySupportedCondition(condition), true)
    assert.equal(canonicalMechanicalCondition(condition.toLowerCase()), condition)
  }

  assert.equal(isMechanicallySupportedCondition('Stunned'), false)
  assert.equal(canonicalMechanicalCondition('Stunned'), null)
})

test('Stage 05 malformed effects are discarded instead of entering actor state', () => {
  assert.deepEqual(normalizeActorEffects([null, {}, { id: 'x', kind: '???', name: 'bad' }]), [])
})


test('Rules-driven Bless exposes a d4 bonus to attacks and saving throws without faking Advantage', () => {
  const blessed = actor({
    effects: [
      {
        id: 'bless',
        name: 'Bless',
        kind: 'dice-bonus',
        scope: 'attack-save',
        value: 0,
        diceCount: 1,
        dieSides: 4,
        sourceRuleId: 'spell:bless',
        concentration: true,
        expiresAtRound: 12,
        sourceActorId: 'cleric',
        sourceActorName: 'Cleric',
        sourceRole: 'player',
        createdAt: new Date().toISOString(),
      },
    ],
  })

  assert.equal(resolveActorD20Mode(blessed, 'attack'), 'normal')
  assert.deepEqual(actorD20BonusDice(blessed, 'attack').map((die) => [die.count, die.sides]), [[1, 4]])
  assert.deepEqual(actorD20BonusDice(blessed, 'saving-throw').map((die) => [die.count, die.sides]), [[1, 4]])
  assert.equal(actorD20BonusDice(blessed, 'ability-check').length, 0)
})

test('Prone uses attack distance for the correct attacker advantage/disadvantage rule', () => {
  const source = actor()
  const proneTarget = actor({ id: 'target', conditions: ['Prone'] })
  assert.equal(resolveActorD20Mode(source, 'attack', 'normal', proneTarget, 5), 'advantage')
  assert.equal(resolveActorD20Mode(source, 'attack', 'normal', proneTarget, 30), 'disadvantage')
  assert.equal(resolveActorD20Mode(actor({ conditions: ['Prone'] }), 'attack'), 'disadvantage')
})
