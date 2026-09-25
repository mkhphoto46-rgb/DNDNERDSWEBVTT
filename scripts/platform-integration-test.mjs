import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { io } from 'socket.io-client'

const currentFile = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(currentFile), '..')
const testDataRoot = path.join(root, '_platform-test-data')
const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')

if (!fs.existsSync(tsxCli)) {
  throw new Error('tsx is not installed. Run npm install or npm ci before the platform test.')
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const findFreePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer()

  probe.unref()

  probe.once('error', reject)

  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address()

    if (!address || typeof address === 'string') {
      probe.close()
      reject(new Error('Could not allocate an isolated platform-test port.'))
      return
    }

    const selectedPort = address.port

    probe.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve(selectedPort)
    })
  })
})

const configuredPort = String(process.env.VTT_PLATFORM_TEST_PORT ?? '').trim()
const configuredPortNumber = Number(configuredPort)

const port =
  configuredPort &&
  Number.isInteger(configuredPortNumber) &&
  configuredPortNumber > 0 &&
  configuredPortNumber <= 65535
    ? configuredPortNumber
    : await findFreePort()

const baseUrl = `http://127.0.0.1:${port}`

console.log(`[platform-test] Isolated test port: ${port}`)

fs.rmSync(testDataRoot, { recursive: true, force: true })

let server = null
let serverOutput = ''

const request = async (route, options = {}) => {
  const response = await fetch(`${baseUrl}${route}`, options)
  let body = null

  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (!response.ok) {
    const error = new Error(body?.error ?? `HTTP ${response.status}`)
    error.status = response.status
    error.body = body
    throw error
  }

  return body
}

const rawRequest = (route, options = {}) => fetch(`${baseUrl}${route}`, options)

const connect = (extraHeaders) => new Promise((resolve, reject) => {
  const socket = io(baseUrl, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    ...(extraHeaders ? { extraHeaders } : {}),
  })

  const timer = setTimeout(() => {
    socket.disconnect()
    reject(new Error('Socket connection timed out.'))
  }, 5000)

  socket.once('connect', () => {
    clearTimeout(timer)
    resolve(socket)
  })

  socket.once('connect_error', (error) => {
    clearTimeout(timer)
    reject(error)
  })
})

const emitRaw = (socket, event, payload) => new Promise((resolve, reject) => {
  socket.timeout(5000).emit(event, payload, (error, result) => {
    if (error) return reject(error)
    resolve(result)
  })
})

const STATE_CHANGING_EVENTS = new Set([
  'effect:apply',
  'effect:remove',
  'turn:use-core-action',
  'turn:use-utility-action',
  'ready:prepare',
  'ready:trigger',
  'ready:cancel',
  'combat:end-own-turn',
  'dm:override-turn-economy',
  'spell:end-concentration',
  'spell:cast',
  'combat:resolve-attack',
  'reaction:respond',
  'actor:update-own-sheet',
  'token:place-own',
  'actor:apply-health',
  'actor:roll-death-save',
  'combat:start',
  'combat:roll-player-initiative',
  'combat:roll-dm-initiative',
  'combat:begin',
  'combat:set-initiative',
  'combat:move-tie',
  'combat:next-turn',
  'combat:previous-turn',
  'combat:end',
  'token:move',
])

let mutationRequestCounter = 0

const nextMutationRequestId = () => {
  mutationRequestCounter += 1
  return `platform_${Date.now()}_${mutationRequestCounter}`
}

const withFreshMutationRequestId = (event, payload) => {
  if (!STATE_CHANGING_EVENTS.has(event)) {
    return payload
  }

  const objectPayload =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload
      : {}

  if (
    typeof objectPayload._requestId === 'string' &&
    objectPayload._requestId.trim()
  ) {
    return objectPayload
  }

  return {
    ...objectPayload,
    _requestId: nextMutationRequestId(),
  }
}

const emit = async (socket, event, payload) => {
  const result = await emitRaw(
    socket,
    event,
    withFreshMutationRequestId(event, payload),
  )

  if (!result?.ok) {
    throw new Error(result?.error ?? `${event} failed`)
  }

  return result
}

