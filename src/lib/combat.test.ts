import assert from 'node:assert/strict'
import test from 'node:test'

import {
  advanceCombatTurn,
  beginCombatState,
  endCombatState,
  moveTiedCombatant,
  normalizeCombatState,
  prepareCombatState,
  rewindCombatTurn,
  setCombatantInitiative,
} from './combat'

import {
  normalizeActor,
} from './actors'

function actor(
  id: string,
  initiativeBonus: number,
  kind: 'player' | 'npc' | 'enemy' = 'enemy',
) {
  return normalizeActor({
    id,
    name: id,
    kind,
    ownerId: kind === 'player' ? `owner-${id}` : null,
    portraitAssetId: '',
    portraitUrl: '',
    level: 1,
    challengeRating: null,
    currentHp: 10,
    maxHp: 10,
    tempHp: 0,
    ac: 10,
    speedFeet: 30,
    initiativeBonus,
    proficiencyBonus: 2,
    abilities: {
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    },
    conditions: [],
    resources: [],
    sourceTemplateId: null,
    source: null,
    creatureSize: 'Medium',
    creatureType: 'humanoid',
    hitPointFormula: '',
    monsterStatBlock: null,
    characterSheet: null,
    gmNotes: '',
  })
}

test('combat preparation selects combatants without auto-rolling initiative', () => {
  const combat = prepareCombatState(
    [actor('fighter', 3, 'player'), actor('goblin', 2)],
    ['fighter', 'goblin'],
    '2026-09-20T00:00:00.000Z',
  )

  assert.equal(combat.active, true)
  assert.equal(combat.phase, 'setup')
  assert.equal(combat.round, 0)
  assert.equal(combat.currentActorId, null)
  assert.deepEqual(
    combat.combatants.map((entry) => [entry.actorId, entry.initiative]),
    [
      ['fighter', null],
      ['goblin', null],
    ],
  )
})

test('player and DM rolls can set initiative independently', () => {
  let combat = prepareCombatState(
    [actor('fighter', 3, 'player'), actor('goblin', 2)],
    ['fighter', 'goblin'],
  )

  combat = setCombatantInitiative(combat, 'fighter', 18, 'player-roll')
  combat = setCombatantInitiative(combat, 'goblin', 12, 'dm-roll')

  assert.equal(combat.combatants.find((entry) => entry.actorId === 'fighter')?.initiativeSource, 'player-roll')
  assert.equal(combat.combatants.find((entry) => entry.actorId === 'goblin')?.initiativeSource, 'dm-roll')
})

test('round one cannot begin until every selected combatant has initiative', () => {
  let combat = prepareCombatState(
    [actor('fighter', 3, 'player'), actor('goblin', 2)],
    ['fighter', 'goblin'],
  )

  combat = setCombatantInitiative(combat, 'fighter', 18, 'player-roll')
  const blocked = beginCombatState(combat)

  assert.equal(blocked.phase, 'setup')
  assert.equal(blocked.round, 0)
})

test('round one begins from the rolled totals and sorts descending', () => {
  let combat = prepareCombatState(
    [actor('fighter', 3, 'player'), actor('goblin', 2), actor('wizard', 1, 'player')],
    ['fighter', 'goblin', 'wizard'],
  )

  combat = setCombatantInitiative(combat, 'fighter', 8, 'player-roll')
  combat = setCombatantInitiative(combat, 'goblin', 19, 'dm-roll')
  combat = setCombatantInitiative(combat, 'wizard', 11, 'player-roll')
  combat = beginCombatState(combat)

  assert.equal(combat.phase, 'active')
  assert.equal(combat.round, 1)
  assert.deepEqual(
    combat.combatants.map((entry) => [entry.actorId, entry.initiative]),
    [
      ['goblin', 19],
      ['wizard', 11],
      ['fighter', 8],
    ],
  )
  assert.equal(combat.currentActorId, 'goblin')
})

test('next turn advances and wraps into the next round', () => {
  const base = normalizeCombatState({
    phase: 'active',
    active: true,
    round: 1,
    currentTurnIndex: 1,
    currentActorId: 'b',
    startedAt: 'now',
    combatants: [
      { actorId: 'a', initiative: 20, tieOrder: 0, initiativeSource: 'dm-roll' },
      { actorId: 'b', initiative: 10, tieOrder: 1, initiativeSource: 'player-roll' },
    ],
  })

  const next = advanceCombatTurn(base)
  assert.equal(next.round, 2)
  assert.equal(next.currentActorId, 'a')
  assert.equal(next.currentTurnIndex, 0)
})

