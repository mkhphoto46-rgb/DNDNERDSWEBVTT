import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createBlankPlayerActor,
  normalizeActor,
} from './actors'

import {
  automaticCharacterDefenseSources,
  DEFENSE_FEATURE_MONK_SUPERIOR_DEFENSE,
  DEFENSE_FEATURE_RAGE,
  effectiveDamageDefenses,
} from './characterDefenseAutomation'

import {
  resolveHealthOperation,
} from './damage'

import type { Actor, CharacterSheetData } from '../types/actor'

type PlayerPatch = Omit<Partial<Actor>, 'characterSheet'> & {
  characterSheet?: Partial<CharacterSheetData>
}

function player(
  patch: PlayerPatch = {},
) {
  const base = createBlankPlayerActor({
    id: 'player-defense-test',
    name: 'Defense Tester',
    ownerId: 'player-1',
  })

  return normalizeActor({
    ...base,
    ...patch,
    characterSheet: {
      ...base.characterSheet!,
      ...(patch.characterSheet ?? {}),
    },
  })
}

test('dwarf poison resistance is derived automatically from species', () => {
  const actor = player({
    characterSheet: { species: 'Dwarf' },
  })

  const defenses = effectiveDamageDefenses(actor)
  assert.deepEqual(defenses.resistances, ['poison'])

  const damage = resolveHealthOperation(actor, {
    operation: 'damage',
    amount: 9,
    damageType: 'poison',
  })

  assert.equal(damage.resolution.resistanceApplied, true)
  assert.equal(damage.resolution.effectiveDamage, 4)
})

test('dragonborn ancestry choice determines automatic resistance', () => {
  const actor = player({
    characterSheet: {
      species: 'Dragonborn',
      defenseSelections: { 'dragonborn-ancestry': 'Red' },
    },
  })

  assert.deepEqual(effectiveDamageDefenses(actor).resistances, ['fire'])
})

test('tiefling legacy choice determines automatic resistance', () => {
  const actor = player({
    characterSheet: {
      species: 'Tiefling',
      defenseSelections: { 'tiefling-legacy': 'Chthonic' },
    },
  })

  assert.deepEqual(effectiveDamageDefenses(actor).resistances, ['necrotic'])
})

test('barbarian Rage grants B/P/S resistance only while active and conscious', () => {
  const inactive = player({
    characterSheet: { className: 'Barbarian' },
  })
  assert.deepEqual(effectiveDamageDefenses(inactive).resistances, [])

  const active = player({
    characterSheet: {
      className: 'Barbarian',
      activeDefenseFeatures: [DEFENSE_FEATURE_RAGE],
    },
  })
  assert.deepEqual(
    effectiveDamageDefenses(active).resistances.sort(),
    ['bludgeoning', 'piercing', 'slashing'].sort(),
  )

  const unconscious = normalizeActor({
    ...active,
    currentHp: 0,
    lifeState: 'unconscious',
  })
  assert.deepEqual(effectiveDamageDefenses(unconscious).resistances, [])
})

test('Fiend warlock level 10 can choose Fiendish Resilience damage type', () => {
  const actor = player({
    level: 10,
    characterSheet: {
      className: 'Warlock',
      subclassName: 'Fiend',
      defenseSelections: { 'fiendish-resilience': 'cold' },
    },
  })

  assert.deepEqual(effectiveDamageDefenses(actor).resistances, ['cold'])
})

test('level 18 Monk Superior Defense resists all typed damage except Force while active', () => {
  const actor = player({
    level: 18,
    characterSheet: {
      className: 'Monk',
      activeDefenseFeatures: [DEFENSE_FEATURE_MONK_SUPERIOR_DEFENSE],
    },
  })

  const defenses = effectiveDamageDefenses(actor)
  assert.equal(defenses.resistances.includes('fire'), true)
  assert.equal(defenses.resistances.includes('psychic'), true)
  assert.equal(defenses.resistances.includes('force'), false)
})

test('manual DM overrides are merged with automatic player defenses without duplicating types', () => {
  const actor = player({
    damageResistances: ['cold', 'poison'],
    characterSheet: { species: 'Dwarf' },
  })

  const defenses = effectiveDamageDefenses(actor)
  assert.deepEqual(defenses.resistances.sort(), ['cold', 'poison'])

  const sources = automaticCharacterDefenseSources(actor)
  assert.equal(sources.some((source) => source.label === 'Dwarven Resilience'), true)
})
