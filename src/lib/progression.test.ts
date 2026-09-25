import assert from 'node:assert/strict'
import test from 'node:test'

import { SRD_CLASS_FEATURES } from '../data/srdClassFeatures.generated'
import { characterFeaturesAtLevel, levelForXp, nextCharacterFeatures, xpProgress } from './progression'

test('synced open SRD feature catalog contains substantial 2024 class data', () => {
  assert.ok(
    SRD_CLASS_FEATURES.length >= 200,
    'Run npm run sync:srd-character-data before tests so the local SRD feature catalog is generated.',
  )
})

test('character features unlock by level and include the selected open subclass only', () => {
  const level3 = characterFeaturesAtLevel('Barbarian', 'Path of the Berserker', 3)
  assert.ok(level3.some((feature) => feature.name === 'Rage' && feature.source === 'class'))
  assert.ok(level3.some((feature) => feature.name === 'Frenzy' && feature.source === 'subclass'))
  assert.equal(level3.some((feature) => feature.name === 'Retaliation'), false)

  const zealot = characterFeaturesAtLevel('Barbarian', 'Path of the Zealot', 20)
  assert.ok(zealot.some((feature) => feature.name === 'Rage'))
  assert.equal(zealot.some((feature) => feature.source === 'subclass'), false)
})

test('next feature preview finds the next unlocked level', () => {
  const next = nextCharacterFeatures('Fighter', 'Champion', 1)
  assert.ok(next.length > 0)
  assert.ok(next.every((feature) => feature.level === 2))
})


test('XP totals derive authoritative character level and bounded progress', () => {
  assert.equal(levelForXp(0), 1)
  assert.equal(levelForXp(299), 1)
  assert.equal(levelForXp(300), 2)
  assert.equal(levelForXp(6500), 5)
  assert.equal(levelForXp(355000), 20)
  assert.equal(levelForXp(999999), 20)

  assert.deepEqual(xpProgress(2, 300), { current: 300, next: 900, percent: 0 })
  assert.equal(Math.round(xpProgress(2, 600).percent), 50)
})
