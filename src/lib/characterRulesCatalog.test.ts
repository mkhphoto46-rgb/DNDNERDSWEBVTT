import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createBlankPlayerActor,
  normalizeActor,
} from './actors'

import {
  backgroundGrantedFeatName,
  classSpellCatalog,
  featMeetsMinimumLevel,
  featureGrantedSpells,
  normalSpellLevelCap,
  openFeatCatalog,
  openSpellCatalog,
  spellIsAvailableToCharacter,
  warlockMysticArcanumCap,
} from './characterRulesCatalog'

import type { SrdSpellRecord } from '../data/srdSpells.generated'


test('synced open 2024 catalogs contain the full SRD feat and spell datasets', () => {
  assert.ok(
    openFeatCatalog().length >= 15,
    'Run npm run sync:srd-character-data so the local SRD feat catalog is generated.',
  )
  assert.ok(
    openSpellCatalog().length >= 300,
    'Run npm run sync:srd-character-data so the local SRD spell catalog is generated.',
  )
})

test('open feat catalog exposes synced feat records and level prerequisites', () => {
  const feats = openFeatCatalog()
  const alert = feats.find((feat) => feat.id === 'alert')
  const asi = feats.find((feat) => feat.id === 'ability-score-improvement')

  assert.ok(alert)
  assert.ok(asi)
  assert.equal(featMeetsMinimumLevel(asi!, 3), false)
  assert.equal(featMeetsMinimumLevel(asi!, 4), true)
})

test('open backgrounds expose their granted origin feat name', () => {
  assert.equal(backgroundGrantedFeatName('Acolyte'), 'Magic Initiate (Cleric)')
  assert.equal(backgroundGrantedFeatName('Criminal'), 'Alert')
})

test('spell level caps follow full, half, and pact-magic progression', () => {
  assert.equal(normalSpellLevelCap('Wizard', 1), 1)
  assert.equal(normalSpellLevelCap('Wizard', 5), 3)
  assert.equal(normalSpellLevelCap('Paladin', 1), 1)
  assert.equal(normalSpellLevelCap('Paladin', 5), 2)
  assert.equal(normalSpellLevelCap('Warlock', 9), 5)
  assert.equal(warlockMysticArcanumCap(11), 6)
  assert.equal(warlockMysticArcanumCap(17), 9)
})

test('class spell catalog filters by class and character level', () => {
  const wizardLevel1 = classSpellCatalog('Wizard', 1)
  assert.equal(wizardLevel1.some((spell) => spell.id === 'acid-splash'), true)
  assert.equal(wizardLevel1.some((spell) => spell.id === 'acid-arrow'), false)

  const wizardLevel3 = classSpellCatalog('Wizard', 3)
  assert.equal(wizardLevel3.some((spell) => spell.id === 'acid-arrow'), true)
})

test('fixed class and subclass feature spells unlock automatically at their rules level', () => {
  assert.deepEqual(
    featureGrantedSpells('Druid', 'Circle of the Land', 1).map((spell) => spell.name),
    ['Speak with Animals'],
  )

  const lifeClericLevel5 = featureGrantedSpells('Cleric', 'Life Domain', 5).map((spell) => spell.name)
  assert.equal(lifeClericLevel5.includes('Aid'), true)
  assert.equal(lifeClericLevel5.includes('Revivify'), true)
  assert.equal(lifeClericLevel5.includes('Death Ward'), false)

  const fiendLevel7 = featureGrantedSpells('Warlock', 'Fiend Patron', 7).map((spell) => spell.name)
  assert.equal(fiendLevel7.includes('Fireball'), true)
  assert.equal(fiendLevel7.includes('Wall of Fire'), true)
  assert.equal(fiendLevel7.includes('Geas'), false)
})

test('warlock Mystic Arcanum levels can expose higher-level class spells at the correct level', () => {
  const testSpell: SrdSpellRecord = {
    id: 'test-arcanum',
    name: 'Test Arcanum',
    level: 6,
    school: 'Evocation',
    classes: ['Warlock'],
    castingTime: 'Action',
    ritual: false,
    range: '60 feet',
    components: ['V'],
    material: '',
    duration: 'Instantaneous',
    concentration: false,
    attackType: '',
    saveAbility: '',
    saveEffect: '',
    area: '',
    damageType: '',
    damageAtSlotLevel: {},
    damageAtCharacterLevel: {},
    healAtSlotLevel: {},
    description: '',
    higherLevel: '',
  }

  assert.equal(spellIsAvailableToCharacter(testSpell, 'Warlock', 10), false)
  assert.equal(spellIsAvailableToCharacter(testSpell, 'Warlock', 11), true)
})

test('character feat and spell selections persist while prepared spells remain a subset of known spells', () => {
  const base = createBlankPlayerActor({
    id: 'feat-spell-character',
    name: 'Catalog Tester',
    ownerId: 'player-1',
  })

  const actor = normalizeActor({
    ...base,
    characterSheet: {
      ...base.characterSheet!,
      selectedFeatIds: ['skilled', 'skilled'],
      knownSpellIds: ['acid-splash', 'acid-arrow'],
      preparedSpellIds: ['acid-arrow', 'not-known'],
    },
  })

  assert.deepEqual(actor.characterSheet?.selectedFeatIds, ['skilled', 'skilled'])
  assert.deepEqual(actor.characterSheet?.knownSpellIds, ['acid-splash', 'acid-arrow'])
  assert.deepEqual(actor.characterSheet?.preparedSpellIds, ['acid-arrow'])
})
