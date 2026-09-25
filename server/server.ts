import fs from 'node:fs'
import { randomInt, randomUUID } from 'node:crypto'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express'

import multer from 'multer'

import {
  Server,
  type Socket,
} from 'socket.io'

import {
  DIST_ROOT,
} from './paths'

import {
  StateConflictError,
  auditPersistence,
  backupAllCriticalDatabases,
  banPlayerSeat,
  closeStore,
  createCampaign,
  createSnapshot,
  endSession,
  getActiveSession,
  getCampaign,
  getCampaignByJoinCode,
  kickPlayerSeat,
  listBannedPlayers,
  listCampaigns,
  listPlayers,
  listSnapshots,
  loadCampaignState,
  loadCharacterVault,
  registerOrResumePlayer,
  restoreSnapshot,
  saveCampaignState,
  saveCharacterVault,
  startSession,
  touchCampaign,
  unbanPlayerSeat,
} from './store'

import {
  deleteAsset,
  getAsset,
  getAssetAbsolutePath,
  listAssets,
  saveMapAsset,
  saveTokenAsset,
} from './assets'

import {
  DEV_CONNECTION_PAGE,
} from './devPage'

import {
  ensureAudioDirectories,
  listAudioLibrary,
  listAudioCueStatus,
  resolveAudioAsset,
} from './audio'

import {
  ensureMusicDirectories,
  listMusicLibrary,
  resolveMusicAsset,
} from './music'

import {
  ensureMonsterCompendium,
  getCompendiumLicense,
  getMonsterById,
  getMonsterCompendiumStatus,
  searchMonsters,
} from './compendium'

import {
  generatedMonsterPortraitSvg,
  getMonsterPortrait,
} from './monsterPortraits'

import {
  listRulebooks,
  rulebookStatus,
  searchRulebooks,
} from './rulebooks'

import {
  backendCatalogStatus,
  characterCatalogOptions,
  rulesKnowledgeStatus,
  searchBackendCatalog,
  searchRulesKnowledge,
} from './rulesKnowledge'

import {
  createBlankPlayerActor,
  isPlayerControlledActor,
  normalizeActor,
  normalizeCharacterSheet,
} from '../src/lib/actors'
import { hitDieSidesForClass } from '../src/lib/restRuntime'

import {
  normalizeGridIndex,
} from '../src/lib/mapGridBounds'

import {
  activeMapTokenForActor,
  actorGridDistanceFeet,
  validateAttackRange,
  visibleActorIdsForActiveMap,
} from '../src/lib/targetingValidation'

import {
  attackBonusForActor,
  attackProfilesForActor,
  rollDiceFormula,
} from '../src/lib/combatActions'

import {
  advanceCombatTurn,
  beginCombatState,
  endCombatState,
  moveTiedCombatant,
  normalizeCombatState,
  prepareCombatState,
  rewindCombatTurn,
  setCombatantInitiative,
} from '../src/lib/combat'

import {
  type Actor,
  type ActorEffect,
  type ActorEffectKind,
  type ActorEffectScope,
} from '../src/types/actor'

import {
  type CombatState,
} from '../src/types/combat'

import {
  DEFAULT_GRID_SETTINGS,
  normalizeGridSettings,
  normalizeMapVisionSettings,
  type MapVisionSettings,
  type PlayerVisionRuntime,
  type TargetSelection,
  type VisionBarrier,
  type VisionDoorInteraction,
  type VisionDoorState,
  type VisionPoint,
  type VisionSettingsByMapId,
} from '../src/types/scene'

import {
  buildVisibilityPolygon,
  pointHasLineOfEffect,
  pointInsideVisibilityPolygon,
  visionSettingsUsable,
} from '../src/lib/visionRuntime'

import {
  canPlayerViewDiceRoll,
  canPlayerViewGenericDiceActivity,
  genericDiceVisibilityForRoll,
  normalizeDiceLog,
  normalizeGenericDiceActivity,
  structuredRollVisibilityForOwnedActor,
  structuredRollVisibilityForRole,
  type GenericDiceMode,
  type GenericDicePurpose,
} from '../src/lib/dice'

import {
  normalizeAppliedDamageType,
  normalizeHealthLog,
  resolveHealthOperation,
  type HealthLogEntry,
  type HealthOperation,
} from '../src/lib/damage'

import {
  needsDeathSave,
  resolveDeathSave,
  type DeathSaveResolution,
} from '../src/lib/death'

import {
  savingThrowModifier,
} from '../src/lib/characterSheet'

import {
  abilityModifier,
  concentrationDc,
  spellAttackBonus,
  spellSaveDc,
} from '../src/rules/dnd2024'

import {
  actorD20BonusDice,
  actorD20Modifier,
  canonicalMechanicalCondition,
  effectDefaultName,
  effectiveActorSpeed,
  normalizeConditionName,
  resolveActorD20Mode,
} from '../src/lib/effects'

import {
  applyDodgeAttackMode,
  applyDodgeSavingThrowMode,
  normalizeSavingThrowAbility,
} from '../src/lib/defensiveActions'

import {
  actorCanTakeCombatAction,
  appendFreshMutationRequest,
  authoritativeGenericDiceModifier,
  playerNameRecoveryAllowed,
  playerSheetEditAllowedDuringCombat,
  playerTokenPlacementAllowedDuringCombat,
  preserveServerOwnedCharacterSheetState,
} from '../src/lib/exploitHardening'

import {
  actorHasSkillProficiency,
  actorSkillModifier,
  addAdvantageMode,
  clearHelpBenefitsAtSourceTurnStart,
  consumeHelpBenefit,
  matchingHelpAbilityBenefit,
  matchingHelpAttackBenefit,
  influenceSkillAllowedForTarget,
  normalizeCharacterSkill,
  normalizeCoreUtilityAction,
  normalizeHelpBenefits,
  normalizeUtilityActionSkill,
  sameDefaultCombatSide,
  type HelpBenefit,
} from '../src/lib/utilityActions'

import {
  type DiceRollEntry,
} from '../src/types/dice'

import {
  applyTurnEconomyOverride,
  combatMovementBudgetApplies,
  endTurnEconomy,
  freshTurnEconomy,
  movementAllowanceFeet,
  standUpMovementCostFeet,
  normalizeTurnEconomy,
  normalizeTurnEconomyMap,
  remainingTurnResource,
  spendTurnResource,
  useAttackFromAction,
  useDash,
  useDisengage,
  useDodge,
} from '../src/lib/actionEconomy'

import {
  actorsAreOpposedForOpportunity,
  eligibleOpportunityAttackIds,
  hasPendingReactionForTriggeringActor,
  normalizeReactionWindows,
  REACTION_WINDOW_TTL_MS,
  reactionWindowExpired,
} from '../src/lib/reactions'

import {
  actorHasReadiedSpell,
  clearReadiedActionsAtActorTurnStart,
  hasOpenReactionWindowForReadiedAction,
  normalizeReadiedActions,
  normalizeReadiedSpellPayload,
  normalizeReadiedUtilityPayload,
  removeReadiedAction,
} from '../src/lib/readyActions'

import type {
  ReadiedAction,
  ReadiedSpellPayload,
  ReadiedUtilityPayload,
} from '../src/types/readyAction'

import type {
  OpportunityAttackReactionWindow,
  ReactionDecision,
  ReactionWindow,
  ReadiedActionReactionWindow,
} from '../src/types/reaction'

import {
  authoritativeCoreActionResource,
} from '../src/lib/actionAuthorization'

import {
  castingTimeActionCost,
  spellHasAutomatedRule,
  spellDamageFormula,
  spellDamageType,
  spellHealingFormula,
  spellSaveAbility,
  spellTargetRule,
} from '../src/lib/spellAutomation'

import {
  assertCanExpendSpellSlotThisTurn,
  markSpellSlotExpendedForTurn,
  reactionSpellRequiresReactionWindow,
  spellTurnKeyForCombat,
  spellTurnResource,
} from '../src/lib/spellActionEconomy'

import {
  featureGrantedSpells,
  spellById,
  spellIsAvailableToCharacter,
} from '../src/lib/characterRulesCatalog'
import { automaticSpellcastingAbility } from '../src/lib/characterAutomation'
import {
  addSelectedSpellPatch,
  removeSelectedSpellPatch,
  spellSelectionAvailability,
  togglePreparedSpellPatch,
} from '../src/lib/spellSelectionRules'

import {
  canSpendSpellSlot,
  normalizeRequestedCastLevel,
  normalizeSpentSlots,
  spellSlotPool,
  spendSpellSlot,
} from '../src/lib/spellRuntime'

import type {
  TurnEconomyByActorId,
  TurnEconomyOverridePatch,
  TurnEconomyState,
} from '../src/types/actionEconomy'

import type {
  AttackOutcome,
  AttackOutcomeOverride,
  AttackResolution,
} from '../src/types/combatActions'

const PORT =
  Number(
    process.env.PORT ?? 3000,
  )

const HOST =
  '0.0.0.0'

const PLAYER_TOKEN_MAX_BYTES =
  15 * 1024 * 1024

const SOCKET_MAX_PAYLOAD_BYTES =
  20 * 1024 * 1024

ensureAudioDirectories()
ensureMusicDirectories()
const monsterCompendiumStatus = ensureMonsterCompendium()

if (monsterCompendiumStatus.ready) {
  console.log(`[Compendium] ${monsterCompendiumStatus.count} SRD monsters ready locally.`)
} else if (monsterCompendiumStatus.error) {
  console.warn(`[Compendium] ${monsterCompendiumStatus.error}`)
}

interface PresenceEntry {
  socketId: string
  campaignId: string
  role: 'dm' | 'player'
  name: string
  userId: string
}

const app =
  express()

app.use(
  express.json({
    limit: '2mb',
  }),
)

const httpServer =
  http.createServer(
    app,
  )

const io =
  new Server(
    httpServer,
    {
      maxHttpBufferSize:
        SOCKET_MAX_PAYLOAD_BYTES,
    },
  )

const mapUpload =
  multer({
    storage:
      multer.memoryStorage(),

    limits: {
      files: 1,

      fileSize:
        100 *
        1024 *
        1024,
    },

    fileFilter: (
      _request,
      file,
      callback,
    ) => {
      const allowed =
        new Set([
          'image/png',
          'image/jpeg',
          'image/webp',
        ])

      if (
        !allowed.has(
          file.mimetype,
        )
      ) {
        callback(
          new Error(
            'Only PNG, JPG and WEBP maps are allowed.',
          ),
        )

        return
      }

      callback(
        null,
        true,
      )
    },
  })

const tokenUpload =
  multer({
    storage:
      multer.memoryStorage(),

    limits: {
      files: 1,
      fileSize:
        15 *
        1024 *
        1024,
    },

    fileFilter: (
      _request,
      file,
      callback,
    ) => {
      const allowed =
        new Set([
          'image/png',
          'image/jpeg',
          'image/webp',
        ])

      if (allowed.has(file.mimetype)) {
        callback(null, true)
        return
      }

      callback(
        new Error('Only PNG, JPG and WEBP tokens are allowed.'),
      )
    },
  })

const presenceByCampaign =
  new Map<
    string,
    Map<
      string,
      PresenceEntry
    >
  >()

const mutationRequestKeysBySocket = new Map<string, string[]>()

function assertFreshMutationRequest(
  socket: Socket,
  eventName: string,
  rawPayload: unknown,
): void {
  const previous = mutationRequestKeysBySocket.get(socket.id) ?? []
  mutationRequestKeysBySocket.set(
    socket.id,
    appendFreshMutationRequest(previous, eventName, rawPayload),
  )
}

function isLoopbackAddress(
  address: string | undefined,
): boolean {
  if (!address) {
    return false
  }

  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address ===
      '::ffff:127.0.0.1'
  )
}

function routeParam(
  value: string | string[] | undefined,
): string {
  if (Array.isArray(value)) {
    return String(value[0] ?? '')
  }

  return String(value ?? '')
}

type ProxyHeaderValue =
  string |
  string[] |
  undefined

type ProxyHeaderBag =
  Record<
    string,
    ProxyHeaderValue
  >

function hasForwardedClientHeaders(
  headers: ProxyHeaderBag,
): boolean {
  const keys = [
    'cf-connecting-ip',
    'x-forwarded-for',
    'forwarded',
    'x-real-ip',
  ]

  return keys.some(
    (key) => {
      const value =
        headers[key]

      if (
        Array.isArray(value)
      ) {
        return value.some(
          (entry) =>
            entry
              .trim()
              .length > 0,
        )
      }

      return (
        typeof value ===
          'string' &&
        value
          .trim()
          .length > 0
      )
    },
  )
}

function isTrustedLocalHttpRequest(
  request: Request,
): boolean {
  return (
    isLoopbackAddress(
      request.socket
        .remoteAddress,
    ) &&
    !hasForwardedClientHeaders(
      request.headers,
    )
  )
}

function isTrustedLocalSocket(
  socket: Socket,
): boolean {
  return (
    isLoopbackAddress(
      socket.handshake
        .address,
    ) &&
    !hasForwardedClientHeaders(
      socket.handshake
        .headers,
    )
  )
}

interface JoinRateWindow {
  startedAt: number
  count: number
}

const JOIN_RATE_WINDOW_MS = 60_000
const JOIN_RATE_LIMIT = 30
const joinRateByClient = new Map<string, JoinRateWindow>()

const SEAT_RECOVERY_WINDOW_MS = 5 * 60 * 1000
const seatRecoveryGrants = new Map<string, Map<string, number>>()

function grantSeatRecovery(
  campaignId: string,
  playerId: string,
): void {
  let campaignGrants =
    seatRecoveryGrants.get(campaignId)

  if (!campaignGrants) {
    campaignGrants = new Map<string, number>()
    seatRecoveryGrants.set(campaignId, campaignGrants)
  }

  campaignGrants.set(
    playerId,
    Date.now() + SEAT_RECOVERY_WINDOW_MS,
  )
}

function hasSeatRecoveryGrant(
  campaignId: string,
  playerId: string,
): boolean {
  const campaignGrants =
    seatRecoveryGrants.get(campaignId)

  const expiresAt =
    campaignGrants?.get(playerId) ?? 0

  if (expiresAt <= Date.now()) {
    campaignGrants?.delete(playerId)
    if (campaignGrants?.size === 0) {
      seatRecoveryGrants.delete(campaignId)
    }
    return false
  }

  return true
}

function consumeSeatRecoveryGrant(
  campaignId: string,
  playerId: string,
): void {
  const campaignGrants =
    seatRecoveryGrants.get(campaignId)

  campaignGrants?.delete(playerId)

  if (campaignGrants?.size === 0) {
    seatRecoveryGrants.delete(campaignId)
  }
}

function socketClientKey(
  socket: Socket,
): string {
  const address =
    String(socket.handshake.address ?? 'unknown')

  return hasForwardedClientHeaders(
    socket.handshake.headers,
  )
    ? `proxy:${address}`
    : `direct:${address}`
}

function consumeJoinRateLimit(
  socket: Socket,
): void {
  if (isTrustedLocalSocket(socket)) return

  const key =
    socketClientKey(socket)

  const timestamp =
    Date.now()

  const current =
    joinRateByClient.get(key)

  if (
    !current ||
    timestamp - current.startedAt >= JOIN_RATE_WINDOW_MS
  ) {
    joinRateByClient.set(
      key,
      {
        startedAt: timestamp,
        count: 1,
      },
    )

    return
  }

  current.count += 1

  if (current.count > JOIN_RATE_LIMIT) {
    throw new Error(
      'Too many join attempts. Wait one minute and try again.',
    )
  }
}

function isUsefulLanIPv4(
  address: string,
): boolean {
  if (
    address.startsWith(
      '169.254.',
    )
  ) {
    return false
  }

  return true
}

function getLanIPv4Addresses():
  string[] {
  const interfaces =
    os.networkInterfaces()

  const addresses:
    string[] = []

  for (
    const entries
    of Object.values(
      interfaces,
    )
  ) {
    if (!entries) {
      continue
    }

    for (
      const entry
      of entries
    ) {
      if (
        entry.family === 'IPv4' &&
        !entry.internal &&
        isUsefulLanIPv4(
          entry.address,
        )
      ) {
        addresses.push(
          entry.address,
        )
      }
    }
  }

  return [
    ...new Set(
      addresses,
    ),
  ]
}

function roomName(
  campaignId: string,
): string {
  return (
    'campaign:' +
    campaignId
  )
}

const PLAYER_COLOR_PALETTE = [
  '#D85A4A',
  '#4A8BD8',
  '#55A96A',
  '#C9923E',
  '#8F6DD8',
  '#D866A2',
  '#4AAFB0',
  '#D27A3A',
]

function createPlayerActorFromVault(
  vaultCharacter: unknown,
  options: {
    sourceCampaignId: string
    targetCampaignId: string
    name: string
    ownerId: string
  },
): Actor {
  const blank =
    createBlankPlayerActor({
      id: `actor-${randomUUID()}`,
      name: options.name,
      ownerId: options.ownerId,
    })

  if (
    !vaultCharacter ||
    typeof vaultCharacter !== 'object' ||
    Array.isArray(vaultCharacter)
  ) {
    return blank
  }

  const vaulted =
    normalizeActor(
      vaultCharacter as Actor,
    )

  const sameCampaign =
    options.sourceCampaignId ===
      options.targetCampaignId

  const resetResources =
    vaulted.resources.map(
      (resource) => ({
        ...resource,
        current: resource.max,
      }),
    )

  const resetSheet =
    vaulted.characterSheet
      ? normalizeCharacterSheet({
          ...vaulted.characterSheet,
          spentSpellSlots: [],
          concentratingSpellId: '',
        })
      : blank.characterSheet

  return normalizeActor({
    ...blank,
    ...vaulted,
    id: blank.id,
    kind: 'player',
    ownerId: options.ownerId,
    challengeRating: null,
    deathRules: 'character',
    sourceTemplateId: null,
    source: null,
    monsterStatBlock: null,
    ...(sameCampaign
      ? {}
      : {
          currentHp: vaulted.maxHp,
          tempHp: 0,
          lifeState: 'conscious',
          deathSaveSuccesses: 0,
          deathSaveFailures: 0,
          lastDeathSaveRound: null,
          conditions: [],
          effects: [],
          resources: resetResources,
          characterSheet: resetSheet,
        }),
  })
}

function defaultPlayerColor(
  playerId: string,
): string {
  let hash = 0

  for (
    let index = 0;
    index < playerId.length;
    index += 1
  ) {
    hash =
      (
        (
          hash << 5
        ) -
        hash +
        playerId.charCodeAt(index)
      ) |
      0
  }

  return PLAYER_COLOR_PALETTE[
    Math.abs(hash) %
    PLAYER_COLOR_PALETTE.length
  ]
}

function safeTokenColor(
  value: unknown,
  fallback: string,
): string {
  return (
    typeof value === 'string' &&
    /^#[0-9a-f]{6}$/i.test(value)
  )
    ? value.toUpperCase()
    : fallback
}

type ArcaneReachMode =
  | 'measure'
  | 'radius'
  | 'cube'
  | 'cone'
  | 'line'

interface SafeArcaneReachSigil {
  controllerId: string
  role: 'dm' | 'player'
  mapId: string
  mode: ArcaneReachMode
  start: {
    gridX: number
    gridY: number
  }
  end: {
    gridX: number
    gridY: number
  }
  updatedAt: string
}

const ARCANE_REACH_MODES =
  new Set<ArcaneReachMode>([
    'measure',
    'radius',
    'cube',
    'cone',
    'line',
  ])

function safeArcaneReachPoint(
  value: unknown,
): {
  gridX: number
  gridY: number
} | null {
  if (
    !value ||
    typeof value !== 'object'
  ) {
    return null
  }

  const point =
    value as Record<string, unknown>

  const gridX =
    Number(point.gridX)

  const gridY =
    Number(point.gridY)

  if (
    !Number.isFinite(gridX) ||
    !Number.isFinite(gridY)
  ) {
    return null
  }

  return {
    gridX:
      Math.max(
        0,
        Math.min(
          10000,
          Math.round(gridX),
        ),
      ),
    gridY:
      Math.max(
        0,
        Math.min(
          10000,
          Math.round(gridY),
        ),
      ),
  }
}

function safeArcaneReachSigils(
  value: unknown,
): Record<string, SafeArcaneReachSigil> {
  if (
    !value ||
    typeof value !== 'object'
  ) {
    return {}
  }

  const result:
    Record<string, SafeArcaneReachSigil> =
      {}

  for (
    const [key, rawSigil]
    of Object.entries(
      value as Record<string, unknown>,
    )
  ) {
    if (
      !rawSigil ||
      typeof rawSigil !== 'object'
    ) {
      continue
    }

    const sigil =
      rawSigil as Record<string, unknown>

    const controllerId =
      String(
        sigil.controllerId ?? key,
      ).trim()

    const role =
      sigil.role === 'dm'
        ? 'dm'
        : 'player'

    const mapId =
      String(
        sigil.mapId ?? '',
      ).trim()

    const mode =
      String(
        sigil.mode ?? '',
      ) as ArcaneReachMode

    const start =
      safeArcaneReachPoint(
        sigil.start,
      )

    const end =
      safeArcaneReachPoint(
        sigil.end,
      )

    if (
      !controllerId ||
      !mapId ||
      !ARCANE_REACH_MODES.has(mode) ||
      !start ||
      !end
    ) {
      continue
    }

    result[controllerId] = {
      controllerId,
      role,
      mapId,
      mode,
      start,
      end,
      updatedAt:
        typeof sigil.updatedAt === 'string' &&
        sigil.updatedAt
          ? sigil.updatedAt
          : new Date(0).toISOString(),
    }
  }

  return result
}

function binaryPayloadToBuffer(
  value: unknown,
): Buffer | null {
  if (Buffer.isBuffer(value)) {
    return value
  }

  if (value instanceof ArrayBuffer) {
    return Buffer.from(value)
  }

  if (ArrayBuffer.isView(value)) {
    return Buffer.from(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    )
  }

  return null
}

function publishedMapForState(
  state: unknown,
): Record<string, unknown> | null {
  if (!state || typeof state !== 'object') {
    return null
  }

  const record = state as Record<string, unknown>
  const published =
    record.publishedMap && typeof record.publishedMap === 'object'
      ? record.publishedMap as Record<string, unknown>
      : null

  if (published && String(published.id ?? '').trim()) {
    return published
  }

  const active =
    record.activeMap && typeof record.activeMap === 'object'
      ? record.activeMap as Record<string, unknown>
      : null

  return active && String(active.id ?? '').trim() ? active : null
}

function publishedMapIdForState(
  state: unknown,
): string {
  return String(publishedMapForState(state)?.id ?? '').trim()
}

function playerSafeState(
  state: unknown,
  viewerUserId = '',
): {
  activeMap: unknown
  worldMap: unknown
  actors: Array<Record<string, unknown>>
  tokens: Array<{
    id: string
    actorId: string
    assetId: string
    imageUrl: string
    mapId: string
    gridX: number
    gridY: number
    size: number
    visible: true
    color: string
    movementUsedFeet: number
  }>
  allowPlayerMovement: boolean
  playerColors: Record<string, string>
  arcaneReachSigils: Record<string, SafeArcaneReachSigil>
  combat: CombatState
  diceLog: DiceRollEntry[]
  lastAction: unknown
  activityLog: unknown[]
  targetSelections: TargetSelection[]
  turnEconomy: TurnEconomyByActorId
  reactionWindows: ReactionWindow[]
  readyActions: ReadiedAction[]
  visionRuntime: PlayerVisionRuntime
} {
  if (
    !state ||
    typeof state !== 'object'
  ) {
    return {
      activeMap: null,
      worldMap: null,
      actors: [],
      tokens: [],
      allowPlayerMovement: false,
      playerColors: {},
      arcaneReachSigils: {},
      combat: normalizeCombatState(null),
      diceLog: [],
      lastAction: null,
      activityLog: [],
      targetSelections: [],
      turnEconomy: {},
      reactionWindows: [],
      readyActions: [],
      visionRuntime: {
        enabled: false,
        mapId: null,
        polygons: [],
        sourceActorIds: [],
        doors: [],
      },
    }
  }

  const typedState =
    state as {
      activeMap?: unknown
      worldMap?: unknown
      actors?: unknown
      tokens?: unknown
      playerColors?: unknown
      arcaneReachSigils?: unknown
      allowPlayerMovement?: unknown
      combat?: unknown
      diceLog?: unknown
      lastAction?: unknown
      activityLog?: unknown
      targetSelections?: unknown
      turnEconomy?: unknown
      reactionWindows?: unknown
      readyActions?: unknown
    }

  const rawActors =
    Array.isArray(typedState.actors)
      ? typedState.actors.filter(
          (entry): entry is Record<string, unknown> =>
            Boolean(entry && typeof entry === 'object'),
        )
      : []

  const actorMap =
    new Map(
      rawActors
        .map((rawActor) => {
          const id = String(rawActor.id ?? '')

          if (!id) {
            return null
          }

          return [id, rawActor] as const
        })
        .filter(
          (
            entry,
          ): entry is readonly [string, Record<string, unknown>] =>
            entry !== null,
        ),
    )

  const rawTokens =
    Array.isArray(typedState.tokens)
      ? typedState.tokens
      : []

  const publishedMap =
    publishedMapForState(state)

  const activeMapId =
    String(publishedMap?.id ?? '')

  const playerColors =
    typedState.playerColors &&
    typeof typedState.playerColors === 'object'
      ? typedState.playerColors as Record<string, unknown>
      : {}

  const safePlayerColors =
    Object.fromEntries(
      Object.entries(playerColors)
        .filter(([playerId]) => Boolean(playerId))
        .map(([playerId, color]) => [
          playerId,
          safeTokenColor(color, defaultPlayerColor(playerId)),
        ]),
    )

  const safeSharedArcaneReachSigils =
    safeArcaneReachSigils(
      typedState.arcaneReachSigils,
    )

  const visionResult =
    viewerUserId
      ? playerVisionForViewer(
          state as Record<string, unknown>,
          viewerUserId,
        )
      : {
          runtime: {
            enabled: false,
            mapId: activeMapId || null,
            polygons: [],
            sourceActorIds: [],
            doors: [],
          } as PlayerVisionRuntime,
          visibleTokenIds: new Set(
            rawTokens
              .filter((rawToken): rawToken is Record<string, unknown> => Boolean(rawToken && typeof rawToken === 'object'))
              .map((rawToken) => String(rawToken.id ?? ''))
              .filter(Boolean),
          ),
        }

  const referencedActorIds =
    new Set<string>()

  const safeTokens =
    rawTokens
      .filter(
        (rawToken): rawToken is Record<string, unknown> =>
          Boolean(
            rawToken &&
            typeof rawToken === 'object' &&
            (rawToken as { visible?: unknown }).visible !== false &&
            (
              !activeMapId ||
              String((rawToken as { mapId?: unknown }).mapId ?? '') === activeMapId
            ) &&
            visionResult.visibleTokenIds.has(
              String((rawToken as { id?: unknown }).id ?? ''),
            ),
          ),
      )
      .map((rawToken) => {
        const tokenId = String(rawToken.id ?? '')
        const actorId =
          typeof rawToken.actorId === 'string' && rawToken.actorId
            ? rawToken.actorId
            : `actor-${tokenId}`

        const rawActor =
          actorMap.get(actorId)

        const legacyOwnerId =
          typeof rawToken.ownerId === 'string' && rawToken.ownerId
            ? rawToken.ownerId
            : null

        const ownerId =
          rawActor &&
          typeof rawActor.ownerId === 'string' &&
          rawActor.ownerId
            ? rawActor.ownerId
            : legacyOwnerId

        const inheritedColor =
          ownerId
            ? safeTokenColor(
                playerColors[ownerId],
                defaultPlayerColor(ownerId),
              )
            : '#C9954B'

        referencedActorIds.add(actorId)

        return {
          id: tokenId,
          actorId,
          assetId: String(rawToken.assetId ?? ''),
          imageUrl: String(rawToken.imageUrl ?? ''),
          mapId: String(rawToken.mapId ?? ''),
          gridX: normalizeGridIndex(rawToken.gridX),
          gridY: normalizeGridIndex(rawToken.gridY),
          size: Math.max(0.5, Number(rawToken.size) || 1),
          visible: true as const,
          color:
            safeTokenColor(
              rawToken.color,
              inheritedColor,
            ),
          movementUsedFeet: Math.max(0, Math.round(Number(rawToken.movementUsedFeet) || 0)),
        }
      })
      .filter((token) => token.id && token.mapId && token.imageUrl)

  if (viewerUserId) {
    for (const rawActor of rawActors) {
      if (
        typeof rawActor.id === 'string' &&
        rawActor.id &&
        rawActor.ownerId === viewerUserId
      ) {
        referencedActorIds.add(rawActor.id)
      }
    }
  }

  const safeActors =
    [...referencedActorIds]
      .map((actorId) => {
        const rawActor =
          actorMap.get(actorId)

        const legacyToken =
          rawTokens.find((rawToken) => {
            if (!rawToken || typeof rawToken !== 'object') {
              return false
            }

            const token = rawToken as Record<string, unknown>
            const tokenId = String(token.id ?? '')
            const tokenActorId =
              typeof token.actorId === 'string' && token.actorId
                ? token.actorId
                : `actor-${tokenId}`

            return tokenActorId === actorId
          }) as Record<string, unknown> | undefined

        const ownerId =
          rawActor &&
          typeof rawActor.ownerId === 'string' &&
          rawActor.ownerId
            ? rawActor.ownerId
            : typeof legacyToken?.ownerId === 'string' && legacyToken.ownerId
              ? legacyToken.ownerId
              : null

        const rawKind = rawActor?.kind
        const kind: 'player' | 'npc' | 'enemy' =
          ownerId
            ? 'player'
            : rawKind === 'player' ||
                rawKind === 'npc' ||
                rawKind === 'enemy'
              ? rawKind
              : 'enemy'

        const speedValue =
          Number(
            rawActor?.speedFeet ??
            legacyToken?.speedFeet ??
            30,
          )

        const summary = {
          id: actorId,
          name:
            String(
              rawActor?.name ??
              legacyToken?.name ??
              'Token',
            ),
          kind,
          ownerId,
          portraitAssetId:
            String(
              rawActor?.portraitAssetId ??
              legacyToken?.assetId ??
              '',
            ),
          portraitUrl:
            String(
              rawActor?.portraitUrl ??
              legacyToken?.imageUrl ??
              '',
            ),
          level: Math.max(
            1,
            Math.min(
              30,
              Math.round(
                Number(
                  rawActor?.level ??
                  legacyToken?.level ??
                  1,
                ) || 1,
              ),
            ),
          ),
          speedFeet:
            Number.isFinite(speedValue) && speedValue > 0
              ? Math.round(speedValue)
              : 30,
          tempHp: rawActor ? normalizeActor(rawActor as unknown as Actor).tempHp : 0,
          conditions: rawActor ? normalizeActor(rawActor as unknown as Actor).conditions : [],
          effects: rawActor
            ? (normalizeActor(rawActor as unknown as Actor).effects ?? []).map((effect) => {
                const sourceActor = effect.sourceActorId
                  ? actorMap.get(effect.sourceActorId)
                  : null
                const sourceIsHiddenDmActor = Boolean(
                  effect.sourceRole === 'dm' &&
                  effect.sourceActorId &&
                  !referencedActorIds.has(effect.sourceActorId) &&
                  sourceActor,
                )

                return sourceIsHiddenDmActor
                  ? {
                      ...effect,
                      sourceActorId: null,
                      sourceActorName: 'DM / Environment',
                    }
                  : effect
              })
            : [],
        }

        const isOwnCharacter =
          Boolean(viewerUserId) &&
          ownerId === viewerUserId &&
          kind === 'player' &&
          rawActor

        if (!isOwnCharacter) {
          return summary
        }

        const normalized = normalizeActor(rawActor as unknown as Actor)

        return {
          ...summary,
          challengeRating: normalized.challengeRating,
          currentHp: normalized.currentHp,
          maxHp: normalized.maxHp,
          tempHp: normalized.tempHp,
          lifeState: normalized.lifeState,
          deathSaveSuccesses: normalized.deathSaveSuccesses,
          deathSaveFailures: normalized.deathSaveFailures,
          deathRules: normalized.deathRules,
          lastDeathSaveRound: normalized.lastDeathSaveRound,
          ac: normalized.ac,
          initiativeBonus: normalized.initiativeBonus,
          proficiencyBonus: normalized.proficiencyBonus,
          abilities: normalized.abilities,
          conditions: normalized.conditions,
          resources: normalized.resources,
          damageResistances: normalized.damageResistances ?? [],
          damageImmunities: normalized.damageImmunities ?? [],
          damageVulnerabilities: normalized.damageVulnerabilities ?? [],
          sourceTemplateId: null,
          source: normalized.source,
          creatureSize: normalized.creatureSize,
          creatureType: normalized.creatureType,
          hitPointFormula: normalized.hitPointFormula,
          monsterStatBlock: null,
          characterSheet: normalized.characterSheet,
          gmNotes: '',
        }
      })

  const fullCombat =
    normalizeCombatState(
      typedState.combat,
      rawActors
        .map((rawActor) => String(rawActor.id ?? ''))
        .filter(Boolean),
    )

  const safeCombatants =
    fullCombat.combatants
      .filter(
        (entry) => referencedActorIds.has(entry.actorId),
      )
      .map((entry) => {
        if (fullCombat.phase !== 'setup') {
          return entry
        }

        const rawActor = actorMap.get(entry.actorId)
        const playerControlled = Boolean(
          rawActor &&
          isPlayerControlledActor({
            kind:
              rawActor.kind === 'player' ||
              rawActor.kind === 'npc' ||
              rawActor.kind === 'enemy'
                ? rawActor.kind
                : 'enemy',
            ownerId:
              typeof rawActor.ownerId === 'string' && rawActor.ownerId
                ? rawActor.ownerId
                : null,
          }),
        )

        return playerControlled
          ? entry
          : {
              ...entry,
              initiative: null,
              initiativeSource: null,
            }
      })

  const currentActorVisible =
    Boolean(fullCombat.currentActorId) &&
    referencedActorIds.has(String(fullCombat.currentActorId))

  const safeCurrentActorId =
    currentActorVisible
      ? fullCombat.currentActorId
      : null

  const safeCurrentTurnIndex =
    safeCurrentActorId
      ? safeCombatants.findIndex(
          (entry) => entry.actorId === safeCurrentActorId,
        )
      : -1

  const safeCombat: CombatState = {
    ...fullCombat,
    combatants: safeCombatants,
    currentActorId: safeCurrentActorId,
    currentTurnIndex: safeCurrentTurnIndex,
  }

  const safeActivityLog = Array.isArray(typedState.activityLog)
    ? typedState.activityLog
        .filter((entry) => {
          if (!entry || typeof entry !== 'object') {
            return true
          }

          const activity = entry as Record<string, unknown>
          if (activity.type !== 'dice-roll') {
            return true
          }

          const diceActivity = normalizeGenericDiceActivity(activity)
          return Boolean(
            diceActivity &&
            canPlayerViewGenericDiceActivity(diceActivity),
          )
        })
        .slice(-100)
    : []

  const safeLastAction = (() => {
    if (!typedState.lastAction || typeof typedState.lastAction !== 'object') {
      return typedState.lastAction ?? null
    }

    const activity = typedState.lastAction as Record<string, unknown>
    if (activity.type !== 'dice-roll') {
      return activity
    }

    const diceActivity = normalizeGenericDiceActivity(activity)
    if (
      diceActivity &&
      canPlayerViewGenericDiceActivity(diceActivity)
    ) {
      return activity
    }

    return safeActivityLog.at(-1) ?? null
  })()

  const safeTargetSelections = normalizeTargetSelections(typedState.targetSelections)
    .map((selection) => ({
      ...selection,
      targetActorIds: selection.targetActorIds.filter((actorId) => referencedActorIds.has(actorId)),
    }))
    .filter((selection) => selection.targetActorIds.length > 0)
    .map((selection) => ({
      ...selection,
      targetActorId: selection.targetActorIds[0],
      sourceActorId:
        selection.sourceActorId && referencedActorIds.has(selection.sourceActorId)
          ? selection.sourceActorId
          : null,
    }))

  const safeTurnEconomy = Object.fromEntries(
    safeActors.map((actorSummary) => {
      const actor = actorMap.get(String(actorSummary.id ?? ''))
      if (!actor) return [String(actorSummary.id ?? ''), null]
      const normalized = normalizeActor(actor as unknown as Actor)
      return [normalized.id, normalizeTurnEconomy((typedState.turnEconomy as Record<string, unknown> | undefined)?.[normalized.id], normalized)]
    }).filter((entry) => Boolean(entry[0]) && entry[1] !== null),
  ) as TurnEconomyByActorId
  const safeReactionWindows = normalizeReactionWindows(typedState.reactionWindows)
    .filter((window) => {
      const reactor = actorMap.get(window.reactorActorId)
      const ownerId = reactor && typeof reactor.ownerId === 'string' ? reactor.ownerId : ''
      return ownerId === viewerUserId &&
        referencedActorIds.has(window.reactorActorId) &&
        (window.kind === 'readied-action' || referencedActorIds.has(window.triggeringActorId))
    })
  const safeReadyActions = normalizeReadiedActions(typedState.readyActions)
    .filter((ready) => {
      const actor = actorMap.get(ready.actorId)
      const ownerId = actor && typeof actor.ownerId === 'string' ? actor.ownerId : ''
      return ownerId === viewerUserId && referencedActorIds.has(ready.actorId)
    })

  return {
    activeMap: publishedMap ?? null,
    worldMap: typedState.worldMap ?? null,
    actors: safeActors,
    tokens: safeTokens,
    allowPlayerMovement: typedState.allowPlayerMovement === true,
    playerColors: safePlayerColors,
    arcaneReachSigils: safeSharedArcaneReachSigils,
    combat: safeCombat,
    diceLog: normalizeDiceLog(typedState.diceLog)
      .filter((entry) => canPlayerViewDiceRoll(entry, viewerUserId)),
    lastAction: safeLastAction,
    activityLog: safeActivityLog,
    targetSelections: safeTargetSelections,
    turnEconomy: safeTurnEconomy,
    reactionWindows: safeReactionWindows,
    readyActions: safeReadyActions,
    visionRuntime: visionResult.runtime,
  }
}

function emitPresence(
  campaignId: string,
): void {
  const room =
    presenceByCampaign.get(
      campaignId,
    )

  const users =
    room
      ? [...room.values()].map(
          (entry) => ({
            id:
              entry.userId,

            name:
              entry.name,

            role:
              entry.role,
          }),
        )
      : []

  io.to(
    roomName(
      campaignId,
    ),
  ).emit(
    'session:presence',
    users,
  )
}

