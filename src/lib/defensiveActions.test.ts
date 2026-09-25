import assert from 'node:assert/strict'
import test from 'node:test'

import { createBlankPlayerActor } from './actors'
import { freshTurnEconomy, useDodge } from './actionEconomy'
import {
  applyDodgeAttackMode,
  applyDodgeSavingThrowMode,
  dodgeBenefitsActive,
  normalizeSavingThrowAbility,
} from './defensiveActions'

function dodgingActor() {
  const actor = createBlankPlayerActor({ id: 'dodger', name: 'Dodger', ownerId: 'p1' })
  actor.speedFeet = 30
  return { actor, economy: useDodge(freshTurnEconomy(actor)) }
}

test('Dodge is active only while conscious, not Incapacitated, and Speed is above 0', () => {
  const { actor, economy } = dodgingActor()
  assert.equal(dodgeBenefitsActive(actor, economy), true)

  actor.conditions = ['Restrained']
  assert.equal(dodgeBenefitsActive(actor, economy), false)

  actor.conditions = []
  actor.lifeState = 'unconscious'
  assert.equal(dodgeBenefitsActive(actor, economy), false)

  actor.lifeState = 'conscious'
  actor.conditions = ['Incapacitated']
  assert.equal(dodgeBenefitsActive(actor, economy), false)
})

test('Dodge adds attack Disadvantage and correctly cancels existing Advantage', () => {
  const { actor, economy } = dodgingActor()
  assert.equal(applyDodgeAttackMode('normal', actor, economy), 'disadvantage')
  assert.equal(applyDodgeAttackMode('advantage', actor, economy), 'normal')
  assert.equal(applyDodgeAttackMode('disadvantage', actor, economy), 'disadvantage')
})

test('Dodge grants Advantage only to Dexterity saving throws', () => {
  const { actor, economy } = dodgingActor()
  assert.equal(applyDodgeSavingThrowMode('normal', actor, economy, 'dexterity'), 'advantage')
  assert.equal(applyDodgeSavingThrowMode('disadvantage', actor, economy, 'dexterity'), 'normal')
  assert.equal(applyDodgeSavingThrowMode('normal', actor, economy, 'constitution'), 'normal')
})

test('saving throw ability input is constrained to the six actor abilities', () => {
  assert.equal(normalizeSavingThrowAbility('DEXTERITY'), 'dexterity')
  assert.equal(normalizeSavingThrowAbility('wisdom'), 'wisdom')
  assert.equal(normalizeSavingThrowAbility(''), null)
  assert.equal(normalizeSavingThrowAbility('acrobatics'), null)
})
