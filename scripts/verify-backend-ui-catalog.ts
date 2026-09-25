import assert from 'node:assert/strict'

import {
  backendCatalogStatus,
  characterCatalogOptions,
  searchBackendCatalog,
} from '../server/rulesKnowledge'

const characters = characterCatalogOptions('2024')

assert.equal(characters.ready, true)
assert.ok(characters.classes.length >= 12, `Expected at least 12 2024 classes, got ${characters.classes.length}`)
assert.ok(characters.subclasses.length >= 48, `Expected at least 48 2024 subclasses, got ${characters.subclasses.length}`)
assert.ok(characters.species.length >= 10, `Expected at least 10 2024 species, got ${characters.species.length}`)
assert.ok(characters.backgrounds.length >= 16, `Expected at least 16 2024 backgrounds, got ${characters.backgrounds.length}`)

const status = backendCatalogStatus()
assert.equal(status.ready, true)

const expectedFamilies = [
  'core-rules',
  'classes',
  'subclasses',
  'species',
  'backgrounds',
  'feats',
  'class-features',
  'spells',
  'book-spells',
  'equipment',
  'magic-items',
  'book-magic-items',
  'poisons',
  'book-poisons',
  'phase8-rules',
]

for (const family of expectedFamilies) {
  assert.ok(
    status.families.some((entry) => entry.id === family),
    `Missing backend catalog family: ${family}`,
  )
}

const phase8 = searchBackendCatalog('phase8-rules', '', '2024', 100)
assert.equal(phase8.length, 19)

const bookMagic = searchBackendCatalog('book-magic-items', '', '', 300)
assert.ok(bookMagic.length > 0)

const bookSpells = searchBackendCatalog('book-spells', '', '', 300)
assert.ok(bookSpells.length > 0)

console.log(JSON.stringify({
  ok: true,
  characterCatalog: {
    classes: characters.classes.length,
    subclasses: characters.subclasses.length,
    species: characters.species.length,
    backgrounds: characters.backgrounds.length,
  },
  backendCatalog: {
    totalRecords: status.totalRecords,
    families: status.families,
    phase8Rules: phase8.length,
    sampleBookMagicItems: bookMagic.length,
    sampleBookSpells: bookSpells.length,
  },
}, null, 2))