function broadcastState(
  campaignId: string,
): void {
  const state =
    loadCampaignState(
      campaignId,
    )

  const presence =
    presenceByCampaign.get(
      campaignId,
    )

  if (!presence) {
    return
  }

  for (
    const entry
    of presence.values()
  ) {
    const socket =
      io.sockets.sockets.get(
        entry.socketId,
      )

    if (!socket) {
      continue
    }

    if (
      entry.role === 'dm'
    ) {
      socket.emit(
        'campaign:state-changed',
        state,
      )
    } else {
      socket.emit(
        'campaign:state-changed',
        playerSafeState(
          state,
          entry.userId,
        ),
      )
    }
  }
}

function broadcastDmState(
  campaignId: string,
): void {
  const state = loadCampaignState(campaignId)
  const presence = presenceByCampaign.get(campaignId)

  if (!presence) {
    return
  }

  for (const entry of presence.values()) {
    if (entry.role !== 'dm') {
      continue
    }

    const socket = io.sockets.sockets.get(entry.socketId)
    if (!socket) {
      continue
    }

    socket.emit('campaign:state-changed', state)
  }
}

function broadcastSession(
  campaignId: string,
): void {
  const session =
    getActiveSession(
      campaignId,
    )

  io.to(
    roomName(
      campaignId,
    ),
  ).emit(
    'campaign:session-changed',
    session,
  )
}

function removePresence(
  socketId: string,
): string | null {
  for (
    const [
      campaignId,
      room,
    ]
    of presenceByCampaign
  ) {
    if (
      room.delete(
        socketId,
      )
    ) {
      if (
        room.size === 0
      ) {
        presenceByCampaign.delete(
          campaignId,
        )
      }

      emitPresence(
        campaignId,
      )

      return campaignId
    }
  }

  return null
}

function leaveCurrentCampaign(
  socket: Socket,
): void {
  const previousUserId = String(socket.data.userId ?? '')
  const previousCampaignId =
    removePresence(
      socket.id,
    )

  if (
    previousCampaignId
  ) {
    if (previousUserId) {
      const state = stateRecord(loadCampaignState(previousCampaignId))
      const targetSelections = normalizeTargetSelections(state.targetSelections)
        .filter((selection) => selection.controllerId !== previousUserId)
      saveCampaignState(previousCampaignId, {
        ...state,
        targetSelections,
      })
      broadcastState(previousCampaignId)
    }

    socket.leave(
      roomName(
        previousCampaignId,
      ),
    )
  }

  delete socket.data.campaignId
  delete socket.data.role
  delete socket.data.userId
  delete socket.data.playerKey
}

function requireLocalRequest(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (
    !isTrustedLocalHttpRequest(
      request,
    )
  ) {
    response
      .status(403)
      .json({
        error:
          'This action is available only on the DM host computer.',
      })

    return
  }

  next()
}

function mergeActiveMapIntoState(
  campaignId: string,
  activeMap: unknown,
): unknown {
  const currentState =
    loadCampaignState(
      campaignId,
    )

  const base =
    (
      currentState &&
      typeof currentState ===
        'object'
    )
      ? currentState as
          Record<
            string,
            unknown
          >
      : {}

  const existingPublishedMap =
    base.publishedMap && typeof base.publishedMap === 'object'
      ? base.publishedMap
      : base.activeMap && typeof base.activeMap === 'object'
        ? base.activeMap
        : null

  const nextState = {
    ...base,

    activeMap,
    publishedMap: existingPublishedMap,
  }

  saveCampaignState(
    campaignId,
    nextState,
  )

  return nextState
}

function mergeWorldMapIntoState(
  campaignId: string,
  worldMap: unknown,
): unknown {
  const currentState =
    loadCampaignState(
      campaignId,
    )

  const base =
    (
      currentState &&
      typeof currentState ===
        'object'
    )
      ? currentState as
          Record<
            string,
            unknown
          >
      : {}

  const nextState = {
    ...base,
    worldMap,
  }

  return saveCampaignState(
    campaignId,
    nextState,
  )
}

app.get(
  '/api/health',
  (_request, response) => {
    response.json({
      ok: true,

      service:
        'dnd-web-vtt',

      timestamp:
        new Date()
          .toISOString(),

      uptimeSeconds:
        Math.floor(process.uptime()),
    })
  },
)

app.get(
  '/api/host-info',
  requireLocalRequest,
  (_request, response) => {
    const addresses =
      getLanIPv4Addresses()

    response.json({
      localUrl:
        `http://localhost:${PORT}`,

      lanUrls:
        addresses.map(
          (address) =>
            `http://${address}:${PORT}`,
        ),
    })
  },
)

app.get(
  '/api/access-info',
  (request, response) => {
    response.set(
      'Cache-Control',
      'no-store',
    )

    response.json({
      isLocalHost:
        isTrustedLocalHttpRequest(
          request,
        ),

      remoteViaProxy:
        hasForwardedClientHeaders(
          request.headers,
        ),
    })
  },
)

app.get(
  '/api/platform/status',
  requireLocalRequest,
  (_request, response) => {
    const persistence =
      auditPersistence()

    response.set(
      'Cache-Control',
      'no-store',
    )

    response.json({
      ok: persistence.ok,
      service: 'dnd-web-vtt',
      port: PORT,
      uptimeSeconds: Math.floor(process.uptime()),
      connectedCampaignRooms: presenceByCampaign.size,
      persistence,
    })
  },
)

app.post(
  '/api/platform/backup',
  requireLocalRequest,
  (_request, response) => {
    try {
      const backup =
        backupAllCriticalDatabases(
          'manual-platform-backup',
        )

      response.status(201).json({
        ok: true,
        backup,
      })
    } catch (error) {
      response.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Platform backup failed.',
      })
    }
  },
)

app.post(
  '/api/platform/shutdown',
  requireLocalRequest,
  (_request, response) => {
    response.status(202).json({
      ok: true,
      message: 'Graceful shutdown started.',
    })

    setTimeout(
      () => shutdownServer('local-platform-shutdown', 0),
      50,
    ).unref()
  },
)

app.get(
  '/api/compendium/monsters/status',
  requireLocalRequest,
  (_request, response) => {
    response.set('Cache-Control', 'no-store')
    response.json(getMonsterCompendiumStatus())
  },
)

app.get(
  '/api/compendium/monsters',
  requireLocalRequest,
  (request, response) => {
    const status = getMonsterCompendiumStatus()

    if (!status.ready) {
      response.status(503).json({
        error:
          status.error ??
          'The local monster compendium is not ready.',
      })
      return
    }

    response.set('Cache-Control', 'no-store')
    response.json(
      searchMonsters({
        query: String(request.query.q ?? ''),
        type: String(request.query.type ?? ''),
        size: String(request.query.size ?? ''),
        cr: String(request.query.cr ?? ''),
        limit: Number(request.query.limit ?? 80),
      }),
    )
  },
)


app.get(
  '/api/compendium/monsters/:monsterId/portrait',
  (request, response) => {
    const monsterId = String(request.params.monsterId ?? '')
    const monster = getMonsterById(monsterId)

    if (!monster) {
      response.status(404).send('Monster not found.')
      return
    }

    const portrait = getMonsterPortrait(monsterId)

    response.set('Cache-Control', 'public, max-age=3600')

    if (portrait) {
      response.type(portrait.mimeType)
      fs.createReadStream(portrait.absolutePath).pipe(response)
      return
    }

    response
      .type('image/svg+xml')
      .send(
        generatedMonsterPortraitSvg(
          monster.name,
          monster.type,
        ),
      )
  },
)

app.get(
  '/api/compendium/monsters/:monsterId',
  requireLocalRequest,
  (request, response) => {
    const monster = getMonsterById(
      String(request.params.monsterId ?? ''),
    )

    if (!monster) {
      response.status(404).json({
        error: 'Monster not found in the local compendium.',
      })
      return
    }

    response.set('Cache-Control', 'no-store')
    response.json(monster)
  },
)

app.get(
  '/api/compendium/license',
  requireLocalRequest,
  (_request, response) => {
    response.set('Cache-Control', 'no-store')
    response.json({
      attribution: getCompendiumLicense(),
    })
  },
)

app.get(
  '/api/library/rulebooks/status',
  requireLocalRequest,
  (_request, response) => {
    response.set('Cache-Control', 'no-store')
    response.json(rulebookStatus())
  },
)

app.get(
  '/api/library/rulebooks',
  requireLocalRequest,
  (_request, response) => {
    response.set('Cache-Control', 'no-store')
    response.json(listRulebooks())
  },
)

app.get(
  '/api/library/rulebooks/search',
  requireLocalRequest,
  (request, response) => {
    response.set('Cache-Control', 'no-store')
    response.json(searchRulebooks(
      String(request.query.q ?? ''),
      String(request.query.bookId ?? ''),
      Number(request.query.limit ?? 40),
    ))
  },
)

app.get(
  '/api/library/rules/status',
  requireLocalRequest,
  (_request, response) => {
    response.set('Cache-Control', 'no-store')
    response.json(rulesKnowledgeStatus())
  },
)

app.get(
  '/api/library/rules/search',
  requireLocalRequest,
  (request, response) => {
    response.set('Cache-Control', 'no-store')
    response.json(searchRulesKnowledge(
      String(request.query.q ?? ''),
      String(request.query.category ?? ''),
      String(request.query.sourceId ?? ''),
      String(request.query.rulesVersion ?? ''),
      String(request.query.status ?? ''),
      Number(request.query.limit ?? 80),
    ))
  },
)

app.get(
  '/api/library/catalog/status',
  requireLocalRequest,
  (_request, response) => {
    response.set('Cache-Control', 'no-store')
    response.json(backendCatalogStatus())
  },
)

app.get(
  '/api/library/catalog/search',
  requireLocalRequest,
  (request, response) => {
    response.set('Cache-Control', 'no-store')
    response.json(searchBackendCatalog(
      String(request.query.family ?? ''),
      String(request.query.q ?? ''),
      String(request.query.rulesVersion ?? ''),
      Number(request.query.limit ?? 120),
    ))
  },
)

app.get(
  '/api/library/character-options',
  requireLocalRequest,
  (request, response) => {
    response.set('Cache-Control', 'no-store')
    response.json(characterCatalogOptions(
      String(request.query.rulesVersion ?? '2024'),
    ))
  },
)

app.get(
  '/api/campaigns',
  requireLocalRequest,
  (_request, response) => {
    response.json(
      listCampaigns(),
    )
  },
)

app.post(
  '/api/campaigns',
  requireLocalRequest,
  (request, response) => {
    try {
      const campaign =
        createCampaign(
          String(
            request.body?.name ??
              '',
          ),
        )

      response
        .status(201)
        .json(
          campaign,
        )
    } catch (error) {
      response
        .status(400)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not create campaign.',
        })
    }
  },
)

app.get(
  '/api/campaigns/:campaignId/state',
  requireLocalRequest,
  (request, response) => {
    try {
      response.json(
        loadCampaignState(
          routeParam(request.params.campaignId),
        ),
      )
    } catch (error) {
      response
        .status(404)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Campaign not found.',
        })
    }
  },
)

app.put(
  '/api/campaigns/:campaignId/state',
  requireLocalRequest,
  (request, response) => {
    try {
      const campaignId =
        routeParam(request.params.campaignId)

      const body =
        request.body && typeof request.body === 'object'
          ? request.body as Record<string, unknown>
          : {}

      const rawExpectedRevision =
        Number(body.stateRevision)

      if (
        !Number.isInteger(rawExpectedRevision) ||
        rawExpectedRevision < 0
      ) {
        response.status(400).json({
          error: 'Campaign state revision is missing or invalid.',
        })
        return
      }

      const savedState =
        saveCampaignState(
          campaignId,
          body,
          rawExpectedRevision,
        )

      broadcastState(
        campaignId,
      )

      response.json({
        ok: true,
        state: savedState,
      })
    } catch (error) {
      if (error instanceof StateConflictError) {
        const campaignId =
          routeParam(request.params.campaignId)

        broadcastState(campaignId)

        response.status(409).json({
          error: error.message,
          state: loadCampaignState(campaignId),
        })
        return
      }

      response
        .status(404)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Campaign not found.',
        })
    }
  },
)

app.get(
  '/api/campaigns/:campaignId/session',
  requireLocalRequest,
  (request, response) => {
    try {
      response.json(
        getActiveSession(
          routeParam(request.params.campaignId),
        ),
      )
    } catch (error) {
      response
        .status(404)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Campaign not found.',
        })
    }
  },
)

app.post(
  '/api/campaigns/:campaignId/session/start',
  requireLocalRequest,
  (request, response) => {
    try {
      const campaignId =
        routeParam(request.params.campaignId)

      const session =
        startSession(
          campaignId,
        )

      broadcastSession(
        campaignId,
      )

      response
        .status(201)
        .json(
          session,
        )
    } catch (error) {
      response
        .status(409)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not start session.',
        })
    }
  },
)

app.post(
  '/api/campaigns/:campaignId/session/end',
  requireLocalRequest,
  (request, response) => {
    try {
      const campaignId =
        routeParam(request.params.campaignId)

      const session =
        endSession(
          campaignId,
        )

      broadcastSession(
        campaignId,
      )

      response.json(
        session,
      )
    } catch (error) {
      response
        .status(409)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not end session.',
        })
    }
  },
)

app.get(
  '/api/campaigns/:campaignId/snapshots',
  requireLocalRequest,
  (request, response) => {
    try {
      response.json(
        listSnapshots(
          routeParam(request.params.campaignId),
        ),
      )
    } catch (error) {
      response
        .status(404)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Campaign not found.',
        })
    }
  },
)

app.post(
  '/api/campaigns/:campaignId/snapshots',
  requireLocalRequest,
  (request, response) => {
    try {
      const snapshot =
        createSnapshot(
          routeParam(request.params.campaignId),

          String(
            request.body?.name ??
              '',
          ),
        )

      response
        .status(201)
        .json(
          snapshot,
        )
    } catch (error) {
      response
        .status(400)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not create snapshot.',
        })
    }
  },
)

app.post(
  '/api/campaigns/:campaignId/snapshots/:snapshotId/restore',
  requireLocalRequest,
  (request, response) => {
    try {
      const campaignId =
        routeParam(request.params.campaignId)

      restoreSnapshot(
        campaignId,
        routeParam(request.params.snapshotId),
      )

      broadcastState(
        campaignId,
      )

      response.json({
        ok: true,

        state:
          loadCampaignState(
            campaignId,
          ),
      })
    } catch (error) {
      response
        .status(404)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not restore snapshot.',
        })
    }
  },
)

app.post(
  '/api/campaigns/:campaignId/world-map',
  requireLocalRequest,
  mapUpload.single(
    'map',
  ),
  (request, response) => {
    try {
      const campaignId =
        routeParam(request.params.campaignId)

      if (!request.file) {
        response
          .status(400)
          .json({
            error:
              'No World Map file was uploaded.',
          })

        return
      }

      const asset =
        saveMapAsset(
          campaignId,
          request.file.originalname,
          request.file.mimetype,
          request.file.buffer,
        )

      const state =
        mergeWorldMapIntoState(
          campaignId,
          asset,
        )

      broadcastState(
        campaignId,
      )

      response
        .status(201)
        .json({
          ok: true,
          asset,
          state,
        })
    } catch (error) {
      response
        .status(400)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not upload World Map.',
        })
    }
  },
)

app.delete(
  '/api/campaigns/:campaignId/world-map',
  requireLocalRequest,
  (request, response) => {
    try {
      const campaignId =
        routeParam(request.params.campaignId)

      const state =
        mergeWorldMapIntoState(
          campaignId,
          null,
        )

      broadcastState(
        campaignId,
      )

      response.json({
        ok: true,
        state,
      })
    } catch (error) {
      response
        .status(400)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not clear World Map.',
        })
    }
  },
)

app.get(
  '/api/campaigns/:campaignId/maps',
  requireLocalRequest,
  (request, response) => {
    try {
      response.json(
        listAssets(
          routeParam(request.params.campaignId),
          'map',
        ),
      )
    } catch (error) {
      response
        .status(404)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not load maps.',
        })
    }
  },
)

app.post(
  '/api/campaigns/:campaignId/maps/library',
  requireLocalRequest,
  mapUpload.single(
    'map',
  ),
  (request, response) => {
    try {
      const campaignId =
        routeParam(request.params.campaignId)

      if (!request.file) {
        response
          .status(400)
          .json({
            error:
              'No map file was uploaded.',
          })

        return
      }

      const asset =
        saveMapAsset(
          campaignId,
          request.file.originalname,
          request.file.mimetype,
          request.file.buffer,
        )

      response
        .status(201)
        .json({
          ok: true,
          asset,
        })
    } catch (error) {
      response
        .status(400)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not upload map to the library.',
        })
    }
  },
)

app.post(
  '/api/campaigns/:campaignId/maps',
  requireLocalRequest,
  mapUpload.single(
    'map',
  ),
  (request, response) => {
    try {
      const campaignId =
        routeParam(request.params.campaignId)

      if (!request.file) {
        response
          .status(400)
          .json({
            error:
              'No map file was uploaded.',
          })

        return
      }

      const asset =
        saveMapAsset(
          campaignId,
          request.file
            .originalname,
          request.file
            .mimetype,
          request.file
            .buffer,
        )

      mergeActiveMapIntoState(
        campaignId,
        asset,
      )

      broadcastState(
        campaignId,
      )

      response
        .status(201)
        .json({
          ok: true,

          asset,

          state:
            loadCampaignState(
              campaignId,
            ),
        })
    } catch (error) {
      response
        .status(400)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not upload map.',
        })
    }
  },
)

app.post(
  '/api/campaigns/:campaignId/maps/:assetId/publish',
  requireLocalRequest,
  (request, response) => {
    try {
      const campaignId = routeParam(request.params.campaignId)
      const asset = getAsset(campaignId, routeParam(request.params.assetId))

      if (!asset || asset.assetType !== 'map') {
        response.status(404).json({ error: 'Map not found.' })
        return
      }

      const currentState = stateRecord(loadCampaignState(campaignId))
      const activeMap =
        currentState.activeMap && typeof currentState.activeMap === 'object'
          ? currentState.activeMap as Record<string, unknown>
          : null

      if (!activeMap || String(activeMap.id ?? '') !== asset.id) {
        response.status(409).json({ error: 'Prepare this map for the DM before publishing it to Players.' })
        return
      }

      const preparedDisplayName =
        String(currentState.mapNames && typeof currentState.mapNames === 'object'
          ? (currentState.mapNames as Record<string, unknown>)[asset.id] ?? activeMap.displayName ?? asset.displayName
          : activeMap.displayName ?? asset.displayName)

      const publishedAsset = {
        ...activeMap,
        ...asset,
        displayName: preparedDisplayName,
      }

      const nextState = {
        ...currentState,
        activeMap: publishedAsset,
        publishedMap: publishedAsset,
      }

      const savedState = saveCampaignState(campaignId, nextState)
      broadcastState(campaignId)

      response.json({ ok: true, asset, state: savedState })
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : 'Could not publish map to Players.',
      })
    }
  },
)

app.post(
  '/api/campaigns/:campaignId/maps/:assetId/world-map',
  requireLocalRequest,
  (request, response) => {
    try {
      const campaignId =
        routeParam(request.params.campaignId)

      const asset =
        getAsset(
          campaignId,
          routeParam(request.params.assetId),
        )

      if (
        !asset ||
        asset.assetType !== 'map'
      ) {
        response
          .status(404)
          .json({
            error:
              'Map not found.',
          })

        return
      }

      const state =
        mergeWorldMapIntoState(
          campaignId,
          asset,
        )

      broadcastState(
        campaignId,
      )

      response.json({
        ok: true,
        asset,
        state,
      })
    } catch (error) {
      response
        .status(400)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not assign World Map.',
        })
    }
  },
)

app.put(
  '/api/campaigns/:campaignId/vision/maps/:mapId',
  requireLocalRequest,
  (request, response) => {
    try {
      const campaignId =
        routeParam(
          request.params.campaignId,
        )

      const mapId =
        routeParam(
          request.params.mapId,
        )

      const asset =
        getAsset(
          campaignId,
          mapId,
        )

      if (
        !asset ||
        asset.assetType !== 'map'
      ) {
        response
          .status(404)
          .json({
            error:
              'Map not found.',
          })

        return
      }

      const rawBody =
        (
          request.body &&
          typeof request.body === 'object'
        )
          ? request.body as {
              settings?: unknown
            }
          : {}

      const normalized =
        normalizeMapVisionSettings(
          rawBody.settings,
        )

      const settings:
        MapVisionSettings = {
          ...normalized,
          updatedAt:
            new Date().toISOString(),
        }

      const currentState =
        loadCampaignState(
          campaignId,
        )

      const base =
        (
          currentState &&
          typeof currentState === 'object'
        )
          ? currentState as Record<string, unknown>
          : {}

      const visionByMap:
        VisionSettingsByMapId = {
          ...(
            (
              base.visionByMap &&
              typeof base.visionByMap === 'object'
            )
              ? base.visionByMap as VisionSettingsByMapId
              : {}
          ),
          [mapId]:
            settings,
        }

      const savedState =
        saveCampaignState(
          campaignId,
          {
            ...base,
            visionByMap,
          },
        )

      if (publishedMapIdForState(savedState) === mapId) {
        broadcastState(campaignId)
      } else {
        broadcastDmState(campaignId)
      }

      response.json({
        ok: true,
        settings,
        state:
          savedState,
      })
    } catch (error) {
      response
        .status(400)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Vision geometry could not be saved.',
        })
    }
  },
)

app.get(
  '/api/campaigns/:campaignId/vision/preview/:playerId',
  requireLocalRequest,
  (request, response) => {
    try {
      const campaignId =
        routeParam(
          request.params.campaignId,
        )

      const playerId =
        routeParam(
          request.params.playerId,
        )

      const state =
        stateRecord(
          loadCampaignState(
            campaignId,
          ),
        )

      const preview =
        playerVisionForViewer(
          state,
          playerId,
        )

      const visibleActorIds =
        [...visibleActorIdsForViewer(
          state,
          playerId,
        )]

      response.json({
        runtime: preview.runtime,
        visibleActorIds,
      })
    } catch (error) {
      response
        .status(400)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not preview Player vision.',
        })
    }
  },
)

app.delete(
  '/api/campaigns/:campaignId/maps/:assetId',
  requireLocalRequest,
  (request, response) => {
    try {
      const campaignId =
        routeParam(request.params.campaignId)

      const assetId =
        routeParam(request.params.assetId)

      const asset =
        getAsset(
          campaignId,
          assetId,
        )

      if (
        !asset ||
        asset.assetType !== 'map'
      ) {
        response
          .status(404)
          .json({
            error:
              'Map not found.',
          })

        return
      }

      const currentState =
        loadCampaignState(
          campaignId,
        )

      const base =
        (
          currentState &&
          typeof currentState === 'object'
        )
          ? currentState as Record<string, unknown>
          : {}

      const activeMap =
        (
          base.activeMap &&
          typeof base.activeMap === 'object'
        )
          ? base.activeMap as { id?: unknown }
          : null

      const worldMap =
        (
          base.worldMap &&
          typeof base.worldMap === 'object'
        )
          ? base.worldMap as { id?: unknown }
          : null

      const mapSettings =
        (
          base.mapSettings &&
          typeof base.mapSettings === 'object'
        )
          ? { ...(base.mapSettings as Record<string, unknown>) }
          : {}

      const mapNames =
        (
          base.mapNames &&
          typeof base.mapNames === 'object'
        )
          ? { ...(base.mapNames as Record<string, unknown>) }
          : {}

      const visionByMap =
        (
          base.visionByMap &&
          typeof base.visionByMap === 'object'
        )
          ? { ...(base.visionByMap as Record<string, unknown>) }
          : {}

      delete mapSettings[assetId]
      delete mapNames[assetId]
      delete visionByMap[assetId]

      const tokens =
        Array.isArray(base.tokens)
          ? base.tokens.filter(
              (token) => {
                if (
                  !token ||
                  typeof token !== 'object'
                ) {
                  return true
                }

                return String(
                  (token as { mapId?: unknown }).mapId ?? '',
                ) !== assetId
              },
            )
          : base.tokens

      const arcaneReachSigils =
        (
          base.arcaneReachSigils &&
          typeof base.arcaneReachSigils === 'object'
        )
          ? Object.fromEntries(
              Object.entries(
                base.arcaneReachSigils as Record<string, unknown>,
              ).filter(
                ([, value]) => {
                  if (
                    !value ||
                    typeof value !== 'object'
                  ) {
                    return true
                  }

                  return String(
                    (value as { mapId?: unknown }).mapId ?? '',
                  ) !== assetId
                },
              ),
            )
          : base.arcaneReachSigils

      const nextState = {
        ...base,
        activeMap:
          String(activeMap?.id ?? '') === assetId
            ? null
            : base.activeMap,
        publishedMap:
          publishedMapIdForState(base) === assetId
            ? null
            : base.publishedMap,
        worldMap:
          String(worldMap?.id ?? '') === assetId
            ? null
            : base.worldMap,
        mapSettings,
        mapNames,
        visionByMap,
        tokens,
        arcaneReachSigils,
      }

      const savedState =
        saveCampaignState(
          campaignId,
          nextState,
        )

      deleteAsset(
        campaignId,
        assetId,
      )

      broadcastState(
        campaignId,
      )

      response.json({
        ok: true,
        state: savedState,
      })
    } catch (error) {
      response
        .status(400)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not delete map.',
        })
    }
  },
)

app.post(
  '/api/campaigns/:campaignId/maps/:assetId/activate',
  requireLocalRequest,
  (request, response) => {
    try {
      const campaignId =
        routeParam(request.params.campaignId)

      const asset =
        getAsset(
          campaignId,
          routeParam(request.params.assetId),
        )

      if (
        !asset ||
        asset.assetType !== 'map'
      ) {
        response
          .status(404)
          .json({
            error:
              'Map not found.',
          })

        return
      }

      const state =
        mergeActiveMapIntoState(
          campaignId,
          asset,
        )

      broadcastDmState(
        campaignId,
      )

      response.json({
        ok: true,

        asset,

        state,
      })
    } catch (error) {
      response
        .status(400)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not activate map.',
        })
    }
  },
)

app.get(
  '/api/campaigns/:campaignId/token-assets',
  requireLocalRequest,
  (request, response) => {
    try {
      response.json(
        listAssets(
          routeParam(request.params.campaignId),
          'token',
        ),
      )
    } catch (error) {
      response
        .status(404)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not load token assets.',
        })
    }
  },
)

app.post(
  '/api/campaigns/:campaignId/token-assets',
  requireLocalRequest,
  tokenUpload.single('token'),
  (request, response) => {
    try {
      if (!request.file) {
        response
          .status(400)
          .json({
            error: 'No token image was uploaded.',
          })

        return
      }

      const asset =
        saveTokenAsset(
          routeParam(request.params.campaignId),
          request.file.originalname,
          request.file.mimetype,
          request.file.buffer,
        )

      response
        .status(201)
        .json({
          ok: true,
          asset,
        })
    } catch (error) {
      response
        .status(400)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not upload token image.',
        })
    }
  },
)

app.get(
  '/campaign-assets/:campaignId/:assetId',
  (request, response) => {
    try {
      const campaignId =
        routeParam(request.params.campaignId)

      const asset =
        getAsset(
          campaignId,
          routeParam(request.params.assetId),
        )

      if (!asset) {
        response
          .status(404)
          .send(
            'Asset not found.',
          )

        return
      }

      const absolutePath =
        getAssetAbsolutePath(
          campaignId,
          asset,
        )

      if (
        !fs.existsSync(
          absolutePath,
        )
      ) {
        response
          .status(404)
          .send(
            'Asset file is missing.',
          )

        return
      }

      response.setHeader(
        'Cache-Control',
        'public, max-age=31536000, immutable',
      )

      response.setHeader(
        'ETag',
        `"${asset.contentHash}"`,
      )

      response.type(
        asset.mimeType,
      )

      response.sendFile(
        absolutePath,
      )
    } catch {
      response
        .status(404)
        .send(
          'Asset not found.',
        )
    }
  },
)

app.get(
  '/dev/connect',
  requireLocalRequest,
  (_request, response) => {
    response
      .type('html')
      .send(
        DEV_CONNECTION_PAGE,
      )
  },
)

function requireDmCampaignId(socket: Socket): string {
  const campaignId = String(socket.data.campaignId ?? '')

  if (!campaignId) {
    throw new Error('Join a campaign before controlling combat.')
  }

  if (socket.data.role !== 'dm') {
    throw new Error('Only the Dungeon Master can control combat.')
  }

  return campaignId
}

function stateRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
}

function normalizeTargetSelections(value: unknown): TargetSelection[] {
  if (!Array.isArray(value)) return []

  return value
    .map((entry): TargetSelection | null => {
      if (!entry || typeof entry !== 'object') return null
      const raw = entry as Record<string, unknown>
      const controllerId = String(raw.controllerId ?? '').trim()
      const controllerName = String(raw.controllerName ?? '').trim()
      const targetActorId = String(raw.targetActorId ?? '').trim()
      const targetActorIds = Array.isArray(raw.targetActorIds)
        ? raw.targetActorIds
            .map((actorId) => String(actorId ?? '').trim())
            .filter(Boolean)
            .filter((actorId, index, entries) => entries.indexOf(actorId) === index)
            .slice(0, 50)
        : targetActorId
          ? [targetActorId]
          : []
      const primaryTargetActorId = targetActorId || targetActorIds[0] || ''
      const role = raw.role === 'dm' ? 'dm' : 'player'
      const sourceActorId =
        typeof raw.sourceActorId === 'string' && raw.sourceActorId.trim()
          ? raw.sourceActorId.trim()
          : null

      if (!controllerId || !controllerName || !primaryTargetActorId) return null

      return {
        controllerId,
        controllerName,
        role,
        sourceActorId,
        targetActorId: primaryTargetActorId,
        targetActorIds,
        updatedAt:
          typeof raw.updatedAt === 'string' && raw.updatedAt
            ? raw.updatedAt
            : new Date(0).toISOString(),
      }
    })
    .filter((entry): entry is TargetSelection => entry !== null)
    .slice(-50)
}

function normalizedActorsForState(
  state: Record<string, unknown>,
): Actor[] {
  return Array.isArray(state.actors)
    ? state.actors
        .filter((entry): entry is Actor => Boolean(entry && typeof entry === 'object'))
        .map((entry) => normalizeActor(entry))
    : []
}

function actorById(
  state: Record<string, unknown>,
  actorId: string | null | undefined,
): Actor | null {
  if (!actorId) return null
  return normalizedActorsForState(state).find((actor) => actor.id === actorId) ?? null
}

function activeMapIdForState(
  state: Record<string, unknown>,
): string {
  return state.activeMap && typeof state.activeMap === 'object'
    ? String((state.activeMap as Record<string, unknown>).id ?? '').trim()
    : ''
}

function targetingTokensForState(
  state: Record<string, unknown>,
): Record<string, unknown>[] {
  return Array.isArray(state.tokens)
    ? state.tokens.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    : []
}

function visibleActorIdsOnActiveMap(
  state: Record<string, unknown>,
): Set<string> {
  return visibleActorIdsForActiveMap(
    activeMapIdForState(state),
    targetingTokensForState(state),
  )
}

function visionSettingsForMap(
  state: Record<string, unknown>,
  mapId: string,
): MapVisionSettings | null {
  if (!mapId) return null

  const visionByMap =
    state.visionByMap && typeof state.visionByMap === 'object'
      ? state.visionByMap as Record<string, unknown>
      : null

  if (!visionByMap || !(mapId in visionByMap)) {
    return null
  }

  return normalizeMapVisionSettings(visionByMap[mapId])
}

function gridSettingsForMap(
  state: Record<string, unknown>,
  mapId: string,
) {
  const mapSettings =
    state.mapSettings && typeof state.mapSettings === 'object'
      ? state.mapSettings as Record<string, unknown>
      : {}

  const activeMap =
    state.activeMap && typeof state.activeMap === 'object'
      ? state.activeMap as Record<string, unknown>
      : null

  const publishedMap =
    publishedMapForState(state)

  const activeMapGrid =
    activeMap && String(activeMap.id ?? '') === mapId
      ? activeMap.grid
      : null

  const publishedMapGrid =
    publishedMap && String(publishedMap.id ?? '') === mapId
      ? publishedMap.grid
      : null

  return normalizeGridSettings(
    activeMapGrid ?? publishedMapGrid ?? mapSettings[mapId] ?? DEFAULT_GRID_SETTINGS,
  )
}

function tokenActorId(
  token: Record<string, unknown>,
): string {
  const tokenId = String(token.id ?? '')
  return typeof token.actorId === 'string' && token.actorId
    ? token.actorId
    : `actor-${tokenId}`
}

function tokenOwnerId(
  state: Record<string, unknown>,
  token: Record<string, unknown>,
): string | null {
  const actor = actorById(state, tokenActorId(token))

  if (actor?.ownerId) {
    return actor.ownerId
  }

  return typeof token.ownerId === 'string' && token.ownerId
    ? token.ownerId
    : null
}

function tokenVisionPoint(
  state: Record<string, unknown>,
  token: Record<string, unknown>,
  gridXOverride: number | null = null,
  gridYOverride: number | null = null,
  offsetXCells = 0,
  offsetYCells = 0,
): VisionPoint | null {
  const mapId = String(token.mapId ?? '')
  const settings = visionSettingsForMap(state, mapId)

  if (!settings || Number(settings.mapWidth) <= 1 || Number(settings.mapHeight) <= 1) {
    return null
  }

  const grid = gridSettingsForMap(state, mapId)
  const gridX = gridXOverride ?? normalizeGridIndex(token.gridX)
  const gridY = gridYOverride ?? normalizeGridIndex(token.gridY)
  const size = Math.max(0.5, Number(token.size) || 1)
  const centerX = gridX + size / 2 + offsetXCells
  const centerY = gridY + size / 2 + offsetYCells
  const pixelX = grid.offsetX + centerX * grid.cellSize
  const pixelY = grid.offsetY + centerY * grid.cellSize

  return {
    x: Math.max(0, Math.min(1, pixelX / Math.max(1, settings.mapWidth ?? 1))),
    y: Math.max(0, Math.min(1, pixelY / Math.max(1, settings.mapHeight ?? 1))),
  }
}

function actorVisionPoint(
  state: Record<string, unknown>,
  actorId: string,
): VisionPoint | null {
  const token = tokenForActor(state, actorId)
  return token ? tokenVisionPoint(state, token) : null
}

function actorHasLineOfEffect(
  state: Record<string, unknown>,
  sourceActorId: string,
  targetActorId: string,
  channel: 'blocksSight' | 'blocksMovement' | 'blocksLight' | 'blocksEffects' | 'blocksProjectiles',
): boolean {
  const sourceToken = tokenForActor(state, sourceActorId)
  const targetToken = tokenForActor(state, targetActorId)

  if (!sourceToken || !targetToken) {
    return true
  }

  const sourceMapId = String(sourceToken.mapId ?? '')
  const targetMapId = String(targetToken.mapId ?? '')
  if (!sourceMapId || sourceMapId !== targetMapId) {
    return true
  }

  const settings = visionSettingsForMap(state, sourceMapId)
  if (!visionSettingsUsable(settings)) {
    return true
  }

  const source = actorVisionPoint(state, sourceActorId)
  const target = actorVisionPoint(state, targetActorId)

  if (!source || !target) {
    return true
  }

  return pointHasLineOfEffect(source, target, settings, channel)
}

function actorHasLineOfEffectToPoint(
  state: Record<string, unknown>,
  sourceActorId: string,
  gridX: number,
  gridY: number,
  channel: 'blocksSight' | 'blocksMovement' | 'blocksLight' | 'blocksEffects' | 'blocksProjectiles',
): boolean {
  const sourceToken = tokenForActor(state, sourceActorId)
  const mapId = String(sourceToken?.mapId ?? '')
  const settings = visionSettingsForMap(state, mapId)
  const source = actorVisionPoint(state, sourceActorId)

  if (!visionSettingsUsable(settings) || !source || !mapId) {
    return true
  }

  const grid = gridSettingsForMap(state, mapId)
  const point: VisionPoint = {
    x: Math.max(0, Math.min(1, (grid.offsetX + (gridX + 0.5) * grid.cellSize) / Math.max(1, settings.mapWidth ?? 1))),
    y: Math.max(0, Math.min(1, (grid.offsetY + (gridY + 0.5) * grid.cellSize) / Math.max(1, settings.mapHeight ?? 1))),
  }

  return pointHasLineOfEffect(source, point, settings, channel)
}

function pointHasLineOfEffectToActor(
  state: Record<string, unknown>,
  gridX: number,
  gridY: number,
  targetActorId: string,
  channel: 'blocksSight' | 'blocksMovement' | 'blocksLight' | 'blocksEffects' | 'blocksProjectiles',
): boolean {
  const targetToken = tokenForActor(state, targetActorId)
  const mapId = String(targetToken?.mapId ?? '')
  const settings = visionSettingsForMap(state, mapId)
  const target = actorVisionPoint(state, targetActorId)

  if (!visionSettingsUsable(settings) || !target || !mapId) {
    return true
  }

  const grid = gridSettingsForMap(state, mapId)
  const point: VisionPoint = {
    x: Math.max(0, Math.min(1, (grid.offsetX + (gridX + 0.5) * grid.cellSize) / Math.max(1, settings.mapWidth ?? 1))),
    y: Math.max(0, Math.min(1, (grid.offsetY + (gridY + 0.5) * grid.cellSize) / Math.max(1, settings.mapHeight ?? 1))),
  }

  return pointHasLineOfEffect(point, target, settings, channel)
}

function movementBlockedByVision(
  state: Record<string, unknown>,
  token: Record<string, unknown>,
  nextGridX: number,
  nextGridY: number,
): boolean {
  const mapId = String(token.mapId ?? '')
  const settings = visionSettingsForMap(state, mapId)

  if (!visionSettingsUsable(settings)) {
    return false
  }

  const previousGridX = normalizeGridIndex(token.gridX)
  const previousGridY = normalizeGridIndex(token.gridY)
  const size = Math.max(0.5, Number(token.size) || 1)
  const footprintOffset = Math.max(0, size * 0.34)
  const samples = footprintOffset > 0.01
    ? [
        [0, 0],
        [-footprintOffset, -footprintOffset],
        [footprintOffset, -footprintOffset],
        [footprintOffset, footprintOffset],
        [-footprintOffset, footprintOffset],
      ] as const
    : [[0, 0]] as const

  return samples.some(([offsetX, offsetY]) => {
    const start = tokenVisionPoint(
      state,
      token,
      previousGridX,
      previousGridY,
      offsetX,
      offsetY,
    )
    const end = tokenVisionPoint(
      state,
      token,
      nextGridX,
      nextGridY,
      offsetX,
      offsetY,
    )

    if (!start || !end) return false

    return !pointHasLineOfEffect(
      start,
      end,
      settings,
      'blocksMovement',
    )
  })
}


