import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canonicalSubclassName,
  CHARACTER_BACKGROUND_OPTIONS,
  CHARACTER_SPECIES_OPTIONS,
  CHARACTER_SUBCLASS_OPTIONS,
  hasBundledSubclassRules,
  OPEN_BACKGROUND_RULES,
} from './characterCatalog'

const CLASS_KEYS = [
  'barbarian', 'bard', 'cleric', 'druid', 'fighter', 'monk',
  'paladin', 'ranger', 'rogue', 'sorcerer', 'warlock', 'wizard',
]

test('2024 character catalog exposes 10 species and 16 background choices', () => {
  assert.equal(CHARACTER_SPECIES_OPTIONS.length, 10)
  assert.equal(CHARACTER_BACKGROUND_OPTIONS.length, 16)
  assert.ok(CHARACTER_SPECIES_OPTIONS.includes('Aasimar'))
  assert.ok(CHARACTER_BACKGROUND_OPTIONS.includes('Wayfarer'))
})

test('every 2024 core class exposes four subclass choices', () => {
  for (const classKey of CLASS_KEYS) {
    assert.equal(CHARACTER_SUBCLASS_OPTIONS[classKey]?.length, 4, classKey)
  }
})

test('legacy Fiend selection canonicalizes to Fiend Patron', () => {
  assert.equal(canonicalSubclassName('Warlock', 'Fiend'), 'Fiend Patron')
  assert.equal(hasBundledSubclassRules('Warlock', 'Fiend Patron'), true)
  assert.equal(hasBundledSubclassRules('Warlock', 'Archfey Patron'), false)
})

test('free/open background mechanics stay explicit instead of being invented for paid-only choices', () => {
  assert.deepEqual(Object.keys(OPEN_BACKGROUND_RULES).sort(), ['Acolyte', 'Criminal', 'Sage', 'Soldier'])
})