const waitForSocketEvent = (socket, event, timeoutMs = 5000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent)
      reject(new Error(`Timed out waiting for ${event}.`))
    }, timeoutMs)

    const onEvent = (payload) => {
      clearTimeout(timer)
      resolve(payload)
    }

    socket.once(event, onEvent)
  })

const waitForSpawnedServer = async () => {
  const marker = `DM URL: http://localhost:${port}`
  const deadline = Date.now() + 15000

  while (Date.now() < deadline) {
    if (server?.exitCode !== null) {
      throw new Error(
        `The isolated platform-test server exited before listening on port ${port}.\n${serverOutput}`,
      )
    }

    if (serverOutput.includes(marker)) {
      return
    }

    await delay(100)
  }

  throw new Error(
    `The isolated platform-test server never confirmed ownership of port ${port}.\n${serverOutput}`,
  )
}

const waitForHealth = async () => {
  await waitForSpawnedServer()

  const deadline = Date.now() + 15000

  while (Date.now() < deadline) {
    if (server?.exitCode !== null) {
      throw new Error(
        `The isolated platform-test server exited while waiting for health.\n${serverOutput}`,
      )
    }

    try {
      const health = await request('/api/health')
      if (health?.ok) return
    } catch {
      // Server is still starting.
    }

    await delay(150)
  }

  throw new Error(`Server did not become healthy. Output:\n${serverOutput}`)
}