function closestPointOnBarrier(
  point: VisionPoint,
  barrier: VisionBarrier,
  settings: MapVisionSettings,
): {
  point: VisionPoint
  distancePixels: number
} {
  const width = Math.max(1, Number(settings.mapWidth) || 1)
  const height = Math.max(1, Number(settings.mapHeight) || 1)

  const px = point.x * width
  const py = point.y * height
  const ax = barrier.start.x * width
  const ay = barrier.start.y * height
  const bx = barrier.end.x * width
  const by = barrier.end.y * height
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy

  const t =
    lengthSquared <= Number.EPSILON
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((px - ax) * dx + (py - ay) * dy) / lengthSquared,
          ),
        )

  const nearestX = ax + dx * t
  const nearestY = ay + dy * t

  return {
    point: {
      x: Math.max(0, Math.min(1, nearestX / width)),
      y: Math.max(0, Math.min(1, nearestY / height)),
    },
    distancePixels: Math.hypot(px - nearestX, py - nearestY),
  }
}

function playerDoorInteractionsForViewer(
  state: Record<string, unknown>,
  viewerUserId: string,
  settings: MapVisionSettings,
  mapId: string,
  sourceTokens: Array<Record<string, unknown>>,
): VisionDoorInteraction[] {
  if (!viewerUserId || !mapId || !visionSettingsUsable(settings)) {
    return []
  }

  const actors = normalizedActorsForState(state)
  const combat = normalizeCombatState(
    state.combat,
    actors.map((actor) => actor.id),
  )

  const eligibleTokens =
    combat.active
      ? sourceTokens.filter(
          (token) =>
            tokenActorId(token) === combat.currentActorId &&
            tokenOwnerId(state, token) === viewerUserId,
        )
      : sourceTokens

  if (eligibleTokens.length === 0) {
    return []
  }

  const doors =
    settings.barriers.filter(
      (barrier) => barrier.kind === 'door',
    )

  const safeDoors = new Map<string, VisionDoorInteraction>()

  for (const door of doors) {
    let bestDistanceFeet = Number.POSITIVE_INFINITY

    for (const token of eligibleTokens) {
      const origin = tokenVisionPoint(state, token)
      if (!origin) continue

      const grid =
        gridSettingsForMap(
          state,
          String(token.mapId ?? mapId),
        )

      const nearest =
        closestPointOnBarrier(
          origin,
          door,
          settings,
        )

      const tokenSize =
        Math.max(
          0.5,
          Number(token.size) || 1,
        )

      const footprintRadiusPixels =
        (tokenSize * Math.max(1, grid.cellSize)) / 2

      const edgeDistancePixels =
        Math.max(
          0,
          nearest.distancePixels - footprintRadiusPixels,
        )

      const distanceFeet =
        (
          edgeDistancePixels /
          Math.max(1, grid.cellSize)
        ) * 5

      if (distanceFeet > 5.01) {
        continue
      }

      // A different Wall/Door between the Actor and this Door still blocks
      // interaction. The target Door's own intersection occurs at the target
      // point and is ignored by pointHasLineOfEffect.
      if (
        !pointHasLineOfEffect(
          origin,
          nearest.point,
          settings,
          'blocksMovement',
        )
      ) {
        continue
      }

      bestDistanceFeet =
        Math.min(
          bestDistanceFeet,
          distanceFeet,
        )
    }

    if (!Number.isFinite(bestDistanceFeet)) {
      continue
    }

    safeDoors.set(
      door.id,
      {
        id: door.id,
        mapId,
        state:
          door.doorState === 'open'
            ? 'open'
            : 'closed',
        start: door.start,
        end: door.end,
        distanceFeet:
          Math.round(bestDistanceFeet * 10) / 10,
      },
    )
  }

  return [...safeDoors.values()]
}

function playerCanInteractWithDoor(
  state: Record<string, unknown>,
  viewerUserId: string,
  door: VisionBarrier,
  settings: MapVisionSettings,
  mapId: string,
): boolean {
  const sourceTokens =
    targetingTokensForState(state)
      .filter(
        (token) =>
          token.visible !== false &&
          String(token.mapId ?? '') === mapId &&
          tokenOwnerId(state, token) === viewerUserId,
      )

  return playerDoorInteractionsForViewer(
    state,
    viewerUserId,
    settings,
    mapId,
    sourceTokens,
  ).some(
    (candidate) => candidate.id === door.id,
  )
}

const visionPolygonCache = new Map<string, VisionPoint[]>()
const VISION_POLYGON_CACHE_LIMIT = 256

function cachedVisibilityPolygon(
  mapId: string,
  point: VisionPoint,
  settings: MapVisionSettings,
  rangePixels: number,
): VisionPoint[] {
  const key = [
    mapId,
    settings.updatedAt ?? '',
    settings.mapWidth ?? 0,
    settings.mapHeight ?? 0,
    settings.barriers.length,
    rangePixels.toFixed(2),
    point.x.toFixed(6),
    point.y.toFixed(6),
  ].join('|')

  const cached = visionPolygonCache.get(key)
  if (cached) {
    return cached
  }

  const polygon = buildVisibilityPolygon(
    point,
    settings,
    'blocksSight',
    rangePixels,
  )

  visionPolygonCache.set(key, polygon)

  if (visionPolygonCache.size > VISION_POLYGON_CACHE_LIMIT) {
    const firstKey = visionPolygonCache.keys().next().value
    if (typeof firstKey === 'string') {
      visionPolygonCache.delete(firstKey)
    }
  }

  return polygon
}

function playerVisionForViewer(
  state: Record<string, unknown>,
  viewerUserId: string,
): {
  runtime: PlayerVisionRuntime
  visibleTokenIds: Set<string>
} {
  const mapId = publishedMapIdForState(state)
  const allTokens = targetingTokensForState(state)
    .filter((token) =>
      token.visible !== false &&
      (!mapId || String(token.mapId ?? '') === mapId),
    )
  const allVisibleIds = new Set(
    allTokens.map((token) => String(token.id ?? '')).filter(Boolean),
  )
  const settings = visionSettingsForMap(state, mapId)

  if (!viewerUserId || !mapId || !visionSettingsUsable(settings)) {
    return {
      runtime: {
        enabled: false,
        mapId: mapId || null,
        polygons: [],
        sourceActorIds: [],
        doors: [],
      },
      visibleTokenIds: allVisibleIds,
    }
  }

  const sourceTokens = allTokens.filter(
    (token) => tokenOwnerId(state, token) === viewerUserId,
  )

  if (sourceTokens.length === 0) {
    // Placement-safe fallback: do not black out a Player who has not placed a
    // controlled token on the Battleground yet.
    return {
      runtime: {
        enabled: false,
        mapId,
        polygons: [],
        sourceActorIds: [],
        doors: [],
      },
      visibleTokenIds: allVisibleIds,
    }
  }

  const origins = sourceTokens
    .map((token) => {
      const actorId = tokenActorId(token)
      const actor = actorById(state, actorId)
      const rangeFeetRaw = Number(actor?.visionRangeFeet ?? 60)
      const rangeFeet =
        Number.isFinite(rangeFeetRaw)
          ? Math.max(5, Math.min(1000, rangeFeetRaw))
          : 60
      const grid = gridSettingsForMap(state, String(token.mapId ?? ''))
      const rangePixels = (rangeFeet / 5) * Math.max(1, grid.cellSize)

      return {
        actorId,
        point: tokenVisionPoint(state, token),
        rangePixels,
      }
    })
    .filter(
      (entry): entry is { actorId: string; point: VisionPoint; rangePixels: number } => Boolean(entry.point),
    )

  if (origins.length === 0) {
    return {
      runtime: {
        enabled: false,
        mapId,
        polygons: [],
        sourceActorIds: [],
        doors: [],
      },
      visibleTokenIds: allVisibleIds,
    }
  }

  const polygons = origins
    .map(({ point, rangePixels }) =>
      cachedVisibilityPolygon(
        mapId,
        point,
        settings,
        rangePixels,
      ),
    )
    .filter((polygon) => polygon.length >= 3)

  const visibleTokenIds = new Set<string>()

  for (const token of allTokens) {
    const tokenId = String(token.id ?? '')
    if (!tokenId) continue

    if (tokenOwnerId(state, token) === viewerUserId) {
      visibleTokenIds.add(tokenId)
      continue
    }

    const target = tokenVisionPoint(state, token)
    if (!target) continue

    if (
      polygons.some((polygon) =>
        pointInsideVisibilityPolygon(
          target,
          polygon,
        ),
      )
    ) {
      visibleTokenIds.add(tokenId)
    }
  }

  const doors =
    playerDoorInteractionsForViewer(
      state,
      viewerUserId,
      settings,
      mapId,
      sourceTokens,
    )

  return {
    runtime: {
      enabled: true,
      mapId,
      polygons,
      sourceActorIds: origins.map(({ actorId }) => actorId),
      doors,
    },
    visibleTokenIds,
  }
}

function visibleActorIdsForViewer(
  state: Record<string, unknown>,
  viewerUserId: string,
): Set<string> {
  const { visibleTokenIds } = playerVisionForViewer(state, viewerUserId)
  const result = new Set<string>()

  for (const token of targetingTokensForState(state)) {
    if (visibleTokenIds.has(String(token.id ?? ''))) {
      result.add(tokenActorId(token))
    }
  }

  for (const actor of normalizedActorsForState(state)) {
    if (actor.ownerId === viewerUserId) {
      result.add(actor.id)
    }
  }

  return result
}

function socketTargetSelection(
  state: Record<string, unknown>,
  socket: Socket,
): TargetSelection | null {
  const controllerId = String(socket.data.userId ?? '')
  return normalizeTargetSelections(state.targetSelections)
    .find((selection) => selection.controllerId === controllerId) ?? null
}

function actionSourceActor(
  state: Record<string, unknown>,
  socket: Socket,
  requestedActorId: unknown = null,
): Actor | null {
  const role = socket.data.role === 'dm' ? 'dm' : 'player'
  const userId = String(socket.data.userId ?? '')
  const actors = normalizedActorsForState(state)

  if (role === 'player') {
    return actors.find((actor) => actor.kind === 'player' && actor.ownerId === userId) ?? null
  }

  const actorId = String(requestedActorId ?? '').trim()
  return actorId
    ? actors.find((actor) => actor.id === actorId) ?? null
    : null
}

function replaceActorInState(
  state: Record<string, unknown>,
  actor: Actor,
): Record<string, unknown> {
  const actors = Array.isArray(state.actors) ? state.actors : []
  const actorIndex = actors.findIndex(
    (entry) => Boolean(
      entry &&
      typeof entry === 'object' &&
      String((entry as Record<string, unknown>).id ?? '') === actor.id,
    ),
  )

  if (actorIndex < 0) {
    throw new Error('Target Actor not found.')
  }

  const nextActors = [...actors]
  nextActors[actorIndex] = actor
  return { ...state, actors: nextActors }
}

function combatForState(state: Record<string, unknown>): CombatState {
  const actors = Array.isArray(state.actors)
    ? state.actors
    : []

  const actorIds = actors
    .filter((entry) => Boolean(entry && typeof entry === 'object'))
    .map((entry) => String((entry as Record<string, unknown>).id ?? ''))
    .filter(Boolean)

  return normalizeCombatState(state.combat, actorIds)
}


function turnEconomyMapForState(
  state: Record<string, unknown>,
): TurnEconomyByActorId {
  const actors = normalizedActorsForState(state)
  return normalizeTurnEconomyMap(state.turnEconomy, actors)
}

function turnEconomyForActor(
  state: Record<string, unknown>,
  actor: Actor,
): TurnEconomyState {
  return normalizeTurnEconomy(
    turnEconomyMapForState(state)[actor.id],
    actor,
  )
}

function replaceTurnEconomyInState(
  state: Record<string, unknown>,
  economy: TurnEconomyState,
): Record<string, unknown> {
  return {
    ...state,
    turnEconomy: {
      ...turnEconomyMapForState(state),
      [economy.actorId]: economy,
    },
  }
}

function resetTurnEconomyForActor(
  state: Record<string, unknown>,
  actorId: string | null,
): Record<string, unknown> {
  if (!actorId) return state
  const actor = actorById(state, actorId)
  if (!actor) return state

  return replaceTurnEconomyInState(
    state,
    freshTurnEconomy(actor),
  )
}

function appendPublicActivity(
  state: Record<string, unknown>,
  activity: Record<string, unknown>,
): Record<string, unknown> {
  const previous = Array.isArray(state.activityLog) ? state.activityLog : []
  return {
    ...state,
    lastAction: activity,
    activityLog: [...previous, activity].slice(-100),
  }
}

function helpBenefitsForState(
  state: Record<string, unknown>,
): HelpBenefit[] {
  return normalizeHelpBenefits(state.helpBenefits)
}

function replaceHelpBenefitsInState(
  state: Record<string, unknown>,
  benefits: HelpBenefit[],
): Record<string, unknown> {
  return {
    ...state,
    helpBenefits: normalizeHelpBenefits(benefits),
  }
}

function consumeHelpBenefitInState(
  state: Record<string, unknown>,
  benefitId: string | null | undefined,
): Record<string, unknown> {
  if (!benefitId) return state
  return replaceHelpBenefitsInState(
    state,
    consumeHelpBenefit(helpBenefitsForState(state), benefitId),
  )
}

function actorCannotTakeUtilityAction(actor: Actor): boolean {
  return !actorCanTakeCombatAction(actor)
}

function utilityRollRecord(
  campaignId: string,
  socket: Socket,
  actor: Actor,
  skill: import('../src/types/actor').CharacterSkill,
  mode: 'normal' | 'advantage' | 'disadvantage',
): {
  record: Record<string, unknown>
  total: number
  natural: number
  modifier: number
  mode: 'normal' | 'advantage' | 'disadvantage'
  bonusDiceTotal: number
} {
  const role = socket.data.role === 'dm' ? 'dm' : 'player'
  const userId = String(socket.data.userId ?? '')
  const rulesMode = resolveActorD20Mode(
    actor,
    'skill-check',
    mode,
  )
  const first = randomInt(1, 21)
  const second = rulesMode === 'normal' ? null : randomInt(1, 21)
  const natural = second === null
    ? first
    : rulesMode === 'advantage'
      ? Math.max(first, second)
      : Math.min(first, second)
  const baseModifier = actorSkillModifier(actor, skill)
  const effectModifier = actorD20Modifier(actor, 'skill-check')
  const bonusDiceResults = actorD20BonusDice(actor, 'skill-check')
    .flatMap((bonus) =>
      Array.from({ length: bonus.count }, () => ({
        effectId: bonus.effectId,
        name: bonus.name,
        sides: bonus.sides,
        roll: randomInt(1, bonus.sides + 1),
      })),
    )
  const bonusDiceTotal = bonusDiceResults.reduce((sum, entry) => sum + entry.roll, 0)
  const modifier = Math.max(-100, Math.min(100, baseModifier + effectModifier))
  const total = natural + modifier + bonusDiceTotal
  const room = presenceByCampaign.get(campaignId)
  const roller = room?.get(socket.id)
  const record = {
    type: 'dice-roll',
    id: `roll_${Date.now()}_${randomInt(1000, 9999)}`,
    rollerId: userId,
    rollerName: roller?.name ?? (role === 'dm' ? 'Dungeon Master' : 'Player'),
    role,
    purpose: 'skill-check',
    sides: 20,
    count: 1,
    modifier,
    mode: rulesMode,
    rolls: second === null ? [[first]] : [[first], [second]],
    total,
    bonusDiceResults,
    natural,
    visibility: genericDiceVisibilityForRoll(role, 'skill-check'),
    createdAt: new Date().toISOString(),
    actorId: actor.id,
    actorName: actor.name,
    skill,
  }

  return {
    record,
    total,
    natural,
    modifier,
    mode: rulesMode,
    bonusDiceTotal,
  }
}

function appendUtilityRollActivity(
  state: Record<string, unknown>,
  record: Record<string, unknown>,
): Record<string, unknown> {
  const previous = Array.isArray(state.activityLog) ? state.activityLog : []
  return {
    ...state,
    lastAction: record,
    activityLog: [...previous, record].slice(-100),
  }
}

function tokenForActor(
  state: Record<string, unknown>,
  actorId: string,
): Record<string, unknown> | null {
  const tokens = targetingTokensForState(state)
  const activeMapId = activeMapIdForState(state)
  const activeToken = activeMapId
    ? activeMapTokenForActor(activeMapId, tokens, actorId)
    : null

  if (activeToken) {
    return activeToken as Record<string, unknown>
  }

  const publishedMapId = publishedMapIdForState(state)
  if (publishedMapId && publishedMapId !== activeMapId) {
    return activeMapTokenForActor(
      publishedMapId,
      tokens,
      actorId,
    ) as Record<string, unknown> | null
  }

  return null
}

function actorDistanceFeet(
  state: Record<string, unknown>,
  sourceActorId: string,
  targetActorId: string,
): number | null {
  const sourceToken = tokenForActor(state, sourceActorId)
  const targetToken = tokenForActor(state, targetActorId)

  if (!sourceToken || !targetToken) {
    return null
  }

  const sourceMapId = String(sourceToken.mapId ?? '')
  const targetMapId = String(targetToken.mapId ?? '')

  if (!sourceMapId || sourceMapId !== targetMapId) {
    return null
  }

  return actorGridDistanceFeet(
    sourceMapId,
    targetingTokensForState(state),
    sourceActorId,
    targetActorId,
  )
}

function reactionWindowsForState(
  state: Record<string, unknown>,
): ReactionWindow[] {
  return normalizeReactionWindows(state.reactionWindows)
}

function replaceReactionWindowsInState(
  state: Record<string, unknown>,
  windows: ReactionWindow[],
): Record<string, unknown> {
  return {
    ...state,
    reactionWindows: normalizeReactionWindows(windows),
  }
}

function readiedActionsForState(
  state: Record<string, unknown>,
): ReadiedAction[] {
  return normalizeReadiedActions(state.readyActions)
}

function replaceReadiedActionsInState(
  state: Record<string, unknown>,
  actions: ReadiedAction[],
): Record<string, unknown> {
  return {
    ...state,
    readyActions: normalizeReadiedActions(actions),
  }
}


function detachPlayerFromCampaignState(
  campaignId: string,
  playerId: string,
): {
  removedActorIds: string[]
  removedTokenIds: string[]
} {
  const state =
    stateRecord(
      loadCampaignState(
        campaignId,
      ),
    )

  const actors =
    normalizedActorsForState(
      state,
    )

  const removedActorIds =
    actors
      .filter(
        (actor) =>
          actor.kind === 'player' &&
          actor.ownerId === playerId,
      )
      .map(
        (actor) =>
          actor.id,
      )

  const removedActorIdSet =
    new Set(
      removedActorIds,
    )

  const remainingActors =
    actors.filter(
      (actor) =>
        !removedActorIdSet.has(
          actor.id,
        ),
    )

  const rawTokens =
    Array.isArray(
      state.tokens,
    )
      ? state.tokens
      : []

  const removedTokenIds: string[] = []

  const remainingTokens =
    rawTokens.filter(
      (entry) => {
        if (
          !entry ||
          typeof entry !== 'object'
        ) {
          return true
        }

        const token =
          entry as Record<string, unknown>

        const tokenId =
          String(
            token.id ?? '',
          )

        const actorId =
          String(
            token.actorId ?? '',
          )

        const legacyOwnerId =
          String(
            token.ownerId ?? '',
          )

        const remove =
          removedActorIdSet.has(
            actorId,
          ) ||
          legacyOwnerId === playerId

        if (
          remove &&
          tokenId
        ) {
          removedTokenIds.push(
            tokenId,
          )
        }

        return !remove
      },
    )

  const removedTokenIdSet =
    new Set(
      removedTokenIds,
    )

  const sigils =
    safeArcaneReachSigils(
      state.arcaneReachSigils,
    )

  delete sigils[
    playerId
  ]

  const validActorIdSet =
    new Set(
      remainingActors.map(
        (actor) =>
          actor.id,
      ),
    )

  const targetSelections =
    normalizeTargetSelections(
      state.targetSelections,
    )
      .filter(
        (selection) =>
          selection.controllerId !== playerId &&
          !(
            selection.sourceActorId &&
            removedActorIdSet.has(
              selection.sourceActorId,
            )
          ),
      )
      .map(
        (selection) => {
          const nextTargets =
            selection.targetActorIds.filter(
              (actorId) =>
                validActorIdSet.has(
                  actorId,
                ),
            )

          return {
            ...selection,
            targetActorIds:
              nextTargets,
            targetActorId:
              nextTargets[0] ?? '',
          }
        },
      )
      .filter(
        (selection) =>
          Boolean(
            selection.targetActorId,
          ),
      )

  const readyActions =
    normalizeReadiedActions(
      state.readyActions,
    )
      .filter(
        (ready) =>
          !removedActorIdSet.has(
            ready.actorId,
          ),
      )
      .map(
        (ready) => ({
          ...ready,
          preparedTargetActorId:
            ready.preparedTargetActorId &&
            removedActorIdSet.has(
              ready.preparedTargetActorId,
            )
              ? null
              : ready.preparedTargetActorId,
          utility:
            ready.utility
              ? {
                  ...ready.utility,
                  targetActorId:
                    ready.utility.targetActorId &&
                    removedActorIdSet.has(
                      ready.utility.targetActorId,
                    )
                      ? null
                      : ready.utility.targetActorId,
                }
              : null,
        }),
      )

  const validReadyActionIds =
    new Set(
      readyActions.map(
        (ready) =>
          ready.id,
      ),
    )

  const reactionWindows =
    normalizeReactionWindows(
      state.reactionWindows,
    )
      .filter(
        (window) => {
          if (
            removedActorIdSet.has(
              window.reactorActorId,
            ) ||
            removedActorIdSet.has(
              window.turnActorId,
            )
          ) {
            return false
          }

          if (
            window.kind ===
              'opportunity-attack'
          ) {
            return !(
              removedActorIdSet.has(
                window.triggeringActorId,
              ) ||
              removedTokenIdSet.has(
                window.reactorTokenId,
              ) ||
              removedTokenIdSet.has(
                window.triggeringTokenId,
              )
            )
          }

          return validReadyActionIds.has(
            window.readyActionId,
          )
        },
      )

  const helpBenefits =
    normalizeHelpBenefits(
      state.helpBenefits,
    )
      .filter(
        (benefit) =>
          !removedActorIdSet.has(
            benefit.sourceActorId,
          ) &&
          !removedActorIdSet.has(
            benefit.targetActorId,
          ) &&
          !(
            benefit.attackTargetActorId &&
            removedActorIdSet.has(
              benefit.attackTargetActorId,
            )
          ),
      )
      .map(
        (benefit) => ({
          ...benefit,
          eligibleAllyActorIds:
            benefit.eligibleAllyActorIds.filter(
              (actorId) =>
                validActorIdSet.has(
                  actorId,
                ),
            ),
        }),
      )

  const combat =
    normalizeCombatState(
      state.combat,
      remainingActors.map(
        (actor) =>
          actor.id,
      ),
    )

  const turnEconomy =
    normalizeTurnEconomyMap(
      state.turnEconomy,
      remainingActors,
    )

  saveCampaignState(
    campaignId,
    {
      ...state,
      actors:
        remainingActors,
      tokens:
        remainingTokens,
      arcaneReachSigils:
        sigils,
      targetSelections,
      combat,
      turnEconomy,
      reactionWindows,
      readyActions,
      helpBenefits,
    },
  )

  return {
    removedActorIds,
    removedTokenIds,
  }
}

function removeReadiedSpellActionsForActor(
  state: Record<string, unknown>,
  actorId: string,
): Record<string, unknown> {
  const spellReadyIds = new Set(
    readiedActionsForState(state)
      .filter((ready) => ready.actorId === actorId && ready.kind === 'spell')
      .map((ready) => ready.id),
  )
  if (spellReadyIds.size === 0) return state
  const nextReady = readiedActionsForState(state).filter((ready) => !spellReadyIds.has(ready.id))
  const nextWindows = reactionWindowsForState(state).filter((window) => (
    window.kind !== 'readied-action' || !spellReadyIds.has(window.readyActionId)
  ))
  return replaceReactionWindowsInState(
    replaceReadiedActionsInState(state, nextReady),
    nextWindows,
  )
}

function clearReadiedActionAndWindows(
  state: Record<string, unknown>,
  readyActionId: string,
  options: { preserveSpellConcentration?: boolean } = {},
): Record<string, unknown> {
  const existing = readiedActionsForState(state).find((ready) => ready.id === readyActionId) ?? null
  let nextState = state
  if (existing?.kind === 'spell' && options.preserveSpellConcentration !== true) {
    nextState = clearActorConcentrationState(nextState, existing.actorId)
  }
  const nextReady = removeReadiedAction(readiedActionsForState(nextState), readyActionId)
  const nextWindows = reactionWindowsForState(nextState).filter((window) => (
    window.kind !== 'readied-action' || window.readyActionId !== readyActionId
  ))
  return replaceReactionWindowsInState(
    replaceReadiedActionsInState(nextState, nextReady),
    nextWindows,
  )
}

function assertNoPendingReactionForCurrentTurn(
  state: Record<string, unknown>,
): void {
  const combat = combatForState(state)
  if (!combat.active || !combat.currentActorId) return
  if (reactionWindowsForState(state).some((window) => window.turnActorId === combat.currentActorId)) {
    throw new Error('Resolve or decline the pending Reaction before continuing the current turn.')
  }
}

function gridDistanceFeetBetween(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return Math.max(
    Math.abs(normalizeGridIndex(ax) - normalizeGridIndex(bx)),
    Math.abs(normalizeGridIndex(ay) - normalizeGridIndex(by)),
  ) * 5
}

function opportunityReactionWindowsForMovement(
  state: Record<string, unknown>,
  mover: Actor,
  moverToken: Record<string, unknown>,
  fromGridX: number,
  fromGridY: number,
  toGridX: number,
  toGridY: number,
  combat: CombatState,
): ReactionWindow[] {
  if (
    !combat.active ||
    combat.currentActorId !== mover.id ||
    !actorCanTakeCombatAction(mover) ||
    turnEconomyForActor(state, mover).disengaged
  ) {
    return []
  }

  const moverTokenId = String(moverToken.id ?? '')
  if (!moverTokenId) return []

  const createdAtMs = Date.now()
  const createdAt = new Date(createdAtMs).toISOString()
  const expiresAt = new Date(createdAtMs + REACTION_WINDOW_TTL_MS).toISOString()

  return normalizedActorsForState(state).flatMap((reactor) => {
    if (
      reactor.id === mover.id ||
      !actorCanTakeCombatAction(reactor) ||
      !actorsAreOpposedForOpportunity(reactor, mover)
    ) {
      return []
    }

    const economy = turnEconomyForActor(state, reactor)
    if (remainingTurnResource(economy, 'reaction') <= 0) return []

    const reactorToken = tokenForActor(state, reactor.id)
    if (!reactorToken) return []

    const reactorGridX = normalizeGridIndex(reactorToken.gridX)
    const reactorGridY = normalizeGridIndex(reactorToken.gridY)
    const distanceBeforeFeet = gridDistanceFeetBetween(
      reactorGridX,
      reactorGridY,
      fromGridX,
      fromGridY,
    )
    const distanceAfterFeet = gridDistanceFeetBetween(
      reactorGridX,
      reactorGridY,
      toGridX,
      toGridY,
    )
    const eligibleAttackIds = eligibleOpportunityAttackIds(
      attackProfilesForActor(reactor),
      distanceBeforeFeet,
      distanceAfterFeet,
    )
    if (eligibleAttackIds.length === 0) return []

    return [{
      id: randomUUID(),
      kind: 'opportunity-attack' as const,
      reactorActorId: reactor.id,
      triggeringActorId: mover.id,
      reactorTokenId: String(reactorToken.id ?? ''),
      triggeringTokenId: moverTokenId,
      eligibleAttackIds,
      triggerDistanceFeet: distanceBeforeFeet,
      reactorGridX,
      reactorGridY,
      triggerFromGridX: normalizeGridIndex(fromGridX),
      triggerFromGridY: normalizeGridIndex(fromGridY),
      triggerToGridX: normalizeGridIndex(toGridX),
      triggerToGridY: normalizeGridIndex(toGridY),
      combatRound: combat.round,
      turnActorId: combat.currentActorId ?? '',
      createdAt,
      expiresAt,
    }]
  })
}


interface OpportunityReactionResolution {
  state: Record<string, unknown>
  resolution: AttackResolution
  healthResolution: unknown
  concentrationCheck: Record<string, unknown> | null
  economy: TurnEconomyState
}

function resolveOpportunityReactionAttack(
  stateInput: Record<string, unknown>,
  window: OpportunityAttackReactionWindow,
  attackId: string,
): OpportunityReactionResolution {
  let state = stateInput
  if (reactionWindowExpired(window)) {
    throw new Error('This Reaction window has expired.')
  }

  const combat = combatForState(state)
  if (
    !combat.active ||
    combat.currentActorId !== window.triggeringActorId ||
    combat.currentActorId !== window.turnActorId ||
    combat.round !== window.combatRound
  ) {
    throw new Error('This Reaction trigger is no longer valid for the current turn.')
  }

  const source = actorById(state, window.reactorActorId)
  const target = actorById(state, window.triggeringActorId)
  if (!source || !target) throw new Error('Reaction source or target no longer exists.')
  if (!actorCanTakeCombatAction(source)) {
    throw new Error(`${source.name} cannot take a Reaction while unconscious or Incapacitated.`)
  }
  if (target.lifeState !== 'conscious') {
    throw new Error('The triggering Actor can no longer complete this Opportunity Attack trigger.')
  }

  const sourceToken = tokenForActor(state, source.id)
  const targetToken = tokenForActor(state, target.id)
  if (!sourceToken || !targetToken) {
    throw new Error('Reaction source and target must remain visible on the active map.')
  }
  if (
    String(sourceToken.id ?? '') !== window.reactorTokenId ||
    String(targetToken.id ?? '') !== window.triggeringTokenId ||
    normalizeGridIndex(sourceToken.gridX) !== window.reactorGridX ||
    normalizeGridIndex(sourceToken.gridY) !== window.reactorGridY ||
    normalizeGridIndex(targetToken.gridX) !== window.triggerToGridX ||
    normalizeGridIndex(targetToken.gridY) !== window.triggerToGridY
  ) {
    throw new Error('The battlefield changed after this Reaction trigger. The window is stale.')
  }

  const profile = attackProfilesForActor(source)
    .find((candidate) => candidate.id === attackId)
  if (
    !profile ||
    profile.attackType !== 'melee' ||
    !window.eligibleAttackIds.includes(profile.id) ||
    window.triggerDistanceFeet > profile.rangeFeet
  ) {
    throw new Error('That melee attack is not eligible for this Opportunity Attack.')
  }
  if (!actorHasLineOfEffect(state, source.id, target.id, 'blocksSight')) {
    throw new Error('The Opportunity Attack target is outside line of sight.')
  }
  if (!actorHasLineOfEffect(state, source.id, target.id, 'blocksEffects')) {
    throw new Error('The Opportunity Attack is blocked by a Wall or closed Door.')
  }

  let economy = turnEconomyForActor(state, source)
  economy = spendTurnResource(economy, 'reaction')
  state = replaceTurnEconomyInState(state, economy)

  const helpAttackBenefit = matchingHelpAttackBenefit(
    helpBenefitsForState(state),
    source.id,
    target.id,
  )
  const helpedMode = helpAttackBenefit
    ? addAdvantageMode('normal')
    : 'normal'
  const rulesMode = resolveActorD20Mode(
    source,
    'attack',
    helpedMode,
    target,
    window.triggerDistanceFeet,
  )
  const mode = applyDodgeAttackMode(
    rulesMode,
    target,
    turnEconomyForActor(state, target),
  )
  if (helpAttackBenefit) {
    state = consumeHelpBenefitInState(state, helpAttackBenefit.id)
  }

  const first = randomInt(1, 21)
  const second = mode === 'normal' ? null : randomInt(1, 21)
  const natural = second === null
    ? first
    : mode === 'advantage'
      ? Math.max(first, second)
      : Math.min(first, second)
  const effectModifier = actorD20Modifier(source, 'attack')
  const bonusDiceResults = actorD20BonusDice(source, 'attack')
    .flatMap((bonus) => Array.from(
      { length: bonus.count },
      () => ({ sides: bonus.sides, value: randomInt(1, bonus.sides + 1) }),
    ))
  const bonusDiceTotal = bonusDiceResults.reduce((sum, roll) => sum + roll.value, 0)
  const attackBonus = attackBonusForActor(source, profile)
  const attackTotal = natural + attackBonus + effectModifier + bonusDiceTotal
  const targetAc = target.ac
  const outcome: AttackOutcome = natural === 1
    ? 'miss'
    : natural === 20
      ? 'critical'
      : attackTotal >= targetAc
        ? 'hit'
        : 'miss'

  const targetHpBefore = target.currentHp
  const targetTempHpBefore = target.tempHp
  const damage = outcome === 'miss'
    ? null
    : rollDiceFormula(
        profile.damageFormula,
        outcome === 'critical',
        (sides) => randomInt(1, sides + 1),
      )

  let effectiveDamage = 0
  let targetHpAfter = targetHpBefore
  let targetTempHpAfter = targetTempHpBefore
  let healthResolution: unknown = null
  let concentrationCheck: Record<string, unknown> | null = null

  if (damage) {
    const applied = resolveHealthOperation(target, {
      operation: 'damage',
      amount: damage.total,
      damageType: profile.damageType,
      criticalHit: outcome === 'critical',
    })
    const updatedTarget = normalizeActor(applied.actor)
    healthResolution = applied.resolution
    effectiveDamage = applied.resolution.effectiveDamage
    targetHpAfter = updatedTarget.currentHp
    targetTempHpAfter = updatedTarget.tempHp
    state = replaceActorInState(state, updatedTarget)

    const concentration = resolveConcentrationAfterDamage(
      state,
      target.id,
      applied.resolution.effectiveDamage,
    )
    state = concentration.state
    concentrationCheck = concentration.check

    const healthEntry: HealthLogEntry = {
      id: randomUUID(),
      actorId: updatedTarget.id,
      actorName: updatedTarget.name,
      createdAt: new Date().toISOString(),
      resolution: applied.resolution,
    }
    state = {
      ...state,
      healthLog: [...normalizeHealthLog(state.healthLog), healthEntry].slice(-100),
    }
  }

  const resolution: AttackResolution = {
    id: randomUUID(),
    sourceActorId: source.id,
    sourceActorName: source.name,
    targetActorId: target.id,
    targetActorName: target.name,
    attackId: profile.id,
    attackName: profile.name,
    attackBonus,
    targetAc,
    coverBonus: 0,
    distanceFeet: window.triggerDistanceFeet,
    mode,
    d20Rolls: second === null ? [first] : [first, second],
    natural,
    bonusDiceResults,
    attackTotal,
    outcome,
    outcomeOverride: 'rules',
    damage,
    damageType: profile.damageType,
    effectiveDamage,
    targetHpBefore,
    targetHpAfter,
    targetTempHpBefore,
    targetTempHpAfter,
    createdAt: new Date().toISOString(),
  }

  const updatedTarget = actorById(state, target.id)
  const remainingWindows = reactionWindowsForState(state)
    .filter((candidate) => candidate.id !== window.id)
    .filter((candidate) => (
      updatedTarget?.lifeState === 'conscious' ||
      candidate.kind !== 'opportunity-attack' ||
      candidate.triggeringActorId !== window.triggeringActorId
    ))
  state = replaceReactionWindowsInState(state, remainingWindows)
  state = appendPublicActivity(state, {
    type: 'reaction-resolution',
    reactionKind: window.kind,
    reactionWindowId: window.id,
    ...resolution,
  })

  return {
    state,
    resolution,
    healthResolution,
    concentrationCheck,
    economy,
  }
}


interface ReadiedAttackReactionResolution {
  state: Record<string, unknown>
  resolution: AttackResolution
  healthResolution: unknown
  concentrationCheck: Record<string, unknown> | null
  economy: TurnEconomyState
}

interface ReadiedUtilityReactionResolution {
  state: Record<string, unknown>
  economy: TurnEconomyState
  message: string
  rollResult: Record<string, unknown> | null
  helpBenefit: HelpBenefit | null
}

function readiedActionForWindow(
  state: Record<string, unknown>,
  window: ReadiedActionReactionWindow,
): ReadiedAction {
  if (reactionWindowExpired(window)) {
    throw new Error('This Ready Reaction window has expired.')
  }

  const combat = combatForState(state)
  if (
    !combat.active ||
    combat.currentActorId !== window.turnActorId ||
    combat.round !== window.combatRound
  ) {
    throw new Error('This Ready trigger is no longer valid for the current turn.')
  }

  const ready = readiedActionsForState(state)
    .find((candidate) => candidate.id === window.readyActionId)
  if (!ready || ready.actorId !== window.reactorActorId) {
    throw new Error('The prepared Ready action is no longer available.')
  }

  const reactor = actorById(state, ready.actorId)
  if (!reactor) throw new Error('Ready Actor no longer exists.')
  if (actorCannotTakeUtilityAction(reactor)) {
    throw new Error(`${reactor.name} cannot take the readied Reaction while Incapacitated or unconscious.`)
  }

  const economy = turnEconomyForActor(state, reactor)
  if (economy.turnStartedAt !== ready.sourceTurnStartedAt) {
    throw new Error('This Ready action expired at the start of the Actor’s next turn.')
  }
  if (remainingTurnResource(economy, 'reaction') <= 0) {
    throw new Error('Reaction is already spent.')
  }

  return ready
}

