import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeAttackProfile } from './combatActions'
import {
  actorsAreOpposedForOpportunity,
  eligibleOpportunityAttackIds,
  hasPendingReactionForTriggeringActor,
  normalizeReactionWindows,
  reactionWindowExpired,
} from './reactions'
import type { ReactionWindow } from '../types/reaction'

const melee5 = normalizeAttackProfile({ id: 'sword', name: 'Sword', attackType: 'melee', rangeFeet: 5, damageFormula: '1d8', damageType: 'slashing' })!
const melee10 = normalizeAttackProfile({ id: 'glaive', name: 'Glaive', attackType: 'melee', rangeFeet: 10, damageFormula: '1d10', damageType: 'slashing' })!
const ranged = normalizeAttackProfile({ id: 'bow', name: 'Bow', attackType: 'ranged', rangeFeet: 80, longRangeFeet: 320, damageFormula: '1d8', damageType: 'piercing' })!

test('opportunity attack eligibility only includes melee profiles whose reach boundary was crossed', () => {
  assert.deepEqual(eligibleOpportunityAttackIds([melee5, melee10, ranged], 5, 10), ['sword'])
  assert.deepEqual(eligibleOpportunityAttackIds([melee5, melee10, ranged], 10, 15), ['glaive'])
  assert.deepEqual(eligibleOpportunityAttackIds([melee5, melee10, ranged], 5, 5), [])
})

test('automatic opportunity opposition is limited to player versus enemy actors', () => {
  assert.equal(actorsAreOpposedForOpportunity({ kind: 'player' }, { kind: 'enemy' }), true)
  assert.equal(actorsAreOpposedForOpportunity({ kind: 'enemy' }, { kind: 'player' }), true)
  assert.equal(actorsAreOpposedForOpportunity({ kind: 'player' }, { kind: 'player' }), false)
  assert.equal(actorsAreOpposedForOpportunity({ kind: 'npc' }, { kind: 'enemy' }), false)
})

test('reaction windows normalize opportunity and readied-action windows independently', () => {
  const now = Date.now()
  const opportunity: ReactionWindow = {
    id: 'rw-1', kind: 'opportunity-attack', reactorActorId: 'fighter', triggeringActorId: 'goblin',
    reactorTokenId: 't-fighter', triggeringTokenId: 't-goblin', eligibleAttackIds: ['sword'],
    triggerDistanceFeet: 5, reactorGridX: 0, reactorGridY: 0, triggerFromGridX: 1, triggerFromGridY: 0,
    triggerToGridX: 2, triggerToGridY: 0, combatRound: 1, turnActorId: 'goblin',
    createdAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 60000).toISOString(),
  }
  const ready: ReactionWindow = {
    id: 'rw-ready', kind: 'readied-action', reactorActorId: 'fighter',
    readyActionId: 'ready-1', readyActionKind: 'attack', readyActionLabel: 'Longsword',
    triggerText: 'When the goblin opens the door', preparedTargetActorId: null,
    readySpellId: null, readySpellCastLevel: null,
    combatRound: 1, turnActorId: 'goblin', createdAt: new Date(now - 1000).toISOString(),
    expiresAt: new Date(now + 60000).toISOString(),
  }
  const readySpell: ReactionWindow = {
    ...ready,
    id: 'rw-spell',
    readyActionId: 'ready-spell',
    readyActionKind: 'spell',
    readyActionLabel: 'Bless',
    readySpellId: 'bless',
    readySpellCastLevel: 1,
  }
  const expired = { ...opportunity, id: 'rw-old', expiresAt: new Date(now - 1).toISOString() }
  const windows = normalizeReactionWindows([opportunity, ready, readySpell, expired, { nope: true }], now)
  assert.equal(windows.length, 3)
  assert.equal(windows.some((window) => window.kind === 'readied-action' && window.readyActionKind === 'spell'), true)
  assert.equal(hasPendingReactionForTriggeringActor(windows, 'goblin'), true)
  assert.equal(reactionWindowExpired(opportunity, now), false)
  assert.equal(reactionWindowExpired(expired, now), true)
})
