import assert from 'node:assert/strict'
import test from 'node:test'

import {
  automaticSavingThrows,
  automaticSpellcastingAbility,
  CLASS_OPTIONS,
} from './characterAutomation'

test('Artificer has basic runtime class automation', () => {
  assert.ok(CLASS_OPTIONS.includes('Artificer'))
  assert.deepEqual(automaticSavingThrows('Artificer'), ['constitution', 'intelligence'])
  assert.equal(automaticSpellcastingAbility('Artificer'), 'intelligence')
})