function resolveReadiedReactionAttack(
  stateInput: Record<string, unknown>,
  window: ReadiedActionReactionWindow,
  targetActorId: string,
): ReadiedAttackReactionResolution {
  let state = stateInput
  const ready = readiedActionForWindow(state, window)
  if (ready.kind !== 'attack' || !ready.attackId) {
    throw new Error('This Ready window is not an Attack action.')
  }

  const source = actorById(state, ready.actorId)
  const target = actorById(state, targetActorId)
  if (!source || !target) throw new Error('Ready attack source or target no longer exists.')
  if (target.id === source.id) throw new Error('A readied Attack requires a different target.')
  if (ready.preparedTargetActorId && ready.preparedTargetActorId !== target.id) {
    throw new Error('This Ready action was prepared for a different target.')
  }

  const sourceToken = tokenForActor(state, source.id)
  const targetToken = tokenForActor(state, target.id)
  if (!sourceToken || !targetToken) {
    throw new Error('Both attacker and target must remain visible on the active map.')
  }

  const profile = attackProfilesForActor(source)
    .find((candidate) => candidate.id === ready.attackId)
  if (!profile) throw new Error('The prepared attack is no longer available to this Actor.')

  const distanceFeet = actorDistanceFeet(state, source.id, target.id)
  const rangeValidation = validateAttackRange(
    distanceFeet,
    profile.rangeFeet,
    profile.longRangeFeet,
  )
  if (!rangeValidation.legal || distanceFeet === null) {
    if (distanceFeet === null) throw new Error('Attack distance could not be established on the active map.')
    throw new Error(`${target.name} is out of range (${distanceFeet} ft; maximum ${rangeValidation.maxRangeFeet} ft).`)
  }

  const readyAttackChannel =
    (profile.rangeFeet ?? 5) > 5
      ? 'blocksProjectiles'
      : 'blocksEffects'
  if (!actorHasLineOfEffect(state, source.id, target.id, 'blocksSight')) {
    throw new Error("The readied Attack target is outside the attacker's current line of sight.")
  }
  if (!actorHasLineOfEffect(state, source.id, target.id, readyAttackChannel)) {
    throw new Error('The readied Attack is blocked by a Wall or closed Door.')
  }

  let economy = turnEconomyForActor(state, source)
  economy = spendTurnResource(economy, 'reaction')
  state = replaceTurnEconomyInState(state, economy)

  const helpAttackBenefit = matchingHelpAttackBenefit(
    helpBenefitsForState(state),
    source.id,
    target.id,
  )
  const helpedRequestedMode = helpAttackBenefit
    ? addAdvantageMode(rangeValidation.mode ?? 'normal')
    : rangeValidation.mode ?? 'normal'
  const rulesMode = resolveActorD20Mode(source, 'attack', helpedRequestedMode, target, distanceFeet)
  const mode = applyDodgeAttackMode(
    rulesMode,
    target,
    turnEconomyForActor(state, target),
  )
  if (helpAttackBenefit) state = consumeHelpBenefitInState(state, helpAttackBenefit.id)

  const first = randomInt(1, 21)
  const second = mode === 'normal' ? null : randomInt(1, 21)
  const natural = second === null
    ? first
    : mode === 'advantage'
      ? Math.max(first, second)
      : Math.min(first, second)
  const effectModifier = actorD20Modifier(source, 'attack')
  const bonusDiceResults = actorD20BonusDice(source, 'attack')
    .flatMap((bonus) => Array.from({ length: bonus.count }, () => ({
      sides: bonus.sides,
      value: randomInt(1, bonus.sides + 1),
    })))
  const bonusDiceTotal = bonusDiceResults.reduce((sum, roll) => sum + roll.value, 0)
  const attackBonus = attackBonusForActor(source, profile)
  const attackTotal = natural + attackBonus + effectModifier + bonusDiceTotal
  const targetAc = target.ac
  const outcome: AttackOutcome = natural === 1
    ? 'miss'
    : natural === 20
      ? 'critical'
      : attackTotal >= targetAc
        ? 'hit'
        : 'miss'

  const targetHpBefore = target.currentHp
  const targetTempHpBefore = target.tempHp
  const damage = outcome === 'miss'
    ? null
    : rollDiceFormula(
        profile.damageFormula,
        outcome === 'critical',
        (sides) => randomInt(1, sides + 1),
      )
  let effectiveDamage = 0
  let targetHpAfter = targetHpBefore
  let targetTempHpAfter = targetTempHpBefore
  let healthResolution: unknown = null
  let concentrationCheck: Record<string, unknown> | null = null

  if (damage) {
    const applied = resolveHealthOperation(target, {
      operation: 'damage',
      amount: damage.total,
      damageType: profile.damageType,
      criticalHit: outcome === 'critical',
    })
    const updatedTarget = normalizeActor(applied.actor)
    healthResolution = applied.resolution
    effectiveDamage = applied.resolution.effectiveDamage
    targetHpAfter = updatedTarget.currentHp
    targetTempHpAfter = updatedTarget.tempHp
    state = replaceActorInState(state, updatedTarget)

    const concentration = resolveConcentrationAfterDamage(
      state,
      target.id,
      applied.resolution.effectiveDamage,
    )
    state = concentration.state
    concentrationCheck = concentration.check

    const healthEntry: HealthLogEntry = {
      id: randomUUID(),
      actorId: updatedTarget.id,
      actorName: updatedTarget.name,
      createdAt: new Date().toISOString(),
      resolution: applied.resolution,
    }
    state = {
      ...state,
      healthLog: [...normalizeHealthLog(state.healthLog), healthEntry].slice(-100),
    }
  }

  const resolution: AttackResolution = {
    id: randomUUID(),
    sourceActorId: source.id,
    sourceActorName: source.name,
    targetActorId: target.id,
    targetActorName: target.name,
    attackId: profile.id,
    attackName: profile.name,
    attackBonus,
    targetAc,
    coverBonus: 0,
    distanceFeet,
    mode,
    d20Rolls: second === null ? [first] : [first, second],
    natural,
    bonusDiceResults,
    attackTotal,
    outcome,
    outcomeOverride: 'rules',
    damage,
    damageType: profile.damageType,
    effectiveDamage,
    targetHpBefore,
    targetHpAfter,
    targetTempHpBefore,
    targetTempHpAfter,
    createdAt: new Date().toISOString(),
  }

  state = clearReadiedActionAndWindows(state, ready.id)
  state = appendPublicActivity(state, {
    type: 'reaction-resolution',
    reactionKind: window.kind,
    reactionWindowId: window.id,
    readyActionId: ready.id,
    ...resolution,
  })

  return { state, resolution, healthResolution, concentrationCheck, economy }
}

function resolveReadiedUtilityReaction(
  stateInput: Record<string, unknown>,
  window: ReadiedActionReactionWindow,
  socket: Socket,
  campaignId: string,
): ReadiedUtilityReactionResolution {
  let state = stateInput
  const ready = readiedActionForWindow(state, window)
  if (ready.kind !== 'utility' || !ready.utility) {
    throw new Error('This Ready window is not a Utility action.')
  }

  const actor = actorById(state, ready.actorId)
  if (!actor) throw new Error('Ready Actor no longer exists.')
  const payload = ready.utility
  const action = normalizeCoreUtilityAction(payload.action)
  if (!action) throw new Error('The prepared utility action is no longer valid.')

  let economy = turnEconomyForActor(state, actor)
  const sourceTurnStartedAt = ready.sourceTurnStartedAt
  let message = ''
  let rollResult: Record<string, unknown> | null = null
  let helpBenefit: HelpBenefit | null = null

  if (action === 'help') {
    const helpMode = payload.helpMode
    if (!helpMode) throw new Error('Prepared Help is missing its Help type.')
    const target = payload.targetActorId ? actorById(state, payload.targetActorId) : null
    if (!target || target.id === actor.id) throw new Error('Prepared Help target is no longer valid.')
    if (!tokenForActor(state, target.id) || !tokenForActor(state, actor.id)) {
      throw new Error('Help requires both creatures to remain visible on the active map.')
    }
    if (!actorHasLineOfEffect(state, actor.id, target.id, 'blocksEffects')) {
      throw new Error('Help is blocked by a Wall or closed Door.')
    }

    if (helpMode === 'ability-check') {
      if (!sameDefaultCombatSide(actor, target)) throw new Error('Ability-check Help must target an ally.')
      const skill = normalizeCharacterSkill(payload.skill)
      if (!skill || !actorHasSkillProficiency(actor, skill)) {
        throw new Error('The prepared Help skill is no longer a valid proficiency.')
      }
      helpBenefit = {
        id: randomUUID(), kind: 'ability-check', sourceActorId: actor.id, targetActorId: target.id,
        attackTargetActorId: null, skill, eligibleAllyActorIds: [], sourceTurnStartedAt,
        createdAt: new Date().toISOString(),
      }
      state = replaceHelpBenefitsInState(state, [...helpBenefitsForState(state), helpBenefit])
      message = `${actor.name} uses the readied Help action for ${target.name}'s ${skill} check.`
    } else {
      if (sameDefaultCombatSide(actor, target)) throw new Error('Attack-roll Help must distract an opposing creature.')
      const distanceFeet = actorDistanceFeet(state, actor.id, target.id)
      if (distanceFeet === null || distanceFeet > 5) throw new Error('Attack-roll Help requires the distracted creature to be within 5 feet when the Reaction resolves.')
      const allies = normalizedActorsForState(state)
        .filter((candidate) => candidate.id !== actor.id && sameDefaultCombatSide(actor, candidate))
        .map((candidate) => candidate.id)
      helpBenefit = {
        id: randomUUID(), kind: 'attack-roll', sourceActorId: actor.id, targetActorId: target.id,
        attackTargetActorId: target.id, skill: null, eligibleAllyActorIds: allies, sourceTurnStartedAt,
        createdAt: new Date().toISOString(),
      }
      state = replaceHelpBenefitsInState(state, [...helpBenefitsForState(state), helpBenefit])
      message = `${actor.name} uses the readied Help action to distract ${target.name}.`
    }
  } else if (action === 'utilize') {
    const objectName = String(payload.objectName ?? '').trim().replace(/\s+/g, ' ').slice(0, 100)
    if (!objectName) throw new Error('Prepared Utilize action is missing its object.')
    message = `${actor.name} uses the readied Utilize action with ${objectName}. Resolve that object's specific rule or DM adjudication.`
  } else {
    const skill = normalizeUtilityActionSkill(action, payload.skill)
    if (!skill) throw new Error(`Prepared ${action} action has an invalid skill.`)

    let target: Actor | null = null
    let suggestedDc: number | null = null
    if (action === 'influence') {
      target = payload.targetActorId ? actorById(state, payload.targetActorId) : null
      if (!target || target.id === actor.id || target.kind === 'player') throw new Error('Prepared Influence target is no longer valid.')
      if (!tokenForActor(state, actor.id) || !tokenForActor(state, target.id)) throw new Error('Influence requires both creatures to remain visible on the active map.')
      if (!actorHasLineOfEffect(state, actor.id, target.id, 'blocksEffects')) throw new Error('Influence is blocked by a Wall or closed Door.')
      if (!influenceSkillAllowedForTarget(skill, target)) throw new Error('Wisdom (Animal Handling) can Influence only a Beast or Monstrosity.')
      suggestedDc = Math.max(15, Math.round(Number(target.abilities.intelligence) || 10))
    }

    let requestedMode: 'normal' | 'advantage' | 'disadvantage' = 'normal'
    const abilityHelp = matchingHelpAbilityBenefit(helpBenefitsForState(state), actor.id, skill)
    if (abilityHelp) requestedMode = addAdvantageMode(requestedMode)

    const rolled = utilityRollRecord(campaignId, socket, actor, skill, requestedMode)
    rollResult = {
      ...rolled.record,
      utilityAction: action,
      suggestedDc,
      hideDc: action === 'hide' ? 15 : null,
      dmAdjudicationRequired: action === 'hide' || action === 'influence' || action === 'search' || action === 'study',
    }
    state = appendUtilityRollActivity(state, rollResult)
    if (abilityHelp) state = consumeHelpBenefitInState(state, abilityHelp.id)

    if (action === 'hide') {
      const passed = rolled.total >= 15
      message = `${actor.name} readied Hide: ${skill} ${rolled.total} vs DC 15 (${passed ? 'check passed' : 'check failed'}). Cover/obscurement and line of sight still require DM or vision-engine validation.`
    } else if (action === 'influence') {
      message = `${actor.name} readied Influence: ${skill} ${rolled.total}. Suggested hesitant-creature DC: ${suggestedDc}; final outcome remains DM-adjudicated.`
    } else if (action === 'search') {
      message = `${actor.name} readied Search: ${skill} ${rolled.total}. The DM resolves what the check discovers.`
    } else {
      message = `${actor.name} readied Study: ${skill} ${rolled.total}. The DM resolves what the check recalls or uncovers.`
    }
  }

  economy = spendTurnResource(economy, 'reaction')
  state = replaceTurnEconomyInState(state, economy)
  state = clearReadiedActionAndWindows(state, ready.id)
  state = appendPublicActivity(state, {
    type: 'reaction-resolution', reactionKind: window.kind, reactionWindowId: window.id,
    readyActionId: ready.id, actorId: actor.id, actorName: actor.name, action, detail: message,
    createdAt: new Date().toISOString(), visibility: 'public',
  })

  return { state, economy, message, rollResult, helpBenefit }
}

interface ReadiedSpellReactionResolution {
  state: Record<string, unknown>
  economy: TurnEconomyState
  message: string
  spellId: string
  spellName: string
  castLevel: number
  targetActorIds: string[]
  areaPoint: { gridX: number; gridY: number } | null
}

function resolveReadiedSpellReaction(
  stateInput: Record<string, unknown>,
  window: ReadiedActionReactionWindow,
  targetActorIdsRaw: unknown,
  areaGridX: unknown,
  areaGridY: unknown,
): ReadiedSpellReactionResolution {
  let state = stateInput
  const ready = readiedActionForWindow(state, window)
  if (ready.kind !== 'spell' || !ready.spell) {
    throw new Error('This Ready window is not a held spell.')
  }

  const actor = actorById(state, ready.actorId)
  if (!actor) throw new Error('Ready spell Actor no longer exists.')
  const spell = spellById(ready.spell.spellId)
  if (!spell) throw new Error('The held spell rule is no longer available.')
  if (!spellHasAutomatedRule(spell.id)) {
    throw new Error(`${spell.name} no longer has an automatic rules resolver.`)
  }
  if (castingTimeActionCost(spell.castingTime) !== 'action') {
    throw new Error('A held Ready spell must have a casting time of an Action.')
  }
  if (actor.characterSheet?.concentratingSpellId !== spell.id) {
    throw new Error('The held spell dissipated because Concentration ended.')
  }

  const { targetActorIds, areaPoint } = validateSpellTargets(
    state,
    actor,
    spell.id,
    ready.spell.castLevel,
    targetActorIdsRaw,
    areaGridX,
    areaGridY,
  )

  let economy = turnEconomyForActor(state, actor)
  economy = spendTurnResource(economy, 'reaction')
  state = replaceTurnEconomyInState(state, economy)

  const combat = combatForState(state)
  const currentActor = actorById(state, actor.id) ?? actor
  if (spell.id === 'bless') {
    state = applyBlessToTargets(state, currentActor, targetActorIds, combat)
  }
  const spellEffects = resolveAutomatedSpellEffects(state, currentActor, spell, ready.spell.castLevel, targetActorIds)
  state = spellEffects.state

  state = clearReadiedActionAndWindows(state, ready.id, {
    preserveSpellConcentration: spell.concentration,
  })
  state = appendPublicActivity(state, {
    type: 'spell-cast',
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    actorId: actor.id,
    actorName: actor.name,
    spellId: spell.id,
    spellName: spell.name,
    castLevel: ready.spell.castLevel,
    targetActorIds,
    areaPoint,
    automated: spellEffects.fullyAutomated,
    effectResults: spellEffects.results,
    readied: true,
    visibility: 'public',
  })
  state = appendPublicActivity(state, {
    type: 'reaction-resolution',
    reactionKind: window.kind,
    reactionWindowId: window.id,
    readyActionId: ready.id,
    actorId: actor.id,
    actorName: actor.name,
    spellId: spell.id,
    spellName: spell.name,
    createdAt: new Date().toISOString(),
    visibility: 'public',
  })

  return {
    state,
    economy,
    message: `${actor.name} released readied ${spell.name}.`,
    spellId: spell.id,
    spellName: spell.name,
    castLevel: ready.spell.castLevel,
    targetActorIds,
    areaPoint,
  }
}

function actorDistanceFromPointFeet(
  state: Record<string, unknown>,
  actorId: string,
  gridX: number,
  gridY: number,
): number | null {
  const token = tokenForActor(state, actorId)
  if (!token) return null
  const dx = Math.abs(normalizeGridIndex(token.gridX) - normalizeGridIndex(gridX))
  const dy = Math.abs(normalizeGridIndex(token.gridY) - normalizeGridIndex(gridY))
  return Math.max(dx, dy) * 5
}

function stateHasConcentrationFromSource(
  state: Record<string, unknown>,
  sourceActorId: string,
): boolean {
  return normalizedActorsForState(state).some((actor) =>
    (actor.effects ?? []).some(
      (effect) => effect.sourceActorId === sourceActorId && effect.concentration === true,
    ),
  )
}

function removeConcentrationEffectsFromSource(
  state: Record<string, unknown>,
  sourceActorId: string,
): Record<string, unknown> {
  const actors = normalizedActorsForState(state)
  const nextActors = actors.map((actor) => {
    const removedEffects = (actor.effects ?? []).filter(
      (effect) => !(effect.sourceActorId === sourceActorId && effect.concentration === true),
    )
    if (removedEffects.length === (actor.effects ?? []).length) return actor

    const remainingConditions = actor.conditions.filter((condition) =>
      removedEffects.some(
        (effect) => effect.kind === 'condition' && effect.name.toLowerCase() === condition.toLowerCase(),
      ) || !(actor.effects ?? []).some(
        (effect) => effect.kind === 'condition' && effect.name.toLowerCase() === condition.toLowerCase() && effect.sourceActorId === sourceActorId && effect.concentration === true,
      ),
    )

    return normalizeActor({
      ...actor,
      effects: removedEffects,
      conditions: remainingConditions,
    })
  })

  return {
    ...state,
    actors: nextActors,
  }
}

function clearActorConcentrationState(
  state: Record<string, unknown>,
  actorId: string,
): Record<string, unknown> {
  const actor = actorById(state, actorId)
  let nextState = state
  if (actor?.characterSheet?.concentratingSpellId) {
    nextState = replaceActorInState(nextState, normalizeActor({
      ...actor,
      characterSheet: { ...actor.characterSheet, concentratingSpellId: '' },
    }))
  }
  return removeConcentrationEffectsFromSource(nextState, actorId)
}

function breakReadiedSpellConcentration(
  state: Record<string, unknown>,
  actorId: string,
): Record<string, unknown> {
  return removeReadiedSpellActionsForActor(
    clearActorConcentrationState(state, actorId),
    actorId,
  )
}

function resolveConcentrationAfterDamage(
  state: Record<string, unknown>,
  actorId: string,
  damageTaken: number,
): { state: Record<string, unknown>; check: Record<string, unknown> | null } {
  if (damageTaken <= 0) return { state, check: null }
  let actor = actorById(state, actorId)
  if (!actor) return { state, check: null }
  const concentrating = Boolean(
    actor.characterSheet?.concentratingSpellId ||
    stateHasConcentrationFromSource(state, actor.id)
  )
  if (!concentrating) return { state, check: null }

  if (actor.lifeState !== 'conscious') {
    state = breakReadiedSpellConcentration(state, actor.id)
    return { state, check: { ended: true, reason: 'incapacitated' } }
  }

  const dc = concentrationDc(damageTaken)
  const mode = resolveActorD20Mode(actor, 'saving-throw')
  const first = randomInt(1, 21)
  const second = mode === 'normal' ? null : randomInt(1, 21)
  const natural = second === null
    ? first
    : mode === 'advantage'
      ? Math.max(first, second)
      : Math.min(first, second)
  const bonusDiceResults = actorD20BonusDice(actor, 'saving-throw')
    .flatMap((bonus) => Array.from(
      { length: bonus.count },
      () => ({ sides: bonus.sides, value: randomInt(1, bonus.sides + 1) }),
    ))
  const bonusDiceTotal = bonusDiceResults.reduce((sum, roll) => sum + roll.value, 0)
  const modifier =
    savingThrowModifier(actor, 'constitution') +
    actorD20Modifier(actor, 'saving-throw')
  const total =
    natural +
    modifier +
    bonusDiceTotal
  const maintained = total >= dc
  if (!maintained) {
    state = breakReadiedSpellConcentration(state, actor.id)
  }
  return {
    state,
    check: {
      dc,
      mode,
      natural,
      total,
      maintained,
      ended: !maintained,
      rolls: second === null ? [first] : [first, second],
      modifier,
      bonusDiceResults,
    },
  }
}

function removeExpiredRoundEffects(
  state: Record<string, unknown>,
  round: number,
): Record<string, unknown> {
  if (round <= 0) return state
  const actors = normalizedActorsForState(state)
  const nextActors = actors.map((actor) => {
    const existing = actor.effects ?? []
    const nextEffects = existing.filter(
      (effect) => effect.expiresAtRound === null || effect.expiresAtRound === undefined || effect.expiresAtRound > round,
    )
    if (nextEffects.length === existing.length) return actor
    const remainingConditions = actor.conditions.filter((condition) =>
      nextEffects.some((effect) => effect.kind === 'condition' && effect.name.toLowerCase() === condition.toLowerCase()),
    )
    return normalizeActor({ ...actor, effects: nextEffects, conditions: remainingConditions })
  })
  return { ...state, actors: nextActors }
}

function activeSpellTurnKeyForState(
  state: Record<string, unknown>,
): string | null {
  const combat = combatForState(state)
  if (!combat.active || !combat.currentActorId) return null
  const currentActor = actorById(state, combat.currentActorId)
  if (!currentActor) return null
  const currentEconomy = turnEconomyForActor(state, currentActor)
  return spellTurnKeyForCombat(combat, currentEconomy)
}

function playerOwnsCurrentTurn(
  state: Record<string, unknown>,
  actor: Actor,
  socket: Socket,
): boolean {
  const combat = combatForState(state)
  if (!combat.active) return true
  if (socket.data.role === 'dm') return true
  return combat.currentActorId === actor.id
}


function validateSpellTargets(
  state: Record<string, unknown>,
  sourceActor: Actor,
  spellId: string,
  castLevel: number,
  rawTargetActorIds: unknown,
  areaGridX: unknown = null,
  areaGridY: unknown = null,
): {
  targetActorIds: string[]
  areaPoint: { gridX: number; gridY: number } | null
} {
  const spell = spellById(spellId)
  if (!spell) throw new Error('Spell rule not found.')
  const rule = spellTargetRule(spell, castLevel)
  const visibleActorIds = visibleActorIdsOnActiveMap(state)
  const targetActorIds = Array.isArray(rawTargetActorIds)
    ? rawTargetActorIds
        .map((actorId) => String(actorId ?? '').trim())
        .filter(Boolean)
        .filter((actorId, index, entries) => entries.indexOf(actorId) === index)
        .slice(0, 50)
    : []

  if (rule.mode === 'self') {
    return { targetActorIds: [sourceActor.id], areaPoint: null }
  }

  if (rule.mode === 'none') {
    return { targetActorIds: [], areaPoint: null }
  }

  if (targetActorIds.length < rule.minTargets || targetActorIds.length > rule.maxTargets) {
    throw new Error(
      `This spell requires ${rule.minTargets === rule.maxTargets ? rule.maxTargets : `${rule.minTargets}-${rule.maxTargets}`} legal target(s).`,
    )
  }

  for (const actorId of targetActorIds) {
    if (!visibleActorIds.has(actorId)) {
      throw new Error('Every spell target must be a visible token on the active map.')
    }
    if (!actorById(state, actorId)) {
      throw new Error('A selected spell target no longer exists.')
    }
    if (!actorHasLineOfEffect(state, sourceActor.id, actorId, 'blocksSight')) {
      throw new Error("A selected spell target is outside the caster's current line of sight.")
    }
  }

  let areaPoint: { gridX: number; gridY: number } | null = null
  if (rule.mode === 'point-area') {
    const x = Number(areaGridX)
    const y = Number(areaGridY)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('Choose the spell area on the map before casting.')
    }
    areaPoint = {
      gridX: normalizeGridIndex(x),
      gridY: normalizeGridIndex(y),
    }
    const sourceToken = tokenForActor(state, sourceActor.id)
    if (!sourceToken) throw new Error('Your token must be on the active map to place an area spell.')
    const dx = Math.abs(normalizeGridIndex(sourceToken.gridX) - areaPoint.gridX)
    const dy = Math.abs(normalizeGridIndex(sourceToken.gridY) - areaPoint.gridY)
    const pointDistance = Math.max(dx, dy) * 5
    if (rule.rangeFeet !== null && pointDistance > rule.rangeFeet) {
      throw new Error(`The chosen spell area is outside ${rule.rangeFeet} ft range.`)
    }
    if (!actorHasLineOfEffectToPoint(state, sourceActor.id, areaPoint.gridX, areaPoint.gridY, 'blocksEffects')) {
      throw new Error('The spell area is blocked by a Wall or closed Door.')
    }
    if (rule.radiusFeet !== null) {
      for (const actorId of targetActorIds) {
        const distance = actorDistanceFromPointFeet(state, actorId, areaPoint.gridX, areaPoint.gridY)
        if (distance === null || distance > rule.radiusFeet) {
          throw new Error(`Every selected target must be inside the ${rule.radiusFeet}-ft spell area.`)
        }
        if (!pointHasLineOfEffectToActor(state, areaPoint.gridX, areaPoint.gridY, actorId, 'blocksEffects')) {
          throw new Error('A selected spell target is shielded from the area by a Wall or closed Door.')
        }
      }
    }
  } else {
    for (const actorId of targetActorIds) {
      if (!actorHasLineOfEffect(state, sourceActor.id, actorId, 'blocksEffects')) {
        throw new Error('A selected spell target is blocked by a Wall or closed Door.')
      }

      if (rule.rangeFeet !== null) {
        const distance = actorDistanceFeet(state, sourceActor.id, actorId)
        if (distance === null || distance > rule.rangeFeet) {
          throw new Error(`A selected target is outside ${rule.rangeFeet} ft range.`)
        }
      }
    }
  }

  return { targetActorIds, areaPoint }
}

function actorCanCastSpell(
  actor: Actor,
  spellId: string,
): boolean {
  const spell = spellById(spellId)
  const sheet = actor.characterSheet
  if (!spell || !sheet) return false
  if (!spellIsAvailableToCharacter(spell, sheet.className, actor.level)) return false

  const granted = featureGrantedSpells(sheet.className, sheet.subclassName, actor.level)
  const isGranted = granted.some((entry) => entry.id === spell.id)
  const isKnown = (sheet.knownSpellIds ?? []).includes(spell.id) || isGranted
  if (!isKnown) return false
  if (spell.level === 0 || isGranted) return true
  return (sheet.preparedSpellIds ?? []).includes(spell.id)
}

function applyBlessToTargets(
  state: Record<string, unknown>,
  sourceActor: Actor,
  targetActorIds: string[],
  combat: CombatState,
): Record<string, unknown> {
  const actors = normalizedActorsForState(state)
  const expiresAtRound = combat.active ? combat.round + 10 : null
  const nextActors = actors.map((actor) => {
    if (!targetActorIds.includes(actor.id)) return actor
    const existing = (actor.effects ?? []).filter(
      (effect) => !(effect.sourceActorId === sourceActor.id && effect.sourceRuleId === 'spell:bless'),
    )
    const effect: ActorEffect = {
      id: randomUUID(),
      name: 'Bless',
      kind: 'dice-bonus',
      scope: 'attack-save',
      value: 0,
      diceCount: 1,
      dieSides: 4,
      sourceRuleId: 'spell:bless',
      concentration: true,
      expiresAtRound,
      sourceActorId: sourceActor.id,
      sourceActorName: sourceActor.name,
      sourceRole: sourceActor.ownerId ? 'player' : 'dm',
      createdAt: new Date().toISOString(),
    }
    return normalizeActor({ ...actor, effects: [...existing, effect].slice(-100) })
  })
  return { ...state, actors: nextActors }
}

interface SpellEffectResolution {
  actorId: string
  actorName: string
  kind: 'hit' | 'miss' | 'save' | 'damage' | 'heal' | 'adjudication'
  roll?: number
  total?: number
  targetNumber?: number
  damage?: number
  healed?: number
  formula?: string
  dice?: Array<{ sides: number; value: number }>
  detail?: string
}

function resolveAutomatedSpellEffects(
  stateInput: Record<string, unknown>,
  source: Actor,
  spell: NonNullable<ReturnType<typeof spellById>>,
  castLevel: number,
  targetActorIds: string[],
): { state: Record<string, unknown>; results: SpellEffectResolution[]; fullyAutomated: boolean } {
  let state = stateInput
  const ability = automaticSpellcastingAbility(source.characterSheet?.className ?? '') ?? 'intelligence'
  const abilityScore = source.abilities[ability]
  const spellAttack = spellAttackBonus(source.level, abilityScore)
  const saveDc = spellSaveDc(source.level, abilityScore)
  const damageFormula = spellDamageFormula(spell, castLevel, source.level)
  const damageType = spellDamageType(spell) ?? 'untyped'
  const healingFormula = spellHealingFormula(spell, castLevel, abilityModifier(abilityScore))
  const saveAbility = spellSaveAbility(spell)
  const attackSpell = Boolean(spell.attackType || /make a (?:melee|ranged) spell attack/i.test(spell.description))
  const halfOnSave = Boolean(saveAbility && /half as much damage|half damage/i.test(`${spell.saveEffect} ${spell.description}`))
  const results: SpellEffectResolution[] = []
  const fullyAutomated = spell.id === 'bless' || Boolean(damageFormula || healingFormula)

  for (const targetActorId of targetActorIds) {
    let target = actorById(state, targetActorId)
    if (!target) continue
    const distanceFeet = actorDistanceFeet(state, source.id, target.id) ?? 0
    let attackHit = true
    let critical = false
    let attackNatural: number | undefined
    let attackTotal: number | undefined
    let saved = false
    let saveRoll: number | undefined
    let saveTotal: number | undefined
    let targetNumber: number | undefined

    if (attackSpell) {
      const first = randomInt(1, 21)
      const natural = first
      const total = natural + spellAttack + actorD20Modifier(source, 'spell')
      attackHit = natural === 20 || (natural !== 1 && total >= target.ac)
      critical = natural === 20
      attackNatural = natural
      attackTotal = total
      if (!damageFormula) {
        results.push({ actorId: target.id, actorName: target.name, kind: attackHit ? 'hit' : 'miss', roll: natural, total, targetNumber: target.ac })
      }
    } else if (saveAbility) {
      const requestedMode = resolveActorD20Mode(target, 'saving-throw', 'normal', source, distanceFeet)
      const mode = applyDodgeSavingThrowMode(requestedMode, target, turnEconomyForActor(state, target), saveAbility)
      const first = randomInt(1, 21)
      const second = mode === 'normal' ? null : randomInt(1, 21)
      const natural = second === null
        ? first
        : mode === 'advantage' ? Math.max(first, second) : Math.min(first, second)
      const bonusDice = actorD20BonusDice(target, 'saving-throw')
        .flatMap((bonus) => Array.from({ length: bonus.count }, () => randomInt(1, bonus.sides + 1)))
      saveTotal = natural + savingThrowModifier(target, saveAbility)
        + actorD20Modifier(target, 'saving-throw')
        + bonusDice.reduce((sum, value) => sum + value, 0)
      targetNumber = saveDc
      saved = saveTotal >= saveDc
      saveRoll = natural
      if (!damageFormula) {
        results.push({ actorId: target.id, actorName: target.name, kind: 'save', roll: natural, total: saveTotal, targetNumber: saveDc })
      }
    }

    if (damageFormula && (attackHit || !attackSpell)) {
      const rolled = rollDiceFormula(damageFormula, critical, (sides) => randomInt(1, sides + 1))
      const amount = saved ? (halfOnSave ? Math.floor(rolled.total / 2) : 0) : rolled.total
      if (amount > 0) {
        const applied = resolveHealthOperation(target, { operation: 'damage', amount, damageType })
        const updated = normalizeActor(applied.actor)
        state = replaceActorInState(state, updated)
        const concentration = resolveConcentrationAfterDamage(state, target.id, applied.resolution.effectiveDamage)
        state = concentration.state
        const healthEntry: HealthLogEntry = {
          id: randomUUID(), actorId: updated.id, actorName: updated.name,
          createdAt: new Date().toISOString(), resolution: applied.resolution,
        }
        state = { ...state, healthLog: [...normalizeHealthLog(state.healthLog), healthEntry].slice(-100) }
        results.push({
          actorId: updated.id,
          actorName: updated.name,
          kind: attackSpell ? 'hit' : saveAbility ? 'save' : 'damage',
          roll: attackSpell ? attackNatural : saveRoll,
          total: attackSpell ? attackTotal : saveTotal,
          targetNumber: attackSpell ? target.ac : targetNumber,
          damage: applied.resolution.effectiveDamage,
          formula: rolled.formula,
          dice: rolled.dice.flatMap((die) => die.rolls.map((value) => ({ sides: die.sides, value: Math.abs(value) }))),
          detail: saved && halfOnSave ? `Save succeeded; half damage applied. Rolled ${rolled.total}.` : `${rolled.total} ${damageType} damage rolled.`,
        })
      } else {
        results.push({ actorId: target.id, actorName: target.name, kind: attackSpell ? 'miss' : 'save', roll: saveRoll, total: saveTotal, targetNumber, damage: 0, formula: rolled.formula, dice: rolled.dice.flatMap((die) => die.rolls.map((value) => ({ sides: die.sides, value: Math.abs(value) }))), detail: saved ? 'Save succeeded; no damage.' : 'No damage applied.' })
      }
    }

    if (damageFormula && attackSpell && !attackHit) {
      results.push({ actorId: target.id, actorName: target.name, kind: 'miss', roll: attackNatural, total: attackTotal, targetNumber: target.ac, damage: 0, detail: 'Spell attack missed.' })
    }

    if (healingFormula) {
      const rolled = rollDiceFormula(healingFormula, false, (sides) => randomInt(1, sides + 1))
      const applied = resolveHealthOperation(target, { operation: 'heal', amount: rolled.total })
      const updated = normalizeActor(applied.actor)
      state = replaceActorInState(state, updated)
      const healthEntry: HealthLogEntry = {
        id: randomUUID(), actorId: updated.id, actorName: updated.name,
        createdAt: new Date().toISOString(), resolution: applied.resolution,
      }
      state = { ...state, healthLog: [...normalizeHealthLog(state.healthLog), healthEntry].slice(-100) }
      results.push({ actorId: updated.id, actorName: updated.name, kind: 'heal', healed: applied.resolution.healed, formula: rolled.formula, dice: rolled.dice.flatMap((die) => die.rolls.map((value) => ({ sides: die.sides, value: Math.abs(value) }))), detail: `${rolled.total} healing rolled.` })
    }
  }

  if (!fullyAutomated) {
    results.push({ actorId: source.id, actorName: source.name, kind: 'adjudication' })
  }
  return { state, results, fullyAutomated }
}

function dmOverrideActivity(
  dmName: string,
  actor: Actor,
  label: string,
): Record<string, unknown> {
  return {
    type: 'dm-override',
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    dmName,
    actorId: actor.id,
    actorName: actor.name,
    label,
    visibility: 'public',
  }
}

function resetMovementForActor(
  state: Record<string, unknown>,
  actorId: string | null,
): Record<string, unknown> {
  if (!actorId) {
    return state
  }

  const tokens = Array.isArray(state.tokens)
    ? state.tokens
    : []

  return {
    ...state,
    tokens: tokens.map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return entry
      }

      const token = entry as Record<string, unknown>
      const tokenId = String(token.id ?? '')
      const tokenActorId =
        typeof token.actorId === 'string' && token.actorId
          ? token.actorId
          : `actor-${tokenId}`

      return tokenActorId === actorId
        ? {
            ...token,
            movementUsedFeet: 0,
          }
        : token
    }),
  }
}

function resetAllCombatMovement(
  state: Record<string, unknown>,
): Record<string, unknown> {
  const tokens = Array.isArray(state.tokens)
    ? state.tokens
    : []

  return {
    ...state,
    tokens: tokens.map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return entry
      }

      return {
        ...(entry as Record<string, unknown>),
        movementUsedFeet: 0,
      }
    }),
  }
}

function endTurnEconomyForActor(
  state: Record<string, unknown>,
  actorId: string | null,
): Record<string, unknown> {
  if (!actorId) return state
  const actor = actorById(state, actorId)
  if (!actor) return state

  return replaceTurnEconomyInState(
    state,
    endTurnEconomy(turnEconomyForActor(state, actor)),
  )
}

function startTurnForActor(
  state: Record<string, unknown>,
  actorId: string | null,
): Record<string, unknown> {
  const movementResetState = resetMovementForActor(state, actorId)
  const helpResetState = actorId
    ? replaceHelpBenefitsInState(
        movementResetState,
        clearHelpBenefitsAtSourceTurnStart(
          helpBenefitsForState(movementResetState),
          actorId,
        ),
      )
    : movementResetState
  const concentrationResetState = actorId && actorHasReadiedSpell(readiedActionsForState(helpResetState), actorId)
    ? clearActorConcentrationState(helpResetState, actorId)
    : helpResetState
  const readyResetState = actorId
    ? replaceReadiedActionsInState(
        concentrationResetState,
        clearReadiedActionsAtActorTurnStart(
          readiedActionsForState(concentrationResetState),
          actorId,
        ),
      )
    : concentrationResetState
  return resetTurnEconomyForActor(readyResetState, actorId)
}

function resetAllCombatTransientState(
  state: Record<string, unknown>,
): Record<string, unknown> {
  let movementResetState = resetAllCombatMovement(state)
  const readiedSpellActorIds = [...new Set(
    readiedActionsForState(movementResetState)
      .filter((ready) => ready.kind === 'spell')
      .map((ready) => ready.actorId),
  )]
  for (const actorId of readiedSpellActorIds) {
    movementResetState = clearActorConcentrationState(movementResetState, actorId)
  }
  const actors = normalizedActorsForState(movementResetState)

  return {
    ...movementResetState,
    turnEconomy: Object.fromEntries(
      actors.map((actor) => [actor.id, freshTurnEconomy(actor)]),
    ) as TurnEconomyByActorId,
    reactionWindows: [],
    helpBenefits: [],
    readyActions: [],
  }
}

