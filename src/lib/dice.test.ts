import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canPlayerViewDiceRoll,
  canPlayerViewGenericDiceActivity,
  genericDiceVisibilityForRoll,
  normalizeDiceLog,
  normalizeDiceRollEntry,
  normalizeGenericDiceActivity,
  structuredRollVisibilityForOwnedActor,
  structuredRollVisibilityForRole,
} from './dice'

test('dice log keeps public/private visibility and initiative math', () => {
  const entry = normalizeDiceRollEntry({
    id: 'roll-1',
    createdAt: '2026-09-20T00:00:00.000Z',
    visibility: 'public',
    rollerRole: 'player',
    rollerId: 'player-1',
    rollerName: 'Aria',
    reason: 'initiative',
    die: 'd20',
    rawRoll: 14,
    modifier: 3,
    total: 17,
    actorId: 'actor-1',
    actorName: 'Aria',
  })

  assert.ok(entry)
  assert.equal(entry.visibility, 'public')
  assert.equal(entry.rawRoll, 14)
  assert.equal(entry.modifier, 3)
  assert.equal(entry.total, 17)
})

test('dice log rejects malformed entries and keeps only the newest 100', () => {
  const entries = Array.from({ length: 105 }, (_, index) => ({
    id: `roll-${index}`,
    createdAt: '2026-09-20T00:00:00.000Z',
    visibility: index % 2 === 0 ? 'dm' : 'public',
    rollerRole: index % 2 === 0 ? 'dm' : 'player',
    rollerId: `roller-${index}`,
    rollerName: `Roller ${index}`,
    reason: 'd20',
    die: 'd20',
    rawRoll: 10,
    modifier: 0,
    total: 10,
    actorId: null,
    actorName: null,
  }))

  const normalized = normalizeDiceLog([
    { bad: true },
    ...entries,
  ])

  assert.equal(normalized.length, 100)
  assert.equal(normalized[0]?.id, 'roll-5')
  assert.equal(normalized.at(-1)?.id, 'roll-104')
})


test('legacy player-dm rolls remain visible only to the rolling player', () => {
  const entry = normalizeDiceRollEntry({
    id: 'death-save-1',
    createdAt: '2026-09-20T00:00:00.000Z',
    visibility: 'player-dm',
    rollerRole: 'player',
    rollerId: 'player-1',
    rollerName: 'Aria',
    reason: 'death-save',
    die: 'd20',
    rawRoll: 12,
    modifier: 0,
    total: 12,
    actorId: 'actor-1',
    actorName: 'Aria',
  })

  assert.ok(entry)
  assert.equal(entry.visibility, 'player-dm')
  assert.equal(canPlayerViewDiceRoll(entry, 'player-1'), true)
  assert.equal(canPlayerViewDiceRoll(entry, 'player-2'), false)
  assert.equal(canPlayerViewDiceRoll(entry, ''), false)
})


test('Stage 04 visibility policy makes every player roll public', () => {
  const purposes = [
    'attack',
    'damage',
    'saving-throw',
    'ability-check',
    'skill-check',
    'spell',
    'other',
  ] as const

  for (const purpose of purposes) {
    assert.equal(genericDiceVisibilityForRoll('player', purpose), 'public')
  }
})

test('Stage 04 visibility policy keeps DM rolls private except NPC damage', () => {
  assert.equal(genericDiceVisibilityForRoll('dm', 'attack'), 'dm-private')
  assert.equal(genericDiceVisibilityForRoll('dm', 'saving-throw'), 'dm-private')
  assert.equal(genericDiceVisibilityForRoll('dm', 'ability-check'), 'dm-private')
  assert.equal(genericDiceVisibilityForRoll('dm', 'skill-check'), 'dm-private')
  assert.equal(genericDiceVisibilityForRoll('dm', 'spell'), 'dm-private')
  assert.equal(genericDiceVisibilityForRoll('dm', 'other'), 'dm-private')
  assert.equal(genericDiceVisibilityForRoll('dm', 'damage'), 'public')
})

test('generic public rolls normalize with purpose and are visible to players', () => {
  const entry = normalizeGenericDiceActivity({
    type: 'dice-roll',
    id: 'generic-player-attack',
    rollerId: 'player-1',
    rollerName: 'Aria',
    role: 'player',
    purpose: 'attack',
    sides: 20,
    count: 1,
    modifier: 5,
    mode: 'normal',
    rolls: [[14]],
    total: 19,
    natural: 14,
    visibility: 'public',
    createdAt: '2026-09-20T00:00:00.000Z',
  })

  assert.ok(entry)
  assert.equal(entry.purpose, 'attack')
  assert.equal(entry.total, 19)
  assert.equal(canPlayerViewGenericDiceActivity(entry), true)
})

test('DM-private generic rolls cannot leak to players', () => {
  const entry = normalizeGenericDiceActivity({
    type: 'dice-roll',
    id: 'generic-dm-attack',
    rollerId: 'dm-1',
    rollerName: 'Dungeon Master',
    role: 'dm',
    purpose: 'attack',
    sides: 20,
    count: 1,
    modifier: 7,
    mode: 'normal',
    rolls: [[18]],
    total: 25,
    natural: 18,
    visibility: 'dm-private',
    createdAt: '2026-09-20T00:00:00.000Z',
  })

  assert.ok(entry)
  assert.equal(canPlayerViewGenericDiceActivity(entry), false)
})

test('player-owned structured saves are public while DM/NPC structured rolls stay private', () => {
  assert.equal(structuredRollVisibilityForRole('player'), 'public')
  assert.equal(structuredRollVisibilityForRole('dm'), 'dm')
  assert.equal(structuredRollVisibilityForOwnedActor('player-1'), 'public')
  assert.equal(structuredRollVisibilityForOwnedActor(null), 'dm')
})
