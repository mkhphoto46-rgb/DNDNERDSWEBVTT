import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PLAYABLE_BACKGROUNDS,
  PLAYABLE_CATALOG_COUNTS,
  PLAYABLE_CLASSES,
  PLAYABLE_SPECIES,
  PLAYABLE_SUBCLASSES,
  playableSubclassesForClass,
} from '../data/playableCatalog.generated'

test('source-linked playable catalog contains the complete audited identity set', () => {
  assert.deepEqual(PLAYABLE_CATALOG_COUNTS, {
    classes: 25,
    subclasses: 154,
    species: 60,
    backgrounds: 38,
  })
  assert.equal(PLAYABLE_CLASSES.length, 25)
  assert.equal(PLAYABLE_SUBCLASSES.length, 154)
  assert.equal(PLAYABLE_SPECIES.length, 60)
  assert.equal(PLAYABLE_BACKGROUNDS.length, 38)
})

test('Artificer and its Tasha subclasses are selectable', () => {
  const artificer = PLAYABLE_CLASSES.find((entry) => entry.name === 'Artificer')
  assert.ok(artificer)
  assert.equal(artificer.rulesVersion, '2014')
  assert.equal(artificer.sourceShort, 'TCoE')

  assert.deepEqual(
    playableSubclassesForClass('Artificer', '2014').map((entry) => entry.name),
    ['Alchemist', 'Armorer', 'Artillerist', 'Battle Smith'],
  )
})

test('2014 and 2024 class/subclass identities remain distinct', () => {
  const rangers = PLAYABLE_CLASSES.filter((entry) => entry.name === 'Ranger')
  assert.equal(rangers.length, 2)
  assert.deepEqual(new Set(rangers.map((entry) => entry.rulesVersion)), new Set(['2014', '2024']))

  const hunters2014 = playableSubclassesForClass('Ranger', '2014').filter((entry) => entry.name === 'Hunter')
  const hunters2024 = playableSubclassesForClass('Ranger', '2024').filter((entry) => entry.name === 'Hunter')
  assert.equal(hunters2014.length, 1)
  assert.equal(hunters2024.length, 1)
  assert.notEqual(hunters2014[0].id, hunters2024[0].id)

  const beast2014 = playableSubclassesForClass('Ranger', '2014').find((entry) => entry.name === 'Beast Master')
  const beast2024 = playableSubclassesForClass('Ranger', '2024').find((entry) => entry.name === 'Beast Master')
  assert.ok(beast2014)
  assert.ok(beast2024)
})