interface CombatLifecycleOptions {
  endActorId?: string | null
  startActorId?: string | null
  resetAllTransient?: boolean
  clearAllReadyActions?: boolean
}

function persistCombatState(
  campaignId: string,
  state: Record<string, unknown>,
  combat: CombatState,
  lifecycle: CombatLifecycleOptions = {},
): void {
  let nextState: Record<string, unknown> = {
    ...state,
    combat,
    // Reaction windows are scoped to the current turn/trigger. A turn change,
    // rewind, encounter reset, or combat end invalidates every pending window.
    reactionWindows: [],
  }

  nextState = removeExpiredRoundEffects(nextState, combat.round)
  if (lifecycle.clearAllReadyActions === true) {
    const readiedSpellActorIds = [...new Set(
      readiedActionsForState(nextState)
        .filter((ready) => ready.kind === 'spell')
        .map((ready) => ready.actorId),
    )]
    for (const actorId of readiedSpellActorIds) {
      nextState = clearActorConcentrationState(nextState, actorId)
    }
    nextState = replaceReadiedActionsInState(nextState, [])
  }

  if (lifecycle.resetAllTransient === true) {
    nextState = resetAllCombatTransientState(nextState)
  } else {
    nextState = endTurnEconomyForActor(
      nextState,
      lifecycle.endActorId ?? null,
    )
    nextState = startTurnForActor(
      nextState,
      lifecycle.startActorId ?? null,
    )
  }

  saveCampaignState(campaignId, nextState)
  broadcastState(campaignId)
}

function appendDiceRollToState(
  state: Record<string, unknown>,
  roll: DiceRollEntry,
): Record<string, unknown> {
  return {
    ...state,
    diceLog: [
      ...normalizeDiceLog(state.diceLog),
      roll,
    ].slice(-100),
  }
}

function emitTableDiceRoll(
  campaignId: string,
  roll: {
    id?: string
    rollerName: string
    title: string
    total: number
    dice: Array<{ sides: number; value: number; discarded?: boolean }>
    detail?: string
  },
): void {
  if (!campaignId || roll.dice.length === 0) return
  io.to(roomName(campaignId)).emit('dice:table-roll', {
    ...roll,
    id: roll.id ?? randomUUID(),
  })
}

function emitConcentrationDiceReveal(
  campaignId: string,
  actorName: string,
  check: Record<string, unknown> | null,
): void {
  if (!check) return
  const rolls = Array.isArray(check.rolls)
    ? check.rolls
    : [check.natural ?? check.rawRoll]
  const natural = Number(check.natural ?? check.rawRoll)
  const keptIndex = rolls.findIndex((value) => Number(value) === natural)
  const dice = rolls.flatMap((value, index) => {
    const roll = Number(value)
    return Number.isFinite(roll)
      ? [{
        sides: 20,
        value: Math.max(1, Math.min(20, Math.round(roll))),
        discarded: rolls.length > 1 && index !== Math.max(0, keptIndex),
      }]
      : []
  })
  const bonusDice = Array.isArray(check.bonusDiceResults) ? check.bonusDiceResults : []
  for (const entry of bonusDice) {
    if (!entry || typeof entry !== 'object') continue
    const bonus = entry as Record<string, unknown>
    const sides = Number(bonus.sides)
    const value = Number(bonus.value)
    if (!Number.isFinite(sides) || !Number.isFinite(value)) continue
    dice.push({
      sides: Math.max(4, Math.min(100, Math.round(sides))),
      value: Math.max(1, Math.min(Math.round(sides), Math.round(value))),
      discarded: false,
    })
  }

  emitTableDiceRoll(campaignId, {
    id: randomUUID(),
    rollerName: actorName,
    title: `Concentration Save · ${actorName}`,
    total: Math.round(Number(check.total) || 0),
    dice,
    detail: [
      `DC ${Math.round(Number(check.dc) || 0)}`,
      Number.isFinite(Number(check.modifier)) && Number(check.modifier) !== 0
        ? `${Number(check.modifier) > 0 ? '+' : ''}${Math.round(Number(check.modifier))} modifier`
        : '',
      check.maintained === true ? 'Maintained' : 'Concentration broken',
    ].filter(Boolean).join(' · '),
  })
}

function appendHealthLogToState(
  state: Record<string, unknown>,
  entry: HealthLogEntry,
): Record<string, unknown> {
  return {
    ...state,
    healthLog: [
      ...normalizeHealthLog(state.healthLog),
      entry,
    ].slice(-100),
  }
}

function socketDisplayName(socket: Socket, campaignId: string): string {
  return presenceByCampaign.get(campaignId)?.get(socket.id)?.name
    ?? (socket.data.role === 'dm' ? 'Dungeon Master' : 'Player')
}

