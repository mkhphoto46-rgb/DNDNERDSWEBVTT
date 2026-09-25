import assert from 'node:assert/strict'
import test from 'node:test'
import {
  actorHasReadiedAction,
  actorHasReadiedSpell,
  clearReadiedActionsAtActorTurnStart,
  hasOpenReactionWindowForReadiedAction,
  normalizeReadiedActions,
  normalizeReadiedSpellPayload,
  removeReadiedAction,
} from './readyActions'
import type { ReactionWindow } from '../types/reaction'
import type { ReadiedAction } from '../types/readyAction'

const readyAttack: ReadiedAction = {
  id: 'ready-1',
  actorId: 'fighter',
  kind: 'attack',
  triggerText: 'When the goblin opens the door',
  sourceTurnStartedAt: '2026-09-21T00:00:00.000Z',
  attackId: 'longsword',
  preparedTargetActorId: null,
  utility: null,
  spell: null,
  createdAt: '2026-09-21T00:00:01.000Z',
}

const readySpell: ReadiedAction = {
  ...readyAttack,
  id: 'ready-spell',
  kind: 'spell',
  attackId: null,
  spell: { spellId: 'bless', castLevel: 1 },
}

test('readied actions allow multiple legal preparations while rejecting duplicate ids and malformed payloads', () => {
  const actions = normalizeReadiedActions([
    readyAttack,
    { ...readyAttack, id: 'ready-2', triggerText: 'When the goblin moves' },
    { ...readyAttack },
    { id: 'bad', actorId: 'x', kind: 'attack' },
  ])
  assert.equal(actions.length, 2)
  assert.equal(actions[0].id, 'ready-1')
  assert.equal(actions[1].id, 'ready-2')
  assert.equal(actorHasReadiedAction(actions, 'fighter'), true)
})

test('readied spell payloads preserve a bounded cast level and mark the actor as holding a spell', () => {
  assert.deepEqual(normalizeReadiedSpellPayload({ spellId: 'bless', castLevel: 2 }), { spellId: 'bless', castLevel: 2 })
  assert.equal(normalizeReadiedSpellPayload({ spellId: 'bless', castLevel: 10 }), null)
  assert.equal(actorHasReadiedSpell([readyAttack, readySpell], 'fighter'), true)
})

test('a readied action expires when its actor next starts a turn', () => {
  const other = { ...readyAttack, id: 'ready-2', actorId: 'rogue' }
  assert.deepEqual(clearReadiedActionsAtActorTurnStart([readyAttack, other], 'fighter'), [other])
  assert.deepEqual(removeReadiedAction([readyAttack, other], 'ready-2'), [readyAttack])
})

test('readied action trigger windows are detected independently from opportunity attacks', () => {
  const window: ReactionWindow = {
    id: 'rw-ready',
    kind: 'readied-action',
    reactorActorId: 'fighter',
    readyActionId: 'ready-1',
    readyActionKind: 'attack',
    readyActionLabel: 'Longsword',
    triggerText: readyAttack.triggerText,
    preparedTargetActorId: null,
    readySpellId: null,
    readySpellCastLevel: null,
    combatRound: 1,
    turnActorId: 'goblin',
    createdAt: '2026-09-21T00:00:02.000Z',
    expiresAt: '2026-09-21T00:01:02.000Z',
  }
  assert.equal(hasOpenReactionWindowForReadiedAction([window], 'ready-1'), true)
})