test('previous turn rewinds across round boundary', () => {
  const base = normalizeCombatState({
    phase: 'active',
    active: true,
    round: 3,
    currentTurnIndex: 0,
    currentActorId: 'a',
    startedAt: 'now',
    combatants: [
      { actorId: 'a', initiative: 20, tieOrder: 0, initiativeSource: 'dm-roll' },
      { actorId: 'b', initiative: 10, tieOrder: 1, initiativeSource: 'player-roll' },
    ],
  })

  const previous = rewindCombatTurn(base)
  assert.equal(previous.round, 2)
  assert.equal(previous.currentActorId, 'b')
  assert.equal(previous.currentTurnIndex, 1)
})

test('manual initiative override re-sorts without losing the active actor', () => {
  const base = normalizeCombatState({
    phase: 'active',
    active: true,
    round: 2,
    currentTurnIndex: 1,
    currentActorId: 'b',
    startedAt: 'now',
    combatants: [
      { actorId: 'a', initiative: 20, tieOrder: 0, initiativeSource: 'dm-roll' },
      { actorId: 'b', initiative: 10, tieOrder: 1, initiativeSource: 'player-roll' },
    ],
  })

  const updated = setCombatantInitiative(base, 'b', 25, 'manual')
  assert.equal(updated.combatants[0]?.actorId, 'b')
  assert.equal(updated.currentActorId, 'b')
  assert.equal(updated.currentTurnIndex, 0)
  assert.equal(updated.combatants[0]?.initiativeSource, 'manual')
})

test('tied combatants can be manually reordered without changing initiative', () => {
  const base = normalizeCombatState({
    phase: 'active',
    active: true,
    round: 1,
    currentTurnIndex: 0,
    currentActorId: 'a',
    startedAt: 'now',
    combatants: [
      { actorId: 'a', initiative: 15, tieOrder: 0, initiativeSource: 'dm-roll' },
      { actorId: 'b', initiative: 15, tieOrder: 1, initiativeSource: 'player-roll' },
    ],
  })

  const moved = moveTiedCombatant(base, 'b', 'up')
  assert.equal(moved.combatants[0]?.actorId, 'b')
  assert.equal(moved.combatants[0]?.initiative, 15)
  assert.equal(moved.currentActorId, 'a')
})

test('normalization drops duplicate and unknown combatants when valid ids are supplied', () => {
  const combat = normalizeCombatState(
    {
      phase: 'setup',
      active: true,
      round: 0,
      currentTurnIndex: -1,
      currentActorId: null,
      startedAt: 'now',
      combatants: [
        { actorId: 'a', initiative: null, tieOrder: 0, initiativeSource: null },
        { actorId: 'a', initiative: 9, tieOrder: 1, initiativeSource: 'manual' },
        { actorId: 'missing', initiative: 8, tieOrder: 2, initiativeSource: 'manual' },
      ],
    },
    ['a'],
  )

  assert.equal(combat.combatants.length, 1)
  assert.equal(combat.combatants[0]?.actorId, 'a')
})

test('end combat returns a clean inactive state', () => {
  assert.deepEqual(endCombatState(), {
    phase: 'inactive',
    active: false,
    round: 0,
    currentTurnIndex: -1,
    currentActorId: null,
    combatants: [],
    startedAt: null,
  })
})

test('player-safe active combat can intentionally hide the current actor', () => {
  const combat = normalizeCombatState({
    phase: 'active',
    active: true,
    round: 4,
    currentTurnIndex: -1,
    currentActorId: null,
    startedAt: 'now',
    combatants: [
      { actorId: 'visible', initiative: 12, tieOrder: 0, initiativeSource: 'player-roll' },
    ],
  })

  assert.equal(combat.phase, 'active')
  assert.equal(combat.round, 4)
  assert.equal(combat.currentActorId, null)
  assert.equal(combat.currentTurnIndex, -1)
})


test('legacy M2 v1 active combat is reopened as setup with all old auto-rolls cleared', () => {
  const legacy = normalizeCombatState({
    active: true,
    round: 2,
    currentTurnIndex: 1,
    currentActorId: 'fighter',
    startedAt: '2026-09-20T00:00:00.000Z',
    combatants: [
      { actorId: 'goblin', initiative: 18, tieOrder: 0 },
      { actorId: 'fighter', initiative: 15, tieOrder: 1 },
    ],
  })

  assert.equal(legacy.phase, 'setup')
  assert.equal(legacy.active, true)
  assert.equal(legacy.round, 0)
  assert.equal(legacy.currentTurnIndex, -1)
  assert.equal(legacy.currentActorId, null)
  assert.deepEqual(
    legacy.combatants.map((entry) => ({
      actorId: entry.actorId,
      initiative: entry.initiative,
      initiativeSource: entry.initiativeSource,
    })),
    [
      { actorId: 'goblin', initiative: null, initiativeSource: null },
      { actorId: 'fighter', initiative: null, initiativeSource: null },
    ],
  )
})