io.on(
  'connection',
  (socket) => {
    socket.on(
      'player:allow-seat-recovery',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          const campaignId =
            requireDmCampaignId(socket)

          const payload =
            (rawPayload ?? {}) as {
              playerId?: unknown
            }

          const playerId =
            String(payload.playerId ?? '').trim()

          const player =
            listPlayers(campaignId)
              .find(
                (candidate) =>
                  candidate.id === playerId,
              )

          if (!player) {
            throw new Error(
              'Player seat not found.',
            )
          }

          grantSeatRecovery(
            campaignId,
            player.id,
          )

          acknowledge?.({
            ok: true,
            playerId: player.id,
            playerName: player.name,
            expiresInSeconds:
              Math.floor(
                SEAT_RECOVERY_WINDOW_MS / 1000,
              ),
          })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'Seat recovery could not be enabled.',
          })
        }
      },
    )

    socket.on(
      'player:kick',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(
            socket,
            'player:kick',
            rawPayload,
          )

          const campaignId =
            requireDmCampaignId(socket)

          const payload =
            (rawPayload ?? {}) as {
              playerId?: unknown
            }

          const playerId =
            String(payload.playerId ?? '').trim()

          if (!playerId) {
            throw new Error(
              'Player seat is required.',
            )
          }

          const player =
            kickPlayerSeat(
              campaignId,
              playerId,
            )

          if (!player) {
            throw new Error(
              'Player seat not found in this campaign.',
            )
          }

          detachPlayerFromCampaignState(
            campaignId,
            playerId,
          )

          const room =
            presenceByCampaign.get(
              campaignId,
            )

          const playerSockets =
            room
              ? [...room.values()]
                  .filter(
                    (entry) =>
                      entry.role === 'player' &&
                      entry.userId === playerId,
                  )
                  .map(
                    (entry) =>
                      io.sockets.sockets.get(
                        entry.socketId,
                      ),
                  )
                  .filter(
                    (
                      candidate,
                    ): candidate is Socket =>
                      Boolean(candidate),
                  )
              : []

          for (
            const playerSocket
            of playerSockets
          ) {
            playerSocket.emit(
              'session:kicked',
              {
                message:
                  'The Dungeon Master removed you from this campaign.',
              },
            )

            leaveCurrentCampaign(
              playerSocket,
            )
          }

          broadcastState(
            campaignId,
          )

          acknowledge?.({
            ok: true,
            playerId:
              player.id,
            playerName:
              player.name,
          })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'Could not kick this Player.',
          })
        }
      },
    )

    socket.on(
      'player:ban',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(
            socket,
            'player:ban',
            rawPayload,
          )

          const campaignId =
            requireDmCampaignId(socket)

          const payload =
            (rawPayload ?? {}) as {
              playerId?: unknown
            }

          const playerId =
            String(payload.playerId ?? '').trim()

          if (!playerId) {
            throw new Error(
              'Player seat is required.',
            )
          }

          const player =
            banPlayerSeat(
              campaignId,
              playerId,
            )

          if (!player) {
            throw new Error(
              'Player seat not found or is already banned.',
            )
          }

          detachPlayerFromCampaignState(
            campaignId,
            playerId,
          )

          const room =
            presenceByCampaign.get(
              campaignId,
            )

          const playerSockets =
            room
              ? [...room.values()]
                  .filter(
                    (entry) =>
                      entry.role === 'player' &&
                      entry.userId === playerId,
                  )
                  .map(
                    (entry) =>
                      io.sockets.sockets.get(
                        entry.socketId,
                      ),
                  )
                  .filter(
                    (
                      candidate,
                    ): candidate is Socket =>
                      Boolean(candidate),
                  )
              : []

          for (
            const playerSocket
            of playerSockets
          ) {
            playerSocket.emit(
              'session:kicked',
              {
                message:
                  'The Dungeon Master banned you from this campaign.',
              },
            )

            leaveCurrentCampaign(
              playerSocket,
            )
          }

          broadcastState(
            campaignId,
          )

          acknowledge?.({
            ok: true,
            playerId:
              player.id,
            playerName:
              player.name,
          })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'Could not ban this Player.',
          })
        }
      },
    )

    socket.on(
      'player:unban',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(
            socket,
            'player:unban',
            rawPayload,
          )

          const campaignId =
            requireDmCampaignId(socket)

          const payload =
            (rawPayload ?? {}) as {
              playerId?: unknown
            }

          const playerId =
            String(payload.playerId ?? '').trim()

          if (!playerId) {
            throw new Error(
              'Player seat is required.',
            )
          }

          const player =
            unbanPlayerSeat(
              campaignId,
              playerId,
            )

          if (!player) {
            throw new Error(
              'Banned Player seat not found.',
            )
          }

          acknowledge?.({
            ok: true,
            playerId:
              player.id,
            playerName:
              player.name,
          })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'Could not unban this Player.',
          })
        }
      },
    )

    socket.on(
      'session:leave',
      (
        _rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          const previousCampaignId =
            String(
              socket.data.campaignId ?? '',
            )

          leaveCurrentCampaign(
            socket,
          )

          acknowledge?.({
            ok: true,
            previousCampaignId,
          })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'Could not leave the campaign.',
          })
        }
      },
    )

    socket.on(
      'session:join',
      (
        rawPayload: unknown,
        acknowledge:
          (
            result: unknown,
          ) => void,
      ) => {
        try {
          const payload =
            (
              rawPayload ?? {}
            ) as {
              role?: string
              campaignId?: string
              joinCode?: string
              name?: string
              playerKey?: string
            }

          const role =
            payload.role === 'dm'
              ? 'dm'
              : payload.role ===
                    'player'
                ? 'player'
                : null

          if (!role) {
            acknowledge({
              ok: false,

              error:
                'Invalid role.',
            })

            return
          }

          const name =
            String(
              payload.name ?? '',
            )
              .trim()
              .slice(
                0,
                40,
              )

          if (!name) {
            acknowledge({
              ok: false,

              error:
                'Name is required.',
            })

            return
          }

          consumeJoinRateLimit(
            socket,
          )

          let campaign = null

          let userId =
            'dm'

          let player = null

          let playerKey = ''

          let resumed =
            false

          if (
            role === 'dm'
          ) {
            if (
              !isTrustedLocalSocket(
                socket,
              )
            ) {
              acknowledge({
                ok: false,

                error:
                  'DM access is allowed only from the host computer using localhost.',
              })

              return
            }

            campaign =
              getCampaign(
                String(
                  payload.campaignId ??
                    '',
                ),
              )
          } else {
            campaign =
              getCampaignByJoinCode(
                String(
                  payload.joinCode ??
                    '',
                ),
              )

            if (campaign) {
              let recoveryPlayerId = ''

              const matchingPlayers =
                listPlayers(campaign.id)
                  .filter(
                    (candidate) =>
                      candidate.name.localeCompare(
                        name,
                        undefined,
                        { sensitivity: 'accent' },
                      ) === 0,
                  )

              if (
                matchingPlayers.length === 1 &&
                playerNameRecoveryAllowed(
                  hasSeatRecoveryGrant(
                    campaign.id,
                    matchingPlayers[0].id,
                  ),
                )
              ) {
                recoveryPlayerId =
                  matchingPlayers[0].id
              }

              playerKey =
                String(
                  payload.playerKey ??
                    '',
                )

              player =
                registerOrResumePlayer(
                  campaign.id,

                  playerKey,

                  name,

                  {
                    allowNameRecovery:
                      playerNameRecoveryAllowed(
                        Boolean(recoveryPlayerId),
                      ),
                  },
                )

              if (
                recoveryPlayerId &&
                player.id === recoveryPlayerId
              ) {
                consumeSeatRecoveryGrant(
                  campaign.id,
                  recoveryPlayerId,
                )
              }

              userId =
                player.id

              resumed =
                player.createdAt !==
                player.lastSeenAt
            }
          }

          if (!campaign) {
            acknowledge({
              ok: false,

              error:
                'Campaign not found.',
            })

            return
          }

          leaveCurrentCampaign(
            socket,
          )

          const room =
            roomName(
              campaign.id,
            )

          socket.join(
            room,
          )

          let presence =
            presenceByCampaign.get(
              campaign.id,
            )

          if (!presence) {
            presence =
              new Map()

            presenceByCampaign.set(
              campaign.id,
              presence,
            )
          }

          presence.set(
            socket.id,
            {
              socketId:
                socket.id,

              campaignId:
                campaign.id,

              role,

              name,

              userId,
            },
          )

          socket.data.campaignId =
            campaign.id

          socket.data.role =
            role

          socket.data.userId =
            userId

          if (role === 'player') {
            socket.data.playerKey =
              playerKey
          }

          touchCampaign(
            campaign.id,
          )

          let fullState =
            loadCampaignState(
              campaign.id,
            )

          let characterCreated = false
          let characterRestored = false
          let characterActorId = ''

          if (role === 'player') {
            const state = stateRecord(fullState)
            const actors = Array.isArray(state.actors)
              ? state.actors.map((entry) => normalizeActor(entry as Actor))
              : []
            const existingCharacter = actors.find(
              (actor) => actor.kind === 'player' && actor.ownerId === userId,
            )

            if (existingCharacter) {
              characterActorId = existingCharacter.id

              saveCharacterVault(
                playerKey,
                campaign.id,
                existingCharacter,
              )
            } else {
              const vault =
                loadCharacterVault(
                  playerKey,
                )

              const actor =
                vault
                  ? createPlayerActorFromVault(
                      vault.character,
                      {
                        sourceCampaignId:
                          vault.sourceCampaignId,
                        targetCampaignId:
                          campaign.id,
                        name,
                        ownerId:
                          userId,
                      },
                    )
                  : createBlankPlayerActor({
                      id: `actor-${randomUUID()}`,
                      name,
                      ownerId: userId,
                    })

              const rawPlayerColors =
                state.playerColors && typeof state.playerColors === 'object'
                  ? state.playerColors as Record<string, unknown>
                  : {}

              fullState = {
                ...state,
                actors: [...actors, actor],
                playerColors: {
                  ...rawPlayerColors,
                  [userId]: safeTokenColor(
                    rawPlayerColors[userId],
                    defaultPlayerColor(userId),
                  ),
                },
              }

              fullState =
                saveCampaignState(
                  campaign.id,
                  fullState,
                ) as Record<string, unknown>

              characterCreated = !vault
              characterRestored = Boolean(vault)
              characterActorId = actor.id
            }
          }

          if (
            role === 'dm'
          ) {
            acknowledge({
              ok: true,

              campaign,

              activeSession:
                getActiveSession(
                  campaign.id,
                ),

              state:
                fullState,

              maps:
                listAssets(
                  campaign.id,
                  'map',
                ),

              snapshots:
                listSnapshots(
                  campaign.id,
                ),

              players:
                listPlayers(
                  campaign.id,
                ),

              bannedPlayers:
                listBannedPlayers(
                  campaign.id,
                ),
            })
          } else {
            acknowledge({
              ok: true,

              campaign: {
                id:
                  campaign.id,

                name:
                  campaign.name,
              },

              player,

              resumed,

              characterCreated,

              characterRestored,

              characterActorId,

              activeSession:
                getActiveSession(
                  campaign.id,
                ),

              state:
                playerSafeState(
                  fullState,
                  userId,
                ),
            })
          }

          if (
            characterCreated ||
            characterRestored
          ) {
            broadcastState(campaign.id)
          }

          emitPresence(
            campaign.id,
          )
        } catch (error) {
          acknowledge({
            ok: false,

            error:
              error instanceof Error
                ? error.message
                : 'Could not join session.',
          })
        }
      },
    )

    socket.on(
      'target:set',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          const campaignId = String(socket.data.campaignId ?? '')
          const userId = String(socket.data.userId ?? '')
          const role = socket.data.role === 'dm' ? 'dm' : 'player'

          if (!campaignId || !userId) {
            throw new Error('Join a campaign before choosing a target.')
          }

          const payload = (rawPayload ?? {}) as {
            targetActorId?: unknown
            sourceActorId?: unknown
            mode?: unknown
            maxTargets?: unknown
          }
          const targetActorId = String(payload.targetActorId ?? '').trim()
          const mode = payload.mode === 'toggle' ? 'toggle' : 'replace'
          const maxTargets = Math.max(1, Math.min(50, Math.round(Number(payload.maxTargets) || 1)))
          const state = stateRecord(loadCampaignState(campaignId))
          const selections = normalizeTargetSelections(state.targetSelections)
          const previous = selections.find((selection) => selection.controllerId === userId) ?? null
          const withoutCurrent = selections.filter((selection) => selection.controllerId !== userId)

          if (!targetActorId) {
            saveCampaignState(campaignId, {
              ...state,
              targetSelections: withoutCurrent,
            })
            broadcastState(campaignId)
            acknowledge?.({ ok: true, target: null })
            return
          }

          const visibleActorIds =
            role === 'player'
              ? visibleActorIdsForViewer(state, userId)
              : visibleActorIdsOnActiveMap(state)
          if (!visibleActorIds.has(targetActorId)) {
            throw new Error('You can target only a creature currently inside your line of sight.')
          }

          const targetActor = actorById(state, targetActorId)
          if (!targetActor) {
            throw new Error('Target Actor not found.')
          }

          const sourceActor = actionSourceActor(state, socket, payload.sourceActorId)
          if (role === 'player' && !sourceActor) {
            throw new Error('Your Player Character is required before targeting.')
          }
          if (role === 'dm' && String(payload.sourceActorId ?? '').trim() && !sourceActor) {
            throw new Error('The selected DM source Actor was not found.')
          }
          if (sourceActor && !visibleActorIds.has(sourceActor.id)) {
            throw new Error('The action source must be a visible token on the active map before targeting.')
          }

          let targetActorIds: string[]
          if (mode === 'toggle') {
            const existing = previous?.targetActorIds ?? (previous?.targetActorId ? [previous.targetActorId] : [])
            targetActorIds = existing.includes(targetActorId)
              ? existing.filter((actorId) => actorId !== targetActorId)
              : [...existing, targetActorId].slice(0, maxTargets)
          } else {
            targetActorIds = [targetActorId]
          }

          if (targetActorIds.length === 0) {
            saveCampaignState(campaignId, {
              ...state,
              targetSelections: withoutCurrent,
            })
            broadcastState(campaignId)
            acknowledge?.({ ok: true, target: null })
            return
          }

          const selection: TargetSelection = {
            controllerId: userId,
            controllerName: socketDisplayName(socket, campaignId),
            role,
            sourceActorId: sourceActor?.id ?? null,
            targetActorId: targetActorIds[0],
            targetActorIds,
            updatedAt: new Date().toISOString(),
          }

          saveCampaignState(campaignId, {
            ...state,
            targetSelections: [...withoutCurrent, selection].slice(-50),
          })
          broadcastState(campaignId)
          acknowledge?.({ ok: true, target: selection })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error: error instanceof Error ? error.message : 'Target selection failed.',
          })
        }
      },
    )

    socket.on(
      'effect:apply',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'effect:apply', rawPayload)
          const campaignId = String(socket.data.campaignId ?? '')
          const userId = String(socket.data.userId ?? '')
          const role = socket.data.role === 'dm' ? 'dm' : 'player'

          if (!campaignId || !userId) {
            throw new Error('Join a campaign before applying an effect.')
          }
          if (role !== 'dm') {
            throw new Error('Player effects must come from a spell, feature, or rules action. Only the DM can use manual effect override.')
          }

          const payload = (rawPayload ?? {}) as {
            targetActorId?: unknown
            sourceActorId?: unknown
            kind?: unknown
            scope?: unknown
            value?: unknown
            name?: unknown
          }
          const state = stateRecord(loadCampaignState(campaignId))
          const selection = socketTargetSelection(state, socket)
          const targetActorId = String(payload.targetActorId ?? '').trim()

          if (!selection || !targetActorId || selection.targetActorId !== targetActorId) {
            throw new Error('Select this target on the map before applying an effect.')
          }

          const visibleActorIds = visibleActorIdsOnActiveMap(state)
          if (!visibleActorIds.has(targetActorId)) {
            throw new Error('Effects can be applied only to a visible target on the active map.')
          }

          const originalTarget = actorById(state, targetActorId)
          if (!originalTarget) {
            throw new Error('Target Actor not found.')
          }

          const sourceActor = actionSourceActor(state, socket, payload.sourceActorId)
          if (String(payload.sourceActorId ?? '').trim() && !sourceActor) {
            throw new Error('The selected DM source Actor was not found.')
          }

          const rawKind = String(payload.kind ?? '')
          const allowedKinds = new Set([
            'advantage',
            'disadvantage',
            'roll-modifier',
            'speed-modifier',
            'condition',
            'temp-hp',
          ])
          if (!allowedKinds.has(rawKind)) {
            throw new Error('Unknown effect type.')
          }

          const rawScope = String(payload.scope ?? 'all-d20')
          const allowedScopes = new Set([
            'all-d20',
            'attack',
            'saving-throw',
            'attack-save',
            'ability-check',
            'skill-check',
            'spell',
          ])
          const scope: ActorEffectScope = allowedScopes.has(rawScope)
            ? rawScope as ActorEffectScope
            : 'all-d20'
          const value = Math.max(-100, Math.min(100, Math.round(Number(payload.value) || 0)))
          const customName = normalizeConditionName(payload.name)

          if (rawKind === 'temp-hp') {
            const amount = Math.max(1, Math.min(999, Math.round(Number(payload.value) || 0)))
            const result = resolveHealthOperation(originalTarget, {
              operation: 'set-temp',
              amount,
              damageType: 'untyped',
            })
            const nextState = replaceActorInState(state, normalizeActor(result.actor))
            saveCampaignState(campaignId, nextState)
            broadcastState(campaignId)
            acknowledge?.({
              ok: true,
              kind: 'temp-hp',
              targetActorId,
              tempHp: result.actor.tempHp,
            })
            return
          }

          const kind = rawKind as ActorEffectKind
          if (
            (kind === 'roll-modifier' || kind === 'speed-modifier') &&
            value === 0
          ) {
            throw new Error('This modifier needs a non-zero value.')
          }

          let conditionName: string | null = null
          if (kind === 'condition') {
            conditionName = canonicalMechanicalCondition(customName)
            if (!conditionName) {
              throw new Error(
                'This condition is not mechanically supported yet. Choose Blinded, Grappled, Invisible, Poisoned, Prone, or Restrained.',
              )
            }
          }

          const effect: ActorEffect = {
            id: randomUUID(),
            name: effectDefaultName(kind, scope, value, conditionName || customName),
            kind,
            scope,
            value,
            sourceActorId: sourceActor?.id ?? null,
            sourceActorName: sourceActor?.name ?? socketDisplayName(socket, campaignId),
            sourceRole: role,
            createdAt: new Date().toISOString(),
          }

          const nextConditions = kind === 'condition' && conditionName
            ? [
                ...originalTarget.conditions.filter(
                  (entry) => entry.toLowerCase() !== conditionName.toLowerCase(),
                ),
                conditionName,
              ]
            : originalTarget.conditions
          const updatedTarget = normalizeActor({
            ...originalTarget,
            conditions: nextConditions,
            effects: [...(originalTarget.effects ?? []), effect].slice(-100),
          })
          const nextState = replaceActorInState(state, updatedTarget)

          saveCampaignState(campaignId, nextState)
          broadcastState(campaignId)
          acknowledge?.({ ok: true, effect, targetActorId })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error: error instanceof Error ? error.message : 'Effect application failed.',
          })
        }
      },
    )

    socket.on(
      'effect:remove',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'effect:remove', rawPayload)
          const campaignId = String(socket.data.campaignId ?? '')
          const userId = String(socket.data.userId ?? '')
          const role = socket.data.role === 'dm' ? 'dm' : 'player'

          if (!campaignId || !userId) {
            throw new Error('Join a campaign before removing an effect.')
          }
          if (role !== 'dm') {
            throw new Error('Only the DM can manually remove rules-driven effects.')
          }

          const payload = (rawPayload ?? {}) as {
            targetActorId?: unknown
            effectId?: unknown
          }
          const targetActorId = String(payload.targetActorId ?? '').trim()
          const effectId = String(payload.effectId ?? '').trim()
          const state = stateRecord(loadCampaignState(campaignId))
          const selection = socketTargetSelection(state, socket)

          if (!selection || selection.targetActorId !== targetActorId) {
            throw new Error('Select this target on the map before removing an effect.')
          }

          const originalTarget = actorById(state, targetActorId)
          if (!originalTarget) {
            throw new Error('Target Actor not found.')
          }

          const effect = (originalTarget.effects ?? []).find((entry) => entry.id === effectId)
          if (!effect) {
            throw new Error('Effect not found.')
          }

          if (role !== 'dm') {
            throw new Error('Player effects are rules-driven. Only the DM can manually remove an individual effect; players end them through the originating spell, feature, or concentration rule.')
          }

          const remainingEffects = (originalTarget.effects ?? []).filter(
            (entry) => entry.id !== effectId,
          )
          const remainingConditions = effect.kind === 'condition'
            ? originalTarget.conditions.filter((condition) => {
                if (condition.toLowerCase() !== effect.name.toLowerCase()) return true
                return remainingEffects.some(
                  (entry) => entry.kind === 'condition' && entry.name.toLowerCase() === condition.toLowerCase(),
                )
              })
            : originalTarget.conditions
          const updatedTarget = normalizeActor({
            ...originalTarget,
            effects: remainingEffects,
            conditions: remainingConditions,
          })

          saveCampaignState(campaignId, replaceActorInState(state, updatedTarget))
          broadcastState(campaignId)
          acknowledge?.({ ok: true, effectId, targetActorId })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error: error instanceof Error ? error.message : 'Effect removal failed.',
          })
        }
      },
    )


    socket.on(
      'turn:use-core-action',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'turn:use-core-action', rawPayload)
          const campaignId = String(socket.data.campaignId ?? '')
          const role = socket.data.role === 'dm' ? 'dm' : 'player'
          const payload = (rawPayload ?? {}) as {
            actorId?: unknown
            action?: unknown
            resource?: unknown
          }
          if (!campaignId) throw new Error('Join a campaign before using an action.')

          let state = stateRecord(loadCampaignState(campaignId))
          assertNoPendingReactionForCurrentTurn(state)
          const actor = actionSourceActor(state, socket, payload.actorId)
          if (!actor) throw new Error('Action source Actor not found.')
          if (!playerOwnsCurrentTurn(state, actor, socket)) {
            throw new Error('This Actor cannot spend turn resources outside their combat turn.')
          }
          if (!actorCanTakeCombatAction(actor)) {
            throw new Error(`${actor.name} cannot take actions while unconscious or Incapacitated.`)
          }

          const combat = combatForState(state)
          let economy = turnEconomyForActor(state, actor)
          const action = String(payload.action ?? '')
          const authoritativeResource = authoritativeCoreActionResource(action, payload.resource)

          if (action === 'attack') {
            economy = useAttackFromAction(economy)
          } else if (action === 'dash') {
            economy = useDash(economy, actor, 'action')
          } else if (action === 'disengage') {
            economy = useDisengage(economy, 'action')
          } else if (action === 'dodge') {
            economy = useDodge(economy, 'action')
          } else if (action === 'stand-up') {
            if (!actor.conditions.some((condition) => condition.toLowerCase() === 'prone')) {
              throw new Error(`${actor.name} is not Prone.`)
            }
            const allowance = movementAllowanceFeet(actor, economy)
            const standCost = standUpMovementCostFeet(actor)
            const tokens = Array.isArray(state.tokens) ? state.tokens : []
            const tokenIndex = tokens.findIndex((entry) => Boolean(
              entry && typeof entry === 'object' && String((entry as Record<string, unknown>).actorId ?? '') === actor.id,
            ))
            if (tokenIndex < 0) throw new Error('Token must be on the map to stand up.')
            const token = tokens[tokenIndex] as Record<string, unknown>
            const used = Math.max(0, Math.round(Number(token.movementUsedFeet) || 0))
            if (used + standCost > allowance) throw new Error('Not enough movement remains to stand up.')
            const nextTokens = [...tokens]
            nextTokens[tokenIndex] = { ...token, movementUsedFeet: used + standCost }
            const remainingEffects = (actor.effects ?? []).filter(
              (effect) => !(effect.kind === 'condition' && effect.name.toLowerCase() === 'prone'),
            )
            const updatedActor = normalizeActor({
              ...actor,
              conditions: actor.conditions.filter((condition) => condition.toLowerCase() !== 'prone'),
              effects: remainingEffects,
            })
            state = {
              ...replaceActorInState(state, updatedActor),
              tokens: nextTokens,
            }
          } else {
            throw new Error('Unknown core action.')
          }

          state = replaceTurnEconomyInState(state, economy)
          state = appendPublicActivity(state, {
            type: 'turn-action',
            id: randomUUID(),
            createdAt: new Date().toISOString(),
            actorId: actor.id,
            actorName: actor.name,
            action,
            resource: authoritativeResource ?? 'movement',
            role,
            visibility: 'public',
          })
          saveCampaignState(campaignId, state)
          broadcastState(campaignId)
          acknowledge?.({ ok: true, economy, combat })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error: error instanceof Error ? error.message : 'Action Economy update failed.',
          })
        }
      },
    )


    socket.on(
      'turn:use-utility-action',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'turn:use-utility-action', rawPayload)
          const campaignId = String(socket.data.campaignId ?? '')
          const role = socket.data.role === 'dm' ? 'dm' : 'player'
          if (!campaignId) throw new Error('Join a campaign before using a utility action.')

          const payload = (rawPayload ?? {}) as {
            actorId?: unknown
            action?: unknown
            helpMode?: unknown
            targetActorId?: unknown
            skill?: unknown
            objectName?: unknown
          }

          let state = stateRecord(loadCampaignState(campaignId))
          assertNoPendingReactionForCurrentTurn(state)
          const actor = actionSourceActor(state, socket, payload.actorId)
          if (!actor) throw new Error('Action source Actor not found.')
          if (!playerOwnsCurrentTurn(state, actor, socket)) {
            throw new Error('This Actor cannot spend turn resources outside their combat turn.')
          }
          if (actorCannotTakeUtilityAction(actor)) {
            throw new Error(`${actor.name} cannot take this action while Incapacitated or unconscious.`)
          }

          const combat = combatForState(state)
          if (!combat.active) {
            throw new Error('Structured utility actions are resolved through the combat Action economy.')
          }

          const action = normalizeCoreUtilityAction(payload.action)
          if (!action) throw new Error('Unknown utility action.')

          let economy = turnEconomyForActor(state, actor)
          const sourceTurnStartedAt = economy.turnStartedAt
          let message = ''
          let rollResult: Record<string, unknown> | null = null
          let helpBenefit: HelpBenefit | null = null

          if (action === 'help') {
            const helpMode =
              payload.helpMode === 'attack-roll'
                ? 'attack-roll'
                : payload.helpMode === 'ability-check'
                  ? 'ability-check'
                  : null
            if (!helpMode) throw new Error('Choose how this Help action assists an ally.')

            const targetActorId = String(payload.targetActorId ?? '').trim()
            const target = actorById(state, targetActorId)
            if (!target || target.id === actor.id) {
              throw new Error('Choose a different valid creature for Help.')
            }
            if (!tokenForActor(state, target.id) || !tokenForActor(state, actor.id)) {
              throw new Error('Help requires the helper and selected creature to be visible on the active map.')
            }
            if (!actorHasLineOfEffect(state, actor.id, target.id, 'blocksEffects')) {
              throw new Error('Help is blocked by a Wall or closed Door.')
            }

            if (helpMode === 'ability-check') {
              if (!sameDefaultCombatSide(actor, target)) {
                throw new Error('Ability-check Help must target an ally.')
              }
              const skill = normalizeCharacterSkill(payload.skill)
              if (!skill) throw new Error('Choose a valid skill proficiency to Help with.')
              if (!actorHasSkillProficiency(actor, skill)) {
                throw new Error(`${actor.name} is not proficient in that skill and cannot grant this Help benefit.`)
              }

              economy = spendTurnResource(economy, 'action')
              helpBenefit = {
                id: randomUUID(),
                kind: 'ability-check',
                sourceActorId: actor.id,
                targetActorId: target.id,
                attackTargetActorId: null,
                skill,
                eligibleAllyActorIds: [],
                sourceTurnStartedAt,
                createdAt: new Date().toISOString(),
              }
              state = replaceHelpBenefitsInState(
                state,
                [...helpBenefitsForState(state), helpBenefit],
              )
              message = `${actor.name} helps ${target.name} with ${skill}. Their next matching check has Advantage.`
            } else {
              if (sameDefaultCombatSide(actor, target)) {
                throw new Error('Attack-roll Help must distract a creature on the opposing side.')
              }
              const distanceFeet = actorDistanceFeet(state, actor.id, target.id)
              if (distanceFeet === null) {
                throw new Error('Help distance could not be established on the active map.')
              }
              if (distanceFeet > 5) {
                throw new Error('Attack-roll Help requires the distracted creature to be within 5 feet.')
              }

              const allies = normalizedActorsForState(state)
                .filter((candidate) =>
                  candidate.id !== actor.id &&
                  sameDefaultCombatSide(actor, candidate),
                )
                .map((candidate) => candidate.id)

              economy = spendTurnResource(economy, 'action')
              helpBenefit = {
                id: randomUUID(),
                kind: 'attack-roll',
                sourceActorId: actor.id,
                targetActorId: target.id,
                attackTargetActorId: target.id,
                skill: null,
                eligibleAllyActorIds: allies,
                sourceTurnStartedAt,
                createdAt: new Date().toISOString(),
              }
              state = replaceHelpBenefitsInState(
                state,
                [...helpBenefitsForState(state), helpBenefit],
              )
              message = `${actor.name} distracts ${target.name}. The next allied attack roll against that creature has Advantage.`
            }
          } else if (action === 'utilize') {
            const objectName = String(payload.objectName ?? '')
              .trim()
              .replace(/\s+/g, ' ')
              .slice(0, 100)
            if (!objectName) {
              throw new Error('Describe the nonmagical object being used.')
            }
            economy = spendTurnResource(economy, 'action')
            message = `${actor.name} uses the Utilize action with ${objectName}. Resolve that object's specific rule or DM adjudication.`
          } else {
            const skill = normalizeUtilityActionSkill(action, payload.skill)
            if (!skill) throw new Error(`Choose a valid skill for the ${action} action.`)

            let target: Actor | null = null
            let suggestedDc: number | null = null
            if (action === 'influence') {
              const targetActorId = String(payload.targetActorId ?? '').trim()
              target = actorById(state, targetActorId)
              if (!target || target.id === actor.id) {
                throw new Error('Choose a valid creature to Influence.')
              }
              if (target.kind === 'player') {
                throw new Error('The structured Influence action targets an NPC or monster, not another Player Character.')
              }
              if (!tokenForActor(state, actor.id) || !tokenForActor(state, target.id)) {
                throw new Error('Influence requires both creatures to be visible on the active map.')
              }
              if (!actorHasLineOfEffect(state, actor.id, target.id, 'blocksEffects')) {
                throw new Error('Influence is blocked by a Wall or closed Door.')
              }
              if (!influenceSkillAllowedForTarget(skill, target)) {
                throw new Error('Wisdom (Animal Handling) can Influence only a Beast or Monstrosity.')
              }
              suggestedDc = Math.max(15, Math.round(Number(target.abilities.intelligence) || 10))
            }

            let requestedMode: 'normal' | 'advantage' | 'disadvantage' = 'normal'
            const abilityHelp = matchingHelpAbilityBenefit(
              helpBenefitsForState(state),
              actor.id,
              skill,
            )
            if (abilityHelp) requestedMode = addAdvantageMode(requestedMode)

            economy = spendTurnResource(economy, 'action')
            const rolled = utilityRollRecord(
              campaignId,
              socket,
              actor,
              skill,
              requestedMode,
            )
            rollResult = {
              ...rolled.record,
              utilityAction: action,
              suggestedDc,
              hideDc: action === 'hide' ? 15 : null,
              dmAdjudicationRequired:
                action === 'hide' ||
                action === 'influence' ||
                action === 'search' ||
                action === 'study',
            }
            state = appendUtilityRollActivity(state, rollResult)
            if (abilityHelp) {
              state = consumeHelpBenefitInState(state, abilityHelp.id)
            }

            io.to(roomName(campaignId)).emit('dice:result', rollResult)

            if (action === 'hide') {
              const passed = rolled.total >= 15
              message = `${actor.name} Hide: ${skill} ${rolled.total} vs DC 15 (${passed ? 'check passed' : 'check failed'}). Cover/obscurement and enemy line-of-sight still require DM or future vision-engine validation before Invisible is applied.`
            } else if (action === 'influence') {
              message = `${actor.name} Influence: ${skill} ${rolled.total}. Suggested hesitant-creature DC: ${suggestedDc}; willingness and attitude remain DM-adjudicated.`
            } else if (action === 'search') {
              message = `${actor.name} Search: ${skill} ${rolled.total}. The DM resolves what that check can discover.`
            } else {
              message = `${actor.name} Study: ${skill} ${rolled.total}. The DM resolves what information that check recalls or uncovers.`
            }
          }

          state = replaceTurnEconomyInState(state, economy)
          state = appendPublicActivity(state, {
            type: 'turn-action',
            id: randomUUID(),
            createdAt: new Date().toISOString(),
            actorId: actor.id,
            actorName: actor.name,
            action,
            resource: 'action',
            role,
            visibility: 'public',
            detail: message,
          })

          saveCampaignState(campaignId, state)
          broadcastState(campaignId)
          acknowledge?.({
            ok: true,
            action,
            economy,
            message,
            roll: rollResult,
            helpBenefit,
          })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error: error instanceof Error ? error.message : 'Utility action failed.',
          })
        }
      },
    )

    socket.on(
      'ready:prepare',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'ready:prepare', rawPayload)
          const campaignId = String(socket.data.campaignId ?? '')
          if (!campaignId) throw new Error('Join a campaign before preparing a Ready action.')
          const payload = (rawPayload ?? {}) as {
            actorId?: unknown
            kind?: unknown
            triggerText?: unknown
            attackId?: unknown
            preparedTargetActorId?: unknown
            utility?: unknown
            spell?: unknown
          }

          let state = stateRecord(loadCampaignState(campaignId))
          assertNoPendingReactionForCurrentTurn(state)
          const actor = actionSourceActor(state, socket, payload.actorId)
          if (!actor) throw new Error('Ready action source Actor not found.')
          if (!playerOwnsCurrentTurn(state, actor, socket)) {
            throw new Error('Ready can be prepared only on this Actor’s combat turn.')
          }
          if (actorCannotTakeUtilityAction(actor)) {
            throw new Error(`${actor.name} cannot take the Ready action while Incapacitated or unconscious.`)
          }
          const combat = combatForState(state)
          if (!combat.active || combat.currentActorId !== actor.id) {
            throw new Error('Ready requires an active combat turn for this Actor.')
          }

          const triggerText = String(payload.triggerText ?? '').trim().replace(/\s+/g, ' ').slice(0, 240)
          if (!triggerText) throw new Error('Describe a perceivable trigger for the Ready action.')
          const kind = payload.kind === 'attack' || payload.kind === 'utility' || payload.kind === 'spell'
            ? payload.kind
            : null
          if (!kind) throw new Error('Choose an Attack, Utility action, or Action-casting-time spell to Ready.')

          let existingReady = readiedActionsForState(state)

          let attackId: string | null = null
          let preparedTargetActorId: string | null = null
          let utility: ReadiedUtilityPayload | null = null
          let spell: ReadiedSpellPayload | null = null

          if (kind === 'attack') {
            attackId = String(payload.attackId ?? '').trim()
            if (!attackId || !attackProfilesForActor(actor).some((profile) => profile.id === attackId)) {
              throw new Error('Choose a valid attack to Ready.')
            }
            preparedTargetActorId = String(payload.preparedTargetActorId ?? '').trim() || null
            if (preparedTargetActorId) {
              const target = actorById(state, preparedTargetActorId)
              if (!target || target.id === actor.id) throw new Error('Prepared attack target is invalid.')
            }
          } else if (kind === 'utility') {
            utility = normalizeReadiedUtilityPayload(payload.utility)
            if (!utility) throw new Error('Choose a valid Utility action to Ready.')
            const action = utility.action
            if (action === 'help') {
              const target = utility.targetActorId ? actorById(state, utility.targetActorId) : null
              if (!target || target.id === actor.id) throw new Error('Prepared Help requires a valid target.')
              if (!utility.helpMode) throw new Error('Prepared Help requires a Help type.')
              if (utility.helpMode === 'ability-check') {
                const skill = normalizeCharacterSkill(utility.skill)
                if (!skill || !actorHasSkillProficiency(actor, skill)) {
                  throw new Error('Prepared ability-check Help requires one of the helper’s skill proficiencies.')
                }
              }
            } else if (action === 'utilize') {
              if (!utility.objectName) throw new Error('Prepared Utilize requires a nonmagical object.')
            } else {
              const skill = normalizeUtilityActionSkill(action, utility.skill)
              if (!skill) throw new Error(`Prepared ${action} requires a valid skill.`)
              if (action === 'influence') {
                const target = utility.targetActorId ? actorById(state, utility.targetActorId) : null
                if (!target || target.id === actor.id || target.kind === 'player') {
                  throw new Error('Prepared Influence requires a valid NPC or monster target.')
                }
                if (!influenceSkillAllowedForTarget(skill, target)) {
                  throw new Error('Wisdom (Animal Handling) can Influence only a Beast or Monstrosity.')
                }
              }
            }
          } else {
            spell = normalizeReadiedSpellPayload(payload.spell)
            if (!spell) throw new Error('Choose a valid spell and cast level to Ready.')
            const spellRecord = spellById(spell.spellId)
            if (!spellRecord) throw new Error('Prepared spell rule not found.')
            if (!spellHasAutomatedRule(spellRecord.id)) {
              throw new Error(`${spellRecord.name} cannot be Readied until its automatic rules resolution is registered.`)
            }
            if (castingTimeActionCost(spellRecord.castingTime) !== 'action') {
              throw new Error('A Readied spell must have a casting time of an Action.')
            }
            if (!actorCanCastSpell(actor, spellRecord.id) && socket.data.role !== 'dm') {
              throw new Error(`${actor.name} cannot cast ${spellRecord.name} from the current character sheet.`)
            }
            spell = {
              spellId: spellRecord.id,
              castLevel: normalizeRequestedCastLevel(spellRecord.level, spell.castLevel),
            }
            if (!actor.characterSheet) {
              throw new Error('Readied Spell requires character spellcasting data so the slot and Concentration hold can be tracked.')
            }
            if (spellRecord.level > 0) {
              const pool = spellSlotPool(actor.characterSheet.className, actor.level)
              const spent = normalizeSpentSlots(pool.slots, actor.characterSheet.spentSpellSlots)
              if (!canSpendSpellSlot(pool.slots, spent, spell.castLevel)) {
                throw new Error(`No level ${spell.castLevel} spell slot remains.`)
              }
              const spellTurnKey = activeSpellTurnKeyForState(state)
              if (!spellTurnKey) throw new Error('The active combat turn could not be identified for spell-slot validation.')
              assertCanExpendSpellSlotThisTurn(turnEconomyForActor(state, actor), spellTurnKey)
            }
          }

          let economy = turnEconomyForActor(state, actor)
          const sourceTurnStartedAt = economy.turnStartedAt
          economy = spendTurnResource(economy, 'action')
          if (kind === 'spell' && spell) {
            const spellRecord = spellById(spell.spellId)
            const spellTurnKey = activeSpellTurnKeyForState(state)
            if (!spellRecord || !spellTurnKey) throw new Error('Prepared spell turn state is no longer available.')
            economy = markSpellSlotExpendedForTurn(economy, spellTurnKey, spellRecord.level > 0)
          }
          state = replaceTurnEconomyInState(state, economy)

          if (kind === 'spell' && spell) {
            const spellRecord = spellById(spell.spellId)
            if (!spellRecord) throw new Error('Prepared spell rule not found.')
            state = breakReadiedSpellConcentration(state, actor.id)
            const currentActor = actorById(state, actor.id) ?? actor
            const currentSheet = currentActor.characterSheet
            if (!currentSheet) throw new Error('Readied Spell requires character spellcasting data.')
            const pool = spellSlotPool(currentSheet.className, currentActor.level)
            const spent = normalizeSpentSlots(pool.slots, currentSheet.spentSpellSlots)
            const updatedActor = normalizeActor({
              ...currentActor,
              characterSheet: {
                ...currentSheet,
                spentSpellSlots: spellRecord.level > 0
                  ? spendSpellSlot(pool.slots, spent, spell.castLevel)
                  : spent,
                concentratingSpellId: spellRecord.id,
              },
            })
            state = replaceActorInState(state, updatedActor)
            existingReady = readiedActionsForState(state)
          }

          const ready: ReadiedAction = {
            id: randomUUID(),
            actorId: actor.id,
            kind,
            triggerText,
            sourceTurnStartedAt,
            attackId,
            preparedTargetActorId,
            utility,
            spell,
            createdAt: new Date().toISOString(),
          }
          state = replaceReadiedActionsInState(state, [...existingReady, ready])
          state = appendPublicActivity(state, {
            type: 'ready-prepared', id: randomUUID(), actorId: actor.id, actorName: actor.name,
            readyActionId: ready.id, readyKind: ready.kind, triggerText: ready.triggerText,
            createdAt: new Date().toISOString(), visibility: 'public',
          })
          saveCampaignState(campaignId, state)
          broadcastState(campaignId)
          acknowledge?.({ ok: true, ready, economy })
        } catch (error) {
          acknowledge?.({ ok: false, error: error instanceof Error ? error.message : 'Ready action preparation failed.' })
        }
      },
    )

    socket.on(
      'ready:trigger',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'ready:trigger', rawPayload)
          const campaignId = requireDmCampaignId(socket)
          const payload = (rawPayload ?? {}) as { readyActionId?: unknown }
          const readyActionId = String(payload.readyActionId ?? '').trim()
          if (!readyActionId) throw new Error('Choose a pending Ready action to trigger.')

          let state = stateRecord(loadCampaignState(campaignId))
          const ready = readiedActionsForState(state).find((candidate) => candidate.id === readyActionId)
          if (!ready) throw new Error('This Ready action is no longer pending.')
          const actor = actorById(state, ready.actorId)
          if (!actor) throw new Error('Ready Actor no longer exists.')
          if (actorCannotTakeUtilityAction(actor)) {
            if (ready.kind === 'spell') {
              state = clearReadiedActionAndWindows(state, ready.id)
              saveCampaignState(campaignId, state)
              broadcastState(campaignId)
            }
            throw new Error(`${actor.name} cannot take the readied Reaction right now.`)
          }

          const combat = combatForState(state)
          if (!combat.active || !combat.currentActorId) throw new Error('Ready triggers require active combat.')
          const economy = turnEconomyForActor(state, actor)
          if (economy.turnStartedAt !== ready.sourceTurnStartedAt) {
            state = clearReadiedActionAndWindows(state, ready.id)
            saveCampaignState(campaignId, state)
            broadcastState(campaignId)
            throw new Error('This Ready action expired at the start of the Actor’s next turn.')
          }
          if (remainingTurnResource(economy, 'reaction') <= 0) throw new Error(`${actor.name}'s Reaction is already spent.`)

          const windows = reactionWindowsForState(state)
          if (windows.some((window) => window.reactorActorId === actor.id)) {
            throw new Error('Resolve the Actor’s existing Reaction window before triggering another.')
          }
          if (hasOpenReactionWindowForReadiedAction(windows, ready.id)) {
            throw new Error('This Ready action already has an open Reaction window.')
          }

          const profile = ready.kind === 'attack' && ready.attackId
            ? attackProfilesForActor(actor).find((candidate) => candidate.id === ready.attackId) ?? null
            : null
          const readySpell = ready.kind === 'spell' && ready.spell
            ? spellById(ready.spell.spellId)
            : null
          if (ready.kind === 'spell') {
            if (!readySpell || actor.characterSheet?.concentratingSpellId !== readySpell.id) {
              state = clearReadiedActionAndWindows(state, ready.id)
              saveCampaignState(campaignId, state)
              broadcastState(campaignId)
              throw new Error('The held spell is no longer available because its Concentration ended.')
            }
          }
          const label = ready.kind === 'attack'
            ? profile?.name ?? 'Attack'
            : ready.kind === 'spell'
              ? readySpell?.name ?? 'Spell'
              : ready.utility?.action ?? 'Utility Action'
          const nowMs = Date.now()
          const window: ReadiedActionReactionWindow = {
            id: randomUUID(), kind: 'readied-action', reactorActorId: actor.id,
            readyActionId: ready.id,
            readyActionKind: ready.kind, readyActionLabel: label,
            triggerText: ready.triggerText, preparedTargetActorId: ready.preparedTargetActorId,
            readySpellId: ready.kind === 'spell' ? ready.spell?.spellId ?? null : null,
            readySpellCastLevel: ready.kind === 'spell' ? ready.spell?.castLevel ?? null : null,
            combatRound: combat.round, turnActorId: combat.currentActorId,
            createdAt: new Date(nowMs).toISOString(),
            expiresAt: new Date(nowMs + REACTION_WINDOW_TTL_MS).toISOString(),
          }
          state = replaceReactionWindowsInState(state, [...windows, window])
          state = appendPublicActivity(state, {
            type: 'ready-triggered', id: randomUUID(), readyActionId: ready.id,
            actorId: actor.id, actorName: actor.name, triggerText: ready.triggerText,
            createdAt: new Date().toISOString(), visibility: 'public',
          })
          saveCampaignState(campaignId, state)
          broadcastState(campaignId)
          acknowledge?.({ ok: true, window })
        } catch (error) {
          acknowledge?.({ ok: false, error: error instanceof Error ? error.message : 'Ready trigger failed.' })
        }
      },
    )

    socket.on(
      'ready:cancel',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'ready:cancel', rawPayload)
          const campaignId = String(socket.data.campaignId ?? '')
          const userId = String(socket.data.userId ?? '')
          const role = socket.data.role === 'dm' ? 'dm' : 'player'
          if (!campaignId || !userId) throw new Error('Join a campaign before cancelling Ready.')
          const payload = (rawPayload ?? {}) as { readyActionId?: unknown }
          const readyActionId = String(payload.readyActionId ?? '').trim()
          let state = stateRecord(loadCampaignState(campaignId))
          const ready = readiedActionsForState(state).find((candidate) => candidate.id === readyActionId)
          if (!ready) throw new Error('This Ready action is no longer pending.')
          const actor = actorById(state, ready.actorId)
          if (!actor) throw new Error('Ready Actor no longer exists.')
          if (role === 'player' && (actor.kind !== 'player' || actor.ownerId !== userId)) {
            throw new Error('You do not control this Ready action.')
          }
          state = clearReadiedActionAndWindows(state, ready.id)
          saveCampaignState(campaignId, state)
          broadcastState(campaignId)
          acknowledge?.({ ok: true, readyActionId: ready.id })
        } catch (error) {
          acknowledge?.({ ok: false, error: error instanceof Error ? error.message : 'Ready cancellation failed.' })
        }
      },
    )

    socket.on(
      'combat:end-own-turn',
      (
        _rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'combat:end-own-turn', _rawPayload)
          const campaignId = String(socket.data.campaignId ?? '')
          const userId = String(socket.data.userId ?? '')
          if (!campaignId || !userId) throw new Error('Join a campaign before ending a turn.')
          const state = stateRecord(loadCampaignState(campaignId))
          const combat = combatForState(state)
          if (combat.phase !== 'active' || !combat.currentActorId) throw new Error('No active turn.')

          const actor = actorById(state, combat.currentActorId)
          if (!actor) throw new Error('Current Actor not found.')
          if (socket.data.role !== 'dm' && actor.ownerId !== userId) {
            throw new Error('Only the active Player or DM can end this turn.')
          }
          if (
            socket.data.role !== 'dm' &&
            needsDeathSave(actor) &&
            actor.lastDeathSaveRound !== combat.round
          ) {
            throw new Error('Roll your Death Saving Throw before ending this turn.')
          }
          if (reactionWindowsForState(state).length > 0) {
            throw new Error('Resolve or decline pending Reactions before ending the turn.')
          }

          const nextCombat = advanceCombatTurn(combat)
          persistCombatState(campaignId, state, nextCombat, {
            endActorId: combat.currentActorId,
            startActorId: nextCombat.currentActorId,
          })
          acknowledge?.({ ok: true, combat: nextCombat })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error: error instanceof Error ? error.message : 'End Turn failed.',
          })
        }
      },
    )

    socket.on(
      'dm:override-turn-economy',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'dm:override-turn-economy', rawPayload)
          const campaignId = requireDmCampaignId(socket)
          const payload = (rawPayload ?? {}) as {
            actorId?: unknown
            patch?: unknown
            reset?: unknown
            label?: unknown
          }
          const actorId = String(payload.actorId ?? '').trim()
          let state = stateRecord(loadCampaignState(campaignId))
          const actor = actorById(state, actorId)
          if (!actor) throw new Error('Override Actor not found.')

          let economy = payload.reset === true
            ? freshTurnEconomy(actor)
            : turnEconomyForActor(state, actor)
          if (payload.patch && typeof payload.patch === 'object') {
            economy = applyTurnEconomyOverride(
              economy,
              payload.patch as TurnEconomyOverridePatch,
            )
          }
          state = replaceTurnEconomyInState(state, economy)
          state = appendPublicActivity(
            state,
            dmOverrideActivity(
              socketDisplayName(socket, campaignId),
              actor,
              String(payload.label ?? 'Turn Economy override'),
            ),
          )
          saveCampaignState(campaignId, state)
          broadcastState(campaignId)
          acknowledge?.({ ok: true, economy })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error: error instanceof Error ? error.message : 'DM override failed.',
          })
        }
      },
    )

    socket.on(
      'spell:end-concentration',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'spell:end-concentration', rawPayload)
          const campaignId = String(socket.data.campaignId ?? '')
          if (!campaignId) throw new Error('Join a campaign first.')
          let state = stateRecord(loadCampaignState(campaignId))
          const actor = actionSourceActor(state, socket, (rawPayload as { actorId?: unknown } | null)?.actorId)
          if (!actor) throw new Error('Concentrating Actor not found.')
          if (socket.data.role !== 'dm' && actor.ownerId !== String(socket.data.userId ?? '')) {
            throw new Error('You can end concentration only for your own character.')
          }
          const sheet = actor.characterSheet
          const updated = normalizeActor({
            ...actor,
            characterSheet: sheet ? { ...sheet, concentratingSpellId: '' } : null,
          })
          state = replaceActorInState(state, updated)
          state = removeConcentrationEffectsFromSource(state, actor.id)
          state = removeReadiedSpellActionsForActor(state, actor.id)
          state = appendPublicActivity(state, {
            type: 'concentration-ended',
            id: randomUUID(),
            createdAt: new Date().toISOString(),
            actorId: actor.id,
            actorName: actor.name,
            visibility: 'public',
          })
          saveCampaignState(campaignId, state)
          broadcastState(campaignId)
          acknowledge?.({ ok: true })
        } catch (error) {
          acknowledge?.({ ok: false, error: error instanceof Error ? error.message : 'Could not end concentration.' })
        }
      },
    )

    socket.on(
      'spell:cast',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'spell:cast', rawPayload)
          const campaignId = String(socket.data.campaignId ?? '')
          const role = socket.data.role === 'dm' ? 'dm' : 'player'
          if (!campaignId) throw new Error('Join a campaign before casting a spell.')
          const payload = (rawPayload ?? {}) as {
            actorId?: unknown
            spellId?: unknown
            castLevel?: unknown
            targetActorIds?: unknown
            areaGridX?: unknown
            areaGridY?: unknown
          }
          let state = stateRecord(loadCampaignState(campaignId))
          assertNoPendingReactionForCurrentTurn(state)
          const sourceActor = actionSourceActor(state, socket, payload.actorId)
          if (!sourceActor) throw new Error('Casting Actor not found.')
          if (!actorCanTakeCombatAction(sourceActor)) throw new Error(`${sourceActor.name} cannot cast while unconscious or Incapacitated.`)
          const spellId = String(payload.spellId ?? '').trim()
          const spell = spellById(spellId)
          if (!spell) throw new Error('Spell rule not found.')
          if (!spellHasAutomatedRule(spell.id)) throw new Error('Spell rule not found.')
          if (!actorCanCastSpell(sourceActor, spellId) && role !== 'dm') {
            throw new Error(`${sourceActor.name} cannot cast ${spell.name} from the current character sheet.`)
          }

          const castLevel = normalizeRequestedCastLevel(spell.level, payload.castLevel)
          const sheet = sourceActor.characterSheet
          if (!sheet && role !== 'dm') throw new Error('Character spellcasting data is missing.')

          if (sheet && spell.level > 0) {
            const pool = spellSlotPool(sheet.className, sourceActor.level)
            const spent = normalizeSpentSlots(pool.slots, sheet.spentSpellSlots)
            if (!canSpendSpellSlot(pool.slots, spent, castLevel)) {
              throw new Error(`No level ${castLevel} spell slot remains.`)
            }
          }

          const combat = combatForState(state)
          const castingTimeCost = castingTimeActionCost(spell.castingTime)
          const cost = spellTurnResource(spell.castingTime)
          if (reactionSpellRequiresReactionWindow(spell.castingTime)) {
            throw new Error(`${spell.name} must be cast from a server-authored Reaction Window. Reaction-spell triggers are not registered yet.`)
          }
          if (combat.active && castingTimeCost === 'long-cast') {
            throw new Error('Long-cast spells are not resolved as a combat action.')
          }
          if (combat.active && castingTimeCost === 'none') {
            throw new Error('This spell has an unsupported combat casting time and cannot bypass Action Economy.')
          }
          if (combat.active && combat.currentActorId !== sourceActor.id && role !== 'dm') {
            throw new Error('This spell cannot be cast because it is not your turn.')
          }

          const spellTurnKey = combat.active ? activeSpellTurnKeyForState(state) : null
          if (combat.active && !spellTurnKey) {
            throw new Error('The active combat turn could not be identified for spell-slot validation.')
          }
          if (combat.active && spell.level > 0) {
            assertCanExpendSpellSlotThisTurn(
              turnEconomyForActor(state, sourceActor),
              spellTurnKey,
            )
          }

          const { targetActorIds, areaPoint } = validateSpellTargets(
            state,
            sourceActor,
            spell.id,
            castLevel,
            payload.targetActorIds,
            payload.areaGridX,
            payload.areaGridY,
          )

          if (combat.active && cost) {
            let economy = turnEconomyForActor(state, sourceActor)
            economy = spendTurnResource(economy, cost)
            economy = markSpellSlotExpendedForTurn(
              economy,
              spellTurnKey,
              spell.level > 0,
            )
            state = replaceTurnEconomyInState(state, economy)
          }

          if (spell.concentration) {
            state = removeReadiedSpellActionsForActor(state, sourceActor.id)
            state = removeConcentrationEffectsFromSource(state, sourceActor.id)
          }

          let updatedSource = actorById(state, sourceActor.id) ?? sourceActor
          if (updatedSource.characterSheet) {
            const currentSheet = updatedSource.characterSheet
            const pool = spellSlotPool(currentSheet.className, updatedSource.level)
            const spent = normalizeSpentSlots(pool.slots, currentSheet.spentSpellSlots)
            updatedSource = normalizeActor({
              ...updatedSource,
              characterSheet: {
                ...currentSheet,
                spentSpellSlots: spell.level > 0
                  ? spendSpellSlot(pool.slots, spent, castLevel)
                  : spent,
                concentratingSpellId: spell.concentration
                  ? spell.id
                  : currentSheet.concentratingSpellId,
              },
            })
            state = replaceActorInState(state, updatedSource)
          }

          if (spell.id === 'bless') {
            state = applyBlessToTargets(state, updatedSource, targetActorIds, combat)
          }

          const spellEffects = resolveAutomatedSpellEffects(state, updatedSource, spell, castLevel, targetActorIds)
          state = spellEffects.state
          const automated = spellEffects.fullyAutomated
          state = appendPublicActivity(state, {
            type: 'spell-cast',
            id: randomUUID(),
            createdAt: new Date().toISOString(),
            actorId: sourceActor.id,
            actorName: sourceActor.name,
            spellId: spell.id,
            spellName: spell.name,
            castLevel,
            targetActorIds,
            areaPoint,
            automated,
            effectResults: spellEffects.results,
            visibility: 'public',
          })
          saveCampaignState(campaignId, state)
          io.to(roomName(campaignId)).emit('combat:spell-resolved', {
            id: randomUUID(),
            sourceActorName: sourceActor.name,
            spellName: spell.name,
            castLevel,
            effectResults: spellEffects.results,
            createdAt: new Date().toISOString(),
          })
          broadcastState(campaignId)
          acknowledge?.({
            ok: true,
            spellId: spell.id,
            spellName: spell.name,
            castLevel,
            targetActorIds,
            areaPoint,
            automated,
            effectResults: spellEffects.results,
          })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error: error instanceof Error ? error.message : 'Spell casting failed.',
          })
        }
      },
    )

    socket.on(
      'combat:resolve-attack',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'combat:resolve-attack', rawPayload)
          const campaignId = String(socket.data.campaignId ?? '')
          const role = socket.data.role === 'dm' ? 'dm' : 'player'
          if (!campaignId) throw new Error('Join a campaign before making an attack.')

          const payload = (rawPayload ?? {}) as {
            sourceActorId?: unknown
            targetActorId?: unknown
            attackId?: unknown
            mode?: unknown
            cover?: unknown
            outcomeOverride?: unknown
            attackRollOverride?: unknown
            ignoreEconomy?: unknown
          }
          let state = stateRecord(loadCampaignState(campaignId))
          assertNoPendingReactionForCurrentTurn(state)
          const source = actionSourceActor(state, socket, payload.sourceActorId)
          if (!source) throw new Error('Choose an attacking Character first.')
          if (!actorCanTakeCombatAction(source)) {
            throw new Error(`${source.name} cannot attack while unconscious or Incapacitated.`)
          }

          const selection = socketTargetSelection(state, socket)
          const requestedTargetId = String(payload.targetActorId ?? '').trim()
          const targetId = requestedTargetId || selection?.targetActorId || ''
          const target = actorById(state, targetId)
          if (!target) throw new Error('Choose a valid target first.')
          if (target.id === source.id) throw new Error('An attack requires a different target.')
          if (role === 'player' && (!selection || !selection.targetActorIds.includes(target.id))) {
            throw new Error('Select this target on the active map before attacking.')
          }
          if (selection?.sourceActorId && selection.sourceActorId !== source.id) {
            throw new Error('The selected target belongs to a different action source. Select the target again.')
          }

          const sourceToken = tokenForActor(state, source.id)
          const targetToken = tokenForActor(state, target.id)
          if (!sourceToken || !targetToken) {
            throw new Error('Both attacker and target must be visible tokens on the active map.')
          }

          const attackId = String(payload.attackId ?? '').trim()
          const profile = attackProfilesForActor(source).find((candidate) => candidate.id === attackId)
          if (!profile) throw new Error('That attack is not available to this Character.')

          const distanceFeet = actorDistanceFeet(state, source.id, target.id)
          const rangeValidation = validateAttackRange(
            distanceFeet,
            profile.rangeFeet,
            profile.longRangeFeet,
          )
          if (!rangeValidation.legal || distanceFeet === null) {
            if (distanceFeet === null) {
              throw new Error('Attack distance could not be established on the active map.')
            }
            throw new Error(
              `${target.name} is out of range (${distanceFeet} ft; maximum ${rangeValidation.maxRangeFeet} ft).`,
            )
          }

          if (!actorHasLineOfEffect(state, source.id, target.id, 'blocksSight')) {
            throw new Error("The target is outside the attacker's current line of sight.")
          }

          const attackCollisionChannel =
            (profile.rangeFeet ?? 5) > 5
              ? 'blocksProjectiles'
              : 'blocksEffects'
          if (!actorHasLineOfEffect(state, source.id, target.id, attackCollisionChannel)) {
            throw new Error('Attack blocked by a Wall or closed Door.')
          }

          const combat = combatForState(state)
          const ignoreEconomy = role === 'dm' && payload.ignoreEconomy === true
          if (combat.active && !ignoreEconomy && combat.currentActorId !== source.id) {
            throw new Error('This Actor cannot attack outside their combat turn.')
          }

          const cover = payload.cover === 'half'
            ? 2
            : payload.cover === 'three-quarters'
              ? 5
              : payload.cover === 'total'
                ? null
                : 0
          if (cover === null && role !== 'dm') {
            throw new Error('The target has Total Cover and cannot be targeted.')
          }

          const requestedMode = role === 'dm' && (payload.mode === 'advantage' || payload.mode === 'disadvantage')
            ? payload.mode
            : rangeValidation.mode ?? 'normal'
          const threatenedByMeleeEnemy = profile.attackType === 'ranged' && normalizedActorsForState(state).some((creature) =>
            creature.id !== source.id &&
            sameDefaultCombatSide(source, creature) === false &&
            actorCanTakeCombatAction(creature) &&
            (actorDistanceFeet(state, source.id, creature.id) ?? Infinity) <= 5,
          )
          const rangeAndThreatMode = threatenedByMeleeEnemy
            ? requestedMode === 'advantage' ? 'normal' : 'disadvantage'
            : requestedMode
          const helpAttackBenefit = matchingHelpAttackBenefit(
            helpBenefitsForState(state),
            source.id,
            target.id,
          )
          const helpedRequestedMode = helpAttackBenefit
            ? addAdvantageMode(rangeAndThreatMode)
            : rangeAndThreatMode
          const rulesMode = resolveActorD20Mode(source, 'attack', helpedRequestedMode, target, distanceFeet)
          const mode = applyDodgeAttackMode(
            rulesMode,
            target,
            turnEconomyForActor(state, target),
          )
          if (helpAttackBenefit) {
            state = consumeHelpBenefitInState(state, helpAttackBenefit.id)
          }

          let economy = turnEconomyForActor(state, source)
          if (combat.active && !ignoreEconomy) {
            economy = useAttackFromAction(economy)
            state = replaceTurnEconomyInState(state, economy)
          }

          const first = role === 'dm' && Number.isInteger(Number(payload.attackRollOverride))
            ? Math.max(1, Math.min(20, Math.round(Number(payload.attackRollOverride))))
            : randomInt(1, 21)
          const second = mode === 'normal' ? null : randomInt(1, 21)
          const natural = second === null
            ? first
            : mode === 'advantage'
              ? Math.max(first, second)
              : Math.min(first, second)
          const effectModifier = actorD20Modifier(source, 'attack')
          const bonusDiceResults = actorD20BonusDice(source, 'attack')
            .flatMap((bonus) => Array.from({ length: bonus.count }, () => ({
              sides: bonus.sides,
              value: randomInt(1, bonus.sides + 1),
            })))
          const bonusDiceTotal = bonusDiceResults.reduce((sum, roll) => sum + roll.value, 0)
          const attackBonus = attackBonusForActor(source, profile)
          const attackTotal = natural + attackBonus + effectModifier + bonusDiceTotal
          const targetAc = target.ac + (cover ?? 0)
          const rulesOutcome: AttackOutcome = natural === 1
            ? 'miss'
            : natural === 20
              ? 'critical'
              : attackTotal >= targetAc
                ? 'hit'
                : 'miss'
          const requestedOutcome =
            payload.outcomeOverride === 'miss' ||
            payload.outcomeOverride === 'hit' ||
            payload.outcomeOverride === 'critical'
              ? payload.outcomeOverride
              : 'rules'
          const outcomeOverride: AttackOutcomeOverride = role === 'dm' ? requestedOutcome : 'rules'
          const outcome = outcomeOverride === 'rules' ? rulesOutcome : outcomeOverride

          const targetHpBefore = target.currentHp
          const targetTempHpBefore = target.tempHp
          const damage = outcome === 'miss'
            ? null
            : rollDiceFormula(
                profile.damageFormula,
                outcome === 'critical',
                (sides) => randomInt(1, sides + 1),
              )
          let effectiveDamage = 0
          let targetHpAfter = targetHpBefore
          let targetTempHpAfter = targetTempHpBefore
          let healthResolution = null
          let concentrationCheck: Record<string, unknown> | null = null

          if (damage) {
            const applied = resolveHealthOperation(target, {
              operation: 'damage',
              amount: damage.total,
              damageType: profile.damageType,
              criticalHit: outcome === 'critical',
            })
            const updatedTarget = normalizeActor(applied.actor)
            healthResolution = applied.resolution
            effectiveDamage = applied.resolution.effectiveDamage
            targetHpAfter = updatedTarget.currentHp
            targetTempHpAfter = updatedTarget.tempHp
            state = replaceActorInState(state, updatedTarget)
            const concentration = resolveConcentrationAfterDamage(
              state,
              target.id,
              applied.resolution.effectiveDamage,
            )
            state = concentration.state
            concentrationCheck = concentration.check

            const healthEntry: HealthLogEntry = {
              id: randomUUID(),
              actorId: updatedTarget.id,
              actorName: updatedTarget.name,
              createdAt: new Date().toISOString(),
              resolution: applied.resolution,
            }
            state = {
              ...state,
              healthLog: [...normalizeHealthLog(state.healthLog), healthEntry].slice(-100),
            }
          }

          const resolution: AttackResolution = {
            id: randomUUID(),
            sourceActorId: source.id,
            sourceActorName: source.name,
            targetActorId: target.id,
            targetActorName: target.name,
            attackId: profile.id,
            attackName: profile.name,
            attackBonus,
            targetAc,
            coverBonus: cover ?? 0,
            distanceFeet,
            mode,
            d20Rolls: second === null ? [first] : [first, second],
            natural,
            bonusDiceResults,
            attackTotal,
            outcome,
            outcomeOverride,
            damage,
            damageType: profile.damageType,
            effectiveDamage,
            targetHpBefore,
            targetHpAfter,
            targetTempHpBefore,
            targetTempHpAfter,
            createdAt: new Date().toISOString(),
          }
          state = appendPublicActivity(state, { type: 'attack-resolution', ...resolution })
          saveCampaignState(campaignId, state)
          io.to(roomName(campaignId)).emit('combat:attack-resolved', resolution)
          emitConcentrationDiceReveal(campaignId, target.name, concentrationCheck)
          broadcastState(campaignId)
          acknowledge?.({ ok: true, resolution, healthResolution, concentrationCheck, economy })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error: error instanceof Error ? error.message : 'Attack resolution failed.',
          })
        }
      },
    )

    socket.on(
      'reaction:respond',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'reaction:respond', rawPayload)
          const campaignId = String(socket.data.campaignId ?? '')
          const userId = String(socket.data.userId ?? '')
          const role = socket.data.role === 'dm' ? 'dm' : 'player'
          if (!campaignId || !userId) {
            throw new Error('Join a campaign before responding to a Reaction.')
          }

          const payload = (rawPayload ?? {}) as {
            windowId?: unknown
            decision?: unknown
            attackId?: unknown
            targetActorId?: unknown
            spellTargetActorIds?: unknown
            areaGridX?: unknown
            areaGridY?: unknown
          }
          const windowId = String(payload.windowId ?? '').trim()
          if (payload.decision !== 'use' && payload.decision !== 'decline') {
            throw new Error('Choose whether to use or decline this Reaction.')
          }
          const decision: ReactionDecision = payload.decision
          if (!windowId) throw new Error('Choose a valid Reaction window.')

          let state = stateRecord(loadCampaignState(campaignId))
          const windows = reactionWindowsForState(state)
          const window = windows.find((candidate) => candidate.id === windowId)
          if (!window) {
            state = replaceReactionWindowsInState(state, windows)
            saveCampaignState(campaignId, state)
            broadcastState(campaignId)
            throw new Error('This Reaction window is no longer available.')
          }

          const reactor = actorById(state, window.reactorActorId)
          if (!reactor) throw new Error('Reaction Actor no longer exists.')

          if (role === 'player') {
            if (reactor.kind !== 'player' || reactor.ownerId !== userId) {
              throw new Error('You do not control this Reaction.')
            }
          } else if (reactor.kind === 'player' && reactor.ownerId) {
            throw new Error('This Reaction belongs to a Player-controlled Character.')
          }

          if (window.kind === 'readied-action' && window.readyActionKind === 'spell' && actorCannotTakeUtilityAction(reactor)) {
            state = clearReadiedActionAndWindows(state, window.readyActionId)
            saveCampaignState(campaignId, state)
            broadcastState(campaignId)
            throw new Error('The held spell dissipated because the caster can no longer take the readied Reaction.')
          }

          if (decision === 'decline') {
            state = replaceReactionWindowsInState(
              state,
              windows.filter((candidate) => candidate.id !== window.id),
            )
            state = appendPublicActivity(state, {
              type: 'reaction-declined',
              id: randomUUID(),
              reactionKind: window.kind,
              reactionWindowId: window.id,
              actorId: reactor.id,
              actorName: reactor.name,
              createdAt: new Date().toISOString(),
            })
            saveCampaignState(campaignId, state)
            broadcastState(campaignId)
            acknowledge?.({ ok: true, declined: true, windowId: window.id })
            return
          }

          if (window.kind === 'opportunity-attack') {
            const attackId = String(payload.attackId ?? '').trim()
            if (!attackId) throw new Error('Choose a melee attack for this Reaction.')

            const result = resolveOpportunityReactionAttack(
              state,
              window,
              attackId,
            )
            state = result.state
            saveCampaignState(campaignId, state)
            io.to(roomName(campaignId)).emit('combat:attack-resolved', result.resolution)
            emitConcentrationDiceReveal(campaignId, result.resolution.targetActorName, result.concentrationCheck)
            io.to(roomName(campaignId)).emit('reaction:resolved', {
              windowId: window.id,
              kind: window.kind,
              resolution: result.resolution,
            })
            broadcastState(campaignId)
            acknowledge?.({
              ok: true,
              windowId: window.id,
              resolution: result.resolution,
              healthResolution: result.healthResolution,
              concentrationCheck: result.concentrationCheck,
              economy: result.economy,
            })
            return
          }

          const ready = readiedActionForWindow(state, window)
          if (ready.kind === 'attack') {
            const targetActorId = String(payload.targetActorId ?? window.preparedTargetActorId ?? '').trim()
            if (!targetActorId) throw new Error('Choose a target for the readied Attack.')
            const result = resolveReadiedReactionAttack(state, window, targetActorId)
            state = result.state
            saveCampaignState(campaignId, state)
            io.to(roomName(campaignId)).emit('combat:attack-resolved', result.resolution)
            emitConcentrationDiceReveal(campaignId, result.resolution.targetActorName, result.concentrationCheck)
            io.to(roomName(campaignId)).emit('reaction:resolved', {
              windowId: window.id, kind: window.kind, resolution: result.resolution,
            })
            broadcastState(campaignId)
            acknowledge?.({
              ok: true, windowId: window.id, resolution: result.resolution,
              healthResolution: result.healthResolution, concentrationCheck: result.concentrationCheck,
              economy: result.economy,
            })
            return
          }

          if (ready.kind === 'spell') {
            const result = resolveReadiedSpellReaction(
              state,
              window,
              payload.spellTargetActorIds,
              payload.areaGridX,
              payload.areaGridY,
            )
            state = result.state
            saveCampaignState(campaignId, state)
            io.to(roomName(campaignId)).emit('reaction:resolved', {
              windowId: window.id,
              kind: window.kind,
              spellId: result.spellId,
              spellName: result.spellName,
              castLevel: result.castLevel,
              targetActorIds: result.targetActorIds,
              areaPoint: result.areaPoint,
              message: result.message,
            })
            broadcastState(campaignId)
            acknowledge?.({
              ok: true,
              windowId: window.id,
              spellId: result.spellId,
              spellName: result.spellName,
              castLevel: result.castLevel,
              targetActorIds: result.targetActorIds,
              areaPoint: result.areaPoint,
              message: result.message,
              economy: result.economy,
            })
            return
          }

          const result = resolveReadiedUtilityReaction(state, window, socket, campaignId)
          state = result.state
          if (result.rollResult) {
            io.to(roomName(campaignId)).emit('dice:result', result.rollResult)
          }
          saveCampaignState(campaignId, state)
          io.to(roomName(campaignId)).emit('reaction:resolved', {
            windowId: window.id, kind: window.kind, message: result.message,
          })
          broadcastState(campaignId)
          acknowledge?.({
            ok: true, windowId: window.id, message: result.message, roll: result.rollResult,
            helpBenefit: result.helpBenefit, economy: result.economy,
          })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error: error instanceof Error ? error.message : 'Reaction response failed.',
          })
        }
      },
    )

    socket.on(
      'dice:roll',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          const campaignId = String(socket.data.campaignId ?? '')
          const role = socket.data.role === 'dm' ? 'dm' : 'player'
          const userId = String(socket.data.userId ?? '')

          if (!campaignId || !userId) {
            throw new Error('Join a campaign before rolling dice.')
          }

          const payload = (rawPayload ?? {}) as {
            sides?: unknown
            count?: unknown
            modifier?: unknown
            mode?: unknown
            purpose?: unknown
            actorId?: unknown
            ability?: unknown
            skill?: unknown
          }

          const sides = Math.trunc(Number(payload.sides))
          const count = Math.trunc(Number(payload.count ?? 1))
          const modifier = authoritativeGenericDiceModifier(role, payload.modifier)
          const payloadMode =
            payload.mode === 'advantage' || payload.mode === 'disadvantage'
              ? payload.mode
              : 'normal'
          const purpose: GenericDicePurpose =
            payload.purpose === 'attack' ||
            payload.purpose === 'damage' ||
            payload.purpose === 'saving-throw' ||
            payload.purpose === 'ability-check' ||
            payload.purpose === 'skill-check' ||
            payload.purpose === 'spell'
              ? payload.purpose
              : 'other'
          const requestedMode: GenericDiceMode = role === 'dm' ? payloadMode : 'normal'

          const saveAbility = purpose === 'saving-throw'
            ? normalizeSavingThrowAbility(payload.ability)
            : null
          const skill = purpose === 'skill-check'
            ? normalizeCharacterSkill(payload.skill)
            : null

          if (
            ![4, 6, 8, 10, 12, 20, 100].includes(sides) ||
            count < 1 || count > 20 ||
            modifier < -100 || modifier > 100
          ) {
            throw new Error('Invalid dice formula.')
          }

          let currentState = stateRecord(loadCampaignState(campaignId))
          const sourceActor = actionSourceActor(currentState, socket, payload.actorId)
          const targetSelection = socketTargetSelection(currentState, socket)
          const targetActor = targetSelection
            ? actorById(currentState, targetSelection.targetActorId)
            : null

          if (purpose === 'attack' && targetSelection) {
            if (!sourceActor || !targetActor) {
              throw new Error('The selected attack target is stale or no longer exists.')
            }
            if (targetSelection.sourceActorId && targetSelection.sourceActorId !== sourceActor.id) {
              throw new Error('The selected attack target belongs to a different action source.')
            }
            if (actorDistanceFeet(currentState, sourceActor.id, targetActor.id) === null) {
              throw new Error('Attack distance could not be established on the active map.')
            }
            if (!actorHasLineOfEffect(currentState, sourceActor.id, targetActor.id, 'blocksSight')) {
              throw new Error("Attack target is outside the attacker's current line of sight.")
            }
            if (!actorHasLineOfEffect(currentState, sourceActor.id, targetActor.id, 'blocksProjectiles')) {
              throw new Error('Attack roll blocked by a Wall or closed Door.')
            }
          }

          if (role === 'player' && !sourceActor) {
            throw new Error('Your Player Character is required before rolling an action die.')
          }
          if (role === 'dm' && String(payload.actorId ?? '').trim() && !sourceActor) {
            throw new Error('The selected DM source Actor was not found.')
          }

          if (purpose === 'saving-throw' && sourceActor && !saveAbility) {
            throw new Error('Choose a valid saving throw ability.')
          }
          if (purpose === 'skill-check' && sourceActor && !skill) {
            throw new Error('Choose a valid skill for this skill check.')
          }

          const d20EffectApplies =
            sides === 20 &&
            count === 1 &&
            purpose !== 'damage' &&
            purpose !== 'other'
          const targetDistanceFeet = sourceActor && targetActor
            ? actorDistanceFeet(currentState, sourceActor.id, targetActor.id)
            : null
          const attackHelpBenefit =
            d20EffectApplies &&
            purpose === 'attack' &&
            sourceActor &&
            targetActor
              ? matchingHelpAttackBenefit(
                  helpBenefitsForState(currentState),
                  sourceActor.id,
                  targetActor.id,
                )
              : null
          const abilityHelpBenefit =
            d20EffectApplies &&
            purpose === 'skill-check' &&
            sourceActor &&
            skill
              ? matchingHelpAbilityBenefit(
                  helpBenefitsForState(currentState),
                  sourceActor.id,
                  skill,
                )
              : null
          let helpAdjustedMode = requestedMode
          if (attackHelpBenefit || abilityHelpBenefit) {
            helpAdjustedMode = addAdvantageMode(helpAdjustedMode)
          }
          const rulesMode = d20EffectApplies
            ? resolveActorD20Mode(sourceActor, purpose, helpAdjustedMode, targetActor, targetDistanceFeet)
            : helpAdjustedMode
          const attackMode = d20EffectApplies && purpose === 'attack' && targetActor
            ? applyDodgeAttackMode(
                rulesMode,
                targetActor,
                turnEconomyForActor(currentState, targetActor),
              )
            : rulesMode
          const mode = d20EffectApplies && purpose === 'saving-throw' && sourceActor
            ? applyDodgeSavingThrowMode(
                attackMode,
                sourceActor,
                turnEconomyForActor(currentState, sourceActor),
                saveAbility,
              )
            : attackMode
          const effectModifier = d20EffectApplies
            ? actorD20Modifier(sourceActor, purpose)
            : 0
          const authoritativeSaveModifier =
            d20EffectApplies &&
            purpose === 'saving-throw' &&
            sourceActor &&
            saveAbility
              ? savingThrowModifier(sourceActor, saveAbility)
              : 0
          const bonusDice = d20EffectApplies
            ? actorD20BonusDice(sourceActor, purpose)
            : []
          const bonusDiceResults = bonusDice.flatMap((bonus) =>
            Array.from({ length: bonus.count }, () => ({
              effectId: bonus.effectId,
              name: bonus.name,
              sides: bonus.sides,
              roll: randomInt(1, bonus.sides + 1),
            })),
          )
          const bonusDiceTotal = bonusDiceResults.reduce((sum, entry) => sum + entry.roll, 0)
          const authoritativeSkillModifier =
            d20EffectApplies &&
            purpose === 'skill-check' &&
            sourceActor &&
            skill
              ? actorSkillModifier(sourceActor, skill)
              : 0
          const baseModifier =
            d20EffectApplies && purpose === 'saving-throw' && sourceActor
              ? authoritativeSaveModifier
              : d20EffectApplies && purpose === 'skill-check' && sourceActor
                ? authoritativeSkillModifier
                : modifier
          const resolvedModifier = Math.max(
            -100,
            Math.min(100, baseModifier + effectModifier),
          )

          const rollSet = () =>
            Array.from({ length: count }, () => randomInt(1, sides + 1))

          const first = rollSet()
          const second = mode === 'normal' ? null : rollSet()
          const firstTotal = first.reduce((sum, value) => sum + value, 0)
          const secondTotal = second?.reduce((sum, value) => sum + value, 0) ?? null
          const diceTotal =
            secondTotal === null
              ? firstTotal
              : mode === 'advantage'
                ? Math.max(firstTotal, secondTotal)
                : Math.min(firstTotal, secondTotal)

          if (attackHelpBenefit) {
            currentState = consumeHelpBenefitInState(currentState, attackHelpBenefit.id)
          }
          if (abilityHelpBenefit) {
            currentState = consumeHelpBenefitInState(currentState, abilityHelpBenefit.id)
          }

          const room = presenceByCampaign.get(campaignId)
          const roller = room?.get(socket.id)
          const record = {
            id: `roll_${Date.now()}_${randomInt(1000, 9999)}`,
            rollerId: userId,
            rollerName: roller?.name ?? (role === 'dm' ? 'Dungeon Master' : 'Player'),
            role,
            purpose,
            sides,
            count,
            modifier: resolvedModifier,
            mode,
            rolls: second ? [first, second] : [first],
            total: diceTotal + resolvedModifier + bonusDiceTotal,
            bonusDiceResults,
            natural: count === 1 && sides === 20 ? diceTotal : null,
            visibility: genericDiceVisibilityForRoll(role, purpose),
            createdAt: new Date().toISOString(),
            skill,
          }

          io.to(roomName(campaignId)).emit('dice:result', record)

          const previousActivity = Array.isArray(currentState.activityLog)
            ? currentState.activityLog
            : []
          saveCampaignState(campaignId, {
            ...currentState,
            lastAction: {
              type: 'dice-roll',
              ...record,
            },
            activityLog: [
              ...previousActivity,
              {
                type: 'dice-roll',
                ...record,
              },
            ].slice(-100),
          })
          broadcastState(campaignId)

          acknowledge?.({
            ok: true,
            total: record.total,
            sides: record.sides,
            rolls: record.rolls,
            mode: record.mode,
            effectModifier,
            bonusDiceResults,
            bonusDiceTotal,
            sourceActorId: sourceActor?.id ?? null,
            targetActorId: targetActor?.id ?? null,
            skill,
          })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error: error instanceof Error ? error.message : 'Dice roll failed.',
          })
        }
      },
    )

    socket.on(
      'actor:create-own-character',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          const campaignId = String(socket.data.campaignId ?? '')
          const role = socket.data.role === 'dm' ? 'dm' : 'player'
          const userId = String(socket.data.userId ?? '')

          if (!campaignId || !userId) {
            throw new Error('Join a campaign before creating a character sheet.')
          }

          if (role !== 'player') {
            throw new Error('DM character creation uses the host controls.')
          }

          const state =
            (loadCampaignState(campaignId) ?? {}) as {
              actors?: Actor[]
              [key: string]: unknown
            }

          const actors = Array.isArray(state.actors)
            ? state.actors.map(normalizeActor)
            : []

          const existing = actors.find(
            (actor) =>
              actor.kind === 'player' &&
              actor.ownerId === userId,
          )

          if (existing) {
            acknowledge?.({ ok: true, actorId: existing.id, existing: true })
            broadcastState(campaignId)
            return
          }

          const payload =
            rawPayload && typeof rawPayload === 'object'
              ? rawPayload as { name?: unknown }
              : {}

          const presenceName =
            presenceByCampaign
              .get(campaignId)
              ?.get(socket.id)
              ?.name

          const requestedName =
            typeof payload.name === 'string'
              ? payload.name.trim().slice(0, 80)
              : ''

          const playerKey =
            String(
              socket.data.playerKey ?? '',
            )

          const vault =
            loadCharacterVault(
              playerKey,
            )

          const actor =
            vault
              ? createPlayerActorFromVault(
                  vault.character,
                  {
                    sourceCampaignId:
                      vault.sourceCampaignId,
                    targetCampaignId:
                      campaignId,
                    name:
                      requestedName ||
                      presenceName ||
                      'Adventurer',
                    ownerId:
                      userId,
                  },
                )
              : createBlankPlayerActor({
                  id: `actor-${randomUUID()}`,
                  name:
                    requestedName ||
                    presenceName ||
                    'Adventurer',
                  ownerId: userId,
                })

          saveCampaignState(
            campaignId,
            {
              ...state,
              actors: [...actors, actor],
            },
          )

          broadcastState(campaignId)
          acknowledge?.({
            ok: true,
            actorId: actor.id,
            existing: false,
            restored: Boolean(vault),
          })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'Character creation failed.',
          })
        }
      },
    )

    socket.on(
      'actor:spend-hit-die',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'actor:spend-hit-die', rawPayload)
          const campaignId = String(socket.data.campaignId ?? '')
          const role = socket.data.role === 'dm' ? 'dm' : 'player'
          const userId = String(socket.data.userId ?? '')
          if (!campaignId || !userId || role !== 'player') {
            throw new Error('Only a joined player can spend Hit Dice on their own character.')
          }

          const payload = (rawPayload ?? {}) as { actorId?: unknown }
          const actorId = String(payload.actorId ?? '')
          const state = (loadCampaignState(campaignId) ?? {}) as {
            actors?: Actor[]
            activityLog?: unknown[]
            [key: string]: unknown
          }
          const actors = Array.isArray(state.actors) ? state.actors : []
          const actorIndex = actors.findIndex((candidate) => candidate?.id === actorId)
          if (actorIndex < 0) throw new Error('Character actor not found.')

          const original = normalizeActor(actors[actorIndex])
          if (original.kind !== 'player' || original.ownerId !== userId || !original.characterSheet) {
            throw new Error('You can spend Hit Dice only for your own Player Character.')
          }
          if (combatForState(state).active) {
            throw new Error('Hit Dice can be spent when combat is not active.')
          }
          if (!original.characterSheet.shortRestActive) {
            throw new Error('The DM must start a Short Rest before you can spend Hit Dice.')
          }
          if (original.characterSheet.shortRestHitDiceDone) {
            throw new Error('You have finished your Hit Dice choice for this Short Rest.')
          }
          if (original.currentHp < 1) throw new Error('A character needs at least 1 HP to take a Short Rest.')
          if (original.currentHp >= original.maxHp) throw new Error('Your Hit Points are already full.')

          const totalHitDice = Math.max(1, Math.min(20, original.level))
          const hitDiceSpent = original.characterSheet.hitDiceSpent
          if (hitDiceSpent >= totalHitDice) throw new Error('No Hit Dice remain until a Long Rest.')
          const dieSides = hitDieSidesForClass(original.characterSheet.className)
          if (!dieSides) throw new Error('Choose a class before spending Hit Dice.')

          const dieResult = randomInt(1, dieSides + 1)
          const constitutionModifier = abilityModifier(original.abilities.constitution)
          const rolledRecovery = dieResult + constitutionModifier
          const recovery = original.characterSheet.classRulesVersion === '2014'
            ? Math.max(0, rolledRecovery)
            : Math.max(1, rolledRecovery)
          const healed = Math.min(original.maxHp - original.currentHp, recovery)
          const updated = normalizeActor({
            ...original,
            currentHp: original.currentHp + healed,
            characterSheet: {
              ...original.characterSheet,
              hitDiceSpent: hitDiceSpent + 1,
            },
          })
          const nextActors = [...actors]
          nextActors[actorIndex] = updated
          const remainingHitDice = totalHitDice - updated.characterSheet!.hitDiceSpent
          const action = {
            type: 'short-rest-hit-die',
            actorId: updated.id,
            actorName: updated.name,
            roll: dieResult,
            dieSides,
            constitutionModifier,
            healed,
            createdAt: new Date().toISOString(),
          }
          const nextState = {
            ...state,
            actors: nextActors,
            lastAction: action,
            activityLog: [...(state.activityLog ?? []), action].slice(-100),
          }
          saveCampaignState(campaignId, nextState)
          broadcastState(campaignId)
          acknowledge?.({
            ok: true,
            message: `d${dieSides} rolled ${dieResult}${constitutionModifier >= 0 ? ` + ${constitutionModifier}` : ` − ${Math.abs(constitutionModifier)}`} · ${healed} HP recovered · ${remainingHitDice}/${totalHitDice} Hit Dice left`,
            roll: dieResult,
            dieSides,
            constitutionModifier,
            healed,
            currentHp: updated.currentHp,
            hitDiceSpent: updated.characterSheet!.hitDiceSpent,
            totalHitDice,
          })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error: error instanceof Error ? error.message : 'Hit Die could not be rolled.',
          })
        }
      },
    )

    socket.on(
      'actor:finish-short-rest-hit-dice',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'actor:finish-short-rest-hit-dice', rawPayload)
          const campaignId = String(socket.data.campaignId ?? '')
          const role = socket.data.role === 'dm' ? 'dm' : 'player'
          const userId = String(socket.data.userId ?? '')
          if (!campaignId || !userId || role !== 'player') {
            throw new Error('Only a joined player can finish their own Hit Dice choice.')
          }

          const payload = (rawPayload ?? {}) as { actorId?: unknown }
          const actorId = String(payload.actorId ?? '')
          const state = (loadCampaignState(campaignId) ?? {}) as {
            actors?: Actor[]
            [key: string]: unknown
          }
          const actors = Array.isArray(state.actors) ? state.actors : []
          const actorIndex = actors.findIndex((candidate) => candidate?.id === actorId)
          if (actorIndex < 0) throw new Error('Character actor not found.')

          const original = normalizeActor(actors[actorIndex])
          if (original.kind !== 'player' || original.ownerId !== userId || !original.characterSheet) {
            throw new Error('You can only finish your own Player Character Hit Dice choice.')
          }
          if (!original.characterSheet.shortRestActive) {
            throw new Error('The DM must start a Short Rest before finishing this choice.')
          }

          const updated = normalizeActor({
            ...original,
            characterSheet: {
              ...original.characterSheet,
              shortRestHitDiceDone: true,
            },
          })
          const nextActors = [...actors]
          nextActors[actorIndex] = updated
          saveCampaignState(campaignId, { ...state, actors: nextActors })
          broadcastState(campaignId)
          acknowledge?.({ ok: true })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error: error instanceof Error ? error.message : 'Hit Dice choice could not be saved.',
          })
        }
      },
    )

    socket.on(
      'actor:update-own-sheet',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'actor:update-own-sheet', rawPayload)
          const campaignId = String(socket.data.campaignId ?? '')
          const role = socket.data.role === 'dm' ? 'dm' : 'player'
          const userId = String(socket.data.userId ?? '')

          if (!campaignId || !userId) {
            throw new Error('Join a campaign before editing a character sheet.')
          }

          if (role !== 'player') {
            throw new Error('DM character edits use the host controls.')
          }

          const payload = (rawPayload ?? {}) as {
            actorId?: unknown
            patch?: unknown
          }

          const actorId = String(payload.actorId ?? '')
          const patch =
            payload.patch && typeof payload.patch === 'object'
              ? payload.patch as Record<string, unknown>
              : {}

          if (!actorId) {
            throw new Error('Character actor is missing.')
          }

          const state =
            (loadCampaignState(campaignId) ?? {}) as {
              actors?: Actor[]
              [key: string]: unknown
            }

          const actors = Array.isArray(state.actors)
            ? state.actors
            : []

          const actorIndex = actors.findIndex(
            (candidate) => candidate?.id === actorId,
          )

          if (actorIndex < 0) {
            throw new Error('Character actor not found.')
          }

          const original = normalizeActor(actors[actorIndex])

          if (
            original.kind !== 'player' ||
            original.ownerId !== userId
          ) {
            throw new Error('You can edit only your own player character.')
          }

          const combat = combatForState(state as Record<string, unknown>)
          if (!playerSheetEditAllowedDuringCombat(combat.active)) {
            throw new Error('Player character sheet edits are locked during active combat. Combat state is server-authoritative.')
          }

          const rawAbilities =
            patch.abilities && typeof patch.abilities === 'object'
              ? patch.abilities as Record<string, unknown>
              : {}

          const rawSheet =
            patch.characterSheet && typeof patch.characterSheet === 'object'
              ? patch.characterSheet as Record<string, unknown>
              : {}
          const safeSheetPatch = preserveServerOwnedCharacterSheetState(
            rawSheet,
            original.characterSheet,
          )

          const currentSheet = original.characterSheet!
          const currentKnownIds = currentSheet.knownSpellIds ?? []
          const requestedKnownIds = Array.isArray(rawSheet.knownSpellIds)
            ? rawSheet.knownSpellIds.filter((entry): entry is string => typeof entry === 'string')
            : currentKnownIds
          const currentKnownSet = new Set(currentKnownIds)
          const requestedKnownSet = new Set(requestedKnownIds)
          const addedKnownIds = [...requestedKnownSet].filter((id) => !currentKnownSet.has(id))
          const removedKnownIds = [...currentKnownSet].filter((id) => !requestedKnownSet.has(id))
          const abilityName = automaticSpellcastingAbility(currentSheet.className)
          const abilityScore = abilityName ? original.abilities[abilityName] : 10
          const grantedSpellIds = new Set(featureGrantedSpells(
            currentSheet.className,
            currentSheet.subclassName,
            original.level,
          ).map((spell) => spell.id))
          const sameIds = (left: string[], right: string[]) => {
            const sortedLeft = [...new Set(left)].sort()
            const sortedRight = [...new Set(right)].sort()
            return sortedLeft.length === sortedRight.length && sortedLeft.every((id, index) => id === sortedRight[index])
          }
          let authorizedSpellPatch: Record<string, unknown> = {}

          if (addedKnownIds.length || removedKnownIds.length) {
            if (addedKnownIds.length + removedKnownIds.length !== 1) {
              throw new Error('Change one spell at a time. Remove a spell explicitly before choosing its replacement.')
            }

            const requestedPreparedIds = Array.isArray(rawSheet.preparedSpellIds)
              ? rawSheet.preparedSpellIds.filter((entry): entry is string => typeof entry === 'string')
              : currentSheet.preparedSpellIds
            let selectionPatch
            if (addedKnownIds.length) {
              const spellId = addedKnownIds[0]
              const spell = spellById(spellId)
              if (!spell || !spellIsAvailableToCharacter(spell, currentSheet.className, original.level) || grantedSpellIds.has(spellId)) {
                throw new Error('That spell is not an available choice for this class and level.')
              }
              selectionPatch = addSelectedSpellPatch(currentSheet, original.level, spellId, abilityScore)
              if (!selectionPatch) throw new Error('This class cannot add that cantrip or spell at this time or its limit is full.')
            } else {
              const spellId = removedKnownIds[0]
              if (grantedSpellIds.has(spellId)) throw new Error('Feature-granted spells cannot be removed from the character sheet.')
              selectionPatch = removeSelectedSpellPatch(currentSheet, original.level, spellId, abilityScore)
              if (!selectionPatch) throw new Error('This class cannot replace that cantrip or spell at this time.')
            }

            const expectedKnownIds = selectionPatch.knownSpellIds ?? currentKnownIds
            const expectedPreparedIds = selectionPatch.preparedSpellIds ?? currentSheet.preparedSpellIds
            if (!sameIds(requestedKnownIds, expectedKnownIds) || !sameIds(requestedPreparedIds, expectedPreparedIds)) {
              throw new Error('Spell changes must be made one at a time through the spellbook controls.')
            }
            authorizedSpellPatch = selectionPatch as Record<string, unknown>
          } else {
            const requestedPreparedIds = Array.isArray(rawSheet.preparedSpellIds)
              ? rawSheet.preparedSpellIds.filter((entry): entry is string => typeof entry === 'string')
              : currentSheet.preparedSpellIds
            const currentPreparedSet = new Set(currentSheet.preparedSpellIds)
            const requestedPreparedSet = new Set(requestedPreparedIds)
            const addedPreparedIds = [...requestedPreparedSet].filter((id) => !currentPreparedSet.has(id))
            const removedPreparedIds = [...currentPreparedSet].filter((id) => !requestedPreparedSet.has(id))
            if (addedPreparedIds.length || removedPreparedIds.length) {
              if (addedPreparedIds.length + removedPreparedIds.length !== 1 || !spellSelectionAvailability(currentSheet, original.level, abilityScore).rules.wizardSpellbook) {
                throw new Error('Only a Wizard can change prepared spells, and only within the allowed preparation window.')
              }
              const spellId = addedPreparedIds[0] ?? removedPreparedIds[0]
              const prepared = addedPreparedIds.length === 1
              const spell = spellById(spellId)
              if (!spell || spell.level === 0 || grantedSpellIds.has(spellId)) {
                throw new Error('That spell cannot be prepared manually.')
              }
              const selectionPatch = togglePreparedSpellPatch(currentSheet, original.level, spellId, prepared, abilityScore)
              if (!selectionPatch || !sameIds(requestedPreparedIds, selectionPatch.preparedSpellIds ?? currentSheet.preparedSpellIds)) {
                throw new Error('Wizard preparation changes are unavailable or the prepared-spell limit is full.')
              }
              authorizedSpellPatch = selectionPatch as Record<string, unknown>
            }
          }

          Object.assign(safeSheetPatch, authorizedSpellPatch)

          const updated = normalizeActor({
            ...original,
            name:
              typeof patch.name === 'string'
                ? patch.name.slice(0, 80)
                : original.name,
            level: original.level,
            currentHp:
              original.currentHp,
            maxHp:
              patch.maxHp === undefined
                ? original.maxHp
                : Number(patch.maxHp),
            tempHp:
              original.tempHp,
            ac:
              patch.ac === undefined
                ? original.ac
                : Number(patch.ac),
            speedFeet:
              patch.speedFeet === undefined
                ? original.speedFeet
                : Number(patch.speedFeet),
            abilities: {
              ...original.abilities,
              ...rawAbilities,
            },
            characterSheet:
              normalizeCharacterSheet({
                ...(original.characterSheet ?? {}),
                ...safeSheetPatch,
              }),
            id: original.id,
            kind: 'player',
            ownerId: original.ownerId,
            portraitAssetId: original.portraitAssetId,
            portraitUrl: original.portraitUrl,
            challengeRating: original.challengeRating,
            sourceTemplateId: original.sourceTemplateId,
            source: original.source,
            creatureSize: original.creatureSize,
            creatureType: original.creatureType,
            hitPointFormula: original.hitPointFormula,
            monsterStatBlock: original.monsterStatBlock,
            gmNotes: original.gmNotes,
            conditions: original.conditions,
            resources: original.resources,
          })

          const nextActors = [...actors]
          nextActors[actorIndex] = updated

          const previousActivity = Array.isArray(state.activityLog)
            ? state.activityLog
            : []
          const characterAction = {
            type: 'character-update',
            actorId: updated.id,
            actorName: updated.name,
            playerId: userId,
            updatedFields: Object.keys(patch).filter((key) => key !== 'id'),
            createdAt: new Date().toISOString(),
          }

          saveCampaignState(
            campaignId,
            {
              ...state,
              actors: nextActors,
              lastAction: characterAction,
              activityLog: [...previousActivity, characterAction].slice(-100),
            },
          )

          broadcastState(campaignId)
          acknowledge?.({ ok: true })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'Character sheet update failed.',
          })
        }
      },
    )

    socket.on(
      'actor:upload-own-token',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          const campaignId = String(socket.data.campaignId ?? '')
          const role = socket.data.role === 'dm' ? 'dm' : 'player'
          const userId = String(socket.data.userId ?? '')

          if (!campaignId || !userId || role !== 'player') {
            throw new Error('Join as a player before changing your token image.')
          }

          const payload = (rawPayload ?? {}) as {
            actorId?: unknown
            fileName?: unknown
            mimeType?: unknown
            bytes?: unknown
          }

          const actorId = String(payload.actorId ?? '')
          const fileName = String(payload.fileName ?? 'player-token.png').slice(0, 180)
          const mimeType = String(payload.mimeType ?? '')
          const bytes = binaryPayloadToBuffer(payload.bytes)
          const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])

          if (!actorId) {
            throw new Error('Character actor is missing.')
          }

          if (!allowedTypes.has(mimeType)) {
            throw new Error('Token image must be PNG, JPG or WEBP.')
          }

          if (!bytes || bytes.length <= 0) {
            throw new Error('Token image data is missing.')
          }

          if (bytes.length > PLAYER_TOKEN_MAX_BYTES) {
            throw new Error('Token image must be 15 MB or smaller.')
          }

          const state = stateRecord(loadCampaignState(campaignId))
          const actors = Array.isArray(state.actors) ? state.actors : []
          const actorIndex = actors.findIndex(
            (entry) => Boolean(
              entry &&
              typeof entry === 'object' &&
              String((entry as Record<string, unknown>).id ?? '') === actorId,
            ),
          )

          if (actorIndex < 0) {
            throw new Error('Character actor not found.')
          }

          const original = normalizeActor(actors[actorIndex] as Actor)

          if (original.kind !== 'player' || original.ownerId !== userId) {
            throw new Error('You can change only your own Player Character token.')
          }

          const asset = saveTokenAsset(
            campaignId,
            fileName,
            mimeType,
            bytes,
          )

          const updatedActor = normalizeActor({
            ...original,
            portraitAssetId: asset.id,
            portraitUrl: asset.url,
          })

          const nextActors = [...actors]
          nextActors[actorIndex] = updatedActor

          const tokens = Array.isArray(state.tokens) ? state.tokens : []
          const nextTokens = tokens.map((entry) => {
            if (!entry || typeof entry !== 'object') return entry

            const token = entry as Record<string, unknown>

            return String(token.actorId ?? '') === actorId
              ? {
                  ...token,
                  assetId: asset.id,
                  imageUrl: asset.url,
                }
              : entry
          })

          saveCampaignState(
            campaignId,
            {
              ...state,
              actors: nextActors,
              tokens: nextTokens,
            },
          )

          broadcastState(campaignId)
          acknowledge?.({ ok: true, assetId: asset.id, portraitUrl: asset.url })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'Token image update failed.',
          })
        }
      },
    )

    socket.on(
      'actor:update-own-token-color',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          const campaignId = String(socket.data.campaignId ?? '')
          const role = socket.data.role === 'dm' ? 'dm' : 'player'
          const userId = String(socket.data.userId ?? '')

          if (!campaignId || !userId || role !== 'player') {
            throw new Error('Join as a player before changing your token color.')
          }

          const payload = (rawPayload ?? {}) as {
            actorId?: unknown
            color?: unknown
          }

          const actorId = String(payload.actorId ?? '')
          const requestedColor = String(payload.color ?? '')

          if (!/^#[0-9a-f]{6}$/i.test(requestedColor)) {
            throw new Error('Invalid token ring color.')
          }

          const state = stateRecord(loadCampaignState(campaignId))
          const actors = Array.isArray(state.actors) ? state.actors : []
          const actorRaw = actors.find(
            (entry) => Boolean(
              entry &&
              typeof entry === 'object' &&
              String((entry as Record<string, unknown>).id ?? '') === actorId,
            ),
          )

          if (!actorRaw || typeof actorRaw !== 'object') {
            throw new Error('Character actor not found.')
          }

          const actor = normalizeActor(actorRaw as Actor)

          if (actor.kind !== 'player' || actor.ownerId !== userId) {
            throw new Error('You can change only your own Player Character token.')
          }

          const color = safeTokenColor(requestedColor, defaultPlayerColor(userId))
          const playerColors =
            state.playerColors && typeof state.playerColors === 'object'
              ? state.playerColors as Record<string, unknown>
              : {}
          const tokens = Array.isArray(state.tokens) ? state.tokens : []
          const nextTokens = tokens.map((entry) => {
            if (!entry || typeof entry !== 'object') return entry

            const token = entry as Record<string, unknown>

            return String(token.actorId ?? '') === actorId
              ? { ...token, color }
              : entry
          })

          saveCampaignState(
            campaignId,
            {
              ...state,
              playerColors: {
                ...playerColors,
                [userId]: color,
              },
              tokens: nextTokens,
            },
          )

          broadcastState(campaignId)
          acknowledge?.({ ok: true, color })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'Token color update failed.',
          })
        }
      },
    )

    socket.on(
      'arcane-reach:update',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(
            socket,
            'arcane-reach:update',
            rawPayload,
          )

          const campaignId =
            String(
              socket.data.campaignId ?? '',
            )

          const role =
            socket.data.role === 'dm'
              ? 'dm'
              : 'player'

          const userId =
            String(
              socket.data.userId ?? '',
            )

          if (
            !campaignId ||
            !userId
          ) {
            throw new Error(
              'Join a campaign before using Arcane Reach.',
            )
          }

          const payload =
            (rawPayload ?? {}) as {
              mapId?: unknown
              mode?: unknown
              start?: unknown
              end?: unknown
            }

          const mapId =
            String(
              payload.mapId ?? '',
            ).trim()

          const mode =
            String(
              payload.mode ?? '',
            ) as ArcaneReachMode

          const start =
            safeArcaneReachPoint(
              payload.start,
            )

          const end =
            safeArcaneReachPoint(
              payload.end,
            )

          if (
            !mapId ||
            !ARCANE_REACH_MODES.has(mode) ||
            !start ||
            !end
          ) {
            throw new Error(
              'Arcane Reach geometry is invalid.',
            )
          }

          const state =
            stateRecord(
              loadCampaignState(
                campaignId,
              ),
            )

          const activeMap =
            state.activeMap &&
            typeof state.activeMap === 'object'
              ? state.activeMap as Record<string, unknown>
              : null

          if (
            !activeMap ||
            String(activeMap.id ?? '') !== mapId
          ) {
            throw new Error(
              'Arcane Reach can be placed only on the active map.',
            )
          }

          const controllerId =
            role === 'dm'
              ? 'dm'
              : userId

          const sigils =
            safeArcaneReachSigils(
              state.arcaneReachSigils,
            )

          sigils[controllerId] = {
            controllerId,
            role,
            mapId,
            mode,
            start,
            end,
            updatedAt:
              new Date().toISOString(),
          }

          saveCampaignState(
            campaignId,
            {
              ...state,
              arcaneReachSigils:
                sigils,
            },
          )

          broadcastState(
            campaignId,
          )

          acknowledge?.({
            ok: true,
          })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'Arcane Reach update failed.',
          })
        }
      },
    )

    socket.on(
      'arcane-reach:clear',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(
            socket,
            'arcane-reach:clear',
            rawPayload,
          )

          const campaignId =
            String(
              socket.data.campaignId ?? '',
            )

          const role =
            socket.data.role === 'dm'
              ? 'dm'
              : 'player'

          const userId =
            String(
              socket.data.userId ?? '',
            )

          if (
            !campaignId ||
            !userId
          ) {
            throw new Error(
              'Join a campaign before clearing Arcane Reach.',
            )
          }

          const controllerId =
            role === 'dm'
              ? 'dm'
              : userId

          const state =
            stateRecord(
              loadCampaignState(
                campaignId,
              ),
            )

          const sigils =
            safeArcaneReachSigils(
              state.arcaneReachSigils,
            )

          delete sigils[
            controllerId
          ]

          saveCampaignState(
            campaignId,
            {
              ...state,
              arcaneReachSigils:
                sigils,
            },
          )

          broadcastState(
            campaignId,
          )

          acknowledge?.({
            ok: true,
          })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'Arcane Reach clear failed.',
          })
        }
      },
    )

    socket.on(
      'token:place-own',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'token:place-own', rawPayload)
          const campaignId = String(socket.data.campaignId ?? '')
          const role = socket.data.role === 'dm' ? 'dm' : 'player'
          const userId = String(socket.data.userId ?? '')

          if (!campaignId || !userId || role !== 'player') {
            throw new Error('Join as a player before placing your token.')
          }

          const payload = (rawPayload ?? {}) as {
            actorId?: unknown
            gridX?: unknown
            gridY?: unknown
          }

          const actorId = String(payload.actorId ?? '')
          const rawGridX = Number(payload.gridX)
          const rawGridY = Number(payload.gridY)

          if (!actorId || !Number.isFinite(rawGridX) || !Number.isFinite(rawGridY)) {
            throw new Error('Invalid token placement.')
          }

          const state = stateRecord(loadCampaignState(campaignId))
          const combat = combatForState(state)
          if (!playerTokenPlacementAllowedDuringCombat(combat.active)) {
            throw new Error('Player token placement is locked during active combat. Ask the DM to place or reposition the token.')
          }

          const actors = Array.isArray(state.actors) ? state.actors : []
          const actorRaw = actors.find(
            (entry) => Boolean(
              entry &&
              typeof entry === 'object' &&
              String((entry as Record<string, unknown>).id ?? '') === actorId,
            ),
          )

          if (!actorRaw || typeof actorRaw !== 'object') {
            throw new Error('Character actor not found.')
          }

          const actor = normalizeActor(actorRaw as Actor)

          if (actor.kind !== 'player' || actor.ownerId !== userId) {
            throw new Error('You can place only your own Player Character token.')
          }

          if (!actor.portraitUrl) {
            throw new Error('Choose a token image before placing your character on the map.')
          }

          const activeMap =
            state.activeMap && typeof state.activeMap === 'object'
              ? state.activeMap as Record<string, unknown>
              : null
          const activeMapId = String(activeMap?.id ?? '')

          if (!activeMapId) {
            throw new Error('The DM must activate a map before you can place your token.')
          }

          const tokens = Array.isArray(state.tokens) ? state.tokens : []
          const alreadyPlaced = tokens.some(
            (entry) => Boolean(
              entry &&
              typeof entry === 'object' &&
              String((entry as Record<string, unknown>).actorId ?? '') === actorId &&
              String((entry as Record<string, unknown>).mapId ?? '') === activeMapId,
            ),
          )

          if (alreadyPlaced) {
            throw new Error('Your token is already on the active map.')
          }

          const playerColors =
            state.playerColors && typeof state.playerColors === 'object'
              ? state.playerColors as Record<string, unknown>
              : {}
          const color = safeTokenColor(
            playerColors[userId],
            defaultPlayerColor(userId),
          )

          const token = {
            id: randomUUID(),
            actorId: actor.id,
            assetId: actor.portraitAssetId || `actor-portrait:${actor.id}`,
            imageUrl: actor.portraitUrl,
            mapId: activeMapId,
            gridX: normalizeGridIndex(rawGridX),
            gridY: normalizeGridIndex(rawGridY),
            size: 1,
            visible: true,
            color,
            movementUsedFeet: 0,
          }

          saveCampaignState(
            campaignId,
            {
              ...state,
              tokens: [...tokens, token],
            },
          )

          broadcastState(campaignId)
          acknowledge?.({ ok: true, tokenId: token.id })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'Player token placement failed.',
          })
        }
      },
    )

    socket.on(
      'actor:apply-health',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'actor:apply-health', rawPayload)
          const campaignId = String(socket.data.campaignId ?? '')
          const role = socket.data.role === 'dm' ? 'dm' : 'player'

          if (!campaignId) {
            throw new Error('Join a campaign before applying damage or healing.')
          }

          if (role !== 'dm') {
            throw new Error('Only the DM can apply damage and healing.')
          }

          const payload = (rawPayload ?? {}) as {
            actorId?: unknown
            operation?: unknown
            amount?: unknown
            damageType?: unknown
            criticalHit?: unknown
          }

          const actorId = String(payload.actorId ?? '').trim()
          const operation: HealthOperation =
            payload.operation === 'heal' || payload.operation === 'set-temp'
              ? payload.operation
              : payload.operation === 'damage'
                ? 'damage'
                : (() => {
                    throw new Error('Unknown health operation.')
                  })()

          if (!actorId) {
            throw new Error('Target Actor is missing.')
          }

          const state =
            (loadCampaignState(campaignId) ?? {}) as {
              actors?: Actor[]
              [key: string]: unknown
            }

          const actors = Array.isArray(state.actors)
            ? state.actors
            : []

          const actorIndex = actors.findIndex(
            (candidate) => candidate?.id === actorId,
          )

          if (actorIndex < 0) {
            throw new Error('Target Actor not found.')
          }

          const original = normalizeActor(actors[actorIndex])
          const { actor, resolution } = resolveHealthOperation(
            original,
            {
              operation,
              amount: Number(payload.amount),
              damageType: normalizeAppliedDamageType(payload.damageType),
              criticalHit: payload.criticalHit === true,
            },
          )

          let updatedActor = normalizeActor(actor)
          let concentrationCheck: {
            dc: number
            rawRoll: number
            modifier: number
            bonusDiceTotal: number
            bonusDiceResults: Array<{ sides: number; value: number }>
            total: number
            maintained: boolean
          } | null = null

          const hasActiveConcentration = Boolean(
            updatedActor.characterSheet?.concentratingSpellId ||
            stateHasConcentrationFromSource(state, original.id)
          )
          const concentrationEndedByIncapacitation = Boolean(
            operation === 'damage' &&
            resolution.effectiveDamage > 0 &&
            hasActiveConcentration &&
            updatedActor.lifeState !== 'conscious'
          )

          if (concentrationEndedByIncapacitation && updatedActor.characterSheet) {
            updatedActor = normalizeActor({
              ...updatedActor,
              characterSheet: {
                ...updatedActor.characterSheet,
                concentratingSpellId: '',
              },
            })
          }

          if (
            operation === 'damage' &&
            resolution.effectiveDamage > 0 &&
            hasActiveConcentration &&
            updatedActor.lifeState === 'conscious'
          ) {
            const dc = concentrationDc(resolution.effectiveDamage)
            const concentrationMode = resolveActorD20Mode(updatedActor, 'saving-throw')
            const firstRoll = randomInt(1, 21)
            const secondRoll = concentrationMode === 'normal' ? null : randomInt(1, 21)
            const rawRoll = secondRoll === null
              ? firstRoll
              : concentrationMode === 'advantage'
                ? Math.max(firstRoll, secondRoll)
                : Math.min(firstRoll, secondRoll)
            const modifier =
              savingThrowModifier(updatedActor, 'constitution') +
              actorD20Modifier(updatedActor, 'saving-throw')
            const bonusDiceResults = actorD20BonusDice(updatedActor, 'saving-throw')
              .flatMap((bonus) => Array.from({ length: bonus.count }, () => ({
                sides: bonus.sides,
                value: randomInt(1, bonus.sides + 1),
              })))
            const bonusDiceTotal = bonusDiceResults.reduce((sum, roll) => sum + roll.value, 0)
            const total = rawRoll + modifier + bonusDiceTotal
            const maintained = total >= dc
            concentrationCheck = { dc, rawRoll, modifier, bonusDiceTotal, bonusDiceResults, total, maintained }

            if (!maintained && updatedActor.characterSheet) {
              updatedActor = normalizeActor({
                ...updatedActor,
                characterSheet: {
                  ...updatedActor.characterSheet,
                  concentratingSpellId: '',
                },
              })
            }
          }

          const nextActors = [...actors]
          nextActors[actorIndex] = updatedActor

          let nextState = appendHealthLogToState(
            {
              ...state,
              actors: nextActors,
            },
            {
              id: randomUUID(),
              actorId,
              actorName: original.name,
              createdAt: new Date().toISOString(),
              resolution,
            },
          )

          if (concentrationEndedByIncapacitation || (concentrationCheck && !concentrationCheck.maintained)) {
            nextState = breakReadiedSpellConcentration(nextState, original.id)
          }

          if (concentrationCheck) {
            const ownerId = original.ownerId ?? 'dm'
            nextState = appendDiceRollToState(nextState, {
              id: randomUUID(),
              createdAt: new Date().toISOString(),
              visibility: structuredRollVisibilityForOwnedActor(original.ownerId),
              rollerRole: original.ownerId ? 'player' : 'dm',
              rollerId: ownerId,
              rollerName: original.name,
              reason: 'concentration',
              die: 'd20',
              rawRoll: concentrationCheck.rawRoll,
              modifier: concentrationCheck.modifier,
              total: concentrationCheck.total,
              actorId: original.id,
              actorName: original.name,
            })
          }

          saveCampaignState(
            campaignId,
            nextState,
          )

          emitConcentrationDiceReveal(campaignId, original.name, concentrationCheck)
          broadcastState(campaignId)
          acknowledge?.({
            ok: true,
            actorId,
            resolution,
            concentrationCheck,
          })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'Damage or healing could not be applied.',
          })
        }
      },
    )

    socket.on(
      'actor:roll-death-save',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'actor:roll-death-save', rawPayload)
          const campaignId = String(socket.data.campaignId ?? '')
          const role = socket.data.role === 'dm' ? 'dm' : 'player'
          const userId = String(socket.data.userId ?? '')

          if (!campaignId || !userId) {
            throw new Error('Join a campaign before rolling a Death Save.')
          }

          const payload = (rawPayload ?? {}) as { actorId?: unknown }
          const actorId = String(payload.actorId ?? '').trim()
          if (!actorId) throw new Error('Target Actor is missing.')

          const state = stateRecord(loadCampaignState(campaignId))
          const actors = Array.isArray(state.actors) ? state.actors as Actor[] : []
          const actorIndex = actors.findIndex((candidate) => candidate?.id === actorId)
          if (actorIndex < 0) throw new Error('Target Actor not found.')

          const original = normalizeActor(actors[actorIndex])
          if (!needsDeathSave(original)) {
            throw new Error(`${original.name} does not currently need a Death Saving Throw.`)
          }

          const combat = normalizeCombatState(
            state.combat,
            actors.map((actor) => String(actor?.id ?? '')).filter(Boolean),
          )

          if (combat.phase !== 'active' || combat.currentActorId !== actorId) {
            throw new Error('Death Saves are rolled on that Actor’s current combat turn.')
          }

          if (original.lastDeathSaveRound === combat.round) {
            throw new Error('This Actor already rolled a Death Save this round.')
          }

          if (role === 'player') {
            if (original.kind !== 'player' || original.ownerId !== userId) {
              throw new Error('Players can roll only their own Death Saving Throw.')
            }
          } else if (original.ownerId) {
            throw new Error('A player-controlled character rolls its own Death Saving Throw. Use DM Override only when necessary.')
          }

          const rawRoll = randomInt(1, 21)
          const saveBonusDiceResults = actorD20BonusDice(original, 'saving-throw')
            .flatMap((bonus) => Array.from({ length: bonus.count }, () => ({
              sides: bonus.sides,
              value: randomInt(1, bonus.sides + 1),
            })))
          const saveBonusDiceTotal = saveBonusDiceResults.reduce((sum, roll) => sum + roll.value, 0)
          const flatSaveModifier = actorD20Modifier(original, 'saving-throw')
          const deathSaveModifier = flatSaveModifier + saveBonusDiceTotal
          const { actor, resolution } = resolveDeathSave(
            original,
            rawRoll,
            combat.round,
            deathSaveModifier,
          )

          const nextActors = [...actors]
          nextActors[actorIndex] = normalizeActor(actor)

          const roll: DiceRollEntry = {
            id: randomUUID(),
            createdAt: new Date().toISOString(),
            visibility: structuredRollVisibilityForRole(role),
            rollerRole: role,
            rollerId: userId,
            rollerName: socketDisplayName(socket, campaignId),
            reason: 'death-save',
            die: 'd20',
            rawRoll,
            modifier: deathSaveModifier,
            total: resolution.total,
            actorId,
            actorName: original.name,
          }

          const nextState = appendDiceRollToState(
            {
              ...state,
              actors: nextActors,
            },
            roll,
          )

          saveCampaignState(campaignId, nextState)
          emitTableDiceRoll(campaignId, {
            id: roll.id,
            rollerName: roll.rollerName,
            title: `Death Save · ${original.name}`,
            total: resolution.total,
            dice: [
              { sides: 20, value: rawRoll },
              ...saveBonusDiceResults,
            ],
            detail: `${resolution.outcome.toUpperCase()} · Final total`,
          })
          broadcastState(campaignId)
          acknowledge?.({
            ok: true,
            actorId,
            rawRoll,
            resolution: resolution as DeathSaveResolution,
          })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error: error instanceof Error ? error.message : 'Death Saving Throw failed.',
          })
        }
      },
    )

    socket.on(
      'combat:start',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'combat:start', rawPayload)
          const campaignId = requireDmCampaignId(socket)
          const state = stateRecord(loadCampaignState(campaignId))
          const existingCombat = combatForState(state)

          if (existingCombat.phase !== 'inactive') {
            throw new Error('An encounter is already being prepared or is active. End it before starting another encounter.')
          }

          const payload = (rawPayload ?? {}) as { actorIds?: unknown }
          const requestedActorIds = Array.isArray(payload.actorIds)
            ? payload.actorIds.map((value) => String(value)).filter(Boolean)
            : []
          const actors = Array.isArray(state.actors)
            ? state.actors
                .filter((entry): entry is Actor => Boolean(entry && typeof entry === 'object'))
                .map((entry) => normalizeActor(entry))
            : []

          const combat = prepareCombatState(
            actors,
            requestedActorIds,
          )

          if (combat.phase !== 'setup') {
            throw new Error('Select at least one valid Actor before preparing initiative.')
          }

          persistCombatState(campaignId, state, combat, { resetAllTransient: true })
          acknowledge?.({ ok: true, combat })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error: error instanceof Error ? error.message : 'Initiative setup could not start.',
          })
        }
      },
    )

    socket.on(
      'combat:roll-player-initiative',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'combat:roll-player-initiative', rawPayload)
          const campaignId = String(socket.data.campaignId ?? '')
          const userId = String(socket.data.userId ?? '')

          if (!campaignId || !userId || socket.data.role !== 'player') {
            throw new Error('Join as a player before rolling player initiative.')
          }

          const state = stateRecord(loadCampaignState(campaignId))
          const combat = combatForState(state)

          if (combat.phase !== 'setup') {
            throw new Error('Initiative rolls are not currently being collected.')
          }

          const payload = (rawPayload ?? {}) as { actorId?: unknown }
          const actorId = String(payload.actorId ?? '')
          const rawActors = Array.isArray(state.actors) ? state.actors : []
          const actorRaw = rawActors.find(
            (entry) => Boolean(entry && typeof entry === 'object' && String((entry as Record<string, unknown>).id ?? '') === actorId),
          )

          if (!actorRaw || typeof actorRaw !== 'object') {
            throw new Error('Player Actor not found.')
          }

          const actor = normalizeActor(actorRaw as Actor)
          const combatant = combat.combatants.find((entry) => entry.actorId === actorId)

          if (!combatant) {
            throw new Error('This Actor is not selected for the encounter.')
          }

          if (actor.kind !== 'player' || actor.ownerId !== userId) {
            throw new Error('You can only roll initiative for your own Player Actor.')
          }

          if (combatant.initiative !== null) {
            throw new Error('Initiative has already been submitted for this Actor. Ask the DM for an override if it must change.')
          }

          const rawRoll = randomInt(1, 21)
          const total = rawRoll + actor.initiativeBonus
          const nextCombat = setCombatantInitiative(
            combat,
            actorId,
            total,
            'player-roll',
          )
          const roll: DiceRollEntry = {
            id: randomUUID(),
            createdAt: new Date().toISOString(),
            visibility: 'public',
            rollerRole: 'player',
            rollerId: userId,
            rollerName: socketDisplayName(socket, campaignId),
            reason: 'initiative',
            die: 'd20',
            rawRoll,
            modifier: actor.initiativeBonus,
            total,
            actorId: actor.id,
            actorName: actor.name,
          }
          const nextState = appendDiceRollToState(
            {
              ...state,
              combat: nextCombat,
            },
            roll,
          )

          saveCampaignState(campaignId, nextState)
          emitTableDiceRoll(campaignId, {
            id: roll.id,
            rollerName: roll.rollerName,
            title: `Initiative · ${actor.name}`,
            total,
            dice: [{ sides: 20, value: rawRoll }],
            detail: `${actor.initiativeBonus >= 0 ? '+' : ''}${actor.initiativeBonus} initiative modifier`,
          })
          broadcastState(campaignId)
          acknowledge?.({ ok: true, rawRoll, total })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error: error instanceof Error ? error.message : 'Player initiative roll failed.',
          })
        }
      },
    )

    socket.on(
      'combat:roll-dm-initiative',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'combat:roll-dm-initiative', rawPayload)
          const campaignId = requireDmCampaignId(socket)
          const state = stateRecord(loadCampaignState(campaignId))
          const combat = combatForState(state)

          if (combat.phase !== 'setup') {
            throw new Error('Initiative rolls are not currently being collected.')
          }

          const payload = (rawPayload ?? {}) as { actorId?: unknown }
          const actorId = String(payload.actorId ?? '')
          const rawActors = Array.isArray(state.actors) ? state.actors : []
          const actorRaw = rawActors.find(
            (entry) => Boolean(entry && typeof entry === 'object' && String((entry as Record<string, unknown>).id ?? '') === actorId),
          )

          if (!actorRaw || typeof actorRaw !== 'object') {
            throw new Error('Actor not found.')
          }

          const actor = normalizeActor(actorRaw as Actor)

          if (!combat.combatants.some((entry) => entry.actorId === actorId)) {
            throw new Error('This Actor is not selected for the encounter.')
          }

          if (actor.kind === 'player') {
            throw new Error('Player initiative must be rolled by that player. The DM may use the manual override, but cannot roll it for them.')
          }

          const rawRoll = randomInt(1, 21)
          const total = rawRoll + actor.initiativeBonus
          const nextCombat = setCombatantInitiative(
            combat,
            actorId,
            total,
            'dm-roll',
          )
          const roll: DiceRollEntry = {
            id: randomUUID(),
            createdAt: new Date().toISOString(),
            visibility: 'dm',
            rollerRole: 'dm',
            rollerId: String(socket.data.userId ?? 'dm'),
            rollerName: socketDisplayName(socket, campaignId),
            reason: 'initiative',
            die: 'd20',
            rawRoll,
            modifier: actor.initiativeBonus,
            total,
            actorId: actor.id,
            actorName: actor.name,
          }
          const nextState = appendDiceRollToState(
            {
              ...state,
              combat: nextCombat,
            },
            roll,
          )

          saveCampaignState(campaignId, nextState)
          emitTableDiceRoll(campaignId, {
            id: roll.id,
            rollerName: roll.rollerName,
            title: `Initiative · ${actor.name}`,
            total,
            dice: [{ sides: 20, value: rawRoll }],
            detail: `${actor.initiativeBonus >= 0 ? '+' : ''}${actor.initiativeBonus} initiative modifier`,
          })
          broadcastState(campaignId)
          acknowledge?.({ ok: true, rawRoll, total })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error: error instanceof Error ? error.message : 'DM initiative roll failed.',
          })
        }
      },
    )

    socket.on(
      'combat:begin',
      (
        _rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'combat:begin', _rawPayload)
          const campaignId = requireDmCampaignId(socket)
          const state = stateRecord(loadCampaignState(campaignId))
          const combat = combatForState(state)

          if (combat.phase !== 'setup') {
            throw new Error('No initiative setup is waiting to begin.')
          }

          const missing = combat.combatants.filter((entry) => entry.initiative === null)

          if (missing.length > 0) {
            throw new Error(`${missing.length} combatant(s) still need initiative.`)
          }

          const nextCombat = beginCombatState(combat)

          if (nextCombat.phase !== 'active') {
            throw new Error('Round 1 could not begin.')
          }

          persistCombatState(campaignId, state, nextCombat, {
            startActorId: nextCombat.currentActorId,
          })
          acknowledge?.({ ok: true, combat: nextCombat })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error: error instanceof Error ? error.message : 'Round 1 could not begin.',
          })
        }
      },
    )

    socket.on(
      'combat:set-initiative',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'combat:set-initiative', rawPayload)
          const campaignId = requireDmCampaignId(socket)
          const state = stateRecord(loadCampaignState(campaignId))
          const combat = combatForState(state)

          if (!combat.active) {
            throw new Error('No active combat.')
          }

          const payload = (rawPayload ?? {}) as { actorId?: unknown; initiative?: unknown }
          const actorId = String(payload.actorId ?? '')
          const initiative = Number(payload.initiative)

          if (!actorId || !Number.isFinite(initiative)) {
            throw new Error('Invalid initiative update.')
          }

          const nextCombat = setCombatantInitiative(combat, actorId, initiative)
          persistCombatState(campaignId, state, nextCombat)
          acknowledge?.({ ok: true, combat: nextCombat })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error: error instanceof Error ? error.message : 'Initiative update failed.',
          })
        }
      },
    )

    socket.on(
      'combat:move-tie',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'combat:move-tie', rawPayload)
          const campaignId = requireDmCampaignId(socket)
          const state = stateRecord(loadCampaignState(campaignId))
          const combat = combatForState(state)

          if (combat.phase !== 'active') {
            throw new Error('Initiative order is not active yet.')
          }

          const payload = (rawPayload ?? {}) as { actorId?: unknown; direction?: unknown }
          const actorId = String(payload.actorId ?? '')
          const direction = payload.direction === 'up' ? 'up' : payload.direction === 'down' ? 'down' : null

          if (!actorId || !direction) {
            throw new Error('Invalid tie-order update.')
          }

          const nextCombat = moveTiedCombatant(combat, actorId, direction)
          persistCombatState(campaignId, state, nextCombat)
          acknowledge?.({ ok: true, combat: nextCombat })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error: error instanceof Error ? error.message : 'Tie-order update failed.',
          })
        }
      },
    )

    socket.on(
      'combat:next-turn',
      (
        _rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'combat:next-turn', _rawPayload)
          const campaignId = requireDmCampaignId(socket)
          const state = stateRecord(loadCampaignState(campaignId))
          const combat = combatForState(state)

          if (combat.phase !== 'active') {
            throw new Error('Round 1 has not started yet.')
          }
          if (reactionWindowsForState(state).length > 0) {
            throw new Error('Resolve or decline pending Reactions before advancing the turn.')
          }

          const nextCombat = advanceCombatTurn(combat)
          persistCombatState(campaignId, state, nextCombat, {
            endActorId: combat.currentActorId,
            startActorId: nextCombat.currentActorId,
          })
          acknowledge?.({ ok: true, combat: nextCombat })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error: error instanceof Error ? error.message : 'Next turn failed.',
          })
        }
      },
    )

    socket.on(
      'combat:previous-turn',
      (
        _rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'combat:previous-turn', _rawPayload)
          const campaignId = requireDmCampaignId(socket)
          const state = stateRecord(loadCampaignState(campaignId))
          const combat = combatForState(state)

          if (combat.phase !== 'active') {
            throw new Error('Round 1 has not started yet.')
          }

          const previousCombat = rewindCombatTurn(combat)
          persistCombatState(campaignId, state, previousCombat, {
            endActorId: combat.currentActorId,
            startActorId: previousCombat.currentActorId,
            clearAllReadyActions: true,
          })
          acknowledge?.({ ok: true, combat: previousCombat })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error: error instanceof Error ? error.message : 'Previous turn failed.',
          })
        }
      },
    )

    socket.on(
      'combat:end',
      (
        _rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'combat:end', _rawPayload)
          const campaignId = requireDmCampaignId(socket)
          const state = stateRecord(loadCampaignState(campaignId))
          const combat = endCombatState()
          persistCombatState(campaignId, state, combat, { resetAllTransient: true })
          acknowledge?.({ ok: true, combat })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error: error instanceof Error ? error.message : 'Combat could not end.',
          })
        }
      },
    )

    socket.on(
      'dice:roll-d20',
      (
        _rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          const campaignId = String(socket.data.campaignId ?? '')
          const userId = String(socket.data.userId ?? '')
          const role = socket.data.role === 'dm' ? 'dm' : 'player'

          if (!campaignId || !userId) {
            throw new Error('Join a campaign before rolling dice.')
          }

          const rawRoll = randomInt(1, 21)
          const visibility = role === 'dm' ? 'dm' : 'public'
          const state = stateRecord(loadCampaignState(campaignId))
          const roll: DiceRollEntry = {
            id: randomUUID(),
            createdAt: new Date().toISOString(),
            visibility,
            rollerRole: role,
            rollerId: userId,
            rollerName: socketDisplayName(socket, campaignId),
            reason: 'd20',
            die: 'd20',
            rawRoll,
            modifier: 0,
            total: rawRoll,
            actorId: null,
            actorName: null,
          }
          const nextState = appendDiceRollToState(state, roll)

          saveCampaignState(campaignId, nextState)
          emitTableDiceRoll(campaignId, {
            id: roll.id,
            rollerName: roll.rollerName,
            title: 'D20 Roll',
            total: rawRoll,
            dice: [{ sides: 20, value: rawRoll }],
          })
          broadcastState(campaignId)
          acknowledge?.({ ok: true, rawRoll })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error: error instanceof Error ? error.message : 'd20 roll failed.',
          })
        }
      },
    )

    socket.on(
      'vision:door-set-state',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(
            socket,
            'vision:door-set-state',
            rawPayload,
          )

          const campaignId =
            String(socket.data.campaignId ?? '')

          const userId =
            String(socket.data.userId ?? '')

          const role =
            socket.data.role === 'dm'
              ? 'dm'
              : 'player'

          if (!campaignId || !userId) {
            throw new Error('Join a campaign before interacting with a Door.')
          }

          const payload =
            (rawPayload ?? {}) as {
              doorId?: unknown
              state?: unknown
            }

          const doorId =
            String(payload.doorId ?? '')

          const nextDoorState: VisionDoorState | null =
            payload.state === 'open' ||
            payload.state === 'closed' ||
            payload.state === 'locked'
              ? payload.state
              : null

          if (!doorId || !nextDoorState) {
            throw new Error('Invalid Door interaction.')
          }

          if (
            role === 'player' &&
            nextDoorState === 'locked'
          ) {
            throw new Error('Players cannot lock Doors from this control.')
          }

          const state =
            stateRecord(
              loadCampaignState(campaignId),
            )

          const mapId =
            activeMapIdForState(state)

          if (!mapId) {
            throw new Error('No active Battleground.')
          }

          const settings =
            visionSettingsForMap(
              state,
              mapId,
            )

          if (!visionSettingsUsable(settings)) {
            throw new Error('Vision geometry is not active on this Battleground.')
          }

          const doorIndex =
            settings.barriers.findIndex(
              (barrier) =>
                barrier.id === doorId &&
                barrier.kind === 'door',
            )

          if (doorIndex < 0) {
            throw new Error('Door not found.')
          }

          const door =
            settings.barriers[doorIndex]

          const currentDoorState =
            door.doorState ?? 'closed'

          if (role === 'player') {
            if (
              currentDoorState === 'locked'
            ) {
              throw new Error('Door is locked.')
            }

            if (
              !playerCanInteractWithDoor(
                state,
                userId,
                door,
                settings,
                mapId,
              )
            ) {
              const combat =
                combatForState(state)

              if (
                combat.active &&
                combat.currentActorId
              ) {
                throw new Error(
                  'You can interact with a Door only when your nearby Actor has the current turn.',
                )
              }

              throw new Error('Move within 5 ft of the Door before interacting with it.')
            }
          }

          if (
            currentDoorState === nextDoorState
          ) {
            acknowledge?.({
              ok: true,
              state: currentDoorState,
            })

            return
          }

          const updatedAt =
            new Date().toISOString()

          const nextBarriers =
            settings.barriers.map(
              (barrier, index) =>
                index === doorIndex
                  ? {
                      ...barrier,
                      doorState: nextDoorState,
                    }
                  : barrier,
            )

          const nextVisionSettings: MapVisionSettings = {
            ...settings,
            runtimeVersion: 2,
            enabled: true,
            barriers: nextBarriers,
            updatedAt,
          }

          const visionByMap: VisionSettingsByMapId = {
            ...(
              state.visionByMap &&
              typeof state.visionByMap === 'object'
                ? state.visionByMap as VisionSettingsByMapId
                : {}
            ),
            [mapId]: nextVisionSettings,
          }

          let nextState: Record<string, unknown> = {
            ...state,
            visionByMap,
          }

          const actorLabel =
            role === 'dm'
              ? 'Dungeon Master'
              : socketDisplayName(
                  socket,
                  campaignId,
                )

          nextState =
            appendPublicActivity(
              nextState,
              {
                type: 'door-interaction',
                doorId,
                mapId,
                doorState: nextDoorState,
                controllerId: userId,
                controllerRole: role,
                message:
                  `${actorLabel} ${nextDoorState === 'open' ? 'opened' : nextDoorState === 'locked' ? 'locked' : 'closed'} a Door.`,
                createdAt: updatedAt,
              },
            )

          saveCampaignState(
            campaignId,
            nextState,
          )

          if (publishedMapIdForState(nextState) === mapId) {
            broadcastState(campaignId)
          } else {
            broadcastDmState(campaignId)
          }

          acknowledge?.({
            ok: true,
            state: nextDoorState,
          })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'Door interaction failed.',
          })
        }
      },
    )

    socket.on(
      'token:move',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          assertFreshMutationRequest(socket, 'token:move', rawPayload)
          const campaignId =
            String(socket.data.campaignId ?? '')

          const role =
            socket.data.role === 'dm'
              ? 'dm'
              : 'player'

          const userId =
            String(socket.data.userId ?? '')

          if (!campaignId || !userId) {
            throw new Error('Join a campaign before moving tokens.')
          }

          const payload =
            (rawPayload ?? {}) as {
              tokenId?: unknown
              gridX?: unknown
              gridY?: unknown
            }

          const tokenId =
            String(payload.tokenId ?? '')

          const rawGridX =
            Number(
              payload.gridX,
            )

          const rawGridY =
            Number(
              payload.gridY,
            )

          if (
            !tokenId ||
            !Number.isFinite(
              rawGridX,
            ) ||
            !Number.isFinite(
              rawGridY,
            )
          ) {
            throw new Error('Invalid token movement.')
          }

          const gridX =
            normalizeGridIndex(
              rawGridX,
            )

          const gridY =
            normalizeGridIndex(
              rawGridY,
            )

          const state =
            (loadCampaignState(campaignId) ?? {}) as {
              actors?: Array<{
                id?: string
                ownerId?: string | null
                speedFeet?: number
                [key: string]: unknown
              }>
              tokens?: Array<{
                id?: string
                actorId?: string
                ownerId?: string | null
                visible?: boolean
                gridX?: number
                gridY?: number
                speedFeet?: number
                movementUsedFeet?: number
                [key: string]: unknown
              }>
              allowPlayerMovement?: boolean
              combat?: unknown
              [key: string]: unknown
            }

          const actors =
            Array.isArray(state.actors)
              ? state.actors
              : []

          const tokens =
            Array.isArray(state.tokens)
              ? state.tokens
              : []

          const tokenIndex =
            tokens.findIndex((token) => token.id === tokenId)

          if (tokenIndex < 0) {
            throw new Error('Token not found.')
          }

          const token = tokens[tokenIndex]
          const actorId =
            typeof token.actorId === 'string' && token.actorId
              ? token.actorId
              : `actor-${String(token.id ?? '')}`

          const actor =
            actors.find(
              (candidate) =>
                candidate.id === actorId,
            )

          const ownerId =
            actor &&
            typeof actor.ownerId === 'string' &&
            actor.ownerId
              ? actor.ownerId
              : typeof token.ownerId === 'string' && token.ownerId
                ? token.ownerId
                : null

          const combat =
            normalizeCombatState(
              state.combat,
              actors
                .map((candidate) => String(candidate.id ?? ''))
                .filter(Boolean),
            )

          const isPlayerControlledMove = role === 'player'
          const usesCombatMovementBudget = combatMovementBudgetApplies(
            combat.active,
            combat.currentActorId,
            actorId,
          )

          if (
            isPlayerControlledMove &&
            combat.active &&
            combat.currentActorId !== actorId
          ) {
            throw new Error('This Actor cannot move because it is not their combat turn.')
          }

          const allowed =
            role === 'dm' ||
            (
              state.allowPlayerMovement === true &&
              token.visible !== false &&
              ownerId === userId
            )

          if (!allowed) {
            throw new Error('You do not control this visible token.')
          }

          if (
            movementBlockedByVision(
              state as Record<string, unknown>,
              token as Record<string, unknown>,
              gridX,
              gridY,
            )
          ) {
            throw new Error('Movement blocked by a Wall or closed Door. Move through an open route instead.')
          }

          const previousGridX = normalizeGridIndex(token.gridX)
          const previousGridY = normalizeGridIndex(token.gridY)
          const stepDistance = Math.max(
            Math.abs(gridX - previousGridX),
            Math.abs(gridY - previousGridY),
          )
          const distanceFeet = stepDistance * 5
          const normalizedMovementActor = actor && typeof actor === 'object'
            ? normalizeActor(actor as unknown as Actor)
            : null

          if (
            usesCombatMovementBudget &&
            normalizedMovementActor &&
            !actorCanTakeCombatAction(normalizedMovementActor)
          ) {
            throw new Error(`${normalizedMovementActor.name} cannot move on its turn while unconscious or Incapacitated.`)
          }

          const existingReactionWindows = reactionWindowsForState(
            state as Record<string, unknown>,
          )
          if (
            combat.active &&
            combat.currentActorId &&
            existingReactionWindows.some((window) => window.turnActorId === combat.currentActorId)
          ) {
            throw new Error('Resolve or decline the pending Reaction before continuing movement.')
          }
          if (
            normalizedMovementActor &&
            hasPendingReactionForTriggeringActor(
              existingReactionWindows,
              normalizedMovementActor.id,
            )
          ) {
            throw new Error('Resolve pending reactions before moving this Actor again.')
          }

          const baseSpeedFeet = normalizedMovementActor
            ? effectiveActorSpeed(normalizedMovementActor)
            : Math.max(0, Math.round(Number(token.speedFeet ?? 30) || 30))
          const movementEconomy = normalizedMovementActor
            ? turnEconomyForActor(state as Record<string, unknown>, normalizedMovementActor)
            : null
          const speedFeet = normalizedMovementActor && movementEconomy
            ? movementAllowanceFeet(normalizedMovementActor, movementEconomy)
            : baseSpeedFeet
          const movementUsedFeet = Math.max(0, Math.round(Number(token.movementUsedFeet) || 0))
          const isProne = normalizedMovementActor?.conditions.some(
            (condition) => condition.toLowerCase() === 'prone',
          ) === true
          const movementCostFeet = distanceFeet * (isProne ? 2 : 1)

          if (
            usesCombatMovementBudget &&
            movementUsedFeet + movementCostFeet > speedFeet
          ) {
            const remainingFeet = Math.max(0, speedFeet - movementUsedFeet)
            throw new Error(`Movement limit reached. ${remainingFeet} ft remaining${isProne ? ' while crawling' : ''}.`)
          }

          const shouldTrackMovement = usesCombatMovementBudget

          tokens[tokenIndex] = {
            ...token,
            actorId,
            gridX,
            gridY,
            movementUsedFeet:
              shouldTrackMovement
                ? movementUsedFeet + movementCostFeet
                : movementUsedFeet,
          }

          const openedReactionWindows = normalizedMovementActor
            ? opportunityReactionWindowsForMovement(
                state as Record<string, unknown>,
                normalizedMovementActor,
                token as Record<string, unknown>,
                previousGridX,
                previousGridY,
                gridX,
                gridY,
                combat,
              )
            : []

          saveCampaignState(
            campaignId,
            {
              ...state,
              tokens,
              reactionWindows: [
                ...existingReactionWindows,
                ...openedReactionWindows,
              ],
            },
          )

          broadcastState(campaignId)
          acknowledge?.({ ok: true })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'Token movement failed.',
          })
        }
      },
    )

    socket.on(
      'disconnect',
      () => {
        mutationRequestKeysBySocket.delete(socket.id)
        leaveCurrentCampaign(socket)
      },
    )
  },
)

