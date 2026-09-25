import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeActor } from './actors'
import {
  attackBonusForActor,
  attackProfilesForActor,
  normalizeDiceFormula,
  rollDiceFormula,
} from './combatActions'

test('dice formulas roll every damage die and double dice, not modifiers, on a critical hit', () => {
  const normal = rollDiceFormula('2d6+3', false, () => 4)
  const critical = rollDiceFormula('2d6+3', true, () => 4)
  assert.equal(normal.total, 11)
  assert.equal(critical.total, 19)
  assert.equal(critical.dice[0].rolls.length, 4)
  assert.equal(critical.modifier, 3)
})

test('unsafe or unsupported dice expressions are rejected to a safe formula', () => {
  assert.equal(normalizeDiceFormula('2d6 + 1d4 - 2'), '2d6+1d4-2')
  assert.equal(normalizeDiceFormula('process.exit()'), '1')
})

test('monster attack profiles are derived from the imported SRD stat block', () => {
  const actor = normalizeActor({
    id: 'skeleton', name: 'Skeleton', kind: 'enemy', ownerId: null,
    currentHp: 13, maxHp: 13, tempHp: 0, ac: 13, speedFeet: 30,
    abilities: { strength: 10, dexterity: 14, constitution: 15, intelligence: 6, wisdom: 8, charisma: 5 },
    monsterStatBlock: {
      actions: [{ name: 'Shortsword', attack_bonus: 4, damage: [{ dice: '1d6+2', type: 'piercing' }] }],
    },
  } as never)
  const attack = attackProfilesForActor(actor).find((candidate) => candidate.name === 'Shortsword')
  assert.ok(attack)
  assert.equal(attack.attackBonus, 4)
  assert.equal(attack.damageFormula, '1d6+2')
  assert.equal(attack.damageType, 'piercing')
})

test('player-authored attacks derive attack bonus from ability and proficiency', () => {
  const actor = normalizeActor({
    id: 'fighter', name: 'Fighter', kind: 'player', ownerId: 'p1', level: 5,
    currentHp: 30, maxHp: 30, tempHp: 0, ac: 18, speedFeet: 30,
    abilities: { strength: 18, dexterity: 12, constitution: 16, intelligence: 8, wisdom: 10, charisma: 10 },
    combatActions: [{ id: 'longsword', name: 'Longsword', attackType: 'melee', ability: 'strength', proficient: true, attackBonus: null, damageFormula: '1d8+4', damageType: 'slashing', rangeFeet: 5, longRangeFeet: null, resource: 'action' }],
  } as never)
  const attack = attackProfilesForActor(actor).find((candidate) => candidate.id === 'longsword')!
  assert.equal(attackBonusForActor(actor, attack), 7)
})
