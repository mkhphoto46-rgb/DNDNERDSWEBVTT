import assert from 'node:assert/strict'
import test from 'node:test'
import { OPEN_RULES_LIBRARY, searchRulesLibrary } from './contentLibrary'

test('open rules library contains every generated content family', () => {
  const types = new Set(OPEN_RULES_LIBRARY.map((entry) => entry.type))
  for (const type of ['spell', 'cantrip', 'weapon', 'armor', 'equipment', 'pack', 'magic-item', 'background', 'feat', 'class-feature', 'poison']) {
    assert.equal(types.has(type as never), true, `missing ${type}`)
  }
  assert.ok(OPEN_RULES_LIBRARY.length > 1_000)
})

test('search supports names, tags, type and rarity together', () => {
  const magic = searchRulesLibrary(OPEN_RULES_LIBRARY, 'adamantine', 'magic-item', 'Uncommon')
  assert.ok(magic.some((entry) => entry.name === 'Adamantine Armor'))

  const wizardCantrips = searchRulesLibrary(OPEN_RULES_LIBRARY, 'wizard', 'cantrip', '')
  assert.ok(wizardCantrips.length > 0)
  assert.ok(wizardCantrips.every((entry) => entry.type === 'cantrip'))
})

test('all bundled open records identify the 2024 SRD source', () => {
  assert.ok(OPEN_RULES_LIBRARY.every((entry) => entry.sourceId === 'srd-5.2.1'))
  assert.ok(OPEN_RULES_LIBRARY.every((entry) => entry.rulesVersion === '2024'))
})
