import assert from 'node:assert/strict'
import { io } from 'socket.io-client'

const baseUrl = process.env.VTT_TEST_URL ?? 'http://localhost:3101'

const request = async (path, options) => {
  const response = await fetch(`${baseUrl}${path}`, options)
  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
  return body
}

const connect = () => new Promise((resolve, reject) => {
  const socket = io(baseUrl, { transports: ['websocket'], forceNew: true })
  socket.once('connect', () => resolve(socket))
  socket.once('connect_error', reject)
})

const emit = (socket, event, payload) => new Promise((resolve, reject) => {
  socket.timeout(5000).emit(event, payload, (error, result) => {
    if (error) return reject(error)
    if (!result?.ok) return reject(new Error(result?.error ?? `${event} failed`))
    resolve(result)
  })
})

const campaign = await request('/api/campaigns', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Persistence Smoke Test' }),
})

const name = 'Persistent Adventurer'
const keyA = 'persistence-smoke-key-a'
const keyB = 'persistence-smoke-key-b'

const firstSocket = await connect()
const firstJoin = await emit(firstSocket, 'session:join', {
  role: 'player', name, joinCode: campaign.joinCode, playerKey: keyA,
})
const firstActor = firstJoin.state.actors.find((actor) => actor.ownerId === firstJoin.player.id)
assert.ok(firstActor)

await emit(firstSocket, 'actor:update-own-sheet', {
  actorId: firstActor.id,
  patch: {
    level: 5,
    currentHp: 7,
    maxHp: 13,
    ac: 16,
    characterSheet: {
      ...firstActor.characterSheet,
      className: 'Wizard',
      knownSpellIds: ['fireball'],
      preparedSpellIds: ['fireball'],
      spentSpellSlots: [1, 0, 1],
      notes: 'persists-after-reconnect',
    },
  },
})
await emit(firstSocket, 'dice:roll', { sides: 6, count: 2, modifier: 1, mode: 'normal' })
firstSocket.disconnect()

const secondSocket = await connect()
const sameKeyJoin = await emit(secondSocket, 'session:join', {
  role: 'player', name, joinCode: campaign.joinCode, playerKey: keyA,
})
assert.equal(sameKeyJoin.player.id, firstJoin.player.id)
const restored = sameKeyJoin.state.actors.find((actor) => actor.id === firstActor.id)
assert.equal(restored.currentHp, 7)
assert.equal(restored.maxHp, 13)
assert.equal(restored.ac, 16)
assert.equal(restored.level, 5)
assert.deepEqual(restored.characterSheet.knownSpellIds, ['fireball'])
assert.deepEqual(restored.characterSheet.preparedSpellIds, ['fireball'])
assert.deepEqual(restored.characterSheet.spentSpellSlots, [1, 0, 1])
assert.equal(restored.characterSheet.notes, 'persists-after-reconnect')
secondSocket.disconnect()

const thirdSocket = await connect()
const recoveredOriginJoin = await emit(thirdSocket, 'session:join', {
  role: 'player', name, joinCode: campaign.joinCode, playerKey: keyB,
})
assert.equal(recoveredOriginJoin.player.id, firstJoin.player.id)
assert.equal(recoveredOriginJoin.characterCreated, false)
const recovered = recoveredOriginJoin.state.actors.find((actor) => actor.id === firstActor.id)
assert.equal(recovered.currentHp, 7)
assert.deepEqual(recovered.characterSheet.preparedSpellIds, ['fireball'])
thirdSocket.disconnect()

const diskState = await request(`/api/campaigns/${encodeURIComponent(campaign.id)}/state`)
assert.equal(diskState.lastAction.type, 'dice-roll')
assert.equal(diskState.activityLog.at(-1).type, 'dice-roll')

console.log(JSON.stringify({
  ok: true,
  campaignId: campaign.id,
  playerId: firstJoin.player.id,
  actorId: firstActor.id,
  restoredHp: recovered.currentHp,
  restoredPreparedSpells: recovered.characterSheet.preparedSpellIds,
  originChangeRecovered: true,
  lastActionPersisted: true,
}, null, 2))