app.use(
  (
    error: unknown,
    _request: Request,
    response: Response,
    next: NextFunction,
  ) => {
    if (
      error instanceof
        multer.MulterError
    ) {
      response
        .status(400)
        .json({
          error:
            error.code ===
              'LIMIT_FILE_SIZE'
              ? 'Map is too large. Maximum size is 100 MB.'
              : error.message,
        })

      return
    }

    if (
      error instanceof Error
    ) {
      response
        .status(400)
        .json({
          error:
            error.message,
        })

      return
    }

    next()
  },
)

if (
  fs.existsSync(
    DIST_ROOT,
  )
) {
  app.use(
    express.static(
      DIST_ROOT,
      {
        etag: false,
        maxAge: 0,
        setHeaders: (response) => {
          response.setHeader('Cache-Control', 'no-store, max-age=0')
        },
      },
    ),
  )

  app.get(
    /^\/(?!api\/|dev\/|socket\.io\/|campaign-assets\/|audio-assets\/|music-assets\/).*/,
    (_request, response) => {
      response.setHeader('Cache-Control', 'no-store, max-age=0')
      response.sendFile(
        path.join(
          DIST_ROOT,
          'index.html',
        ),
      )
    },
  )
}

const startupPersistenceAudit =
  auditPersistence()