const startServer = async () => {
  serverOutput = ''

  server = spawn(
    process.execPath,
    [tsxCli, 'server/server.ts'],
    {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        DND_VTT_DATA_ROOT: testDataRoot,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  server.stdout.on('data', (chunk) => {
    serverOutput += chunk.toString()
  })

  server.stderr.on('data', (chunk) => {
    serverOutput += chunk.toString()
  })

  server.once('exit', (code) => {
    if (code && code !== 0) {
      serverOutput += `\n[platform-test] server exited with code ${code}\n`
    }
  })

  await waitForHealth()
}

const stopServer = async () => {
  if (!server || server.exitCode !== null) return

  const child = server

  try {
    await rawRequest('/api/platform/shutdown', { method: 'POST' })
  } catch {
    // Fall back to terminating the isolated test process below.
  }

  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL')
      resolve()
    }, 7000)

    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

let dmSocket = null
let playerSocket = null
let visibilityPlayerSocket = null
let recoveredSocket = null
let remoteSocket = null
let remoteDmSocket = null
let success = false

try {
  await startServer()

  const health = await request('/api/health')
  assert.equal(health.ok, true)

  const hostInfo = await request('/api/host-info')
  assert.ok(Array.isArray(hostInfo.lanUrls))

  const proxiedHostInfo = await rawRequest('/api/host-info', {
    headers: { 'x-forwarded-for': '203.0.113.10' },
  })
  assert.equal(proxiedHostInfo.status, 403)

  const proxiedDevPage = await rawRequest('/dev/connect', {
    headers: { 'x-forwarded-for': '203.0.113.10' },
  })
  assert.equal(proxiedDevPage.status, 403)

  const campaign = await request('/api/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Platform Foundation Test' }),
  })

  dmSocket = await connect()
  const dmJoin = await emit(dmSocket, 'session:join', {
    role: 'dm',
    campaignId: campaign.id,
    name: 'Dungeon Master',
  })
  assert.equal(dmJoin.campaign.id, campaign.id)

  remoteDmSocket = await connect({ 'x-forwarded-for': '203.0.113.11' })
  const remoteDmJoin = await emitRaw(remoteDmSocket, 'session:join', {
    role: 'dm',
    campaignId: campaign.id,
    name: 'Remote DM',
  })
  assert.equal(remoteDmJoin?.ok, false)
  remoteDmSocket.disconnect()
  remoteDmSocket = null

  const playerName = 'Persistent Adventurer'
  const keyA = 'platform-foundation-player-key-a'
  const keyB = 'platform-foundation-player-key-b'

  playerSocket = await connect()
  const firstJoin = await emit(playerSocket, 'session:join', {
    role: 'player',
    name: playerName,
    joinCode: campaign.joinCode,
    playerKey: keyA,
  })

  const actor = firstJoin.state.actors.find(
    (candidate) => candidate.ownerId === firstJoin.player.id,
  )
  assert.ok(actor)
  const initialAuthoritativeCurrentHp = actor.currentHp
  const initialAuthoritativeLevel = actor.level
  const initialAuthoritativeXp = actor.characterSheet?.experiencePoints ?? 0

  visibilityPlayerSocket = await connect()
  const visibilityJoin = await emit(visibilityPlayerSocket, 'session:join', {
    role: 'player',
    name: 'Visibility Viewer',
    joinCode: campaign.joinCode,
    playerKey: 'platform-stage04-visibility-viewer-key',
  })
  assert.ok(visibilityJoin.player.id)

  const playerPurposes = [
    'attack',
    'saving-throw',
    'ability-check',
    'skill-check',
    'spell',
  ]

  for (const purpose of playerPurposes) {
    const eventPromise = waitForSocketEvent(visibilityPlayerSocket, 'dice:result')
    await emit(playerSocket, 'dice:roll', {
      sides: 20,
      count: 1,
      modifier: 2,
      mode: 'normal',
      purpose,
      ability: purpose === 'saving-throw' ? 'dexterity' : undefined,
      skill: purpose === 'skill-check' ? 'perception' : undefined,
    })
    const event = await eventPromise
    assert.equal(event.visibility, 'public')
    assert.equal(event.role, 'player')
    assert.equal(event.purpose, purpose)
  }

  const privatePurposes = [
    'attack',
    'saving-throw',
    'ability-check',
    'skill-check',
    'spell',
    'other',
  ]

  for (const purpose of privatePurposes) {
    const privateStatePromise = waitForSocketEvent(
      visibilityPlayerSocket,
      'campaign:state-changed',
    )
    await emit(dmSocket, 'dice:roll', {
      sides: 20,
      count: 1,
      modifier: 5,
      mode: 'normal',
      purpose,
      ability: purpose === 'saving-throw' ? 'dexterity' : undefined,
      skill: purpose === 'skill-check' ? 'perception' : undefined,
    })
    const stateAfterPrivateDmRoll = await privateStatePromise
    assert.equal(
      (stateAfterPrivateDmRoll.activityLog ?? []).some(
        (entry) =>
          entry?.type === 'dice-roll' &&
          entry?.role === 'dm' &&
          entry?.visibility === 'dm-private',
      ),
      false,
    )
    assert.notEqual(stateAfterPrivateDmRoll.lastAction?.visibility, 'dm-private')
  }

  const dmDamageEventPromise = waitForSocketEvent(
    visibilityPlayerSocket,
    'dice:result',
  )
  await emit(dmSocket, 'dice:roll', {
    sides: 8,
    count: 2,
    modifier: 3,
    mode: 'normal',
    purpose: 'damage',
  })
  const dmDamageEvent = await dmDamageEventPromise
  assert.equal(dmDamageEvent.visibility, 'public')
  assert.equal(dmDamageEvent.role, 'dm')
  assert.equal(dmDamageEvent.purpose, 'damage')

  await emit(playerSocket, 'actor:update-own-sheet', {
    actorId: actor.id,
    patch: {
      level: 5,
      currentHp: 7,
      maxHp: 13,
      ac: 16,
      characterSheet: {
        ...actor.characterSheet,
        className: 'Wizard',
        experiencePoints: 999999,
        notes: 'survives-server-restart',
      },
    },
  })

  let state = await request(`/api/campaigns/${encodeURIComponent(campaign.id)}/state`)
  assert.ok(Number.isInteger(state.stateRevision))

  const actorAfterOwnSheetUpdate = state.actors.find(
    (candidate) => candidate.id === actor.id,
  )
  assert.ok(actorAfterOwnSheetUpdate)
  assert.equal(
    actorAfterOwnSheetUpdate.currentHp,
    initialAuthoritativeCurrentHp,
  )
  assert.equal(actorAfterOwnSheetUpdate.maxHp, 13)
  assert.equal(actorAfterOwnSheetUpdate.ac, 16)
  assert.equal(actorAfterOwnSheetUpdate.level, initialAuthoritativeLevel)
  assert.equal(actorAfterOwnSheetUpdate.characterSheet.experiencePoints, initialAuthoritativeXp)
  assert.equal(
    actorAfterOwnSheetUpdate.characterSheet.notes,
    'survives-server-restart',
  )

  const stateBeforeMap = state
  const mapState = {
    ...state,
    activeMap: {
      id: 'platform-test-map',
      assetType: 'map',
      displayName: 'Platform Test Map',
      relativePath: '',
      contentHash: '',
      byteSize: 0,
      mimeType: 'image/png',
      updatedAt: new Date().toISOString(),
      url: '',
    },
  }

  const savedMap = await request(`/api/campaigns/${encodeURIComponent(campaign.id)}/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mapState),
  })
  assert.ok(savedMap.state.stateRevision > stateBeforeMap.stateRevision)

  const placed = await emit(playerSocket, 'token:place-own', {
    actorId: actor.id,
    gridX: 2,
    gridY: 3,
  })
  assert.ok(placed.tokenId)

  state = await request(`/api/campaigns/${encodeURIComponent(campaign.id)}/state`)
  const stage05EnemyId = 'stage05-enemy-actor'
  const stateWithStage05Enemy = {
    ...state,
    actors: [
      ...state.actors,
      {
        id: stage05EnemyId,
        name: 'Stage 05 Enemy',
        kind: 'enemy',
        ownerId: null,
        currentHp: 18,
        maxHp: 18,
        tempHp: 0,
        ac: 13,
        speedFeet: 30,
        conditions: [],
        effects: [],
        resources: [],
      },
    ],
    tokens: [
      ...(state.tokens ?? []),
      {
        id: 'stage05-enemy-token',
        actorId: stage05EnemyId,
        assetId: 'stage05-enemy-asset',
        imageUrl: '/assets/tokens/adventurer-token.svg',
        mapId: 'platform-test-map',
        gridX: 5,
        gridY: 3,
        size: 1,
        visible: true,
        color: '#C9954B',
        movementUsedFeet: 0,
      },
    ],
  }

  await request(`/api/campaigns/${encodeURIComponent(campaign.id)}/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(stateWithStage05Enemy),
  })

  const targetVisiblePromise = waitForSocketEvent(
    visibilityPlayerSocket,
    'campaign:state-changed',
  )
  await emit(playerSocket, 'target:set', { targetActorId: stage05EnemyId })
  const targetVisibleState = await targetVisiblePromise
  assert.ok(
    (targetVisibleState.targetSelections ?? []).some(
      (selection) =>
        selection.controllerId === firstJoin.player.id &&
        selection.targetActorId === stage05EnemyId,
    ),
  )

  const playerManualCondition = await emitRaw(playerSocket, 'effect:apply', {
    _requestId: nextMutationRequestId(),
    targetActorId: stage05EnemyId,
    kind: 'condition',
    scope: 'all-d20',
    value: 0,
    name: 'Blinded',
  })
  assert.equal(playerManualCondition?.ok, false)

  const playerManualRemove = await emitRaw(playerSocket, 'effect:remove', {
    _requestId: nextMutationRequestId(),
    targetActorId: stage05EnemyId,
    effectId: 'not-a-real-effect',
  })
  assert.equal(playerManualRemove?.ok, false)

  await emit(dmSocket, 'target:set', {
    targetActorId: stage05EnemyId,
    sourceActorId: actor.id,
  })
  const conditionVisiblePromise = waitForSocketEvent(
    visibilityPlayerSocket,
    'campaign:state-changed',
  )
  const dmCondition = await emit(dmSocket, 'effect:apply', {
    targetActorId: stage05EnemyId,
    sourceActorId: actor.id,
    kind: 'condition',
    scope: 'all-d20',
    value: 0,
    name: 'Blinded',
  })
  assert.equal(dmCondition.effect.kind, 'condition')
  const conditionVisibleState = await conditionVisiblePromise
  const publicEnemy = conditionVisibleState.actors.find(
    (candidate) => candidate.id === stage05EnemyId,
  )
  assert.ok(publicEnemy)
  assert.ok((publicEnemy.conditions ?? []).includes('Blinded'))
  assert.ok((publicEnemy.effects ?? []).some((effect) => effect.name === 'Blinded'))

  const unsupportedCondition = await emitRaw(dmSocket, 'effect:apply', {
    _requestId: nextMutationRequestId(),
    targetActorId: stage05EnemyId,
    sourceActorId: actor.id,
    kind: 'condition',
    scope: 'all-d20',
    value: 0,
    name: 'Stunned',
  })
  assert.equal(unsupportedCondition?.ok, false)

  await emit(dmSocket, 'target:set', {
    targetActorId: actor.id,
    sourceActorId: stage05EnemyId,
  })
  const tempHpVisiblePromise = waitForSocketEvent(
    visibilityPlayerSocket,
    'campaign:state-changed',
  )
  await emit(dmSocket, 'effect:apply', {
    targetActorId: actor.id,
    sourceActorId: stage05EnemyId,
    kind: 'temp-hp',
    scope: 'all-d20',
    value: 6,
  })
  const tempHpVisibleState = await tempHpVisiblePromise
  assert.equal(
    tempHpVisibleState.actors.find((candidate) => candidate.id === actor.id)?.tempHp,
    6,
  )

  const dmDebuff = await emit(dmSocket, 'effect:apply', {
    targetActorId: actor.id,
    sourceActorId: stage05EnemyId,
    kind: 'disadvantage',
    scope: 'attack',
    value: 0,
    name: 'Enemy Hex',
  })
  assert.equal(dmDebuff.effect.sourceRole, 'dm')

  // The attacker has Enemy Hex (Disadvantage), while the selected target is
  // Blinded (Advantage for attacks against it). D&D Advantage + Disadvantage
  // cancel, so the first roll must be Normal.
  const mechanicalRollPromise = waitForSocketEvent(visibilityPlayerSocket, 'dice:result')
  await emit(playerSocket, 'dice:roll', {
    sides: 20,
    count: 1,
    modifier: 0,
    mode: 'normal',
    purpose: 'attack',
  })
  const mechanicalRoll = await mechanicalRollPromise
  assert.equal(mechanicalRoll.mode, 'normal')

  // DM effect removal is target-selection authoritative. The DM had switched
  // selection to the player to apply Temp HP / Enemy Hex, so select the
  // Blinded enemy again before removing that effect.
  await emit(dmSocket, 'target:set', {
    targetActorId: stage05EnemyId,
    sourceActorId: actor.id,
  })

  // Create the removal-state waiter only after the selection change, so the
  // target:set broadcast cannot satisfy this promise by mistake.
  const blindRemovedPromise = waitForSocketEvent(
    visibilityPlayerSocket,
    'campaign:state-changed',
  )
  await emit(dmSocket, 'effect:remove', {
    targetActorId: stage05EnemyId,
    effectId: dmCondition.effect.id,
  })
  const blindRemovedState = await blindRemovedPromise
  const unblindedEnemy = blindRemovedState.actors.find(
    (candidate) => candidate.id === stage05EnemyId,
  )
  assert.ok(unblindedEnemy)
  assert.equal((unblindedEnemy.conditions ?? []).includes('Blinded'), false)

  const disadvantageOnlyPromise = waitForSocketEvent(
    visibilityPlayerSocket,
    'dice:result',
  )
  await emit(playerSocket, 'dice:roll', {
    sides: 20,
    count: 1,
    modifier: 0,
    mode: 'normal',
    purpose: 'attack',
  })
  const disadvantageOnlyRoll = await disadvantageOnlyPromise
  assert.equal(disadvantageOnlyRoll.mode, 'disadvantage')

  const playerRemoveDmEffect = await emitRaw(playerSocket, 'effect:remove', {
    _requestId: nextMutationRequestId(),
    targetActorId: actor.id,
    effectId: dmDebuff.effect.id,
  })
  assert.equal(playerRemoveDmEffect?.ok, false)

  const blessVisiblePromise = waitForSocketEvent(
    visibilityPlayerSocket,
    'campaign:state-changed',
  )
  const blessCast = await emit(dmSocket, 'spell:cast', {
    actorId: stage05EnemyId,
    spellId: 'bless',
    castLevel: 1,
    targetActorIds: [actor.id],
  })
  assert.equal(blessCast.automated, true)
  const blessedState = await blessVisiblePromise
  const blessedActor = blessedState.actors.find((candidate) => candidate.id === actor.id)
  assert.ok((blessedActor?.effects ?? []).some((effect) => effect.name === 'Bless'))

  const blessedSavePromise = waitForSocketEvent(visibilityPlayerSocket, 'dice:result')
  await emit(playerSocket, 'dice:roll', {
    sides: 20,
    count: 1,
    modifier: 0,
    mode: 'normal',
    purpose: 'saving-throw',
    ability: 'dexterity',
  })
  const blessedSave = await blessedSavePromise
  assert.ok(Array.isArray(blessedSave.bonusDiceResults))
  assert.ok(blessedSave.bonusDiceResults.some((entry) => entry.name === 'Bless' && entry.sides === 4))

  const unsupportedSpell = await emitRaw(dmSocket, 'spell:cast', {
    _requestId: nextMutationRequestId(),
    actorId: stage05EnemyId,
    spellId: 'fireball',
    castLevel: 3,
    targetActorIds: [],
  })
  assert.equal(unsupportedSpell?.ok, false)

  const playerTurnOverrideAttempt = await emitRaw(playerSocket, 'dm:override-turn-economy', {
    _requestId: nextMutationRequestId(),
    actorId: actor.id,
    patch: { actionMax: 9 },
    label: 'unauthorized player override',
  })
  assert.equal(playerTurnOverrideAttempt?.ok, false)

  const dmTurnOverride = await emit(dmSocket, 'dm:override-turn-economy', {
    actorId: actor.id,
    patch: {
      actionMax: 2,
      bonusActionMax: 2,
      reactionMax: 2,
      movementBonusFeet: 10,
      attackLimit: 3,
    },
    label: 'Platform test override',
  })
  assert.equal(dmTurnOverride.economy.actionMax, 2)
  assert.equal(dmTurnOverride.economy.bonusActionMax, 2)
  assert.equal(dmTurnOverride.economy.reactionMax, 2)
  assert.equal(dmTurnOverride.economy.movementBonusFeet, 10)
  assert.equal(dmTurnOverride.economy.attackLimit, 3)

  visibilityPlayerSocket.disconnect()
  visibilityPlayerSocket = null

  state = await request(`/api/campaigns/${encodeURIComponent(campaign.id)}/state`)
  const hiddenState = {
    ...state,
    tokens: state.tokens.map((token) =>
      token.id === placed.tokenId
        ? { ...token, visible: false }
        : token,
    ),
  }

  await request(`/api/campaigns/${encodeURIComponent(campaign.id)}/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(hiddenState),
  })

  const duplicatePlacement = await emitRaw(playerSocket, 'token:place-own', {
    _requestId: nextMutationRequestId(),
    actorId: actor.id,
    gridX: 4,
    gridY: 4,
  })
  assert.equal(duplicatePlacement?.ok, false)

  const staleState = await request(`/api/campaigns/${encodeURIComponent(campaign.id)}/state`)
  await emit(playerSocket, 'dice:roll', {
    sides: 6,
    count: 1,
    modifier: 0,
    mode: 'normal',
  })

  const staleSaveResponse = await rawRequest(
    `/api/campaigns/${encodeURIComponent(campaign.id)}/state`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...staleState,
        devNote: 'this stale write must be rejected',
      }),
    },
  )
  assert.equal(staleSaveResponse.status, 409)

  remoteSocket = await connect({ 'x-forwarded-for': '203.0.113.12' })
  const remoteTakeover = await emitRaw(remoteSocket, 'session:join', {
    role: 'player',
    name: playerName,
    joinCode: campaign.joinCode,
    playerKey: 'remote-takeover-key-12345678',
  })
  assert.equal(remoteTakeover?.ok, false)
  remoteSocket.disconnect()
  remoteSocket = null

  const playerRecoveryGrantAttempt = await emitRaw(
    playerSocket,
    'player:allow-seat-recovery',
    { playerId: firstJoin.player.id },
  )
  assert.equal(playerRecoveryGrantAttempt?.ok, false)

  playerSocket.disconnect()
  playerSocket = null

  const recoveryGrant = await emit(dmSocket, 'player:allow-seat-recovery', {
    playerId: firstJoin.player.id,
  })
  assert.equal(recoveryGrant.playerId, firstJoin.player.id)

  recoveredSocket = await connect({ 'x-forwarded-for': '203.0.113.13' })
  const recoveredJoin = await emit(recoveredSocket, 'session:join', {
    role: 'player',
    name: playerName,
    joinCode: campaign.joinCode,
    playerKey: keyB,
  })
  assert.equal(recoveredJoin.player.id, firstJoin.player.id)
  assert.equal(recoveredJoin.characterCreated, false)

  const snapshot = await request(
    `/api/campaigns/${encodeURIComponent(campaign.id)}/snapshots`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Platform Test Snapshot' }),
    },
  )
  assert.ok(snapshot.id)

  const backupDir = path.join(testDataRoot, 'campaigns', campaign.id, 'backups')
  const backupFiles = fs.readdirSync(backupDir).filter((name) => name.endsWith('.sqlite'))
  assert.ok(backupFiles.length >= 1)

  const beforeRestoreMutation = await request(
    `/api/campaigns/${encodeURIComponent(campaign.id)}/state`,
  )
  await request(`/api/campaigns/${encodeURIComponent(campaign.id)}/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...beforeRestoreMutation,
      devNote: 'must-disappear-after-restore',
    }),
  })

  await request(
    `/api/campaigns/${encodeURIComponent(campaign.id)}/snapshots/${encodeURIComponent(snapshot.id)}/restore`,
    { method: 'POST' },
  )

  const restoredState = await request(
    `/api/campaigns/${encodeURIComponent(campaign.id)}/state`,
  )
  assert.notEqual(restoredState.devNote, 'must-disappear-after-restore')

  const restoreBackupFiles = fs.readdirSync(backupDir).filter((name) => name.endsWith('.sqlite'))
  assert.ok(restoreBackupFiles.length >= backupFiles.length + 2)

  recoveredSocket.disconnect()
  recoveredSocket = null
  dmSocket.disconnect()
  dmSocket = null

  await stopServer()
  await startServer()

  const statusAfterRestart = await request('/api/platform/status')
  assert.equal(statusAfterRestart.ok, true)

  recoveredSocket = await connect()
  const restartJoin = await emit(recoveredSocket, 'session:join', {
    role: 'player',
    name: playerName,
    joinCode: campaign.joinCode,
    playerKey: keyB,
  })

  assert.equal(restartJoin.player.id, firstJoin.player.id)
  const restartedActor = restartJoin.state.actors.find(
    (candidate) => candidate.id === actor.id,
  )
  assert.ok(restartedActor)
  assert.equal(
    restartedActor.currentHp,
    initialAuthoritativeCurrentHp,
  )
  assert.equal(restartedActor.maxHp, 13)
  assert.equal(restartedActor.ac, 16)
  assert.equal(restartedActor.level, initialAuthoritativeLevel)
  assert.equal(restartedActor.characterSheet.notes, 'survives-server-restart')

  const secondCampaign = await request('/api/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Character Vault Switch Test' }),
  })

  const leaveFirstCampaign = await emit(
    recoveredSocket,
    'session:leave',
    {},
  )
  assert.equal(leaveFirstCampaign.previousCampaignId, campaign.id)

  const switchedJoin = await emit(recoveredSocket, 'session:join', {
    role: 'player',
    name: playerName,
    joinCode: secondCampaign.joinCode,
    playerKey: keyB,
  })
  assert.equal(switchedJoin.characterRestored, true)

  const switchedActor = switchedJoin.state.actors.find(
    (candidate) => candidate.ownerId === switchedJoin.player.id,
  )
  assert.ok(switchedActor)
  assert.equal(switchedActor.level, initialAuthoritativeLevel)
  assert.equal(switchedActor.maxHp, 13)
  assert.equal(switchedActor.currentHp, 13)
  assert.equal(switchedActor.ac, 16)
  assert.equal(switchedActor.characterSheet.className, 'Wizard')
  assert.equal(switchedActor.characterSheet.notes, 'survives-server-restart')
  assert.deepEqual(switchedActor.characterSheet.spentSpellSlots, [])
  assert.equal(switchedActor.characterSheet.concentratingSpellId, '')

  const secondCampaignState = await request(
    `/api/campaigns/${encodeURIComponent(secondCampaign.id)}/state`,
  )

  await request(
    `/api/campaigns/${encodeURIComponent(secondCampaign.id)}/state`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...secondCampaignState,
        actors: secondCampaignState.actors.filter(
          (candidate) => candidate.id !== switchedActor.id,
        ),
        tokens: (secondCampaignState.tokens ?? []).filter(
          (token) => token.actorId !== switchedActor.id,
        ),
      }),
    },
  )

  await emit(
    recoveredSocket,
    'session:leave',
    {},
  )

  const restoredAfterDmDelete = await emit(recoveredSocket, 'session:join', {
    role: 'player',
    name: playerName,
    joinCode: secondCampaign.joinCode,
    playerKey: keyB,
  })
  assert.equal(restoredAfterDmDelete.characterRestored, true)

  const recoveredDeletedActor = restoredAfterDmDelete.state.actors.find(
    (candidate) => candidate.ownerId === restoredAfterDmDelete.player.id,
  )
  assert.ok(recoveredDeletedActor)
  assert.equal(recoveredDeletedActor.level, initialAuthoritativeLevel)
  assert.equal(recoveredDeletedActor.maxHp, 13)
  assert.equal(recoveredDeletedActor.currentHp, 13)
  assert.equal(recoveredDeletedActor.ac, 16)
  assert.equal(
    recoveredDeletedActor.characterSheet.notes,
    'survives-server-restart',
  )

  const backupResult = await request('/api/platform/backup', { method: 'POST' })
  assert.equal(backupResult.ok, true)
  assert.ok(fs.existsSync(backupResult.backup.system))

  success = true

  console.log(JSON.stringify({
    ok: true,
    testPort: port,
    campaignId: campaign.id,
    playerId: firstJoin.player.id,
    actorId: actor.id,
    tests: {
      health: true,
      isolatedServerOwnership: true,
      localHostProtection: true,
      remoteDmBlocked: true,
      playerPersistence: true,
      duplicateTokenBlockedEvenWhenHidden: true,
      staleStateWriteRejected: true,
      remoteNameTakeoverBlocked: true,
      playerCannotGrantSeatRecovery: true,
      dmApprovedRemoteSeatRecovery: true,
      physicalDatabaseBackup: true,
      snapshotRestoreAndRestoreBackups: true,
      serverRestartRecovery: true,
      persistenceIntegrityAudit: true,
      playerCanLeaveAndSwitchCampaigns: true,
      characterVaultCrossCampaignRestore: true,
      characterVaultRecoversDmDeletedActor: true,
      playerAttackSaveCheckSpellRollsPublic: true,
      dmAttackSaveCheckSpellRollsPrivate: true,
      npcDamageRollsPublic: true,
      dmPrivateDiceHiddenFromPlayerState: true,
      targetingVisibleToAllPlayers: true,
      playerManualEffectsBlocked: true,
      dmManualEffectsVisibleToAllPlayers: true,
      dmEffectsMechanicallyAffectPlayers: true,
      tempHpVisibleToAllPlayers: true,
      playerManualEffectRemovalBlocked: true,
      unsupportedConditionsRejectedUntilMechanicsExist: true,
      blessRulesDrivenEffectApplied: true,
      blessMechanicallyAddsD4ToSavingThrows: true,
      unsupportedSpellAutomationDoesNotSpendResources: true,
      playerCannotUseDmTurnOverride: true,
      dmUniversalTurnEconomyOverrideFoundation: true,
      playerCannotForgeXpOrLevel: true,
    },
  }, null, 2))
} finally {
  dmSocket?.disconnect()
  playerSocket?.disconnect()
  visibilityPlayerSocket?.disconnect()
  recoveredSocket?.disconnect()
  remoteSocket?.disconnect()
  remoteDmSocket?.disconnect()

  await stopServer()

  if (success) {
    fs.rmSync(testDataRoot, { recursive: true, force: true })
  } else {
    console.error(`[platform-test] Failure data preserved at: ${testDataRoot}`)
    console.error(serverOutput)
  }
}
