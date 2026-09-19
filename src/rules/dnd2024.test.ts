import assert from 'node:assert/strict'
import test from 'node:test'

import {
  abilityModifier,
  chooseD20,
  concentrationDc,
  coverBonus,
  doubledCriticalDice,
  exhaustionD20Penalty,
  exhaustionSpeedPenalty,
  gridDistanceFeet,
  proficiencyBonus,
  resolveRollMode,
  spellAttackBonus,
  spellSaveDc,
} from './dnd2024'

test('2024 ability modifiers and proficiency progression', () => {
  assert.equal(abilityModifier(1), -5)
  assert.equal(abilityModifier(10), 0)
  assert.equal(abilityModifier(20), 5)
  assert.equal(proficiencyBonus(1), 2)
  assert.equal(proficiencyBonus(5), 3)
  assert.equal(proficiencyBonus(17), 6)
})

test('spell DC and spell attack use proficiency and casting ability', () => {
  assert.equal(spellSaveDc(5, 18), 15)
  assert.equal(spellAttackBonus(5, 18), 7)
})

test('advantage and disadvantage cancel', () => {
  assert.equal(resolveRollMode(true, true), 'normal')
  assert.equal(chooseD20(4, 17, 'advantage'), 17)
  assert.equal(chooseD20(4, 17, 'disadvantage'), 4)
})

test('cover, exhaustion, concentration, grid range and critical dice', () => {
  assert.equal(coverBonus('half'), 2)
  assert.equal(coverBonus('three-quarters'), 5)
  assert.equal(coverBonus('total'), null)
  assert.equal(exhaustionD20Penalty(3), -6)
  assert.equal(exhaustionSpeedPenalty(3), -15)
  assert.equal(concentrationDc(8), 10)
  assert.equal(concentrationDc(40), 20)
  assert.equal(concentrationDc(100), 30)
  assert.equal(gridDistanceFeet(0, 0, 4, 3), 20)
  assert.equal(doubledCriticalDice(3), 6)
})
