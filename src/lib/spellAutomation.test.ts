import assert from 'node:assert/strict'
import test from 'node:test'

import { spellById } from './characterRulesCatalog'
import { castingTimeActionCost, spellHasAutomatedRule, spellTargetRule } from './spellAutomation'

test('Bless target count scales with upcast level and uses an Action', () => {
  const bless = spellById('bless')
  assert.ok(bless)
  assert.equal(castingTimeActionCost(bless.castingTime), 'action')
  assert.deepEqual(
    spellTargetRule(bless, 1),
    {
      mode: 'creatures',
      minTargets: 1,
      maxTargets: 3,
      rangeFeet: 30,
      relation: 'any',
      radiusFeet: null,
      label: 'Choose up to 3 creatures within 30 ft',
    },
  )
  assert.equal(spellTargetRule(bless, 3).maxTargets, 5)
})

test('Mass Healing Word exposes six selectable creature targets and costs a Bonus Action', () => {
  const spell = spellById('mass-healing-word')
  assert.ok(spell)
  assert.equal(castingTimeActionCost(spell.castingTime), 'bonus-action')
  const rule = spellTargetRule(spell, 3)
  assert.equal(rule.mode, 'creatures')
  assert.equal(rule.maxTargets, 6)
  assert.equal(rule.rangeFeet, 60)
})

test('Mass Cure Wounds exposes point-area targeting foundation', () => {
  const spell = spellById('mass-cure-wounds')
  assert.ok(spell)
  const rule = spellTargetRule(spell, 5)
  assert.equal(rule.mode, 'point-area')
  assert.equal(rule.radiusFeet, 30)
  assert.equal(rule.maxTargets, 6)
  assert.equal(rule.rangeFeet, 60)
})


test('only registered spell rules can spend authoritative combat resources', () => {
  assert.equal(spellHasAutomatedRule('bless'), true)
  assert.equal(spellHasAutomatedRule('fireball'), false)
  assert.equal(spellHasAutomatedRule('mass-healing-word'), false)
})