if (!startupPersistenceAudit.ok) {
  console.error(
    '[Persistence] Startup integrity check FAILED. The server will not open a campaign on damaged storage.',
    startupPersistenceAudit,
  )

  closeStore()
  process.exit(1)
}

console.log(
  `[Persistence] Integrity check passed for ${startupPersistenceAudit.campaigns.length} campaign(s).`,
)

try {
  backupAllCriticalDatabases(
    'server-startup',
  )
  console.log(
    '[Persistence] Startup recovery backup created.',
  )
} catch (error) {
  console.error(
    '[Persistence] Startup backup FAILED. Server startup was stopped to avoid running without a recovery point.',
    error,
  )

  closeStore()
  process.exit(1)
}

httpServer.on(
  'error',
  (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `[Server] Port ${PORT} is already in use. Another VTT host may already be running.`,
      )
    } else {
      console.error(
        '[Server] HTTP server error:',
        error,
      )
    }

    process.exitCode = 1
  },
)

httpServer.listen(
  PORT,
  HOST,
  () => {
    const lanAddresses =
      getLanIPv4Addresses()

    console.log('')

    console.log(
      '========================================',
    )

    console.log(
      ' D&D WEB VTT LOCAL HOST',
    )

    console.log(
      '========================================',
    )

    console.log('')

    console.log(
      `DM URL: http://localhost:${PORT}`,
    )

    console.log(
      `TEST PAGE: http://localhost:${PORT}/dev/connect`,
    )

    console.log('')

    console.log(
      'DM authentication:',
    )

    console.log(
      '  Localhost only — no host key required.',
    )

    console.log('')

    if (
      lanAddresses.length === 0
    ) {
      console.log(
        'No LAN IPv4 address detected.',
      )
    } else {
      console.log(
        'PLAYER LAN URLS:',
      )

      for (
        const address
        of lanAddresses
      ) {
        console.log(
          `  http://${address}:${PORT}`,
        )
      }
    }

    console.log('')

    console.log(
      'Campaign data:',
    )

    console.log(
      'F:\\DND WEB VTT\\data\\campaigns',
    )

    console.log('')

    console.log(
      'Press CTRL+C to stop the host.',
    )

    console.log(
      '========================================',
    )

    console.log('')
  },
)

app.get(
  '/api/audio/manifest',
  (_request, response) => {
    const cues =
      listAudioCueStatus()

    response.json({
      cues,
      library:
        listAudioLibrary(),
      available:
        cues.filter(
          (cue) => cue.available,
        ).length,
      missing:
        cues.filter(
          (cue) => !cue.available,
        ).length,
    })
  },
)

app.get(
  '/api/music/library',
  (_request, response) => {
    const tracks =
      listMusicLibrary()

    response.json({
      tracks,
      collections:
        [...new Set(
          tracks.map(
            (track) => track.collection,
          ),
        )],
    })
  },
)

app.get(
  '/music-assets/*musicPath',
  (request, response) => {
    const rawPath =
      request.params.musicPath

    const relativePath =
      Array.isArray(rawPath)
        ? rawPath.join('/')
        : String(rawPath ?? '')

    const asset =
      resolveMusicAsset(relativePath)

    if (!asset) {
      response
        .status(404)
        .json({ error: 'Music track not found.' })

      return
    }

    response.type(asset.mimeType)
    response.sendFile(
      asset.absolutePath,
      {
        headers: {
          'Cache-Control': 'public, max-age=3600',
        },
      },
    )
  },
)

app.get(
  '/audio-assets/*audioPath',
  (request, response) => {
    const rawPath =
      request.params.audioPath

    const relativePath =
      Array.isArray(rawPath)
        ? rawPath.join('/')
        : String(rawPath ?? '')

    const absolutePath =
      resolveAudioAsset(
        relativePath,
      )

    if (!absolutePath) {
      response
        .status(404)
        .json({
          error: 'Audio asset not found.',
        })

      return
    }

    response.sendFile(
      absolutePath,
      {
        headers: {
          'Cache-Control':
            'public, max-age=3600',
        },
      },
    )
  },
)

let shutdownStarted = false

function shutdownServer(
  reason: string,
  exitCode = 0,
): void {
  if (shutdownStarted) return
  shutdownStarted = true

  console.log(
    `[Server] Shutdown requested: ${reason}`,
  )

  try {
    backupAllCriticalDatabases(
      'server-shutdown',
    )
  } catch (error) {
    console.error(
      '[Persistence] Shutdown backup failed:',
      error,
    )
  }

  let finalized = false

  const finalize = (
    forced = false,
  ) => {
    if (finalized) return
    finalized = true

    try {
      closeStore()
    } catch (error) {
      console.error(
        '[Persistence] Store close failed:',
        error,
      )
    }

    process.exit(
      forced && exitCode === 0
        ? 1
        : exitCode,
    )
  }

  const forceExit =
    setTimeout(
      () => finalize(true),
      5_000,
    )

  forceExit.unref()

  // Disconnect Socket.IO clients first so the HTTP server can drain quickly.
  io.disconnectSockets(true)

  httpServer.close(() => {
    clearTimeout(forceExit)
    finalize(false)
  })
}

process.once(
  'SIGINT',
  () => shutdownServer('SIGINT', 0),
)

process.once(
  'SIGTERM',
  () => shutdownServer('SIGTERM', 0),
)

process.once(
  'uncaughtException',
  (error) => {
    console.error(
      '[Server] Uncaught exception:',
      error,
    )
    shutdownServer('uncaughtException', 1)
  },
)

process.once(
  'unhandledRejection',
  (reason) => {
    console.error(
      '[Server] Unhandled rejection:',
      reason,
    )
    shutdownServer('unhandledRejection', 1)
  },
)
