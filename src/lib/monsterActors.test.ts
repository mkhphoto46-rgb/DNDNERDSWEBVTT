import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createActorFromMonsterTemplate,
} from './monsterActors'

import {
  normalizeActor,
} from './actors'

import {
  type MonsterTemplate,
} from '../types/compendium'

const skeleton: MonsterTemplate = {
  id: 'srd:skeleton',
  name: 'Skeleton',
  size: 'Medium',
  type: 'undead',
  cr: '1/4',
  crNumeric: 0.25,
  armorClass: 13,
  hitPoints: 13,
  hitPointFormula: '2d8+4',
  initiativeModifier: 2,
  source: 'srd-5.2.1',
  portraitUrl: '/api/compendium/monsters/srd%3Askeleton/portrait',
  attribution: 'SRD 5.2.1 / CC-BY 4.0',
  statBlock: {
    ability_scores: {
      str: 10,
      dex: 14,
      con: 15,
      int: 6,
      wis: 8,
      cha: 5,
    },
    speed: {
      walk: 30,
    },
    damage_resistances: ['poison'],
    damage_vulnerabilities: ['bludgeoning'],
    actions: [
      {
        name: 'Shortsword',
        attack_bonus: 4,
        damage: [{ dice: '1d6+2', type: 'piercing' }],
      },
    ],
  },
}

test('one monster template spawns independent actor instances', () => {
  const first = createActorFromMonsterTemplate(skeleton, [], 'actor-skeleton-1')
  const second = createActorFromMonsterTemplate(skeleton, [first], 'actor-skeleton-2')

  assert.equal(first.name, 'Skeleton')
  assert.equal(second.name, 'Skeleton 2')
  assert.equal(first.currentHp, 13)
  assert.equal(second.currentHp, 13)
  assert.equal(first.sourceTemplateId, 'srd:skeleton')
  assert.equal(first.ac, 13)
  assert.equal(first.speedFeet, 30)
  assert.equal(first.abilities.dexterity, 14)
  assert.equal(first.portraitAssetId, 'compendium:srd:skeleton')
  assert.match(first.portraitUrl, /compendium\/monsters/)
  assert.deepEqual(first.damageResistances, ['poison'])
  assert.deepEqual(first.damageVulnerabilities, ['bludgeoning'])

  first.currentHp = 2
  assert.equal(second.currentHp, 13)
})

test('spawned monster keeps its own stat block snapshot', () => {
  const first = createActorFromMonsterTemplate(skeleton, [], 'actor-skeleton-a')
  const second = createActorFromMonsterTemplate(skeleton, [first], 'actor-skeleton-b')

  const firstBlock = first.monsterStatBlock as {
    actions: Array<{ name: string }>
  }
  const secondBlock = second.monsterStatBlock as {
    actions: Array<{ name: string }>
  }

  firstBlock.actions[0].name = 'Changed Attack'

  assert.equal(secondBlock.actions[0].name, 'Shortsword')
  assert.equal((skeleton.statBlock.actions as Array<{ name: string }>)[0].name, 'Shortsword')
})


test('legacy compendium actors recover a placeable portrait and imported simple defenses', () => {
  const legacy = createActorFromMonsterTemplate(skeleton, [], 'legacy-source')
  legacy.portraitAssetId = ''
  legacy.portraitUrl = ''
  ;(legacy as unknown as { damageResistances?: unknown }).damageResistances = undefined
  ;(legacy as unknown as { damageVulnerabilities?: unknown }).damageVulnerabilities = undefined

  const normalized = normalizeActor(legacy)

  assert.equal(normalized.portraitAssetId, 'compendium:srd:skeleton')
  assert.match(normalized.portraitUrl, /compendium\/monsters/)
  assert.deepEqual(normalized.damageResistances, ['poison'])
  assert.deepEqual(normalized.damageVulnerabilities, ['bludgeoning'])
})
