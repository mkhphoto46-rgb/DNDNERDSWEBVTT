import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

import { createPortal } from 'react-dom'

import {
  AudioLines,
  BookOpenText,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  CloudFog,
  Compass,
  Copy,
  Crosshair,
  Footprints,
  Eye,
  Grid3X3,
  Hand,
  Hourglass,
  Image as ImageIcon,
  Layers3,
  LibraryBig,
  LogOut,
  Map as MapIcon,
  MessageSquare,
  MoreHorizontal,
  MousePointer2,
  PackagePlus,
  Pencil,
  Ruler,
  Search,
  Settings,
  Shield,
  Sparkles,
  Sun,
  Swords,
  Trash2,
  Users,
  Volume2,
  X,
} from 'lucide-react'

import './App.css'
import './styles/frozen-necropolis.css'
import './styles/frozen-necropolis-m2-8.css'

import { WorldMapViewer } from './components/WorldMapViewer'
import './components/WorldMapViewer.css'

import { VisionEditor } from './components/VisionEditor'

import {
  MapViewport,
  type ArcaneReachMode,
  type ArcaneReachPlacement,
  type ArcaneReachResult,
  type ArcaneReachSharedSigil,
  type MapViewportHandle,
} from './components/MapViewport'

import {
  InitiativePanel,
} from './components/InitiativePanel'

import {
  FloatingTurnOrder,
} from './components/FloatingTurnOrder'

import {
  ActorRoster,
} from './components/ActorRoster'

import {
  HealthPanel,
} from './components/HealthPanel'

import {
  CharacterSheetPanel,
} from './components/CharacterSheetPanel'

import {
  MonsterCompendium,
} from './components/MonsterCompendium'

import {
  SpellbookPanel,
} from './components/SpellbookPanel'

import { ContentLibrary } from './components/ContentLibrary'

import {
  PlayerSpellHud,
} from './components/PlayerSpellHud'
import { PlayerAttackHud } from './components/PlayerAttackHud'
import { PlayerCharacterHud } from './components/PlayerCharacterHud'
import { ReactionWindowPanel } from './components/ReactionWindowPanel'
import { CoreUtilityActionsPanel, type UtilityActionRequest } from './components/CoreUtilityActionsPanel'
import { ReadyActionPanel, type ReadyActionPrepareRequest } from './components/ReadyActionPanel'
import { ReadyActionStatusPanel } from './components/ReadyActionStatusPanel'

import {
  PlayerSpellbookPanel,
} from './components/PlayerSpellbookPanel'

import {
  TargetEffectsPanel,
  type TargetEffectDraft,
} from './components/TargetEffectsPanel'

import {
  socket,
} from './lib/socket'

import {
  actorForToken,
  createFreshActorFromAsset,
  migrateActorState,
  nextActorName,
  normalizeActor,
} from './lib/actors'
import {
  cancelActorShortRest,
  closeActorLongRestChanges,
  completeActorLongRest,
  finishActorShortRest,
  hitDieSidesForClass,
  startActorShortRest,
} from './lib/restRuntime'

import {
  createFreshSceneTokenInstance,
  tokenAssetFromActorPortrait,
  tokenMovementSummary,
} from './lib/tokenInstances'

import {
  createActorFromMonsterTemplate,
} from './lib/monsterActors'

import {
  normalizeCombatState,
} from './lib/combat'

import {
  normalizeDiceLog,
  normalizeGenericDiceActivity,
  type GenericDicePurpose,
} from './lib/dice'

import {
  attackDicePresentation,
  DEFAULT_DICE_THEME,
  genericDicePresentation,
  normalizeDiceThemeCatalog,
  spellDicePresentation,
  tableDicePresentation,
} from './lib/diceVisuals'

import {
  normalizeHealthLog,
  type AppliedDamageType,
  type HealthLogEntry,
  type HealthOperation,
  type HealthResolution,
} from './lib/damage'

import {
  spellById,
} from './lib/characterRulesCatalog'

import {
  levelForXp,
} from './lib/progression'

import {
  effectiveActorSpeed,
} from './lib/effects'

import {
  needsDeathSave,
  type DeathSaveResolution,
} from './lib/death'

import {
  initialiseSfx,
  playDiceSfx,
  playHealthSfx,
  playSfx,
  setSfxEnabled,
} from './lib/audioManager'

import {
  type Actor,
  type ActorAbility,
  type CharacterSkill,
} from './types/actor'

import type { AttackResolution } from './types/combatActions'
import type { ReactionDecision, ReactionWindow } from './types/reaction'
import type { ReadiedAction } from './types/readyAction'

import {
  type MonsterTemplate,
} from './types/compendium'

import {
  type CombatState,
} from './types/combat'
import type {
  TurnEconomyByActorId,
  TurnEconomyOverridePatch,
} from './types/actionEconomy'

import {
  movementAllowanceFeet,
  normalizeTurnEconomy,
} from './lib/actionEconomy'

import {
  spellHasAutomatedRule,
  spellRuleLabel,
  spellTargetRule,
  type SpellTargetRule,
} from './lib/spellAutomation'

import {
  type DiceRollEntry,
} from './types/dice'
import type {
  DiceRollPresentation,
  DiceThemeCatalog,
  DiceThemeDefinition,
} from './types/diceVisuals'

import {
  DEFAULT_GRID_SETTINGS,
  type GridSettings,
  type MapAsset,
  type MapSettingsByAssetId,
  type MapVisionSettings,
  type PlayerVisionRuntime,
  normalizeGridSettings,
  normalizeMapVisionSettings,
  type SceneMapAsset,
  type RenderableSceneToken,
  type SceneToken,
  type TargetSelection,
  type TokenAsset,
  type VisionDoorInteraction,
  type VisionDoorState,
  type VisionSettingsByMapId,
} from './types/scene'

import './styles/muted-glacier-v1.css'
import './styles/reference-command-ui.css'

type Role = 'dm' | 'player'
type InspectorTab = 'party' | 'health' | 'grid' | 'maps' | 'vision' | 'compendium' | 'library' | 'actors' | 'tokens' | 'session'
type ToolMode = 'select' | 'pan'
type NoticeTone = 'info' | 'success' | 'error' | 'connection'

interface NoticeOptions {
  tone?: NoticeTone
  durationMs?: number
  sticky?: boolean
  bypassDedupe?: boolean
}

const NOTICE_DEDUPE_WINDOW_MS = 8000
const NOTICE_DEFAULT_DURATION_MS = 4200
const NOTICE_ERROR_DURATION_MS = 6500
const NOTICE_RECONNECTED_DURATION_MS = 2600

interface Campaign {
  id: string
  name: string
  joinCode?: string
}

interface SessionRecord {
  id: string
  number: number
  startedAt: string
  endedAt: string | null
}

interface PlayerRecord {
  id: string
  name: string
  createdAt: string
  lastSeenAt: string
}

interface PresenceUser {
  id: string
  name: string
  role: Role
}

interface SnapshotRecord {
  id: string
  name: string
  createdAt: string
}

interface CampaignArcaneReachSigil extends ArcaneReachPlacement {
  controllerId: string
  role: Role
  mapId: string
  updatedAt: string
}

interface CampaignState {
  version?: number
  stateRevision?: number
  activeMap?: SceneMapAsset | null
  publishedMap?: SceneMapAsset | null
  worldMap?: SceneMapAsset | null
  mapSettings?: MapSettingsByAssetId
  mapNames?: Record<string, string>
  visionByMap?: VisionSettingsByMapId
  visionRuntime?: PlayerVisionRuntime
  playerColors?: Record<string, string>
  arcaneReachSigils?: Record<string, CampaignArcaneReachSigil>
  activeSceneId?: string | null
  actors?: Actor[]
  tokens?: SceneToken[]
  allowPlayerMovement?: boolean
  combat?: CombatState
  diceLog?: DiceRollEntry[]
  healthLog?: HealthLogEntry[]
  lastAction?: unknown
  activityLog?: unknown[]
  targetSelections?: TargetSelection[]
  turnEconomy?: TurnEconomyByActorId
  reactionWindows?: ReactionWindow[]
  readyActions?: ReadiedAction[]
  devNote?: string
  [key: string]: unknown
}

interface PendingSpellCast {
  actorId: string
  spellId: string
  spellName: string
  castLevel: number
  rule: SpellTargetRule
}

interface TargetAreaPoint {
  gridX: number
  gridY: number
}

interface JoinResult {
  ok: boolean
  error?: string
  campaign?: Campaign
  activeSession?: SessionRecord | null
  state?: CampaignState
  maps?: MapAsset[]
  snapshots?: SnapshotRecord[]
  players?: PlayerRecord[]
  bannedPlayers?: PlayerRecord[]
  player?: PlayerRecord
  resumed?: boolean
  characterCreated?: boolean
  characterRestored?: boolean
  characterActorId?: string
}

const PLAYER_KEY_STORAGE = 'dnd_vtt_player_key_v1'
const PLAYER_NAME_STORAGE = 'dnd_vtt_player_name_v1'
const JOIN_CODE_STORAGE = 'dnd_vtt_join_code_v1'
const DM_CAMPAIGN_STORAGE = 'dnd_vtt_dm_campaign_v1'
const DICE_THEME_STORAGE = 'dnd_vtt_dice_theme_v1'
const GRID_SAVE_DELAY_MS = 350
const DEFAULT_TOKEN_COLOR = '#C9954B'
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

function normalizeTokenColor(
  value: unknown,
  fallback = DEFAULT_TOKEN_COLOR,
): string {
  const candidate = String(value ?? '').trim()

  return /^#[0-9a-f]{6}$/i.test(candidate)
    ? candidate.toUpperCase()
    : fallback
}

function defaultPlayerColor(playerId: string): string {
  let hash = 0

  for (let index = 0; index < playerId.length; index += 1) {
    hash = ((hash << 5) - hash + playerId.charCodeAt(index)) | 0
  }

  return PLAYER_COLOR_PALETTE[Math.abs(hash) % PLAYER_COLOR_PALETTE.length]
}

function friendlyMapName(value: string): string {
  const withoutExtension =
    value
      .replace(/\.(png|jpe?g|webp)$/i, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  return withoutExtension || 'Map'
}

interface TableRollTicker {
  id: string
  createdAt: string
  text: string
}

function formatElapsed(startedAt: string, now: number): string {
  const started = Date.parse(startedAt)
  const seconds = Number.isFinite(started)
    ? Math.max(0, Math.floor((now - started) / 1000))
    : 0
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return [hours, minutes, remainder]
    .map((value) => String(value).padStart(2, '0'))
    .join(':')
}

function SessionElapsed({ session }: { session: SessionRecord | null }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!session) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [session])

  return <>{session ? formatElapsed(session.startedAt, now) : '00:00:00'}</>
}

const CHARACTER_SKILL_OPTIONS: Array<[CharacterSkill, string]> = [
  ['acrobatics', 'Acrobatics'],
  ['animalHandling', 'Animal Handling'],
  ['arcana', 'Arcana'],
  ['athletics', 'Athletics'],
  ['deception', 'Deception'],
  ['history', 'History'],
  ['insight', 'Insight'],
  ['intimidation', 'Intimidation'],
  ['investigation', 'Investigation'],
  ['medicine', 'Medicine'],
  ['nature', 'Nature'],
  ['perception', 'Perception'],
  ['performance', 'Performance'],
  ['persuasion', 'Persuasion'],
  ['religion', 'Religion'],
  ['sleightOfHand', 'Sleight of Hand'],
  ['stealth', 'Stealth'],
  ['survival', 'Survival'],
]

function signedRollModifier(value: number): string {
  if (value === 0) return ''
  return value > 0 ? ` +${value}` : ` ${value}`
}

function recentPublicTableRolls(state: CampaignState): TableRollTicker[] {
  const candidates: TableRollTicker[] = []

  for (const rawActivity of state.activityLog ?? []) {
    const activity = normalizeGenericDiceActivity(rawActivity)
    if (!activity || activity.visibility !== 'public') continue
    const dieLabel = activity.sides === 100 ? 'd%' : `d${activity.sides}`
    candidates.push({
      id: activity.id,
      createdAt: activity.createdAt,
      text: `${activity.rollerName} rolled ${activity.count}${dieLabel}${signedRollModifier(activity.modifier)}: ${activity.total}`,
    })
  }

  for (const roll of normalizeDiceLog(state.diceLog)) {
    if (roll.visibility !== 'public') continue
    const reason = roll.reason === 'initiative'
      ? 'initiative'
      : roll.reason === 'death-save'
        ? 'a death save'
        : roll.reason === 'concentration'
          ? 'concentration'
          : 'd20'
    candidates.push({
      id: roll.id,
      createdAt: roll.createdAt,
      text: `${roll.actorName ?? roll.rollerName} rolled ${reason}: ${roll.total}`,
    })
  }

  return candidates
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 5)
}

function createClientUuid(): string {
  const cryptoApi = window.crypto

  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    try {
      return cryptoApi.randomUUID()
    } catch {
      // Some browser/network contexts expose crypto but do not permit randomUUID.
    }
  }

  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    cryptoApi.getRandomValues(bytes)

    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80

    const hex = Array.from(
      bytes,
      (value) => value.toString(16).padStart(2, '0'),
    )

    return [
      hex.slice(0, 4).join(''),
      hex.slice(4, 6).join(''),
      hex.slice(6, 8).join(''),
      hex.slice(8, 10).join(''),
      hex.slice(10, 16).join(''),
    ].join('-')
  }

  return [
    'fallback',
    Date.now().toString(36),
    Math.random().toString(36).slice(2, 10),
    Math.random().toString(36).slice(2, 10),
  ].join('-')
}

function getOrCreatePlayerKey(): string {
  let key = localStorage.getItem(PLAYER_KEY_STORAGE)
  if (key) return key

  key = createClientUuid()

  localStorage.setItem(PLAYER_KEY_STORAGE, key)
  return key
}

async function requestJson<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(url, options)
  let body: unknown = null

  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (!response.ok) {
    const message =
      body &&
      typeof body === 'object' &&
      'error' in body
        ? String((body as { error: unknown }).error)
        : 'Request failed.'

    throw new Error(message)
  }

  return body as T
}

function readGridFromState(state: CampaignState): GridSettings {
  const activeMap = state.activeMap
  if (!activeMap) return { ...DEFAULT_GRID_SETTINGS }

  if (activeMap.grid) {
    return normalizeGridSettings(activeMap.grid)
  }

  return normalizeGridSettings(state.mapSettings?.[activeMap.id])
}

function gridDistanceFeet(
  left: Pick<SceneToken, 'gridX' | 'gridY'>,
  right: Pick<SceneToken, 'gridX' | 'gridY'>,
): number {
  return Math.max(
    Math.abs(left.gridX - right.gridX),
    Math.abs(left.gridY - right.gridY),
  ) * 5
}

function pointDistanceFeet(
  token: Pick<SceneToken, 'gridX' | 'gridY'>,
  point: TargetAreaPoint,
): number {
  return Math.max(
    Math.abs(token.gridX - point.gridX),
    Math.abs(token.gridY - point.gridY),
  ) * 5
}

function hydrateActiveMapGrid(state: CampaignState): CampaignState {
  const migrated =
    migrateActorState(
      state.actors,
      state.tokens,
    )

  const combat =
    normalizeCombatState(
      state.combat,
      migrated.actors.map((actor) => actor.id),
    )

  if (!state.activeMap) {
    return {
      ...state,
      actors: migrated.actors,
      tokens: migrated.tokens,
      combat,
      diceLog: normalizeDiceLog(state.diceLog),
      healthLog: normalizeHealthLog(state.healthLog),
    }
  }

  return {
    ...state,
    actors: migrated.actors,
    tokens: migrated.tokens,
    combat,
    diceLog: normalizeDiceLog(state.diceLog),
    healthLog: normalizeHealthLog(state.healthLog),
    activeMap: {
      ...state.activeMap,
      grid: readGridFromState(state),
    },
  }
}

function resolveRenderableToken(
  token: SceneToken,
  actors: Actor[] | undefined,
  targetSelections: TargetSelection[] = [],
  currentControllerId = '',
  currentRole: Role | null = null,
): RenderableSceneToken | null {
  const actor =
    actorForToken(
      actors,
      token,
    )

  if (!actor) {
    return null
  }

  const targeting = targetSelections.filter(
    (selection) => (selection.targetActorIds?.length ? selection.targetActorIds : [selection.targetActorId]).includes(actor.id),
  )

  return {
    ...token,
    name: actor.name,
    ownerId: actor.ownerId,
    level: actor.level,
    speedFeet: effectiveActorSpeed(actor),
    currentHp: actor.currentHp,
    maxHp: actor.maxHp,
    tempHp: actor.tempHp,
    lifeState: actor.lifeState,
    conditions: actor.conditions ?? [],
    effects: actor.effects ?? [],
    targetedByActorIds: targeting
      .map((selection) => selection.sourceActorId)
      .filter((actorId): actorId is string => Boolean(actorId)),
    targetedByControllerIds: targeting.map((selection) => selection.controllerId),
    targetedByMe: targeting.some(
      (selection) =>
        currentRole === 'dm'
          ? selection.role === 'dm'
          : Boolean(currentControllerId) && selection.controllerId === currentControllerId,
    ),
  }
}

function emitSocketRequest(
  eventName: string,
  payload: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let settled = false

    if (!socket.connected) {
      reject(
        new Error(
          'Connection to the VTT server is unavailable. Reconnecting…',
        ),
      )
      return
    }

    const timeoutId = window.setTimeout(() => {
      if (settled) return
      settled = true
      reject(
        new Error(
          'The server did not confirm this action in time. Check your connection and try again.',
        ),
      )
    }, 5000)

    const requestPayload = {
      ...payload,
      _requestId:
        typeof payload._requestId === 'string' && payload._requestId
          ? payload._requestId
          : createClientUuid(),
    }

    socket.emit(
      eventName,
      requestPayload,
      (rawResult: unknown) => {
        if (settled) return
        settled = true
        window.clearTimeout(timeoutId)

        const result =
          rawResult && typeof rawResult === 'object'
            ? rawResult as Record<string, unknown>
            : {}

        if (result.ok === true) {
          resolve(result)
          return
        }

        reject(
          new Error(
            typeof result.error === 'string'
              ? result.error
              : 'The combat action was rejected.',
          ),
        )
      },
    )
  })
}

function App() {
  const [accessMode, setAccessMode] = useState<'loading' | 'host' | 'player'>('loading')
  const [role, setRole] = useState<Role | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [currentCampaign, setCurrentCampaign] = useState<Campaign | null>(null)
  const [gameState, setGameState] = useState<CampaignState>({})
  const [activeSession, setActiveSession] = useState<SessionRecord | null>(null)
  const [presence, setPresence] = useState<PresenceUser[]>([])
  const [campaignPlayers, setCampaignPlayers] = useState<PlayerRecord[]>([])
  const [bannedPlayers, setBannedPlayers] = useState<PlayerRecord[]>([])
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(null)
  const [maps, setMaps] = useState<MapAsset[]>([])
  const [worldMapOpen, setWorldMapOpen] = useState(false)
  const [onlineRosterOpen, setOnlineRosterOpen] = useState(false)
  const [tokenAssets, setTokenAssets] = useState<TokenAsset[]>([])
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([])
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('actors')
  const [dmInspectorExpanded, setDmInspectorExpanded] = useState(false)
  const [toolMode, setToolMode] = useState<ToolMode>('pan')
  const [arcaneReachOpen, setArcaneReachOpen] = useState(false)
  const [arcaneReachMode, setArcaneReachMode] = useState<ArcaneReachMode>('measure')
  const [arcaneReachResult, setArcaneReachResult] = useState<ArcaneReachResult | null>(null)
  const [cameraZoom, setCameraZoom] = useState(1)
  const [statusMessage, setStatusMessageState] = useState('')
  const [statusTone, setStatusTone] = useState<NoticeTone>('info')
  const [diceTrayOpen, setDiceTrayOpen] = useState(false)
  const [diceRollQueue, setDiceRollQueue] = useState<DiceRollPresentation[]>([])
  const [diceThemeCatalog, setDiceThemeCatalog] = useState<DiceThemeCatalog>({
    defaultThemeId: DEFAULT_DICE_THEME.id,
    themes: [DEFAULT_DICE_THEME],
  })
  const [diceThemeId, setDiceThemeId] = useState(
    () => localStorage.getItem(DICE_THEME_STORAGE) ?? DEFAULT_DICE_THEME.id,
  )
  const [diceCount, setDiceCount] = useState(1)
  const [dicePurpose, setDicePurpose] = useState<GenericDicePurpose>('other')
  const [diceSaveAbility, setDiceSaveAbility] = useState<ActorAbility>('dexterity')
  const [diceSkill, setDiceSkill] = useState<CharacterSkill>('perception')
  const [utilityActionsOpen, setUtilityActionsOpen] = useState(false)
  const [readyActionOpen, setReadyActionOpen] = useState(false)
  const [newCampaignName, setNewCampaignName] = useState('')
  const [playerName, setPlayerName] = useState(
    () => localStorage.getItem(PLAYER_NAME_STORAGE) ?? '',
  )
  const [joinCode, setJoinCode] = useState(
    () => localStorage.getItem(JOIN_CODE_STORAGE) ?? '',
  )
  const [cellSizeDraft, setCellSizeDraft] = useState('')
  const [pendingTokenAssetId, setPendingTokenAssetId] = useState<string | null>(null)
  const [pendingActorId, setPendingActorId] = useState<string | null>(null)
  const [showTokenLayer, setShowTokenLayer] = useState(true)
  const [tokenSfxEnabled, setTokenSfxEnabled] = useState(true)
  const [playerSheetOpen, setPlayerSheetOpen] = useState(false)
  const [playerSpellHudOpen, setPlayerSpellHudOpen] = useState(false)
  const [playerCharacterHudOpen, setPlayerCharacterHudOpen] = useState(false)
  const [playerAttackHudOpen, setPlayerAttackHudOpen] = useState(false)
  const [deathSaveBusy, setDeathSaveBusy] = useState(false)
  const [playerSpellbookOpen, setPlayerSpellbookOpen] = useState(false)
  const [playerSpellbookTargetId, setPlayerSpellbookTargetId] = useState('')
  const [dmSheetActorId, setDmSheetActorId] = useState<string | null>(null)
  const [hoveredToken, setHoveredToken] = useState<RenderableSceneToken | null>(null)
  const [healthTargetActorId, setHealthTargetActorId] = useState<string>('')
  const [dmSpellbookOpen, setDmSpellbookOpen] = useState(false)
  const [dmSpellbookTargetId, setDmSpellbookTargetId] = useState('')
  const [playerTokenPlacementArmed, setPlayerTokenPlacementArmed] = useState(false)
  const [dmEffectSourceActorId, setDmEffectSourceActorId] = useState('')
  const [partyXpGrantDraft, setPartyXpGrantDraft] = useState('')
  const [restPopupOpen, setRestPopupOpen] = useState(false)
  const [restSelectedActorIds, setRestSelectedActorIds] = useState<string[] | null>(null)
  const [shortRestHitDieBusy, setShortRestHitDieBusy] = useState(false)
  const [shortRestHitDieResult, setShortRestHitDieResult] = useState('')
  const [renamingMapId, setRenamingMapId] = useState<string | null>(null)
  const [mapRenameDraft, setMapRenameDraft] = useState('')
  const [visionEditorMapId, setVisionEditorMapId] = useState<string | null>(null)
  const [dmVisionPreviewPlayerId, setDmVisionPreviewPlayerId] = useState('')
  const [dmVisionPreview, setDmVisionPreview] = useState<{
    playerId: string
    runtime: PlayerVisionRuntime
    visibleActorIds: string[]
  } | null>(null)
  const [pendingSpellCast, setPendingSpellCast] = useState<PendingSpellCast | null>(null)
  const [targetAreaPoint, setTargetAreaPoint] = useState<TargetAreaPoint | null>(null)

  useEffect(() => {
    setRestPopupOpen(false)
    setRestSelectedActorIds(null)
  }, [currentCampaign?.id])

  useEffect(() => {
    if (role !== 'dm') setRestPopupOpen(false)
  }, [role])

  const gameStateRef = useRef<CampaignState>({})
  const gridSaveTimerRef = useRef<number | null>(null)
  const stateSaveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const mapViewportRef = useRef<MapViewportHandle>(null)
  const mapFileInput = useRef<HTMLInputElement>(null)
  const tokenFileInput = useRef<HTMLInputElement>(null)
  const tokenAssetDragRef = useRef<string | null>(null)
  const noticeDismissTimerRef = useRef<number | null>(null)
  const noticeLastShownRef = useRef<Map<string, number>>(new Map())
  const socketHadDisconnectRef = useRef(false)
  const seenDiceRollIdsRef = useRef<Set<string>>(new Set())

  const selectedDiceTheme: DiceThemeDefinition =
    diceThemeCatalog.themes.find((theme) => theme.id === diceThemeId) ??
    diceThemeCatalog.themes.find((theme) => theme.id === diceThemeCatalog.defaultThemeId) ??
    DEFAULT_DICE_THEME

  const enqueueDiceRoll = useCallback((roll: DiceRollPresentation | null) => {
    if (!roll || seenDiceRollIdsRef.current.has(roll.id)) return
    seenDiceRollIdsRef.current.add(roll.id)
    if (seenDiceRollIdsRef.current.size > 100) {
      const firstId = seenDiceRollIdsRef.current.values().next().value
      if (typeof firstId === 'string') seenDiceRollIdsRef.current.delete(firstId)
    }
    setDiceRollQueue((current) => [...current.slice(-4), roll])
  }, [])

  const completeDiceRoll = useCallback((rollId: string) => {
    setDiceRollQueue((current) =>
      current[0]?.id === rollId
        ? current.slice(1)
        : current.filter((roll) => roll.id !== rollId),
    )
  }, [])

  const showStatusMessage = (
    message: string,
    options: NoticeOptions = {},
  ) => {
    const nextMessage = message.trim()

    if (!nextMessage) {
      if (noticeDismissTimerRef.current !== null) {
        window.clearTimeout(noticeDismissTimerRef.current)
        noticeDismissTimerRef.current = null
      }

      setStatusMessageState('')
      return
    }

    const now = Date.now()
    const dedupeKey = nextMessage.toLocaleLowerCase()
    const previousShownAt = noticeLastShownRef.current.get(dedupeKey) ?? 0

    if (
      !options.bypassDedupe &&
      now - previousShownAt < NOTICE_DEDUPE_WINDOW_MS
    ) {
      return
    }

    noticeLastShownRef.current.set(dedupeKey, now)

    if (noticeLastShownRef.current.size > 40) {
      for (const [key, shownAt] of noticeLastShownRef.current) {
        if (now - shownAt > NOTICE_DEDUPE_WINDOW_MS * 4) {
          noticeLastShownRef.current.delete(key)
        }
      }
    }

    const inferredTone: NoticeTone =
      options.tone ??
      (
        /failed|error|could not|cannot|can't|rejected|did not|unavailable|timed out|timeout|must|locked/i.test(nextMessage)
          ? 'error'
          : /restored|saved|created|updated|started|ended|rolled|placed|active|welcome back/i.test(nextMessage)
            ? 'success'
            : 'info'
      )

    if (noticeDismissTimerRef.current !== null) {
      window.clearTimeout(noticeDismissTimerRef.current)
      noticeDismissTimerRef.current = null
    }

    setStatusTone(inferredTone)
    setStatusMessageState(nextMessage)

    if (options.sticky) {
      return
    }

    const durationMs =
      options.durationMs ??
      (
        inferredTone === 'error'
          ? NOTICE_ERROR_DURATION_MS
          : NOTICE_DEFAULT_DURATION_MS
      )

    noticeDismissTimerRef.current = window.setTimeout(() => {
      noticeDismissTimerRef.current = null
      setStatusMessageState('')
    }, durationMs)
  }

  const setStatusMessage = (message: string) => {
    showStatusMessage(message)
  }

  const isDm = role === 'dm'
  const restPlayerActors = isDm
    ? (gameState.actors ?? []).filter((actor) => actor.kind === 'player' && actor.ownerId && actor.characterSheet)
    : []
  const selectedRestPlayerActors = restSelectedActorIds === null
    ? restPlayerActors
    : restPlayerActors.filter((actor) => restSelectedActorIds.includes(actor.id))
  const restShortActiveCount = selectedRestPlayerActors.filter((actor) => actor.characterSheet?.shortRestActive).length
  const restLongChangeWindowCount = selectedRestPlayerActors.filter((actor) => actor.characterSheet?.spellLongRestActive).length
  const restCanStartShortCount = selectedRestPlayerActors.filter((actor) => actor.currentHp >= 1 && !actor.characterSheet?.shortRestActive).length
  const restCanCompleteLongCount = selectedRestPlayerActors.filter((actor) => actor.currentHp >= 1 && !actor.characterSheet?.spellLongRestActive).length
  const recentTableRolls = recentPublicTableRolls(gameState)
  const activePlayerIds = new Set(
    presence
      .filter((user) => user.role === 'player')
      .map((user) => user.id),
  )
  const initiativePlayers = campaignPlayers.map((player) => ({
    id: player.id,
    name: player.name,
    connected: activePlayerIds.has(player.id),
  }))
  const activeMap = gameState.activeMap ?? null
  const publishedMap = gameState.publishedMap ?? activeMap ?? null
  const worldMap = gameState.worldMap ?? null
  const grid = readGridFromState(gameState)
  const combat = normalizeCombatState(
    gameState.combat,
    (gameState.actors ?? []).map((actor) => actor.id),
  )
  const ownCharacter =
    !isDm && currentPlayerId
      ? (gameState.actors ?? []).find(
          (actor) =>
            actor.kind === 'player' &&
            actor.ownerId === currentPlayerId,
        ) ?? null
      : null
  const ownShortRestHitDieSides = hitDieSidesForClass(ownCharacter?.characterSheet?.className ?? '')
  const ownShortRestTotalHitDice = ownCharacter ? Math.max(1, Math.min(20, ownCharacter.level)) : 0
  const ownShortRestRemainingHitDice = ownCharacter?.characterSheet
    ? Math.max(0, ownShortRestTotalHitDice - ownCharacter.characterSheet.hitDiceSpent)
    : 0

  useEffect(() => {
    if (!ownCharacter?.characterSheet?.shortRestActive) setShortRestHitDieResult('')
  }, [ownCharacter?.id, ownCharacter?.characterSheet?.shortRestActive])

  const targetSelections = Array.isArray(gameState.targetSelections)
    ? gameState.targetSelections
    : []
  const currentTargetSelection = isDm
    ? targetSelections.find((selection) => selection.role === 'dm') ?? null
    : currentPlayerId
      ? targetSelections.find((selection) => selection.controllerId === currentPlayerId) ?? null
      : null
  const currentTargetActorIds = currentTargetSelection
    ? (currentTargetSelection.targetActorIds?.length
        ? currentTargetSelection.targetActorIds
        : [currentTargetSelection.targetActorId])
    : []
  const currentTargetActors = currentTargetActorIds
    .map((actorId) => (gameState.actors ?? []).find((actor) => actor.id === actorId) ?? null)
    .filter((actor): actor is Actor => actor !== null)
  const currentTargetActor = currentTargetActors[0] ?? null
  const activeMapActors = activeMap
    ? (gameState.actors ?? []).filter((candidate) =>
        (gameState.tokens ?? []).some((token) =>
          token.actorId === candidate.id &&
          token.mapId === activeMap.id &&
          token.visible,
        ),
      )
    : []
  const readiedActions = Array.isArray(gameState.readyActions)
    ? gameState.readyActions
    : []
  const visibleReadiedActions = isDm
    ? readiedActions
    : ownCharacter
      ? readiedActions.filter((ready) => ready.actorId === ownCharacter.id)
      : []

  const reactionWindows = Array.isArray(gameState.reactionWindows)
    ? gameState.reactionWindows
    : []
  const activeReactionWindow = isDm
    ? reactionWindows.find((window) => {
        const reactor = (gameState.actors ?? []).find((actor) => actor.id === window.reactorActorId)
        return Boolean(reactor && !(reactor.kind === 'player' && reactor.ownerId))
      }) ?? null
    : ownCharacter
      ? reactionWindows.find((window) => window.reactorActorId === ownCharacter.id) ?? null
      : null
  const reactionReactor = activeReactionWindow
    ? (gameState.actors ?? []).find((actor) => actor.id === activeReactionWindow.reactorActorId) ?? null
    : null
  const reactionTriggerActor = activeReactionWindow?.kind === 'opportunity-attack'
    ? (gameState.actors ?? []).find((actor) => actor.id === activeReactionWindow.triggeringActorId) ?? null
    : null

  const activeTurnActor = combat.currentActorId
    ? (gameState.actors ?? []).find((actor) => actor.id === combat.currentActorId) ?? null
    : null
  const combatHudActor = isDm
    ? activeTurnActor
      ?? (gameState.actors ?? []).find((actor) => actor.id === dmEffectSourceActorId)
      ?? null
    : ownCharacter
  const hudActor = ownCharacter
    ?? activeTurnActor
    ?? (gameState.actors ?? []).find((actor) => actor.kind === 'player')
    ?? null
  const activeTurnEconomy = activeTurnActor
    ? normalizeTurnEconomy(gameState.turnEconomy?.[activeTurnActor.id], activeTurnActor)
    : null
  const ownTurnIsCurrent = Boolean(
    ownCharacter &&
    (
      !combat.active ||
      combat.currentActorId === ownCharacter.id
    ),
  )
  const ownNeedsDeathSave = Boolean(
    ownCharacter &&
    needsDeathSave(ownCharacter),
  )
  const ownDeathSaveTurnActive = Boolean(
    ownCharacter &&
    combat.active &&
    combat.currentActorId === ownCharacter.id,
  )
  const ownDeathSaveRolledThisRound = Boolean(
    ownCharacter &&
    combat.active &&
    ownCharacter.lastDeathSaveRound === combat.round,
  )
  const playerCanUseTurnActions = Boolean(
    ownCharacter &&
    ownCharacter.lifeState === 'conscious' &&
    ownTurnIsCurrent,
  )
  const activeTurnToken = activeTurnActor && activeMap
    ? (gameState.tokens ?? []).find((token) => token.actorId === activeTurnActor.id && token.mapId === activeMap.id && token.visible) ?? null
    : null
  const activeTurnMovementRemainingFeet = activeTurnActor && activeTurnEconomy
    ? Math.max(
        0,
        movementAllowanceFeet(activeTurnActor, activeTurnEconomy) -
          Math.max(0, Math.round(activeTurnToken?.movementUsedFeet ?? 0)),
      )
    : null
  const turnHudInteractive = Boolean(
    activeTurnActor &&
    (isDm || activeTurnActor.ownerId === currentPlayerId),
  )

  const ownTokenOnActiveMap =
    ownCharacter && activeMap
      ? (gameState.tokens ?? []).find(
          (token) =>
            token.actorId === ownCharacter.id &&
            token.mapId === activeMap.id &&
            token.visible,
        ) ?? null
      : null

  const ownTokenMovementAllowed = Boolean(
    ownCharacter &&
    ownTokenOnActiveMap &&
    gameState.allowPlayerMovement === true &&
    ownCharacter.lifeState === 'conscious' &&
    (
      !combat.active ||
      combat.currentActorId === ownCharacter.id
    ),
  )

  const pendingSpellValidTargetActorIds = (() => {
    if (!pendingSpellCast || !activeMap) return [] as string[]
    const rule = pendingSpellCast.rule
    if (rule.mode === 'self') return [pendingSpellCast.actorId]
    const sourceToken = (gameState.tokens ?? []).find(
      (token) => token.actorId === pendingSpellCast.actorId && token.mapId === activeMap.id && token.visible,
    )
    if (!sourceToken) return []

    return (gameState.tokens ?? [])
      .filter((token) => token.mapId === activeMap.id && token.visible)
      .filter((token) => {
        if (rule.mode === 'point-area') {
          return Boolean(
            targetAreaPoint &&
            rule.radiusFeet !== null &&
            pointDistanceFeet(token, targetAreaPoint) <= rule.radiusFeet
          )
        }
        if (rule.mode === 'self-area') {
          return rule.radiusFeet !== null && gridDistanceFeet(sourceToken, token) <= rule.radiusFeet
        }
        return rule.rangeFeet === null || gridDistanceFeet(sourceToken, token) <= rule.rangeFeet
      })
      .map((token) => token.actorId)
  })()

  const canRollOwnDeathSave = Boolean(
    ownCharacter &&
    ownCharacter.deathRules === 'character' &&
    ownCharacter.currentHp === 0 &&
    ownCharacter.lifeState === 'unconscious' &&
    combat.phase === 'active' &&
    combat.currentActorId === ownCharacter.id &&
    ownCharacter.lastDeathSaveRound !== combat.round,
  )

  const dmSheetActor =
    isDm && dmSheetActorId
      ? (gameState.actors ?? []).find(
          (actor) => actor.id === dmSheetActorId && actor.kind === 'player',
        ) ?? null
      : null

  const getPlayerColor = (playerId: string): string =>
    normalizeTokenColor(
      gameStateRef.current.playerColors?.[playerId],
      defaultPlayerColor(playerId),
    )

  const arcaneReachControllerId =
    isDm
      ? 'dm'
      : currentPlayerId ?? ''

  const arcaneReachColor =
    !isDm && currentPlayerId
      ? getPlayerColor(currentPlayerId)
      : '#78B8C8'

  const sharedArcaneReachSigils: ArcaneReachSharedSigil[] =
    Object.values(
      gameState.arcaneReachSigils ?? {},
    )
      .filter(
        (sigil) =>
          Boolean(
            sigil &&
            sigil.controllerId &&
            sigil.mapId,
          ),
      )
      .map((sigil) => ({
        controllerId:
          sigil.controllerId,
        role:
          sigil.role,
        mapId:
          sigil.mapId,
        mode:
          sigil.mode,
        start:
          sigil.start,
        end:
          sigil.end,
        color:
          sigil.role === 'player'
            ? normalizeTokenColor(
                gameState.playerColors?.[sigil.controllerId],
                defaultPlayerColor(sigil.controllerId),
              )
            : '#78B8C8',
      }))

  const allowPlayerSeatRecovery = async (
    playerId: string,
    playerName: string,
  ) => {
    if (!isDm) return

    try {
      const result = await emitSocketRequest(
        'player:allow-seat-recovery',
        { playerId },
      )

      const seconds =
        Number(result.expiresInSeconds ?? 300)

      setStatusMessage(
        `${playerName} can rejoin from a new remote browser for the next ${Math.max(1, Math.round(seconds / 60))} minute(s).`,
      )
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Could not enable Player seat recovery.',
      )
    }
  }

  const kickPlayerFromCampaign = async (
    playerId: string,
    playerName: string,
  ) => {
    if (!isDm) return

    const confirmed = window.confirm(
      `Kick ${playerName} from this campaign? Their character is preserved and they can rejoin later.`,
    )

    if (!confirmed) return

    try {
      await emitSocketRequest(
        'player:kick',
        { playerId },
      )

      setCampaignPlayers((current) =>
        current.filter((player) => player.id !== playerId),
      )
      setPresence((current) =>
        current.filter(
          (entry) =>
            !(entry.role === 'player' && entry.id === playerId),
        ),
      )

      showStatusMessage(
        `${playerName} was kicked from the campaign.`,
        {
          tone: 'success',
          durationMs: 4200,
          bypassDedupe: true,
        },
      )
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Could not kick this Player.',
      )
    }
  }

  const banPlayerFromCampaign = async (
    playerId: string,
    playerName: string,
  ) => {
    if (!isDm) return

    const confirmed = window.confirm(
      `Ban ${playerName} from this campaign? They will be removed now and blocked from rejoining until you unban them.`,
    )

    if (!confirmed) return

    try {
      await emitSocketRequest(
        'player:ban',
        { playerId },
      )

      const bannedPlayer =
        campaignPlayers.find(
          (player) => player.id === playerId,
        ) ?? {
          id: playerId,
          name: playerName,
          createdAt: '',
          lastSeenAt: '',
        }

      setCampaignPlayers((current) =>
        current.filter((player) => player.id !== playerId),
      )
      setBannedPlayers((current) => [
        bannedPlayer,
        ...current.filter((player) => player.id !== playerId),
      ])
      setPresence((current) =>
        current.filter(
          (entry) =>
            !(entry.role === 'player' && entry.id === playerId),
        ),
      )

      showStatusMessage(
        `${playerName} was banned from the campaign.`,
        {
          tone: 'success',
          durationMs: 4200,
          bypassDedupe: true,
        },
      )
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Could not ban this Player.',
      )
    }
  }

  const unbanPlayerFromCampaign = async (
    playerId: string,
    playerName: string,
  ) => {
    if (!isDm) return

    try {
      await emitSocketRequest(
        'player:unban',
        { playerId },
      )

      setBannedPlayers((current) =>
        current.filter((player) => player.id !== playerId),
      )

      showStatusMessage(
        `${playerName} was unbanned and can join this campaign again.`,
        {
          tone: 'success',
          durationMs: 4200,
          bypassDedupe: true,
        },
      )
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Could not unban this Player.',
      )
    }
  }

  const getMapDisplayName = (map: Pick<MapAsset, 'id' | 'displayName'>): string => {
    const customName =
      gameStateRef.current.mapNames?.[map.id]?.trim()

    return customName || friendlyMapName(map.displayName)
  }

  const getMapVisionSettings = (
    mapId: string,
  ): MapVisionSettings =>
    normalizeMapVisionSettings(
      gameStateRef.current.visionByMap?.[mapId],
    )

  const saveMapVisionSettings = async (
    mapId: string,
    settings: MapVisionSettings,
    silent = false,
  ) => {
    if (!isDm || !currentCampaign) {
      return
    }

    try {
      const result =
        await requestJson<{
          state: CampaignState
          settings: MapVisionSettings
        }>(
          `/api/campaigns/${encodeURIComponent(currentCampaign.id)}/vision/maps/${encodeURIComponent(mapId)}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              settings,
            }),
          },
        )

      commitState(
        hydrateActiveMapGrid(
          result.state,
        ),
      )

      if (!silent) {
        showStatusMessage(
          settings.enabled
            ? 'Vision runtime saved and active.'
            : 'Vision geometry saved.',
          {
            tone: 'success',
            durationMs: 3200,
            bypassDedupe: true,
          },
        )
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Vision geometry could not be saved.'

      setStatusMessage(message)
      throw error
    }
  }

  const commitState = (state: CampaignState) => {
    gameStateRef.current = state
    setGameState(state)
  }

  const acceptDmJoin = (
    campaign: Campaign,
    result: JoinResult,
    options: { announce?: boolean } = {},
  ) => {
    localStorage.setItem(DM_CAMPAIGN_STORAGE, campaign.id)
    setRole('dm')
    setCurrentPlayerId(null)
    setCurrentCampaign(result.campaign ?? campaign)
    commitState(hydrateActiveMapGrid(result.state ?? {}))
    setActiveSession(result.activeSession ?? null)
    setMaps(result.maps ?? [])
    setCampaignPlayers(result.players ?? [])
    setBannedPlayers(result.bannedPlayers ?? [])
    requestJson<TokenAsset[]>(
      `/api/campaigns/${encodeURIComponent(campaign.id)}/token-assets`,
    ).then(setTokenAssets).catch(() => setTokenAssets([]))
    setSnapshots(result.snapshots ?? [])
    setToolMode('pan')

    if (options.announce !== false) {
      setStatusMessage('Campaign restored from persistent storage.')
    }
  }

  const acceptPlayerJoin = (
    result: JoinResult,
    options: { announce?: boolean } = {},
  ) => {
    setRole('player')
    setCurrentPlayerId(result.player?.id ?? null)
    setCampaignPlayers(result.player ? [result.player] : [])
    setBannedPlayers([])
    setCurrentCampaign(result.campaign ?? null)
    commitState(hydrateActiveMapGrid(result.state ?? {}))
    setActiveSession(result.activeSession ?? null)
    setToolMode('pan')
    setPlayerSheetOpen(true)

    if (options.announce !== false) {
      setStatusMessage(
        result.characterCreated
          ? 'Player Character created and linked to your persistent identity.'
          : result.characterRestored
            ? 'Your saved character was restored into this campaign.'
            : 'Welcome back. Your character, spells, HP, token and campaign state were restored.',
      )
    }
  }

  useEffect(() => {
    gameStateRef.current = gameState
  }, [gameState])

  useEffect(() => {
    initialiseSfx()
  }, [])

  useEffect(() => {
    return () => {
      if (noticeDismissTimerRef.current !== null) {
        window.clearTimeout(noticeDismissTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    let lastHoveredControl: Element | null = null

    const interactiveControl = (target: EventTarget | null) =>
      target instanceof Element
        ? target.closest('button:not(:disabled), [role="button"]:not([aria-disabled="true"]), select:not(:disabled)')
        : null

    const onPointerOver = (event: PointerEvent) => {
      const control = interactiveControl(event.target)
      if (!control || control === lastHoveredControl) return
      lastHoveredControl = control
      void playSfx('ui/button-hover')
    }

    const onPointerOut = (event: PointerEvent) => {
      const control = interactiveControl(event.target)
      if (control && !control.contains(event.relatedTarget as Node | null)) {
        lastHoveredControl = null
      }
    }

    const onClick = (event: MouseEvent) => {
      const control = interactiveControl(event.target)
      if (!control) return
      const isTab = control.getAttribute('role') === 'tab' || control.closest('[role="tablist"]')
      void playSfx(isTab ? 'ui/tab-change' : 'ui/button-click')
    }

    const onChange = (event: Event) => {
      if (!(event.target instanceof HTMLInputElement)) return
      if (event.target.type !== 'checkbox' && event.target.type !== 'radio') return
      void playSfx(event.target.checked ? 'ui/toggle-on' : 'ui/toggle-off')
    }

    document.addEventListener('pointerover', onPointerOver)
    document.addEventListener('pointerout', onPointerOut)
    document.addEventListener('click', onClick)
    document.addEventListener('change', onChange)

    return () => {
      document.removeEventListener('pointerover', onPointerOver)
      document.removeEventListener('pointerout', onPointerOut)
      document.removeEventListener('click', onClick)
      document.removeEventListener('change', onChange)
    }
  }, [])

  useEffect(() => {
    setSfxEnabled(tokenSfxEnabled)
  }, [tokenSfxEnabled])

  useEffect(() => {
    setCellSizeDraft(String(Math.round(grid.cellSize)))
  }, [activeMap?.id, grid.cellSize])

  useEffect(() => {
    let cancelled = false
    fetch('/assets/dice/dice-themes.json', { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('Dice theme catalogue is unavailable.')
        return response.json() as Promise<unknown>
      })
      .then((value) => {
        if (cancelled) return
        const catalog = normalizeDiceThemeCatalog(value)
        setDiceThemeCatalog(catalog)
        setDiceThemeId((current) =>
          catalog.themes.some((theme) => theme.id === current)
            ? current
            : catalog.defaultThemeId,
        )
      })
      .catch(() => {
        if (!cancelled) {
          setDiceThemeCatalog({
            defaultThemeId: DEFAULT_DICE_THEME.id,
            themes: [DEFAULT_DICE_THEME],
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(DICE_THEME_STORAGE, diceThemeId)
  }, [diceThemeId])

  const resetClientToMainMenu = (
    returningRole: Role | null,
    message?: string,
  ) => {
    if (returningRole === 'dm') {
      localStorage.removeItem(
        DM_CAMPAIGN_STORAGE,
      )
    } else if (returningRole === 'player') {
      localStorage.removeItem(
        JOIN_CODE_STORAGE,
      )
      setJoinCode('')
    }

    setRole(null)
    setCurrentPlayerId(null)
    setCurrentCampaign(null)
    commitState({})
    setActiveSession(null)
    setPresence([])
    setCampaignPlayers([])
    setBannedPlayers([])
    setMaps([])
    setTokenAssets([])
    setSnapshots([])

    setInspectorTab('actors')
    setDmInspectorExpanded(false)
    setToolMode('pan')
    setArcaneReachOpen(false)
    setArcaneReachResult(null)
    setCameraZoom(1)
    setWorldMapOpen(false)
    setOnlineRosterOpen(false)
    setDiceTrayOpen(false)
    setUtilityActionsOpen(false)
    setReadyActionOpen(false)

    setPendingTokenAssetId(null)
    setPendingActorId(null)
    setPlayerTokenPlacementArmed(false)

    setPlayerSheetOpen(false)
    setPlayerSpellHudOpen(false)
    setPlayerCharacterHudOpen(false)
    setPlayerAttackHudOpen(false)
    setPlayerSpellbookOpen(false)
    setPlayerSpellbookTargetId('')

    setDmSheetActorId(null)
    setHealthTargetActorId('')
    setDmSpellbookOpen(false)
    setDmSpellbookTargetId('')
    setDmEffectSourceActorId('')

    setPendingSpellCast(null)
    setTargetAreaPoint(null)
    setHoveredToken(null)

    if (message) {
      showStatusMessage(
        message,
        {
          tone: 'success',
          durationMs: 5200,
          bypassDedupe: true,
        },
      )
    }
  }

  useEffect(() => {
    const initialise = async () => {
      try {
        const access = await requestJson<{ isLocalHost: boolean }>('/api/access-info')

        if (access.isLocalHost) {
          setAccessMode('host')
          const availableCampaigns = await requestJson<Campaign[]>('/api/campaigns')
          setCampaigns(availableCampaigns)
          const savedCampaignId = localStorage.getItem(DM_CAMPAIGN_STORAGE)
          const savedCampaign = availableCampaigns.find((campaign) => campaign.id === savedCampaignId)

          if (savedCampaign) {
            socket.emit(
              'session:join',
              { role: 'dm', campaignId: savedCampaign.id, name: 'Dungeon Master' },
              (result: JoinResult) => {
                if (result.ok) {
                  acceptDmJoin(savedCampaign, result)
                } else {
                  setStatusMessage(result.error ?? 'Saved DM campaign could not be restored.')
                }
              },
            )
          }
        } else {
          setAccessMode('player')
          const savedName = localStorage.getItem(PLAYER_NAME_STORAGE)?.trim() ?? ''
          const savedCode = localStorage.getItem(JOIN_CODE_STORAGE)?.trim().toUpperCase() ?? ''

          if (savedName && savedCode) {
            socket.emit(
              'session:join',
              {
                role: 'player',
                name: savedName,
                joinCode: savedCode,
                playerKey: getOrCreatePlayerKey(),
              },
              (result: JoinResult) => {
                if (result.ok) {
                  acceptPlayerJoin(result)
                } else {
                  setStatusMessage(result.error ?? 'Saved player seat could not be restored. Enter the table again.')
                }
              },
            )
          }
        }
      } catch (error) {
        setStatusMessage(
          error instanceof Error
            ? error.message
            : 'Could not reach the local VTT host.',
        )
      }
    }

    initialise()
  }, [])

  useEffect(() => {
    const onDiceResult = (payload: unknown) => {
      enqueueDiceRoll(genericDicePresentation(payload))
    }
    const onTableDiceRoll = (payload: unknown) => {
      enqueueDiceRoll(tableDicePresentation(payload))
    }
    const onAttackResolved = (payload: unknown) => {
      enqueueDiceRoll(attackDicePresentation(payload))
    }
    const onSpellResolved = (payload: unknown) => {
      enqueueDiceRoll(spellDicePresentation(payload))
    }

    socket.on('dice:result', onDiceResult)
    socket.on('dice:table-roll', onTableDiceRoll)
    socket.on('combat:attack-resolved', onAttackResolved)
    socket.on('combat:spell-resolved', onSpellResolved)

    return () => {
      socket.off('dice:result', onDiceResult)
      socket.off('dice:table-roll', onTableDiceRoll)
      socket.off('combat:attack-resolved', onAttackResolved)
      socket.off('combat:spell-resolved', onSpellResolved)
    }
  }, [enqueueDiceRoll])

  useEffect(() => {
    const onPresence = (users: PresenceUser[]) => {
      setPresence(users)

      const onlinePlayers = users.filter((user) => user.role === 'player')
      if (onlinePlayers.length === 0) return

      setCampaignPlayers((current) => {
        const byId = new Map(current.map((player) => [player.id, player]))

        for (const player of onlinePlayers) {
          const existing = byId.get(player.id)
          byId.set(
            player.id,
            existing
              ? { ...existing, name: player.name }
              : {
                  id: player.id,
                  name: player.name,
                  createdAt: '',
                  lastSeenAt: '',
                },
          )
        }

        return [...byId.values()]
      })
    }
    const onStateChanged = (state: CampaignState) => {
      commitState(hydrateActiveMapGrid(state ?? {}))
    }
    const onSessionChanged = (session: SessionRecord | null) => {
      setActiveSession(session)
    }
    const onKicked = (payload: { message?: unknown } = {}) => {
      resetClientToMainMenu(
        'player',
        typeof payload.message === 'string' && payload.message.trim()
          ? payload.message
          : 'The Dungeon Master removed you from this campaign.',
      )
    }

    socket.on('session:presence', onPresence)
    socket.on('campaign:state-changed', onStateChanged)
    socket.on('campaign:session-changed', onSessionChanged)
    socket.on('session:kicked', onKicked)

    return () => {
      socket.off('session:presence', onPresence)
      socket.off('campaign:state-changed', onStateChanged)
      socket.off('campaign:session-changed', onSessionChanged)
      socket.off('session:kicked', onKicked)
    }
  }, [])

  useEffect(() => {
    const onDisconnect = () => {
      socketHadDisconnectRef.current = true
      showStatusMessage(
        'Connection lost. Reconnecting…',
        {
          tone: 'connection',
          sticky: true,
        },
      )
    }

    const onConnectError = () => {
      if (socket.connected) return

      socketHadDisconnectRef.current = true
      showStatusMessage(
        'Unable to reach the VTT server. Reconnecting…',
        {
          tone: 'connection',
          sticky: true,
        },
      )
    }

    const onConnect = () => {
      if (!socketHadDisconnectRef.current) return

      socketHadDisconnectRef.current = false
      showStatusMessage(
        'Connection restored.',
        {
          tone: 'success',
          durationMs: NOTICE_RECONNECTED_DURATION_MS,
          bypassDedupe: true,
        },
      )
    }

    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onConnectError)
    socket.on('connect', onConnect)

    return () => {
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onConnectError)
      socket.off('connect', onConnect)
    }
  }, [])

  useEffect(() => {
    if (!role || !currentCampaign) return

    const rejoinAfterReconnect = () => {
      if (role === 'dm') {
        socket.emit(
          'session:join',
          { role: 'dm', campaignId: currentCampaign.id, name: 'Dungeon Master' },
          (result: JoinResult) => {
            if (result.ok) acceptDmJoin(currentCampaign, result, { announce: false })
          },
        )
        return
      }

      const savedName = localStorage.getItem(PLAYER_NAME_STORAGE)?.trim() ?? playerName.trim()
      const savedCode = localStorage.getItem(JOIN_CODE_STORAGE)?.trim().toUpperCase() ?? ''
      if (!savedName || !savedCode) return

      socket.emit(
        'session:join',
        {
          role: 'player',
          name: savedName,
          joinCode: savedCode,
          playerKey: getOrCreatePlayerKey(),
        },
        (result: JoinResult) => {
          if (result.ok) acceptPlayerJoin(result, { announce: false })
        },
      )
    }

    socket.on('connect', rejoinAfterReconnect)
    return () => {
      socket.off('connect', rejoinAfterReconnect)
    }
  }, [role, currentCampaign?.id])

  useEffect(() => {
    return () => {
      if (gridSaveTimerRef.current !== null) {
        window.clearTimeout(gridSaveTimerRef.current)
      }
    }
  }, [])

  const saveWholeState = (
    campaignId: string,
    state: CampaignState,
  ): Promise<void> => {
    const saveTask =
      stateSaveQueueRef.current
        .then(async () => {
          const result = await requestJson<{
            ok: boolean
            state?: CampaignState
          }>(
            `/api/campaigns/${encodeURIComponent(campaignId)}/state`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(state),
            },
          )

          const savedRevision =
            Number(result.state?.stateRevision)

          if (Number.isInteger(savedRevision) && savedRevision >= 0) {
            const current = gameStateRef.current
            const currentRevision = Number(current.stateRevision ?? 0)

            if (savedRevision >= currentRevision) {
              commitState({
                ...current,
                stateRevision: savedRevision,
              })
            }
          }
        })

    stateSaveQueueRef.current =
      saveTask.catch(() => undefined)

    return saveTask
  }

  const joinAsDm = (campaign: Campaign) => {
    socket.emit(
      'session:join',
      {
        role: 'dm',
        campaignId: campaign.id,
        name: 'Dungeon Master',
      },
      (result: JoinResult) => {
        if (!result.ok) {
          setStatusMessage(result.error ?? 'Could not open campaign.')
          return
        }

        acceptDmJoin(campaign, result)
      },
    )
  }

  const createCampaign = async (event: FormEvent) => {
    event.preventDefault()
    const name = newCampaignName.trim()
    if (!name) return

    try {
      const campaign = await requestJson<Campaign>('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })

      setNewCampaignName('')
      setCampaigns((previous) => [campaign, ...previous])
      joinAsDm(campaign)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Could not create campaign.')
    }
  }

  const joinAsPlayer = (event: FormEvent) => {
    event.preventDefault()

    const name = playerName.trim()
    const code = joinCode.trim().toUpperCase()

    if (!name || !code) {
      setStatusMessage('Enter your name and campaign join code.')
      return
    }

    const playerKey = getOrCreatePlayerKey()
    localStorage.setItem(PLAYER_NAME_STORAGE, name)
    localStorage.setItem(JOIN_CODE_STORAGE, code)

    socket.emit(
      'session:join',
      {
        role: 'player',
        name,
        joinCode: code,
        playerKey,
      },
      (result: JoinResult) => {
        if (!result.ok) {
          setStatusMessage(result.error ?? 'Could not join campaign.')
          return
        }

        acceptPlayerJoin(result)
      },
    )
  }

  const returnToMainMenu = async () => {
    if (!role || !currentCampaign) {
      return
    }

    const returningRole = role
    const campaignName = currentCampaign.name
    const confirmed = window.confirm(
      returningRole === 'dm'
        ? `Return to the Main Menu from ${campaignName}? The campaign and its saved state will remain available.`
        : `Return to the Main Menu from ${campaignName}? Your saved character sheet will remain in your Character Vault.`,
    )

    if (!confirmed) {
      return
    }

    try {
      await stateSaveQueueRef.current.catch(() => undefined)

      await emitSocketRequest(
        'session:leave',
        {},
      )

      resetClientToMainMenu(
        returningRole,
        `Returned to the Main Menu from ${campaignName}.`,
      )
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Could not return to the Main Menu.',
      )
    }
  }

  const persistGrid = (nextGrid: GridSettings) => {
    if (!isDm || !currentCampaign) return

    const current = gameStateRef.current
    const currentMap = current.activeMap
    if (!currentMap) return

    const normalized = normalizeGridSettings(nextGrid)
    const nextState: CampaignState = {
      ...current,
      mapSettings: {
        ...(current.mapSettings ?? {}),
        [currentMap.id]: normalized,
      },
      activeMap: {
        ...currentMap,
        grid: normalized,
      },
      publishedMap:
        current.publishedMap?.id === currentMap.id
          ? {
              ...current.publishedMap,
              grid: normalized,
            }
          : current.publishedMap,
    }

    commitState(nextState)

    if (gridSaveTimerRef.current !== null) {
      window.clearTimeout(gridSaveTimerRef.current)
    }

    gridSaveTimerRef.current = window.setTimeout(async () => {
      try {
        await saveWholeState(currentCampaign.id, nextState)
        setStatusMessage('Grid calibration saved.')
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : 'Could not save grid calibration.',
        )
      }
    }, GRID_SAVE_DELAY_MS)
  }

  const updateGrid = (patch: Partial<GridSettings>) => {
    persistGrid({ ...grid, ...patch })
  }

  const commitCellSizeDraft = () => {
    const trimmed = cellSizeDraft.trim()

    if (!trimmed) {
      setCellSizeDraft(String(Math.round(grid.cellSize)))
      return
    }

    const parsed = Number(trimmed)

    if (!Number.isFinite(parsed) || parsed < 10 || parsed > 500) {
      setCellSizeDraft(String(Math.round(grid.cellSize)))
      setStatusMessage('Cell Size must be between 10 and 500 pixels.')
      return
    }

    const rounded = Math.round(parsed)
    setCellSizeDraft(String(rounded))
    updateGrid({ cellSize: rounded })
  }

  const activateMapState = (
    state: CampaignState,
    asset: MapAsset,
  ) => {
    const gridSettings = normalizeGridSettings(state.mapSettings?.[asset.id])
    const displayName =
      state.mapNames?.[asset.id]?.trim() ||
      asset.displayName

    const nextState: CampaignState = {
      ...state,
      mapSettings: {
        ...(state.mapSettings ?? {}),
        [asset.id]: gridSettings,
      },
      activeMap: {
        ...asset,
        displayName,
        grid: gridSettings,
      },
    }

    commitState(nextState)
  }

  const uploadMap = async () => {
    if (!isDm || !currentCampaign) return

    const file = mapFileInput.current?.files?.[0]
    if (!file) {
      setStatusMessage('Choose a PNG, JPG or WEBP map first.')
      return
    }

    const formData = new FormData()
    formData.append('map', file)

    try {
      setStatusMessage(`Uploading ${file.name}...`)

      const result = await requestJson<{ asset: MapAsset }>(
        `/api/campaigns/${encodeURIComponent(currentCampaign.id)}/maps/library`,
        { method: 'POST', body: formData },
      )

      setMaps((currentMaps) =>
        currentMaps.some((entry) => entry.id === result.asset.id)
          ? currentMaps.map((entry) =>
              entry.id === result.asset.id ? result.asset : entry,
            )
          : [...currentMaps, result.asset],
      )

      if (mapFileInput.current) mapFileInput.current.value = ''
      setStatusMessage('Map added to Campaign Maps. Battleground Map was not changed.')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Map upload failed.')
    }
  }

  const activateMap = async (map: MapAsset) => {
    if (!isDm || !currentCampaign) return

    try {
      const result = await requestJson<{ state: CampaignState; asset: MapAsset }>(
        `/api/campaigns/${encodeURIComponent(currentCampaign.id)}/maps/${encodeURIComponent(map.id)}/activate`,
        { method: 'POST' },
      )

      activateMapState(result.state, result.asset)
      setStatusMessage(
        publishedMap?.id === map.id
          ? `${getMapDisplayName(map)} remains live for Players.`
          : `${getMapDisplayName(map)} is prepared for the DM only. Players still see ${publishedMap ? getMapDisplayName(publishedMap) : 'no Battleground'}.`,
      )
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Could not activate map.')
    }
  }

  const publishMapToPlayers = async (map: MapAsset) => {
    if (!isDm || !currentCampaign) return

    if (activeMap?.id !== map.id) {
      setStatusMessage('Prepare this map for the DM before publishing it to Players.')
      return
    }

    try {
      const result = await requestJson<{ state: CampaignState; asset: MapAsset }>(
        `/api/campaigns/${encodeURIComponent(currentCampaign.id)}/maps/${encodeURIComponent(map.id)}/publish`,
        { method: 'POST' },
      )

      commitState(hydrateActiveMapGrid(result.state))
      void playSfx('atmosphere/map-reveal', ['doors/magical-secret-reveal', 'doors/secret-reveal'])
      setStatusMessage(`${getMapDisplayName(map)} is now live for Players.`)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Could not publish map to Players.')
    }
  }

  const assignWorldMap = async (map: MapAsset) => {
    if (!isDm || !currentCampaign) return

    try {
      const result = await requestJson<{ state: CampaignState; asset: MapAsset }>(
        `/api/campaigns/${encodeURIComponent(currentCampaign.id)}/maps/${encodeURIComponent(map.id)}/world-map`,
        { method: 'POST' },
      )

      commitState(hydrateActiveMapGrid(result.state))
      setWorldMapOpen(true)
      setStatusMessage(`${getMapDisplayName(map)} is now the World Map. Battleground Map was not changed.`)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Could not assign World Map.')
    }
  }

  const clearWorldMap = async () => {
    if (!isDm || !currentCampaign) return

    try {
      const result = await requestJson<{ state: CampaignState }>(
        `/api/campaigns/${encodeURIComponent(currentCampaign.id)}/world-map`,
        { method: 'DELETE' },
      )

      commitState(hydrateActiveMapGrid(result.state))
      setWorldMapOpen(false)
      setStatusMessage('World Map assignment cleared. Battleground Map was not changed.')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Could not clear World Map.')
    }
  }

  const uploadTokenAsset = async () => {
    if (!isDm || !currentCampaign) return

    const file = tokenFileInput.current?.files?.[0]
    if (!file) {
      setStatusMessage('Choose a PNG, JPG or WEBP token first.')
      return
    }

    const formData = new FormData()
    formData.append('token', file)

    try {
      const result = await requestJson<{ asset: TokenAsset }>(
        `/api/campaigns/${encodeURIComponent(currentCampaign.id)}/token-assets`,
        { method: 'POST', body: formData },
      )

      setTokenAssets((previous) => [
        result.asset,
        ...previous.filter((asset) => asset.id !== result.asset.id),
      ])

      if (tokenFileInput.current) tokenFileInput.current.value = ''
      setStatusMessage('Token portrait added to the campaign chest.')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Token upload failed.')
    }
  }

  const createTokenAt = async (
    asset: TokenAsset,
    gridX: number,
    gridY: number,
  ) => {
    if (!isDm || !currentCampaign || !activeMap) return

    const previousState = gameStateRef.current
    const actors = previousState.actors ?? []
    const existingTokens = previousState.tokens ?? []

    const actor =
      createFreshActorFromAsset(
        asset,
        {
          id: createClientUuid(),
          name: nextActorName(
            asset.displayName,
            actors,
          ),
        },
      )

    const token =
      createFreshSceneTokenInstance(
        asset,
        {
          id: createClientUuid(),
          actorId: actor.id,
          mapId: activeMap.id,
          gridX,
          gridY,
          color: DEFAULT_TOKEN_COLOR,
        },
      )

    const nextState: CampaignState = {
      ...previousState,
      actors: [...actors, actor],
      tokens: [...existingTokens, token],
    }

    setPendingTokenAssetId(null)
    setPendingActorId(null)
    setToolMode('select')
    commitState(nextState)

    try {
      await saveWholeState(currentCampaign.id, nextState)
      void playSfx('tokens/token-drop', ['tokens/token-snap', 'tokens/token-move'])
      setStatusMessage(`${actor.name} created and placed at grid ${token.gridX}, ${token.gridY}.`)
    } catch (error) {
      commitState(previousState)
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Combatant placement could not be saved.',
      )
    }
  }

  const placeExistingActorAt = async (
    actor: Actor,
    gridX: number,
    gridY: number,
  ) => {
    if (!isDm || !currentCampaign || !activeMap) return

    const previousState = gameStateRef.current
    const existingTokens = previousState.tokens ?? []

    if (
      existingTokens.some(
        (token) =>
          token.actorId === actor.id &&
          token.mapId === activeMap.id,
      )
    ) {
      setPendingActorId(null)
      setStatusMessage(`${actor.name} already has a token on this map.`)
      return
    }

    const asset =
      tokenAssets.find(
        (candidate) =>
          candidate.id === actor.portraitAssetId,
      ) ?? tokenAssetFromActorPortrait(actor)

    if (!asset) {
      setPendingActorId(null)
      setStatusMessage(`${actor.name} has no usable token portrait.`)
      return
    }

    const token =
      createFreshSceneTokenInstance(
        asset,
        {
          id: createClientUuid(),
          actorId: actor.id,
          mapId: activeMap.id,
          gridX,
          gridY,
          color:
            actor.ownerId
              ? getPlayerColor(actor.ownerId)
              : DEFAULT_TOKEN_COLOR,
        },
      )

    const nextState: CampaignState = {
      ...previousState,
      tokens: [...existingTokens, token],
    }

    setPendingActorId(null)
    setPendingTokenAssetId(null)
    setToolMode('select')
    commitState(nextState)

    try {
      await saveWholeState(currentCampaign.id, nextState)
      void playSfx('tokens/token-drop', ['tokens/token-snap', 'tokens/token-move'])
      setStatusMessage(`${actor.name} placed at grid ${token.gridX}, ${token.gridY}.`)
    } catch (error) {
      commitState(previousState)
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Actor placement could not be saved.',
      )
    }
  }

  const armTokenPlacement = (asset: TokenAsset) => {
    if (!activeMap) {
      setStatusMessage('Activate a map before placing a token.')
      return
    }

    setPendingActorId(null)
    setPendingTokenAssetId(asset.id)
    setToolMode('select')
    setStatusMessage(`Create a new ${asset.displayName}: click the map or drag the portrait onto a square.`)
  }

  const armActorPlacement = (actor: Actor) => {
    if (!activeMap) {
      setStatusMessage('Activate a map before placing an actor.')
      return
    }

    if (!actor.portraitUrl) {
      setStatusMessage(`${actor.name} has no token portrait.`)
      return
    }

    setPendingTokenAssetId(null)
    setPendingActorId(actor.id)
    setToolMode('select')
    setStatusMessage(`Place existing actor ${actor.name}: click a square on the map.`)
  }

  const placePendingTokenAt = (gridX: number, gridY: number) => {
    if (pendingActorId) {
      const actor =
        (gameStateRef.current.actors ?? [])
          .find((candidate) => candidate.id === pendingActorId)

      if (!actor) {
        setPendingActorId(null)
        return
      }

      void placeExistingActorAt(actor, gridX, gridY)
      return
    }

    if (!pendingTokenAssetId) return

    const asset =
      tokenAssets.find(
        (candidate) =>
          candidate.id === pendingTokenAssetId,
      )

    if (!asset) {
      setPendingTokenAssetId(null)
      return
    }

    void createTokenAt(asset, gridX, gridY)
  }

  const dropTokenAssetAt = (assetId: string, gridX: number, gridY: number) => {
    const asset = tokenAssets.find((candidate) => candidate.id === assetId)
    if (!asset) return

    setPendingActorId(null)
    void createTokenAt(asset, gridX, gridY)
  }

  const moveToken = (
    tokenId: string,
    gridX: number,
    gridY: number,
  ) => {
    const current = gameStateRef.current
    const tokens = current.tokens ?? []
    const original = tokens.find((token) => token.id === tokenId)
    if (!original) return

    const nextState: CampaignState = {
      ...current,
      tokens: tokens.map((token) =>
        token.id === tokenId
          ? { ...token, gridX, gridY }
          : token,
      ),
    }

    commitState(nextState)
    socket.emit(
      'token:move',
      { tokenId, gridX, gridY, _requestId: createClientUuid() },
      (result: { ok?: boolean; error?: string }) => {
        if (!result?.ok) {
          const latest = gameStateRef.current
          const currentToken = (latest.tokens ?? []).find((token) => token.id === tokenId)
          // A stale rejection must not roll back a later drag that has already
          // moved this token again.
          if (!currentToken || currentToken.gridX !== gridX || currentToken.gridY !== gridY) {
            setStatusMessage(result?.error ?? 'Token movement was rejected.')
            return
          }
          commitState({
            ...latest,
            tokens: (latest.tokens ?? []).map((token) =>
              token.id === tokenId
                ? { ...token, gridX: original.gridX, gridY: original.gridY }
                : token,
            ),
          })
          setStatusMessage(result?.error ?? 'Token movement was rejected.')
          return
        }

        void playSfx('tokens/token-snap', ['tokens/token-drop', 'tokens/token-move'])
      },
    )
  }

  const setDoorState = (
    doorId: string,
    nextState: VisionDoorState,
  ) => {
    if (!currentCampaign || !activeMap) {
      return
    }

    socket.emit(
      'vision:door-set-state',
      {
        doorId,
        state: nextState,
        _requestId: createClientUuid(),
      },
      (result: { ok?: boolean; error?: string; state?: VisionDoorState }) => {
        if (!result?.ok) {
          setStatusMessage(
            result?.error ?? 'Door interaction was rejected.',
          )
          return
        }

        const label =
          result.state === 'open'
            ? 'Door opened.'
            : result.state === 'locked'
              ? 'Door locked.'
              : 'Door closed.'

        showStatusMessage(
          label,
          {
            tone: 'success',
            durationMs: 2200,
          },
        )
      },
    )
  }

  const updateToken = async (
    tokenId: string,
    patch: Partial<SceneToken>,
  ) => {
    if (!isDm || !currentCampaign) return

    const current = gameStateRef.current
    const nextState: CampaignState = {
      ...current,
      tokens: (current.tokens ?? []).map((token) =>
        token.id === tokenId
          ? { ...token, ...patch }
          : token,
      ),
    }

    commitState(nextState)
    await saveWholeState(currentCampaign.id, nextState)
  }

  const updateActor = async (
    actorId: string,
    patch: Partial<Actor>,
  ) => {
    if (!isDm || !currentCampaign) return

    const current = gameStateRef.current
    const actors = current.actors ?? []
    const original = actors.find((actor) => actor.id === actorId)

    if (!original) {
      throw new Error('Actor not found.')
    }

    const updated =
      normalizeActor({
        ...original,
        ...patch,
        abilities:
          patch.abilities
            ? {
                ...original.abilities,
                ...patch.abilities,
              }
            : original.abilities,
      })

    let nextTokens = current.tokens ?? []

    if (
      updated.ownerId &&
      updated.ownerId !== original.ownerId
    ) {
      const ownerColor =
        getPlayerColor(
          updated.ownerId,
        )

      nextTokens =
        nextTokens.map((token) =>
          token.actorId === actorId
            ? {
                ...token,
                color: ownerColor,
              }
            : token,
        )
    }

    const nextState: CampaignState = {
      ...current,
      actors: actors.map((actor) =>
        actor.id === actorId
          ? updated
          : actor,
      ),
      tokens: nextTokens,
    }

    commitState(nextState)
    await saveWholeState(currentCampaign.id, nextState)
  }

  const applyActorHealth = async (
    actorId: string,
    operation: HealthOperation,
    amount: number,
    damageType: AppliedDamageType,
    criticalHit = false,
  ): Promise<HealthResolution> => {
    if (!isDm || !currentCampaign) {
      throw new Error('Only the DM can apply damage and healing.')
    }

    const actor = (gameStateRef.current.actors ?? []).find(
      (candidate) => candidate.id === actorId,
    )

    if (!actor) {
      throw new Error('Target Actor not found.')
    }

    const result = await emitSocketRequest(
      'actor:apply-health',
      {
        actorId,
        operation,
        amount,
        damageType,
        criticalHit,
      },
    )

    const resolution = result.resolution as HealthResolution | undefined

    if (!resolution) {
      throw new Error('The server did not return a health resolution.')
    }

    void playHealthSfx(resolution.operation, resolution.damageType)

    if (resolution.operation === 'damage') {
      const defense = resolution.immunityApplied
        ? ' · IMMUNE'
        : resolution.resistanceApplied && resolution.vulnerabilityApplied
          ? ' · RESIST + VULNERABLE'
          : resolution.resistanceApplied
            ? ' · RESIST'
            : resolution.vulnerabilityApplied
              ? ' · VULNERABLE'
              : ''

      const lifeChange = resolution.lifeStateBefore !== resolution.lifeStateAfter
        ? ` · ${resolution.lifeStateBefore.toUpperCase()} → ${resolution.lifeStateAfter.toUpperCase()}`
        : ''
      const deathFailure = resolution.deathSaveFailuresAdded > 0
        ? ` · Death failures +${resolution.deathSaveFailuresAdded}`
        : ''
      setStatusMessage(
        `${actor.name}: ${resolution.requestedAmount} ${resolution.damageType} → ${resolution.effectiveDamage} damage${defense}. HP ${resolution.currentHpBefore} → ${resolution.currentHpAfter}; Temp ${resolution.tempHpBefore} → ${resolution.tempHpAfter}${deathFailure}${lifeChange}.`,
      )
    } else if (resolution.operation === 'heal') {
      setStatusMessage(
        resolution.healingBlockedByDeath
          ? `${actor.name}: no healing applied because the Actor is Dead. Use DM Override to revive.`
          : `${actor.name}: healed ${resolution.healed}. HP ${resolution.currentHpBefore} → ${resolution.currentHpAfter}.`,
      )
    } else {
      setStatusMessage(
        `${actor.name}: Temp HP ${resolution.tempHpBefore} → ${resolution.tempHpAfter}.`,
      )
    }

    return resolution
  }

  const resolveCombatAttack = async (request: {
    sourceActorId: string
    targetActorId: string
    attackId: string
    cover: 'none' | 'half' | 'three-quarters' | 'total'
    outcomeOverride: 'rules' | 'miss' | 'hit' | 'critical'
    ignoreEconomy: boolean
  }): Promise<AttackResolution> => {
    const result = await emitSocketRequest('combat:resolve-attack', request)
    const resolution = result.resolution as AttackResolution | undefined
    if (!resolution) throw new Error('The server did not return an attack resolution.')
    void playDiceSfx(20, resolution.natural)
    if (resolution.damage) void playHealthSfx('damage', resolution.damageType)
    return resolution
  }

  const respondToReaction = async (
    windowId: string,
    decision: ReactionDecision,
    attackId?: string,
    targetActorId?: string,
    spellTargetActorIds?: string[],
    areaGridX?: number,
    areaGridY?: number,
  ): Promise<void> => {
    const window = reactionWindows.find((candidate) => candidate.id === windowId) ?? null
    const result = await emitSocketRequest('reaction:respond', {
      windowId,
      decision,
      attackId,
      targetActorId,
      spellTargetActorIds,
      areaGridX,
      areaGridY,
    })
    if (decision === 'decline') {
      setStatusMessage(window?.kind === 'readied-action' ? 'Ready trigger ignored; the prepared action remains available until your next turn.' : 'Reaction declined.')
      return
    }

    const resolution = result.resolution as AttackResolution | undefined
    if (resolution) {
      void playDiceSfx(20, resolution.natural)
      if (resolution.damage) void playHealthSfx('damage', resolution.damageType)
      return
    }

    if (result.rollResult) return
    const message = String(result.message ?? '').trim()
    if (message) {
      setStatusMessage(message)
      return
    }

    setStatusMessage('Reaction resolved.')
  }

  const rollDeathSave = async (
    actorId: string,
  ): Promise<DeathSaveResolution> => {
    const result = await emitSocketRequest(
      'actor:roll-death-save',
      { actorId },
    )

    const resolution = result.resolution as DeathSaveResolution | undefined
    const rawRoll = Number(result.rawRoll)

    if (!resolution || !Number.isFinite(rawRoll)) {
      throw new Error('The server did not return a Death Save result.')
    }

    void playDiceSfx(20, Math.round(rawRoll))

    return resolution
  }

  const createOwnCharacter = async () => {
    if (isDm || !currentPlayerId) {
      throw new Error('Join as a player before creating a character sheet.')
    }

    await new Promise<void>((resolve, reject) => {
      socket.emit(
        'actor:create-own-character',
        {
          name: playerName.trim() || 'Adventurer',
        },
        (result: { ok?: boolean; error?: string; restored?: boolean }) => {
          if (!result?.ok) {
            reject(new Error(result?.error ?? 'Character creation was rejected.'))
            return
          }

          setStatusMessage(
            result.restored
              ? 'Your saved Character Vault sheet was restored.'
              : 'Character Sheet created and saved to your Character Vault.',
          )
          resolve()
        },
      )
    })
  }

  const updateOwnCharacter = async (
    patch: Partial<Actor>,
  ) => {
    if (isDm || !currentPlayerId || !ownCharacter) {
      throw new Error('No owned player character is available.')
    }

    const current = gameStateRef.current
    const actors = current.actors ?? []
    const original = actors.find((actor) => actor.id === ownCharacter.id)

    if (!original) {
      throw new Error('Character actor not found.')
    }

    const optimistic = normalizeActor({
      ...original,
      ...patch,
      abilities:
        patch.abilities
          ? {
              ...original.abilities,
              ...patch.abilities,
            }
          : original.abilities,
      characterSheet:
        patch.characterSheet
          ? {
              ...(original.characterSheet ?? {}),
              ...patch.characterSheet,
            }
          : original.characterSheet,
    })

    commitState({
      ...current,
      actors: actors.map((actor) =>
        actor.id === original.id
          ? optimistic
          : actor,
      ),
    })

    await new Promise<void>((resolve, reject) => {
      socket.emit(
        'actor:update-own-sheet',
        {
          actorId: original.id,
          patch,
          _requestId: createClientUuid(),
        },
        (result: { ok?: boolean; error?: string }) => {
          if (!result?.ok) {
            const latest = gameStateRef.current
            commitState({
              ...latest,
              actors: (latest.actors ?? []).map((actor) =>
                actor.id === original.id
                  ? original
                  : actor,
              ),
            })
            reject(new Error(result?.error ?? 'Character update was rejected.'))
            return
          }

          resolve()
        },
      )
    })
  }

  const spendOwnHitDie = async (): Promise<string> => {
    if (isDm || !currentPlayerId || !ownCharacter) {
      throw new Error('Only a player can spend Hit Dice on their own character.')
    }
    const result = await emitSocketRequest('actor:spend-hit-die', { actorId: ownCharacter.id })
    return typeof result.message === 'string' ? result.message : 'Hit Die rolled and saved.'
  }

  const rollOwnShortRestHitDie = async () => {
    if (shortRestHitDieBusy || !ownCharacter) return
    setShortRestHitDieBusy(true)
    setShortRestHitDieResult('')
    try {
      setShortRestHitDieResult(await spendOwnHitDie())
    } catch (error) {
      setShortRestHitDieResult(error instanceof Error ? error.message : 'Hit Die could not be rolled.')
    } finally {
      setShortRestHitDieBusy(false)
    }
  }

  const finishOwnShortRestHitDiceChoice = async () => {
    if (shortRestHitDieBusy || !ownCharacter || !currentPlayerId) return
    setShortRestHitDieBusy(true)
    setShortRestHitDieResult('')
    try {
      await emitSocketRequest('actor:finish-short-rest-hit-dice', { actorId: ownCharacter.id })
    } catch (error) {
      setShortRestHitDieResult(error instanceof Error ? error.message : 'Your choice could not be saved.')
    } finally {
      setShortRestHitDieBusy(false)
    }
  }

  const uploadOwnTokenPortrait = async (file: File) => {
    if (isDm || !currentPlayerId || !ownCharacter) {
      throw new Error('Create or assign your Player Character before choosing a token image.')
    }

    const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])

    if (!allowedTypes.has(file.type)) {
      throw new Error('Token image must be PNG, JPG or WEBP.')
    }

    if (file.size > 15 * 1024 * 1024) {
      throw new Error('Token image must be 15 MB or smaller.')
    }

    const bytes = await file.arrayBuffer()

    await emitSocketRequest(
      'actor:upload-own-token',
      {
        actorId: ownCharacter.id,
        fileName: file.name,
        mimeType: file.type,
        bytes,
      },
    )

    void playSfx('tokens/token-snap', ['tokens/token-drop', 'tokens/token-move'])
    setStatusMessage('Your token image was updated. Existing map tokens now use the new portrait.')
  }

  const updateOwnTokenColor = async (color: string) => {
    if (isDm || !currentPlayerId || !ownCharacter) {
      throw new Error('No owned Player Character is available.')
    }

    const normalizedColor =
      normalizeTokenColor(
        color,
        getPlayerColor(currentPlayerId),
      )

    const previousState =
      gameStateRef.current

    const ownedActorIds =
      new Set(
        (previousState.actors ?? [])
          .filter(
            (actor) =>
              actor.kind === 'player' &&
              actor.ownerId === currentPlayerId,
          )
          .map((actor) => actor.id),
      )

    const optimisticState: CampaignState = {
      ...previousState,
      playerColors: {
        ...(previousState.playerColors ?? {}),
        [currentPlayerId]:
          normalizedColor,
      },
      tokens:
        (previousState.tokens ?? []).map(
          (token) =>
            ownedActorIds.has(token.actorId)
              ? {
                  ...token,
                  color:
                    normalizedColor,
                }
              : token,
        ),
    }

    commitState(
      optimisticState,
    )

    try {
      await emitSocketRequest(
        'actor:update-own-token-color',
        {
          actorId:
            ownCharacter.id,
          color:
            normalizedColor,
        },
      )

      setStatusMessage(
        'Your token ring color was updated.',
      )
    } catch (error) {
      commitState(
        previousState,
      )

      throw error
    }
  }

  const commitArcaneReachSigil = async (
    placement: ArcaneReachPlacement,
  ) => {
    if (
      !currentCampaign ||
      !activeMap ||
      !arcaneReachControllerId
    ) {
      return
    }

    const previousState =
      gameStateRef.current

    const sigil: CampaignArcaneReachSigil = {
      controllerId:
        arcaneReachControllerId,
      role:
        isDm ? 'dm' : 'player',
      mapId:
        activeMap.id,
      mode:
        placement.mode,
      start:
        placement.start,
      end:
        placement.end,
      updatedAt:
        new Date().toISOString(),
    }

    commitState({
      ...previousState,
      arcaneReachSigils: {
        ...(previousState.arcaneReachSigils ?? {}),
        [arcaneReachControllerId]:
          sigil,
      },
    })

    try {
      await emitSocketRequest(
        'arcane-reach:update',
        {
          mapId:
            activeMap.id,
          mode:
            placement.mode,
          start:
            placement.start,
          end:
            placement.end,
        },
      )
    } catch (error) {
      commitState(
        previousState,
      )

      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Arcane Reach could not be shared.',
      )
    }
  }

  const clearOwnArcaneReachSigil = async () => {
    if (
      !currentCampaign ||
      !arcaneReachControllerId
    ) {
      return
    }

    const previousState =
      gameStateRef.current

    const nextSigils = {
      ...(previousState.arcaneReachSigils ?? {}),
    }

    delete nextSigils[
      arcaneReachControllerId
    ]

    commitState({
      ...previousState,
      arcaneReachSigils:
        nextSigils,
    })

    setArcaneReachResult(
      null,
    )

    mapViewportRef.current
      ?.clearArcaneReach()

    try {
      await emitSocketRequest(
        'arcane-reach:clear',
        {},
      )
    } catch (error) {
      commitState(
        previousState,
      )

      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Arcane Reach could not be cleared.',
      )
    }
  }

  const armOwnTokenPlacement = () => {
    if (isDm || !ownCharacter) return

    if (!activeMap) {
      setStatusMessage('The DM must activate a map before you can place your token.')
      return
    }

    if (!ownCharacter.portraitUrl) {
      setStatusMessage('Choose a token image on your Character Sheet first.')
      return
    }

    if (ownTokenOnActiveMap) {
      setStatusMessage('Your token is already on the active map.')
      return
    }

    setPendingActorId(null)
    setPendingTokenAssetId(null)
    setToolMode('select')
    setPlayerTokenPlacementArmed(true)
    setPlayerSheetOpen(false)
    setStatusMessage('Token placement armed. Click the map square where your character should appear.')
  }

  const toggleOwnTokenControl = () => {
    if (isDm) return

    if (!ownCharacter) {
      setPlayerSheetOpen(true)
      setStatusMessage('Your Player Character is still loading. Open Character and try again.')
      return
    }

    if (!activeMap) {
      setStatusMessage('The DM must activate a map before your token can be used.')
      return
    }

    if (!ownTokenOnActiveMap) {
      armOwnTokenPlacement()
      return
    }

    if (gameState.allowPlayerMovement !== true) {
      setToolMode('pan')
      setStatusMessage('Player token movement is locked by the DM. Your token is still visible on the map.')
      return
    }

    if (ownCharacter.lifeState !== 'conscious') {
      setToolMode('pan')
      setStatusMessage(`${ownCharacter.name} cannot move while ${ownCharacter.lifeState}.`)
      return
    }

    if (combat.active && combat.currentActorId !== ownCharacter.id) {
      setToolMode('pan')
      setStatusMessage('Your token can move when your combat turn begins.')
      return
    }

    const nextMode: ToolMode = toolMode === 'select' ? 'pan' : 'select'
    setPlayerTokenPlacementArmed(false)
    setPlayerSheetOpen(false)
    setToolMode(nextMode)
    setStatusMessage(
      nextMode === 'select'
        ? 'Move mode enabled. Drag your own token within its movement budget.'
        : 'Move mode disabled. Map pan mode restored.',
    )
  }

  const placeOwnTokenAt = async (gridX: number, gridY: number) => {
    if (isDm || !ownCharacter || !activeMap || !playerTokenPlacementArmed) return

    try {
      await emitSocketRequest(
        'token:place-own',
        {
          actorId: ownCharacter.id,
          gridX,
          gridY,
        },
      )

      setPlayerTokenPlacementArmed(false)
      void playSfx('tokens/token-drop', ['tokens/token-snap', 'tokens/token-move'])
      setStatusMessage(`${ownCharacter.name} placed at grid ${gridX}, ${gridY}.`)
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Your token could not be placed.',
      )
    }
  }

  const selectMapTarget = async (
    actorId: string | null,
    sourceActorId = pendingSpellCast?.actorId ?? (isDm ? combatHudActor?.id ?? dmEffectSourceActorId : ownCharacter?.id ?? ''),
  ) => {
    if (!currentCampaign) return

    const currentTargetId = currentTargetSelection?.targetActorId ?? ''
    const currentSourceId = currentTargetSelection?.sourceActorId ?? ''
    const nextTargetId = actorId ?? ''
    const multiTargeting = Boolean(pendingSpellCast)

    if (!multiTargeting && currentTargetId === nextTargetId && currentSourceId === sourceActorId) {
      return
    }

    if (multiTargeting && actorId && !pendingSpellValidTargetActorIds.includes(actorId)) {
      setStatusMessage('That token is not a legal target for the current spell rule.')
      return
    }

    try {
      await emitSocketRequest('target:set', {
        targetActorId: nextTargetId,
        sourceActorId,
        mode: multiTargeting ? 'toggle' : 'replace',
        maxTargets: pendingSpellCast?.rule.maxTargets ?? 1,
      })
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Target selection failed.',
      )
    }
  }

  const cancelPendingSpellCast = async () => {
    const sourceActorId = pendingSpellCast?.actorId ?? ownCharacter?.id ?? ''
    setPendingSpellCast(null)
    setTargetAreaPoint(null)
    try {
      await emitSocketRequest('target:set', {
        targetActorId: '',
        sourceActorId,
      })
    } catch {
      // Connection UI already reports transport failures.
    }
  }

  const confirmPendingSpellCast = async () => {
    if (!pendingSpellCast) return
    const { rule } = pendingSpellCast
    if (rule.mode === 'point-area' && !targetAreaPoint) {
      setStatusMessage('Choose the spell area on the map first.')
      return
    }
    if (currentTargetActorIds.length < rule.minTargets || currentTargetActorIds.length > rule.maxTargets) {
      setStatusMessage(`Select ${rule.minTargets === rule.maxTargets ? rule.maxTargets : `${rule.minTargets}-${rule.maxTargets}`} legal target(s).`)
      return
    }

    try {
      const result = await emitSocketRequest('spell:cast', {
        actorId: pendingSpellCast.actorId,
        spellId: pendingSpellCast.spellId,
        castLevel: pendingSpellCast.castLevel,
        targetActorIds: currentTargetActorIds,
        areaGridX: targetAreaPoint?.gridX,
        areaGridY: targetAreaPoint?.gridY,
      })
      const automated = result.automated === true
      setStatusMessage(
        automated
          ? `${pendingSpellCast.spellName} resolved automatically.`
          : `${pendingSpellCast.spellName} was cast.`,
      )
      setPendingSpellCast(null)
      setTargetAreaPoint(null)
      await emitSocketRequest('target:set', {
        targetActorId: '',
        sourceActorId: pendingSpellCast.actorId,
      })
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Spell casting failed.')
    }
  }

  const beginRulesSpellCast = async (spellId: string, castLevel: number, requestedActorId?: string) => {
    const actorId = requestedActorId ?? (isDm ? activeTurnActor?.id ?? dmEffectSourceActorId : ownCharacter?.id)
    const sourceActor = actorId ? (gameState.actors ?? []).find((actor) => actor.id === actorId) ?? null : null
    if (!sourceActor) return
    const spell = spellById(spellId)
    if (!spell) {
      setStatusMessage('Spell rule not found.')
      return
    }
    if (!spellHasAutomatedRule(spell.id)) {
      setStatusMessage(`${spell.name}: automatic rules resolution is not registered yet. Nothing was spent.`)
      return
    }
    const rule = spellTargetRule(spell, castLevel)

    if (rule.mode === 'none' || rule.mode === 'self') {
      try {
        const result = await emitSocketRequest('spell:cast', {
          actorId: sourceActor.id,
          spellId,
          castLevel,
          targetActorIds: rule.mode === 'self' ? [sourceActor.id] : [],
        })
        setStatusMessage(
          result.automated === true
            ? `${spell.name} resolved automatically.`
            : `${spell.name} cast. Action Economy and spell resources were resolved by the server.`,
        )
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : 'Spell casting failed.')
      }
      return
    }

    setPendingSpellCast({
      actorId: sourceActor.id,
      spellId,
      spellName: spell.name,
      castLevel,
      rule,
    })
    setTargetAreaPoint(null)
    setPlayerSpellHudOpen(false)
    setToolMode('pan')
    if (rule.mode === 'self-area') {
      const sourceToken = (gameState.tokens ?? []).find((token) => token.actorId === sourceActor.id && token.mapId === activeMap?.id && token.visible)
      if (sourceToken) setTargetAreaPoint({ gridX: sourceToken.gridX, gridY: sourceToken.gridY })
    }
    await emitSocketRequest('target:set', {
      targetActorId: '',
      sourceActorId: sourceActor.id,
    }).catch(() => undefined)
    setStatusMessage(`${spell.name}: ${rule.label}. Select targets on the map, then Confirm.`)
  }

  const endOwnConcentration = async (actorId = ownCharacter?.id) => {
    if (!actorId) return
    try {
      await emitSocketRequest('spell:end-concentration', { actorId })
      setStatusMessage('Concentration ended. Linked rules effects were removed.')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Could not end concentration.')
    }
  }

  const useCoreTurnAction = async (action: 'attack' | 'dash' | 'disengage' | 'dodge' | 'stand-up' | 'utility' | 'ready') => {
    if (!activeTurnActor) return
    if (action === 'utility') {
      setPlayerAttackHudOpen(false)
      setPlayerSpellHudOpen(false)
      setReadyActionOpen(false)
      setUtilityActionsOpen(true)
      setStatusMessage('Choose a 2024 core utility action.')
      return
    }
    if (action === 'ready') {
      setPlayerAttackHudOpen(false)
      setPlayerSpellHudOpen(false)
      setUtilityActionsOpen(false)
      setReadyActionOpen(true)
      setStatusMessage('Define a perceivable trigger and choose the action to prepare.')
      return
    }
    if (action === 'attack') {
      setReadyActionOpen(false)
      if (isDm) {
        setDmEffectSourceActorId(activeTurnActor.id)
        setInspectorTab('health')
      } else {
        setPlayerSpellHudOpen(false)
        setPlayerAttackHudOpen(true)
      }
      setStatusMessage('Choose a target and resolve the attack. The Attack action is spent when the server resolves the roll.')
      return
    }
    try {
      await emitSocketRequest('turn:use-core-action', {
        actorId: activeTurnActor.id,
        action,
        resource: 'action',
      })
      setStatusMessage(`${activeTurnActor.name}: ${action.replace('-', ' ')} resolved.`)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Turn action failed.')
    }
  }

  const resolveUtilityAction = async (request: UtilityActionRequest) => {
    if (!activeTurnActor) return
    try {
      const result = await emitSocketRequest('turn:use-utility-action', {
        actorId: activeTurnActor.id,
        ...request,
      })
      const message = String(result.message ?? '').trim()
      setStatusMessage(message || `${activeTurnActor.name}: ${request.action} resolved.`)
      setUtilityActionsOpen(false)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Utility action failed.')
      throw error
    }
  }

  const prepareReadyAction = async (request: ReadyActionPrepareRequest) => {
    if (!activeTurnActor) return
    try {
      await emitSocketRequest('ready:prepare', {
        actorId: activeTurnActor.id,
        ...request,
      })
      setReadyActionOpen(false)
      setStatusMessage(`${activeTurnActor.name} prepared a Ready action. The DM must confirm when its trigger occurs.`)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Ready action could not be prepared.')
      throw error
    }
  }

  const triggerReadyAction = async (readyActionId: string) => {
    if (!isDm) return
    try {
      await emitSocketRequest('ready:trigger', { readyActionId })
      setStatusMessage('Ready trigger confirmed. Reaction window opened for the owning Actor.')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Ready trigger could not be opened.')
      throw error
    }
  }

  const cancelReadyAction = async (readyActionId: string) => {
    try {
      await emitSocketRequest('ready:cancel', { readyActionId })
      setStatusMessage('Readied action cancelled. Spent Action and spell-slot resources are not refunded.')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Readied action could not be cancelled.')
      throw error
    }
  }

  const endCurrentTurn = async () => {
    setUtilityActionsOpen(false)
    setReadyActionOpen(false)
    try {
      await emitSocketRequest('combat:end-own-turn')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'End Turn failed.')
    }
  }

  const overrideTurnEconomy = async (
    actorId: string,
    patch: TurnEconomyOverridePatch,
    label: string,
  ) => {
    if (!isDm) return
    try {
      await emitSocketRequest('dm:override-turn-economy', { actorId, patch, label })
      setStatusMessage(`DM override: ${label}`)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'DM override failed.')
    }
  }

  const resetTurnEconomyOverride = async (actorId: string) => {
    if (!isDm) return
    try {
      await emitSocketRequest('dm:override-turn-economy', {
        actorId,
        reset: true,
        label: 'Reset turn resources',
      })
      setStatusMessage('Turn resources reset by DM.')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'DM reset failed.')
    }
  }

  const applyTargetEffect = async (draft: TargetEffectDraft) => {
    if (!currentTargetActor) return

    try {
      const result = await emitSocketRequest('effect:apply', {
        targetActorId: currentTargetActor.id,
        sourceActorId: draft.sourceActorId,
        kind: draft.kind,
        scope: draft.scope,
        value: draft.value,
        name: draft.name,
      })

      if (draft.kind === 'temp-hp') {
        setStatusMessage(
          `${currentTargetActor.name} now has ${Math.max(0, Math.round(Number(result.tempHp) || 0))} Temporary HP.`,
        )
      } else {
        const effect = result.effect && typeof result.effect === 'object'
          ? result.effect as { name?: unknown }
          : null
        setStatusMessage(
          `${String(effect?.name ?? 'Effect')} applied to ${currentTargetActor.name}.`,
        )
      }
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Effect application failed.',
      )
      throw error
    }
  }

  const removeTargetEffect = async (effectId: string) => {
    if (!currentTargetActor) return

    try {
      await emitSocketRequest('effect:remove', {
        targetActorId: currentTargetActor.id,
        effectId,
      })
      setStatusMessage(`Effect removed from ${currentTargetActor.name}.`)
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Effect removal failed.',
      )
      throw error
    }
  }

  const updateDmEffectSource = (actorId: string) => {
    setDmEffectSourceActorId(actorId)
    if (isDm && currentTargetActor) {
      void selectMapTarget(currentTargetActor.id, actorId)
    }
  }

  const createMonsterActor = async (
    monster: MonsterTemplate,
  ) => {
    if (!isDm || !currentCampaign) return

    const current = gameStateRef.current
    const actors = current.actors ?? []
    const actorId = `actor-${createClientUuid()}`

    const actor = createActorFromMonsterTemplate(
      monster,
      actors,
      actorId,
    )

    const nextState: CampaignState = {
      ...current,
      actors: [...actors, actor],
    }

    commitState(nextState)
    await saveWholeState(currentCampaign.id, nextState)
    setInspectorTab('actors')
    setStatusMessage(
      `${actor.name} added from the local SRD compendium. Assign a portrait before placing it on a map.`,
    )
  }

  const loadDmVisionPreview = async (
    playerId: string,
  ) => {
    if (!isDm || !currentCampaign || !playerId) {
      setDmVisionPreview(null)
      return
    }

    try {
      const preview =
        await requestJson<{
          runtime: PlayerVisionRuntime
          visibleActorIds: string[]
        }>(
          `/api/campaigns/${encodeURIComponent(currentCampaign.id)}/vision/preview/${encodeURIComponent(playerId)}`,
        )

      setDmVisionPreview({
        playerId,
        runtime: preview.runtime,
        visibleActorIds: preview.visibleActorIds,
      })
    } catch (error) {
      setDmVisionPreview(null)
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Could not preview Player vision.',
      )
    }
  }

  useEffect(() => {
    if (!isDm || !dmVisionPreviewPlayerId || !currentCampaign) {
      if (!dmVisionPreviewPlayerId) {
        setDmVisionPreview(null)
      }
      return
    }

    void loadDmVisionPreview(
      dmVisionPreviewPlayerId,
    )
  }, [
    isDm,
    currentCampaign?.id,
    dmVisionPreviewPlayerId,
    gameState.stateRevision,
    activeMap?.id,
  ])

  const renameMap = async (
    mapId: string,
    requestedName: string,
  ) => {
    if (!isDm || !currentCampaign) return

    const nextName = requestedName.trim()

    if (!nextName) {
      setStatusMessage('Map name cannot be empty.')
      return
    }

    const current = gameStateRef.current
    const nextState: CampaignState = {
      ...current,
      mapNames: {
        ...(current.mapNames ?? {}),
        [mapId]: nextName,
      },
      activeMap:
        current.activeMap?.id === mapId
          ? {
              ...current.activeMap,
              displayName: nextName,
            }
          : current.activeMap,
      publishedMap:
        current.publishedMap?.id === mapId
          ? {
              ...current.publishedMap,
              displayName: nextName,
            }
          : current.publishedMap,
      worldMap:
        current.worldMap?.id === mapId
          ? {
              ...current.worldMap,
              displayName: nextName,
            }
          : current.worldMap,
    }

    commitState(nextState)
    await saveWholeState(currentCampaign.id, nextState)
    setStatusMessage(`Map renamed to ${nextName}.`)
  }

  const deleteMap = async (map: MapAsset) => {
    if (!isDm || !currentCampaign) return

    const displayName = getMapDisplayName(map)
    const roles = [
      activeMap?.id === map.id ? 'DM Battleground' : null,
      publishedMap?.id === map.id ? 'live for Players' : null,
      worldMap?.id === map.id ? 'World Map' : null,
    ].filter((value): value is string => Boolean(value))

    const roleWarning =
      roles.length > 0
        ? ` It is currently assigned as ${roles.join(' and ')}.`
        : ''

    const confirmed = window.confirm(
      `Delete "${displayName}" from Campaign Maps?${roleWarning} Tokens and Arcane Reach marks on this map will also be removed. Characters are not deleted.`,
    )

    if (!confirmed) return

    try {
      const result = await requestJson<{ state: CampaignState }>(
        `/api/campaigns/${encodeURIComponent(currentCampaign.id)}/maps/${encodeURIComponent(map.id)}`,
        { method: 'DELETE' },
      )

      commitState(hydrateActiveMapGrid(result.state))
      setMaps(
        await requestJson<MapAsset[]>(
          `/api/campaigns/${encodeURIComponent(currentCampaign.id)}/maps`,
        ),
      )

      if (worldMap?.id === map.id) {
        setWorldMapOpen(false)
      }

      if (renamingMapId === map.id) {
        setRenamingMapId(null)
        setMapRenameDraft('')
      }

      showStatusMessage(
        `${displayName} was deleted from Campaign Maps.`,
        {
          tone: 'success',
          durationMs: 4200,
          bypassDedupe: true,
        },
      )
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Map could not be deleted.',
      )
    }
  }

  const grantXpToAllPlayers = async () => {
    if (!isDm || !currentCampaign) return

    const amount = Math.max(0, Math.round(Number(partyXpGrantDraft) || 0))
    if (amount <= 0) {
      setStatusMessage('Enter a positive XP award for the whole party.')
      return
    }

    const current = gameStateRef.current
    let changed = 0
    const actors = (current.actors ?? []).map((actor) => {
      if (actor.kind !== 'player' || !actor.ownerId || !actor.characterSheet) return actor

      const nextXp = Math.min(999999, Math.max(0, actor.characterSheet.experiencePoints + amount))
      const nextLevel = levelForXp(nextXp)
      changed += 1

      return normalizeActor({
        ...actor,
        level: nextLevel,
        characterSheet: {
          ...actor.characterSheet,
          experiencePoints: nextXp,
        },
      })
    })

    if (changed === 0) {
      setStatusMessage('No linked Player Characters are available for an XP award.')
      return
    }

    const nextState: CampaignState = {
      ...current,
      actors,
      activityLog: [
        ...(current.activityLog ?? []),
        `DM awarded ${amount.toLocaleString()} XP to all ${changed} Player Characters.`,
      ].slice(-80),
    }

    commitState(nextState)
    await saveWholeState(currentCampaign.id, nextState)
    setPartyXpGrantDraft('')
    setStatusMessage(`${amount.toLocaleString()} XP awarded to all ${changed} Player Characters. Levels updated from XP.`)
  }

  const updateRestParticipants = async (
    transform: (actor: Actor) => Actor,
    successMessage: (changed: number) => string,
    activityMessage: string,
  ) => {
    if (!isDm || !currentCampaign) return
    const selectedIds = new Set(selectedRestPlayerActors.map((actor) => actor.id))
    if (!selectedIds.size) {
      setStatusMessage('Select at least one linked Player Character.')
      return
    }

    const current = gameStateRef.current
    let changed = 0
    const actors = (current.actors ?? []).map((actor) => {
      if (!selectedIds.has(actor.id) || actor.kind !== 'player' || !actor.ownerId || !actor.characterSheet) return actor
      const updated = transform(actor)
      if (updated !== actor) changed += 1
      return updated
    })

    if (!changed) {
      setStatusMessage('No selected characters can take that rest action right now.')
      return
    }

    const nextState: CampaignState = {
      ...current,
      actors,
      activityLog: [...(current.activityLog ?? []), `${activityMessage} (${changed} Player Character${changed === 1 ? '' : 's'}).`].slice(-80),
    }
    commitState(nextState)
    try {
      await saveWholeState(currentCampaign.id, nextState)
      setStatusMessage(successMessage(changed))
    } catch (error) {
      setStatusMessage(error instanceof Error ? `Rest state could not be saved: ${error.message}` : 'Rest state could not be saved.')
    }
  }

  const startPartyShortRest = async () => {
    const canStart = new Set(selectedRestPlayerActors
      .filter((actor) => actor.currentHp >= 1 && !actor.characterSheet?.shortRestActive)
      .map((actor) => actor.id))
    await updateRestParticipants(
      (actor) => canStart.has(actor.id) ? startActorShortRest(actor) : actor,
      (changed) => `DM started a Short Rest for ${changed} Player Character${changed === 1 ? '' : 's'}. They can spend Hit Dice one at a time.`,
      'DM started a Short Rest',
    )
  }

  const finishPartyShortRest = async () => {
    const active = new Set(selectedRestPlayerActors
      .filter((actor) => actor.characterSheet?.shortRestActive)
      .map((actor) => actor.id))
    await updateRestParticipants(
      (actor) => active.has(actor.id) ? finishActorShortRest(actor) : actor,
      (changed) => `Short Rest finished for ${changed} Player Character${changed === 1 ? '' : 's'}. Short-rest features and Pact Magic slots were restored.`,
      'DM finished a Short Rest',
    )
  }

  const cancelPartyShortRest = async () => {
    const active = new Set(selectedRestPlayerActors
      .filter((actor) => actor.characterSheet?.shortRestActive)
      .map((actor) => actor.id))
    await updateRestParticipants(
      (actor) => active.has(actor.id) ? cancelActorShortRest(actor) : actor,
      (changed) => `Short Rest cancelled for ${changed} Player Character${changed === 1 ? '' : 's'}. No rest resources were restored.`,
      'DM cancelled an interrupted Short Rest',
    )
  }

  const completePartyLongRest = async () => {
    const eligible = new Set(selectedRestPlayerActors
      .filter((actor) => actor.currentHp >= 1 && !actor.characterSheet?.spellLongRestActive)
      .map((actor) => actor.id))
    await updateRestParticipants(
      (actor) => eligible.has(actor.id) ? completeActorLongRest(actor) : actor,
      (changed) => `Long Rest completed for ${changed} Player Character${changed === 1 ? '' : 's'}. HP, Hit Dice, slots, and rest resources were restored; spell changes are open.`,
      'DM completed a Long Rest',
    )
  }

  const closePartyLongRestChanges = async () => {
    const open = new Set(selectedRestPlayerActors
      .filter((actor) => actor.characterSheet?.spellLongRestActive)
      .map((actor) => actor.id))
    await updateRestParticipants(
      (actor) => open.has(actor.id) ? closeActorLongRestChanges(actor) : actor,
      (changed) => `Spell changes closed for ${changed} Player Character${changed === 1 ? '' : 's'}.`,
      'DM closed the Long Rest spell-change window',
    )
  }

  const setRestParticipantSelected = (actorId: string, checked: boolean) => {
    const allIds = restPlayerActors.map((actor) => actor.id)
    setRestSelectedActorIds((current) => {
      const selected = new Set(current ?? allIds)
      if (checked) selected.add(actorId)
      else selected.delete(actorId)
      return [...selected]
    })
  }

  const resetTokenMovement = async (tokenId: string) => {
    await updateToken(tokenId, { movementUsedFeet: 0 })
    setStatusMessage('Token movement reset for the next turn.')
  }

  const resetAllTokenMovement = async () => {
    if (!isDm || !currentCampaign) return

    const current = gameStateRef.current
    const nextState: CampaignState = {
      ...current,
      tokens: (current.tokens ?? []).map((token) => ({
        ...token,
        movementUsedFeet: 0,
      })),
    }

    commitState(nextState)
    await saveWholeState(currentCampaign.id, nextState)
    setStatusMessage('Movement reset for all tokens.')
  }

  const testTokenSfx = async () => {
    const played = await playSfx(
      'tokens/token-snap',
      ['tokens/token-drop', 'tokens/token-move'],
    )

    setStatusMessage(
      played
        ? 'Token SFX is connected and playing.'
        : 'No token SFX cue was found. Check assets-source/audio/tokens/.',
    )
  }

  const setPlayerMovement = async (enabled: boolean) => {
    if (!isDm || !currentCampaign) return

    const nextState: CampaignState = {
      ...gameStateRef.current,
      allowPlayerMovement: enabled,
    }

    commitState(nextState)
      await saveWholeState(currentCampaign.id, nextState)
      void playSfx('tokens/token-delete')
      setStatusMessage(
      enabled
        ? 'Player self-movement enabled.'
        : 'Player self-movement locked.',
    )
  }

  const prepareCombat = async (actorIds: string[]) => {
    try {
      await emitSocketRequest('combat:start', { actorIds })
      setStatusMessage('Initiative setup opened. Players roll their own initiative; the DM rolls enemies and NPCs.')
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Combat initiative setup could not be prepared.',
      )
      throw error
    }
  }

  const assignPlayerActorForCombat = async (actorId: string, playerId: string) => {
    const player = campaignPlayers.find((candidate) => candidate.id === playerId)
    const actor = (gameStateRef.current.actors ?? []).find((candidate) => candidate.id === actorId)

    if (!player || !actor) {
      throw new Error('Player or combatant could not be found.')
    }

    await updateActor(
      actorId,
      {
        kind: 'player',
        ownerId: playerId,
      },
    )

    setStatusMessage(`${actor.name} is now linked to ${player.name} as a Player Actor.`)
  }

  const rollPlayerInitiative = async (actorId: string) => {
    try {
      const result = await emitSocketRequest('combat:roll-player-initiative', { actorId })
      void playDiceSfx(20, Number(result.rawRoll))
      setStatusMessage('Your initiative roll was submitted publicly.')
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Initiative could not be rolled.',
      )
      throw error
    }
  }

  const rollDmInitiative = async (actorId: string) => {
    try {
      const result = await emitSocketRequest('combat:roll-dm-initiative', { actorId })
      void playDiceSfx(20, Number(result.rawRoll))
      setStatusMessage('Enemy/NPC initiative rolled privately by the DM.')
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Enemy initiative could not be rolled.',
      )
      throw error
    }
  }

  const beginCombatRoundOne = async () => {
    try {
      await emitSocketRequest('combat:begin')
      void playSfx('combat/initiative-start')
      setStatusMessage('Round 1 started from the submitted initiative results.')
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Round 1 could not begin.',
      )
      throw error
    }
  }

  const setCombatInitiative = async (
    actorId: string,
    initiative: number,
  ) => {
    try {
      await emitSocketRequest('combat:set-initiative', { actorId, initiative })
      setStatusMessage('Initiative updated.')
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Initiative could not be updated.',
      )
      throw error
    }
  }

  const moveCombatTie = async (
    actorId: string,
    direction: 'up' | 'down',
  ) => {
    try {
      await emitSocketRequest('combat:move-tie', { actorId, direction })
      setStatusMessage('Initiative tie order updated.')
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Tie order could not be updated.',
      )
      throw error
    }
  }

  const previousCombatTurn = async () => {
    try {
      const previousRound = combat.round
      const result = await emitSocketRequest('combat:previous-turn')
      const nextRound = Number((result.combat as { round?: unknown } | undefined)?.round)
      void playSfx(nextRound !== previousRound ? 'combat/round-change' : 'combat/turn-change')
      setStatusMessage('Combat moved to the previous turn.')
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Previous turn could not be restored.',
      )
      throw error
    }
  }

  const nextCombatTurn = async () => {
    try {
      const previousRound = combat.round
      const result = await emitSocketRequest('combat:next-turn')
      const nextRound = Number((result.combat as { round?: unknown } | undefined)?.round)
      void playSfx(nextRound !== previousRound ? 'combat/round-change' : 'combat/turn-change')
      setStatusMessage('Combat advanced to the next turn.')
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Combat could not advance.',
      )
      throw error
    }
  }

  const endCombat = async () => {
    try {
      await emitSocketRequest('combat:end')
      void playSfx('combat/combat-end')
      setStatusMessage('Combat ended. Actor and token state remains in the campaign.')
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Combat could not be ended.',
      )
      throw error
    }
  }

  const removeToken = async (tokenId: string) => {
    if (!isDm || !currentCampaign) return

    const current = gameStateRef.current
    const token =
      (current.tokens ?? [])
        .find((candidate) => candidate.id === tokenId)
    const actor =
      token
        ? actorForToken(current.actors, token)
        : null

    const nextState: CampaignState = {
      ...current,
      tokens: (current.tokens ?? []).filter((candidate) => candidate.id !== tokenId),
    }

    commitState(nextState)
    await saveWholeState(currentCampaign.id, nextState)
    setStatusMessage(
      actor
        ? `${actor.name} removed from this map. The Actor remains in the roster.`
        : 'Token removed from the scene.',
    )
  }

  const deleteActor = async (actorId: string) => {
    if (!isDm || !currentCampaign) return

    const current = gameStateRef.current
    const actor =
      (current.actors ?? [])
        .find((candidate) => candidate.id === actorId)

    if (!actor) return

    const linkedTokenCount =
      (current.tokens ?? [])
        .filter((token) => token.actorId === actorId)
        .length

    const confirmed =
      window.confirm(
        linkedTokenCount > 0
          ? `Delete ${actor.name} and ${linkedTokenCount} linked token(s)? This removes the combatant from the campaign roster.`
          : `Delete ${actor.name} from the campaign roster?`,
      )

    if (!confirmed) return

    const nextState: CampaignState = {
      ...current,
      actors: (current.actors ?? []).filter((candidate) => candidate.id !== actorId),
      tokens: (current.tokens ?? []).filter((token) => token.actorId !== actorId),
    }

    if (pendingActorId === actorId) {
      setPendingActorId(null)
    }

    commitState(nextState)
    await saveWholeState(currentCampaign.id, nextState)
    setStatusMessage(`${actor.name} deleted from the campaign roster.`)
  }

  const startSession = async () => {
    if (!isDm || !currentCampaign) return

    try {
      const session = await requestJson<SessionRecord>(
        `/api/campaigns/${encodeURIComponent(currentCampaign.id)}/session/start`,
        { method: 'POST' },
      )
      setActiveSession(session)
      void playSfx('atmosphere/session-start', ['doors/magical-secret-reveal', 'ui/success'])
      setStatusMessage(`Session ${session.number} started.`)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Could not start session.')
    }
  }

  const endSession = async () => {
    if (!isDm || !currentCampaign) return

    try {
      await requestJson<SessionRecord>(
        `/api/campaigns/${encodeURIComponent(currentCampaign.id)}/session/end`,
        { method: 'POST' },
      )
      setActiveSession(null)
      void playSfx('atmosphere/session-end', ['combat/combat-end', 'ui/success'])
      setStatusMessage('Session ended and snapshotted.')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Could not end session.')
    }
  }

  const createSnapshot = async () => {
    if (!isDm || !currentCampaign) return

    const name = window.prompt('Snapshot name', 'Before Major Encounter')
    if (name === null) return

    try {
      const snapshot = await requestJson<SnapshotRecord>(
        `/api/campaigns/${encodeURIComponent(currentCampaign.id)}/snapshots`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        },
      )
      setSnapshots((previous) => [snapshot, ...previous])
      setStatusMessage('Snapshot created.')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Could not create snapshot.')
    }
  }

  const performDieRoll = async (sides: 4 | 6 | 8 | 10 | 12 | 20 | 100) => {
    try {
      const result = await emitSocketRequest('dice:roll', {
        sides,
        count: diceCount,
        modifier: 0,
        mode: 'normal',
        purpose: dicePurpose,
        actorId: isDm ? dmEffectSourceActorId : ownCharacter?.id ?? '',
        ability: dicePurpose === 'saving-throw' ? diceSaveAbility : undefined,
        skill: dicePurpose === 'skill-check' ? diceSkill : undefined,
      })
      const total = Number(result.total)
      if (!Number.isFinite(total)) throw new Error('The server did not return a dice total.')
      const rolls = Array.isArray(result.rolls) ? result.rolls as number[][] : []
      const natural = diceCount === 1 ? Number(rolls[0]?.[0]) : undefined
      void playDiceSfx(sides, Number.isFinite(natural) ? natural : undefined)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'The dice roll failed.')
    }
  }

  const copyCampaignJoinCode = async () => {
    const code = currentCampaign?.joinCode?.trim().toUpperCase()
    if (!code) {
      setStatusMessage('This campaign does not have a Join Code yet.')
      return
    }

    try {
      await navigator.clipboard.writeText(code)
    } catch {
      const field = document.createElement('textarea')
      field.value = code
      field.setAttribute('readonly', '')
      field.style.position = 'fixed'
      field.style.opacity = '0'
      document.body.appendChild(field)
      field.select()
      document.execCommand('copy')
      field.remove()
    }

    setStatusMessage(`Join Code ${code} copied. Send it to your players.`)
  }

  if (accessMode === 'loading') {
    return (
      <main className="startup-shell">
        <img
          className="startup-brand-logo"
          src="/assets/branding/dnd-nerds-logo.png"
          alt="D&D Nerds logo"
        />
        <h1>D&D Nerds</h1>
        <p>Dice will decide your fate</p>
      </main>
    )
  }

  if (!role) {
    return (
      <main className="startup-shell">
        <img
          className="startup-brand-logo"
          src="/assets/branding/dnd-nerds-logo.png"
          alt="D&D Nerds logo"
        />
        <h1>D&D Nerds</h1>
        <p>Dice will decide your fate</p>

        {accessMode === 'host' ? (
          <section className="gate-card">
            <header>
              <span>Dungeon Master</span>
              <h2>Choose Your Chronicle</h2>
            </header>

            <div className="campaign-grid">
              {campaigns.map((campaign) => (
                <button
                  key={campaign.id}
                  type="button"
                  className="campaign-card"
                  onClick={() => joinAsDm(campaign)}
                >
                  <strong>{campaign.name}</strong>
                  <small>Join Code</small>
                  <b>{campaign.joinCode}</b>
                </button>
              ))}
            </div>

            <form className="create-campaign" onSubmit={createCampaign}>
              <input
                value={newCampaignName}
                onChange={(event) => setNewCampaignName(event.target.value)}
                placeholder="Name a new campaign"
                maxLength={80}
              />
              <button type="submit">Begin Chronicle</button>
            </form>
          </section>
        ) : (
          <section className="gate-card player-gate">
            <header>
              <span>Adventurer</span>
              <h2>Enter the Table</h2>
            </header>

            <form className="join-form" onSubmit={joinAsPlayer}>
              <label>
                Your Name
                <input
                  value={playerName}
                  onChange={(event) => setPlayerName(event.target.value)}
                  placeholder="Adventurer name"
                />
              </label>

              <label>
                Join Code
                <input
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                  placeholder="ABC123"
                />
              </label>

              <button type="submit">Enter the Table</button>
            </form>

            <p className="character-vault-hint">
              Your Character Vault follows this browser identity between campaigns.
            </p>
          </section>
        )}

        {statusMessage ? <div className="startup-status">{statusMessage}</div> : null}
      </main>
    )
  }

  return (
    <main
      className={[
        'table-shell',
        isDm ? 'dm-shell' : 'player-shell',
        isDm && dmSpellbookOpen ? 'dm-spellbook-open' : '',
        !isDm && playerSpellbookOpen ? 'player-spellbook-open' : '',
        !isDm && playerSheetOpen ? 'player-shell-with-sheet' : '',
      ].filter(Boolean).join(' ')}
    >
      <header className="table-header">
        <div className="frozen-brand-block" aria-label="D&D Nerds">
          <Compass aria-hidden="true" />
          <span><strong>D&D NERDS</strong><small>VIRTUAL TABLETOP</small></span>
        </div>

        <button
          type="button"
          className="header-select header-campaign-select"
          onClick={() => {
            if (isDm) void copyCampaignJoinCode()
          }}
          title={isDm ? 'Copy campaign Join Code' : 'Current campaign'}
          aria-label={isDm && currentCampaign?.joinCode ? `Copy Join Code ${currentCampaign.joinCode}` : 'Current campaign'}
        >
          <span>
            <small>
              Campaign{isDm && currentCampaign?.joinCode ? ` · Join ${currentCampaign.joinCode}` : ''}
            </small>
            <strong>{currentCampaign?.name ?? 'Untitled Campaign'}</strong>
          </span>
          {isDm ? <Copy className="header-copy-icon" aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </button>

        <button
          type="button"
          className="header-select header-scene-select"
          onClick={() => {
            if (isDm) {
              setInspectorTab('maps')
              setDmInspectorExpanded(true)
            }
          }}
          title={isDm ? 'Open scene controls' : 'Current scene'}
        >
          <span><small>Scene</small><strong>{activeMap ? getMapDisplayName(activeMap) : 'No Battleground'}</strong></span>
          <ChevronDown aria-hidden="true" />
        </button>

        <div className={`header-session-state${activeSession ? ' is-live' : ''}`}>
          <CircleDot aria-hidden="true" />
          <span><small>Session</small><strong>{activeSession ? 'In Progress' : 'Not Started'}</strong></span>
        </div>

        <div className="header-session-clock">
          <Hourglass aria-hidden="true" />
          <strong><SessionElapsed session={activeSession} /></strong>
        </div>

        <div className="header-role">
          <small>Role</small>
          <strong>{isDm ? 'Dungeon Master' : playerName || 'Player'}</strong>
        </div>

        <button
          type="button"
          className="header-players"
          onClick={() => {
            setOnlineRosterOpen((open) => !open)
          }}
          aria-expanded={onlineRosterOpen}
          title="Show online players"
        >
          <Users aria-hidden="true" />
          <span><small>Players</small><strong>{activePlayerIds.size} Online</strong></span>
        </button>

        {onlineRosterOpen ? createPortal(
          <section className="header-player-popover" aria-label="Players at the table">
            <header><strong>Players at the Table</strong><button type="button" onClick={() => setOnlineRosterOpen(false)} aria-label="Close player list"><X /></button></header>
            <div>
              {campaignPlayers.length === 0 ? <p>No players have joined this campaign yet.</p> : campaignPlayers.map((player) => (
                <span key={player.id} className={activePlayerIds.has(player.id) ? 'is-online' : ''}>
                  <i />
                  <b>{player.name}</b>
                  <small>{activePlayerIds.has(player.id) ? 'Online' : 'Offline'}</small>
                </span>
              ))}
            </div>
            {isDm ? (
              <button type="button" className="header-manage-party" onClick={() => { setOnlineRosterOpen(false); setInspectorTab('party'); setDmInspectorExpanded(true) }}>Manage Party & Characters</button>
            ) : (
              <button type="button" className="header-leave-campaign" onClick={() => { setOnlineRosterOpen(false); void returnToMainMenu() }}><LogOut /> Return to Main Menu</button>
            )}
          </section>,
          document.body,
        ) : null}

        <nav className="frozen-header-tools" aria-label="Table navigation">
          <button
            type="button"
            onClick={() => document.querySelector('.dm-recent-activity, .reference-activity-panel')?.scrollIntoView({ behavior: 'smooth' })}
            title="Recent activity"
            aria-label="Recent activity"
          ><MessageSquare /></button>
          <button
            type="button"
            onClick={() => {
              if (isDm) {
                setInspectorTab('session')
                setDmInspectorExpanded(true)
              } else {
                setPlayerSheetOpen(true)
              }
            }}
            title="Settings"
            aria-label="Settings"
          ><Settings /></button>
          <button
            type="button"
            onClick={() => {
              void returnToMainMenu()
            }}
            title="Return to Main Menu"
            aria-label="Return to Main Menu"
          ><LogOut /></button>
        </nav>
      </header>

      {isDm ? (
        <nav className="dm-mobile-map-tools" aria-label="Dungeon Master map tools">
          <strong>{Math.round(cameraZoom * 100)}%</strong>
          <button type="button" onClick={() => mapViewportRef.current?.zoomOut()} aria-label="Zoom out">−</button>
          <button type="button" onClick={() => mapViewportRef.current?.zoomIn()} aria-label="Zoom in">+</button>
          <button type="button" onClick={() => mapViewportRef.current?.fitMap()}>Fit</button>
          <button type="button" onClick={() => mapViewportRef.current?.actualSize()}>1:1</button>
          <button
            type="button"
            className={toolMode === 'select' && !arcaneReachOpen ? 'is-active' : ''}
            onClick={() => {
              setArcaneReachOpen(false)
              setToolMode('select')
            }}
          >
            Select
          </button>
          <button
            type="button"
            className={toolMode === 'pan' && !arcaneReachOpen ? 'is-active' : ''}
            onClick={() => {
              setArcaneReachOpen(false)
              setPlayerTokenPlacementArmed(false)
              setToolMode('pan')
            }}
          >
            Pan
          </button>
          <button
            type="button"
            className={arcaneReachOpen ? 'is-active' : ''}
            onClick={() => {
              setArcaneReachOpen(!arcaneReachOpen)
              setPlayerTokenPlacementArmed(false)
              setPendingTokenAssetId(null)
              setPendingActorId(null)
            }}
          >
            Arcane
          </button>
        </nav>
      ) : null}

      {!isDm && combat.phase !== 'inactive' ? (
        <section className="player-mobile-initiative-slot" aria-label="Player initiative controls">
          <InitiativePanel
            isDm={false}
            currentPlayerId={currentPlayerId}
            players={initiativePlayers}
            combat={combat}
            diceLog={normalizeDiceLog(gameState.diceLog)}
            actors={gameState.actors ?? []}
            tokens={gameState.tokens ?? []}
            activeMapId={activeMap?.id ?? null}
            onPrepareCombat={prepareCombat}
            onAssignPlayerActor={assignPlayerActorForCombat}
            onRollPlayerInitiative={rollPlayerInitiative}
            onRollDmInitiative={rollDmInitiative}
            onBeginCombat={beginCombatRoundOne}
            onSetInitiative={setCombatInitiative}
            onMoveTie={moveCombatTie}
            onPreviousTurn={previousCombatTurn}
            onNextTurn={nextCombatTurn}
            onEndCombat={endCombat}
          />
        </section>
      ) : null}

      <aside className="tool-rail" aria-label="Map tools">
        <nav className="frozen-primary-tools" aria-label="Primary tabletop tools">
          <button
            type="button"
            className={(toolMode === 'select' && !arcaneReachOpen) || (!isDm && ownTokenMovementAllowed) ? 'is-active' : ''}
            onClick={() => {
              if (isDm) {
                setArcaneReachOpen(false)
                setToolMode('select')
              } else {
                toggleOwnTokenControl()
              }
            }}
            aria-label="Select"
          >
            <MousePointer2 aria-hidden="true" /><b>Select</b>
          </button>
          <button
            type="button"
            className={toolMode === 'pan' && !arcaneReachOpen ? 'is-active' : ''}
            onClick={() => {
              setArcaneReachOpen(false)
              setPlayerTokenPlacementArmed(false)
              setToolMode('pan')
            }}
            aria-label="Pan"
          >
            <Hand aria-hidden="true" /><b>Pan</b>
          </button>
          <button
            type="button"
            className={arcaneReachOpen ? 'is-active' : ''}
            onClick={() => {
              setArcaneReachOpen(!arcaneReachOpen)
              setPlayerTokenPlacementArmed(false)
              setPendingTokenAssetId(null)
              setPendingActorId(null)
            }}
            aria-label="Arcane Reach"
            title="Arcane Reach — measure distance and inspect area effects"
          >
            <Ruler aria-hidden="true" /><b>Arcane Reach</b>
          </button>
          <button
            type="button"
            disabled
            title="Drawing tools are coming in the scene-annotation pass"
            aria-label="Draw coming soon"
          >
            <Pencil aria-hidden="true" /><b>Draw</b>
          </button>
          <button
            type="button"
            className={isDm && inspectorTab === 'health' ? 'is-active' : ''}
            onClick={() => {
              if (isDm) {
                setInspectorTab('health')
                setDmInspectorExpanded(true)
              }
            }}
            aria-label="Target"
          >
            <Crosshair aria-hidden="true" /><b>Target</b>
          </button>
          <button type="button" disabled title="Fog of war is coming in the visibility pass"><CloudFog /><b>Fog <small>Soon</small></b></button>
          <button type="button" disabled title="Wall drawing is coming in the visibility pass"><Layers3 /><b>Walls <small>Soon</small></b></button>
          {isDm ? (
            <button
              type="button"
              className={restPopupOpen ? 'is-active' : ''}
              title="DM Short Rest and Long Rest controls"
              aria-label="Open Short Rest and Long Rest controls"
              aria-expanded={restPopupOpen}
              onClick={() => setRestPopupOpen((open) => !open)}
            >
              <Sun aria-hidden="true" /><b>Rest</b>
            </button>
          ) : (
            <button type="button" disabled title="Short Rests and Long Rests are controlled by the DM"><Sun /><b>Rest</b></button>
          )}
          <button
            type="button"
            onClick={() => {
              if (isDm) {
                setInspectorTab('session')
                setDmInspectorExpanded(true)
              }
            }}
            aria-label="More tools"
          ><MoreHorizontal /><b>More</b></button>
        </nav>

        {isDm && restPopupOpen ? createPortal(
          <div
            className="dm-rest-backdrop"
            role="presentation"
            onClick={(event) => {
              if (event.target === event.currentTarget) setRestPopupOpen(false)
            }}
          >
            <section className="dm-rest-dialog" role="dialog" aria-modal="true" aria-labelledby="dm-rest-title">
              <header>
                <div>
                  <span>DM CONTROL</span>
                  <h2 id="dm-rest-title">Party Rests</h2>
                </div>
                <button type="button" aria-label="Close rest controls" onClick={() => setRestPopupOpen(false)}><X /></button>
              </header>
              <p className="dm-rest-intro">
                Starting a Short Rest opens a Hit Dice choice for each selected player. Finish it here when its in-game duration is complete; Long Rest applies each character’s selected rules version.
              </p>
              <div className="dm-rest-actions">
                <button type="button" disabled={!restCanStartShortCount} onClick={() => void startPartyShortRest()}>
                  Start Short Rest{restCanStartShortCount ? ` · ${restCanStartShortCount}` : ''}
                </button>
                <button type="button" disabled={!restShortActiveCount} onClick={() => void finishPartyShortRest()}>
                  Finish Short Rest{restShortActiveCount ? ` · ${restShortActiveCount}` : ''}
                </button>
                <button type="button" disabled={!restShortActiveCount} onClick={() => void cancelPartyShortRest()}>
                  Cancel Interrupted Rest{restShortActiveCount ? ` · ${restShortActiveCount}` : ''}
                </button>
                <button type="button" disabled={!restCanCompleteLongCount} onClick={() => void completePartyLongRest()}>
                  Complete Long Rest{restCanCompleteLongCount ? ` · ${restCanCompleteLongCount}` : ''}
                </button>
                <button type="button" disabled={!restLongChangeWindowCount} onClick={() => void closePartyLongRestChanges()}>
                  Close Spell Changes{restLongChangeWindowCount ? ` · ${restLongChangeWindowCount}` : ''}
                </button>
              </div>
              <div className="dm-rest-participants-heading">
                <strong>Player Characters</strong>
                <button type="button" onClick={() => setRestSelectedActorIds(null)}>Select All</button>
              </div>
              <div className="dm-rest-participants">
                {restPlayerActors.map((actor) => {
                  const sheet = actor.characterSheet!
                  const selected = restSelectedActorIds === null || restSelectedActorIds.includes(actor.id)
                  const status = sheet.spellLongRestActive
                    ? 'Long Rest · spell changes open'
                    : sheet.shortRestActive
                      ? `Short Rest · Hit Dice ${sheet.shortRestHitDiceDone ? 'choice complete' : 'choice pending'}`
                      : actor.currentHp < 1
                        ? 'Needs at least 1 HP to rest'
                        : `Level ${actor.level}`
                  return (
                    <label key={actor.id}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(event) => setRestParticipantSelected(actor.id, event.target.checked)}
                      />
                      <span><strong>{actor.name}</strong><small>{status} · HP {actor.currentHp}/{actor.maxHp}</small></span>
                    </label>
                  )
                })}
                {!restPlayerActors.length ? <p>No linked Player Characters are in this campaign.</p> : null}
              </div>
              <small className="dm-rest-rule-note">A rest can start only at 1 HP or higher. The DM confirms when its in-game duration and conditions have been met.</small>
            </section>
          </div>,
          document.body,
        ) : null}

        {!isDm && ownCharacter?.characterSheet?.shortRestActive && !ownCharacter.characterSheet.shortRestHitDiceDone ? createPortal(
          <div className="player-short-rest-backdrop">
            <section className="player-short-rest-dialog" role="dialog" aria-modal="true" aria-labelledby="player-short-rest-title">
              <header>
                <span>SHORT REST · PLAYER CHOICE</span>
                <h2 id="player-short-rest-title">Spend Hit Dice?</h2>
              </header>
              <p>
                {ownCharacter.name}, you can roll one of your class Hit Dice to regain hit points. Choose when you are finished; the DM controls when the rest ends.
              </p>
              <div className="player-short-rest-stats">
                <span><small>Hit Die</small><strong>{ownShortRestHitDieSides ? `d${ownShortRestHitDieSides}` : 'Class required'}</strong></span>
                <span><small>Available</small><strong>{ownShortRestRemainingHitDice} / {ownShortRestTotalHitDice}</strong></span>
                <span><small>Hit Points</small><strong>{ownCharacter.currentHp} / {ownCharacter.maxHp}</strong></span>
              </div>
              <p className="player-short-rest-rule-note">Roll one die at a time and add your Constitution modifier. Your available Hit Dice are limited by your character level.</p>
              {shortRestHitDieResult ? <p className="player-short-rest-result" role="status">{shortRestHitDieResult}</p> : null}
              {ownCharacter.currentHp >= ownCharacter.maxHp ? <p className="player-short-rest-rule-note">Your Hit Points are already full, so a Hit Die cannot restore more.</p> : null}
              {!ownShortRestHitDieSides ? <p className="player-short-rest-rule-note">Choose a class on your character sheet before spending Hit Dice.</p> : null}
              <div className="player-short-rest-actions">
                <button
                  type="button"
                  disabled={shortRestHitDieBusy || !ownShortRestHitDieSides || ownShortRestRemainingHitDice < 1 || ownCharacter.currentHp >= ownCharacter.maxHp}
                  onClick={() => void rollOwnShortRestHitDie()}
                >{shortRestHitDieBusy ? 'Please wait…' : ownShortRestHitDieSides ? `Roll d${ownShortRestHitDieSides} Hit Die` : 'Choose a Class'}</button>
                <button type="button" className="player-short-rest-done" disabled={shortRestHitDieBusy} onClick={() => void finishOwnShortRestHitDiceChoice()}>
                  I’m done
                </button>
              </div>
            </section>
          </div>,
          document.body,
        ) : null}

        {isDm ? (
          <section className="dm-scene-sidebar" aria-label="Scene tools">
            <header><strong>Scene Tools</strong><CircleDot /></header>
            <button type="button" onClick={() => { setInspectorTab('grid'); setDmInspectorExpanded(true) }}><Grid3X3 /><span>Grid Settings</span></button>
            <button type="button" onClick={() => { setInspectorTab('maps'); setDmInspectorExpanded(true) }}><MapIcon /><span>Map Explorer</span></button>
            <button type="button" onClick={() => { setInspectorTab('maps'); setDmInspectorExpanded(true) }}><Settings /><span>Scene Properties</span></button>
            <button type="button" disabled title="Environment controls coming soon"><CloudFog /><span>Environment <small>Soon</small></span></button>
            <button type="button" onClick={() => { setInspectorTab('tokens'); setDmInspectorExpanded(true) }}><AudioLines /><span>Ambience & SFX</span></button>

            <div className="scene-layers-card">
              <header><strong>Layers</strong><Layers3 /></header>
              <label><input type="checkbox" checked={showTokenLayer} onChange={(event) => setShowTokenLayer(event.target.checked)} /> Tokens</label>
              <label><input type="checkbox" checked={grid.enabled} onChange={(event) => updateGrid({ enabled: event.target.checked })} /> Grid</label>
              <label className="is-muted"><input type="checkbox" disabled /> Lighting <small>Soon</small></label>
              <label className="is-muted"><input type="checkbox" disabled /> Fog <small>Soon</small></label>
              <label className="is-muted"><input type="checkbox" checked disabled /> Effects <small>Active</small></label>
              <label className="is-muted"><input type="checkbox" checked disabled /> Annotations <small>Active</small></label>
            </div>

            <div className="quick-spawn-card">
              <header><strong>Quick Spawn</strong><PackagePlus /></header>
              <button type="button" className="quick-spawn-search" onClick={() => { setInspectorTab('compendium'); setDmInspectorExpanded(true) }}><Search /><span>Search monsters…</span></button>
              {(gameState.actors ?? []).filter((actor) => actor.kind !== 'player').slice(0, 5).map((actor) => (
                <button key={actor.id} type="button" className="quick-spawn-row" onClick={() => armActorPlacement(actor)}>
                  <span className="quick-spawn-avatar">{actor.portraitUrl ? <img src={actor.portraitUrl} alt="" /> : <Swords />}</span>
                  <strong>{actor.name}</strong>
                  <small>Lv {actor.level}</small>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <div className="camera-rail-controls" aria-label="Map camera controls">
          <strong className="camera-zoom-readout">
            {Math.round(cameraZoom * 100)}%
          </strong>
          <button
            type="button"
            onClick={() => mapViewportRef.current?.zoomOut()}
            title="Zoom out"
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => mapViewportRef.current?.zoomIn()}
            title="Zoom in"
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => mapViewportRef.current?.fitMap()}
            title="Fit map"
            aria-label="Fit map"
          >
            Fit
          </button>
          <button
            type="button"
            onClick={() => mapViewportRef.current?.actualSize()}
            title="Actual size"
            aria-label="Actual size"
          >
            1:1
          </button>
        </div>

      </aside>

      {isDm && dmSpellbookOpen ? (
        <section className="dm-spellbook-stage">
          <SpellbookPanel
            onClose={() => setDmSpellbookOpen(false)}
            onMessage={setStatusMessage}
            initialSpellId={dmSpellbookTargetId}
          />
        </section>
      ) : !isDm && playerSpellbookOpen && ownCharacter ? (
        <section className="player-spellbook-stage">
          <PlayerSpellbookPanel
            actor={ownCharacter}
            onClose={() => setPlayerSpellbookOpen(false)}
            onUpdate={updateOwnCharacter}
            onMessage={setStatusMessage}
            initialSpellId={playerSpellbookTargetId}
          />
        </section>
      ) : (
      <section className="battlefield">
        <div className="battlefield-frame">
          {arcaneReachOpen ? (
            <section className="arcane-reach-panel" aria-label="Arcane Reach controls">
              <header>
                <span>
                  <Sparkles aria-hidden="true" />
                  <strong>Arcane Reach</strong>
                </span>
                <button
                  type="button"
                  className="arcane-reach-close"
                  onClick={() => {
                    setArcaneReachOpen(false)
                  }}
                  aria-label="Close Arcane Reach"
                  title="Close Arcane Reach"
                >
                  <X aria-hidden="true" />
                </button>
              </header>

              <div className="arcane-reach-modes" role="group" aria-label="Arcane Reach shape">
                {([
                  ['measure', 'Measure'],
                  ['radius', 'Radius'],
                  ['cube', 'Cube'],
                  ['cone', 'Cone'],
                  ['line', 'Line'],
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    className={arcaneReachMode === mode ? 'is-active' : ''}
                    onClick={() => {
                      setArcaneReachMode(mode)
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="arcane-reach-readout" aria-live="polite">
                <strong>
                  {arcaneReachResult?.label ?? 'Drag across the battlefield'}
                </strong>
                <span>
                  {arcaneReachMode === 'measure'
                    ? 'Distance snaps to 5-ft grid increments.'
                    : arcaneReachResult
                      ? `${arcaneReachResult.affectedTokens.length} target${arcaneReachResult.affectedTokens.length === 1 ? '' : 's'} intersect the area.`
                      : 'Drag from the origin to size and aim the area.'}
                </span>
                {arcaneReachResult && arcaneReachResult.affectedTokens.length > 0 ? (
                  <small>
                    {arcaneReachResult.affectedTokens.map((token) => token.name).join(' • ')}
                  </small>
                ) : null}
              </div>

              <button
                type="button"
                className="arcane-reach-clear"
                onClick={() => {
                  void clearOwnArcaneReachSigil()
                }}
              >
                Clear Sigil
              </button>
            </section>
          ) : null}

          <MapViewport
            ref={mapViewportRef}
            activeMap={activeMap}
            grid={grid}
            tokens={(showTokenLayer ? gameState.tokens ?? [] : [])
              .filter(
                (token) => {
                  if (token.mapId !== activeMap?.id || !token.visible) {
                    return false
                  }

                  if (!isDm || !dmVisionPreview) {
                    return true
                  }

                  return dmVisionPreview.visibleActorIds.includes(token.actorId)
                },
              )
              .map((token) => resolveRenderableToken(
                token,
                gameState.actors,
                targetSelections,
                currentPlayerId ?? '',
                role,
              ))
              .filter((token): token is RenderableSceneToken => token !== null)
              .map((token) => ({
                ...token,
                color: normalizeTokenColor(
                  token.color,
                  token.ownerId
                    ? getPlayerColor(token.ownerId)
                    : DEFAULT_TOKEN_COLOR,
                ),
              }))}
            movableTokenIds={(gameState.tokens ?? [])
              .filter((token) => {
                const actor =
                  actorForToken(
                    gameState.actors,
                    token,
                  )

                return (
                  pendingTokenAssetId === null &&
                  pendingActorId === null &&
                  !playerTokenPlacementArmed &&
                  !arcaneReachOpen &&
                  toolMode === 'select' &&
                  token.visible &&
                  Boolean(actor) &&
                  (
                    isDm ||
                    (
                      gameState.allowPlayerMovement === true &&
                      actor?.ownerId === currentPlayerId &&
                      actor?.lifeState === 'conscious' &&
                      (
                        !combat.active ||
                        combat.currentActorId === actor?.id
                      )
                    )
                  )
                )
              })
              .map((token) => token.id)}
            placementEnabled={
              isDm
                ? (pendingTokenAssetId !== null || pendingActorId !== null)
                : playerTokenPlacementArmed
            }
            onTokenMove={moveToken}
            onTokenPickup={() => {
              setHoveredToken(null)
              void playSfx('tokens/token-pickup', ['tokens/token-move'])
            }}
            onTokenHover={setHoveredToken}
            onTokenSelect={(token) => {
              setHoveredToken(token)
              void selectMapTarget(token.actorId)
              if (isDm && toolMode === 'select' && pendingTokenAssetId === null && pendingActorId === null) {
                setHealthTargetActorId(token.actorId)
                setInspectorTab('health')
              }
            }}
            showHealthBars={isDm}
            onPlaceAtGrid={isDm ? placePendingTokenAt : placeOwnTokenAt}
            onAssetDrop={isDm ? dropTokenAssetAt : undefined}
            panEnabled={
              toolMode === 'pan' &&
              !arcaneReachOpen &&
              pendingTokenAssetId === null &&
              pendingActorId === null &&
              !playerTokenPlacementArmed
            }
            onCameraChange={(camera) => setCameraZoom(camera.zoom)}
            visionRuntime={
              isDm
                ? dmVisionPreview?.runtime ?? null
                : gameState.visionRuntime ?? null
            }
            doorInteractions={
              isDm
                ? dmVisionPreview
                  ? dmVisionPreview.runtime.doors
                  : activeMap
                    ? getMapVisionSettings(activeMap.id)
                        .barriers
                        .filter(
                          (barrier) => barrier.kind === 'door',
                        )
                        .map(
                          (door): VisionDoorInteraction => ({
                            id: door.id,
                            mapId: activeMap.id,
                            state: door.doorState ?? 'closed',
                            start: door.start,
                            end: door.end,
                          }),
                        )
                    : []
                : gameState.visionRuntime?.doors ?? []
            }
            doorInteractionRole={role}
            onDoorSetState={setDoorState}
            onMapMetrics={({ width, height }) => {
              if (!isDm || !activeMap) return

              const settings = getMapVisionSettings(activeMap.id)
              if (
                settings.barriers.length === 0 ||
                (settings.mapWidth === width && settings.mapHeight === height)
              ) {
                return
              }

              void saveMapVisionSettings(
                activeMap.id,
                {
                  ...settings,
                  mapWidth: width,
                  mapHeight: height,
                  updatedAt: new Date().toISOString(),
                },
                true,
              )
            }}
            arcaneReachActive={arcaneReachOpen}
            arcaneReachMode={arcaneReachMode}
            arcaneReachControllerId={arcaneReachControllerId}
            arcaneReachColor={arcaneReachColor}
            arcaneReachSigils={sharedArcaneReachSigils}
            onArcaneReachResult={setArcaneReachResult}
            onArcaneReachCommit={(placement) => {
              void commitArcaneReachSigil(
                placement,
              )
            }}
            targetingActive={Boolean(pendingSpellCast)}
            validTargetActorIds={pendingSpellValidTargetActorIds}
            activeTurnActorId={combat.active ? combat.currentActorId : null}
            activeTurnEconomy={activeTurnEconomy}
            activeTurnMovementRemainingFeet={activeTurnMovementRemainingFeet}
            turnHudInteractive={turnHudInteractive}
            onTurnCommand={(command) => {
              if (command === 'end-turn') {
                void endCurrentTurn()
              } else {
                void useCoreTurnAction(command)
              }
            }}
            targetAreaEnabled={pendingSpellCast?.rule.mode === 'point-area'}
            targetArea={pendingSpellCast && (pendingSpellCast.rule.mode === 'point-area' || pendingSpellCast.rule.mode === 'self-area') && targetAreaPoint && pendingSpellCast.rule.radiusFeet
              ? { ...targetAreaPoint, radiusFeet: pendingSpellCast.rule.radiusFeet }
              : null}
            onTargetAreaAtGrid={(gridX, gridY) => {
              if (pendingSpellCast?.rule.mode !== 'point-area') return
              setTargetAreaPoint({ gridX, gridY })
              setStatusMessage(`${pendingSpellCast.spellName}: area selected. Choose legal targets inside the highlighted area.`)
            }}
            diceRoll={diceRollQueue[0] ?? null}
            diceTheme={selectedDiceTheme}
            onDiceRollComplete={completeDiceRoll}
          />

          {!activeMap ? (
            <section className="reference-empty-map" aria-label="No active battleground">
              <span><MapIcon /></span>
              <small>{isDm ? 'BATTLEGROUND NOT ASSIGNED' : 'WAITING FOR THE DUNGEON MASTER'}</small>
              <strong>{isDm ? 'Choose a map for this scene' : 'No active map yet'}</strong>
              <p>{isDm ? 'Open the map library, upload or select a map, then set it as the active Battleground.' : 'You are connected correctly. The table will appear here as soon as the DM activates a Battleground map.'}</p>
              {isDm ? <button type="button" onClick={() => { setInspectorTab('maps'); setDmInspectorExpanded(true) }}><ImageIcon /> Open Map Library</button> : <em><CircleDot /> Connected to {currentCampaign?.name}</em>}
            </section>
          ) : !isDm && ownCharacter && !ownTokenOnActiveMap ? (
            <section className="reference-place-token-callout" aria-label="Place your character token">
              <img src={ownCharacter.portraitUrl || '/assets/tokens/adventurer-token.svg'} alt="" />
              <span><small>ACTIVE MAP READY</small><strong>Place {ownCharacter.name} on the map</strong></span>
              <button type="button" onClick={armOwnTokenPlacement}><Crosshair /> Place My Token</button>
            </section>
          ) : null}

          {pendingSpellCast ? (
            <section className="map-action-target-bar" aria-label="Spell target selection">
              <div>
                <span>RULES TARGETING</span>
                <strong>{pendingSpellCast.spellName}</strong>
                <small>{pendingSpellCast.rule.label}</small>
                <em>
                  {currentTargetActorIds.length}/{pendingSpellCast.rule.maxTargets} target(s)
                  {pendingSpellCast.rule.mode === 'point-area'
                    ? targetAreaPoint ? ' · area selected' : ' · choose area first'
                    : ''}
                </em>
                <small>{spellRuleLabel(pendingSpellCast.spellId)}</small>
              </div>
              <div className="map-action-target-actions">
                <button type="button" onClick={() => void cancelPendingSpellCast()}>Cancel</button>
                <button
                  type="button"
                  className="is-confirm"
                  disabled={
                    currentTargetActorIds.length < pendingSpellCast.rule.minTargets ||
                    currentTargetActorIds.length > pendingSpellCast.rule.maxTargets ||
                    (pendingSpellCast.rule.mode === 'point-area' && !targetAreaPoint)
                  }
                  onClick={() => void confirmPendingSpellCast()}
                >
                  Confirm
                </button>
              </div>
            </section>
          ) : null}

          {activeReactionWindow && reactionReactor && (activeReactionWindow.kind === 'readied-action' || reactionTriggerActor) ? (
            <ReactionWindowPanel
              key={activeReactionWindow.id}
              window={activeReactionWindow}
              reactor={reactionReactor}
              triggerActor={reactionTriggerActor}
              actors={activeMapActors}
              onRespond={respondToReaction}
              onMessage={setStatusMessage}
            />
          ) : null}

          <ReadyActionStatusPanel
            actions={visibleReadiedActions}
            actors={gameState.actors ?? []}
            isDm={isDm}
            onTrigger={triggerReadyAction}
            onCancel={cancelReadyAction}
          />

          {!isDm && ownCharacter && ownNeedsDeathSave ? (
            <section className="player-death-save-panel" aria-label="Death Saving Throw">
              <header>
                <span className="player-death-save-icon"><Hourglass aria-hidden="true" /></span>
                <div>
                  <small>DEATH SAVING THROW</small>
                  <strong>{ownCharacter.name}</strong>
                  <span>
                    {ownDeathSaveTurnActive
                      ? `Your turn · Round ${combat.round}`
                      : combat.active
                        ? `Waiting for your turn · Round ${combat.round}`
                        : 'Waiting for combat'}
                  </span>
                </div>
              </header>

              <div className="player-death-save-tracks">
                <div className="is-success">
                  <span>Successes</span>
                  <b>{[0, 1, 2].map((index) => index < ownCharacter.deathSaveSuccesses ? '●' : '○').join(' ')}</b>
                </div>
                <div className="is-failure">
                  <span>Failures</span>
                  <b>{[0, 1, 2].map((index) => index < ownCharacter.deathSaveFailures ? '●' : '○').join(' ')}</b>
                </div>
              </div>

              <button
                type="button"
                className="player-death-save-roll"
                disabled={
                  deathSaveBusy ||
                  !ownDeathSaveTurnActive ||
                  ownDeathSaveRolledThisRound
                }
                onClick={() => {
                  setDeathSaveBusy(true)
                  void rollDeathSave(ownCharacter.id)
                    .catch((error) => {
                      setStatusMessage(
                        error instanceof Error
                          ? error.message
                          : 'Death Saving Throw failed.',
                      )
                    })
                    .finally(() => setDeathSaveBusy(false))
                }}
              >
                {deathSaveBusy
                  ? 'Rolling d20…'
                  : ownDeathSaveRolledThisRound
                    ? 'Death Save Complete This Round'
                    : ownDeathSaveTurnActive
                      ? 'Roll Death Save'
                      : 'Waiting for Your Turn'}
              </button>

              <small className="player-death-save-rule">
                10+ = Success · Natural 1 = 2 Failures · Natural 20 = regain 1 HP
              </small>
            </section>
          ) : null}

          {readyActionOpen && activeTurnActor && activeMap && combat.active ? (
            <ReadyActionPanel
              actor={activeTurnActor}
              actors={activeMapActors}
              turnEconomy={activeTurnEconomy}
              defaultTargetActorId={currentTargetActor?.id ?? ''}
              onClose={() => setReadyActionOpen(false)}
              onPrepare={prepareReadyAction}
            />
          ) : null}

          {utilityActionsOpen && activeTurnActor && activeMap && combat.active ? (
            <CoreUtilityActionsPanel
              actor={activeTurnActor}
              actors={activeMapActors}
              defaultTargetActorId={currentTargetActor?.id ?? ''}
              onClose={() => setUtilityActionsOpen(false)}
              onResolve={resolveUtilityAction}
            />
          ) : null}

          {!isDm && playerCharacterHudOpen && ownCharacter ? (
            <PlayerCharacterHud
              actor={ownCharacter}
              onClose={() => setPlayerCharacterHudOpen(false)}
              onOpenSheet={() => {
                setPlayerCharacterHudOpen(false)
                setPlayerSheetOpen(true)
              }}
              onOpenSpellbook={() => {
                setPlayerCharacterHudOpen(false)
                setPlayerSpellbookOpen(true)
              }}
            />
          ) : null}

          {playerSpellHudOpen && combatHudActor ? (
            <PlayerSpellHud
              actor={combatHudActor}
              isDm={isDm}
              turnEconomy={normalizeTurnEconomy(gameState.turnEconomy?.[combatHudActor.id], combatHudActor)}
              inActiveCombat={combat.active}
              isCurrentTurn={!combat.active || isDm || combat.currentActorId === combatHudActor.id}
              onClose={() => setPlayerSpellHudOpen(false)}
              onCast={(spellId, castLevel) => beginRulesSpellCast(spellId, castLevel, combatHudActor.id)}
              onEndConcentration={(actorId) => endOwnConcentration(actorId)}
              onMessage={setStatusMessage}
              onOpenSpell={(spellId) => {
                if (isDm) setDmSpellbookTargetId(spellId)
                else setPlayerSpellbookTargetId(spellId)
                setPlayerSpellHudOpen(false)
                if (isDm) setDmSpellbookOpen(true)
                else setPlayerSpellbookOpen(true)
              }}
            />
          ) : null}

          {playerAttackHudOpen && combatHudActor ? (
            <PlayerAttackHud
              actor={combatHudActor}
              target={currentTargetActor}
              targets={activeMapActors.filter((candidate) => candidate.id !== combatHudActor.id)}
              isDm={isDm}
              onSelectTarget={(actorId) => void selectMapTarget(actorId, combatHudActor.id)}
              onClose={() => setPlayerAttackHudOpen(false)}
              onResolve={resolveCombatAttack}
              onMessage={setStatusMessage}
            />
          ) : null}

          {hoveredToken ? (
            <div className="map-token-hover-card" role="status">
              {hoveredToken.imageUrl ? <img src={hoveredToken.imageUrl} alt="" /> : null}
              <div>
                <strong>{hoveredToken.name}</strong>
                {(hoveredToken.conditions.length > 0 || hoveredToken.effects.length > 0 || hoveredToken.tempHp > 0) ? (
                  <small>
                    {[
                      ...hoveredToken.conditions,
                      ...hoveredToken.effects.filter((effect) => effect.kind !== 'condition').map((effect) => effect.name),
                      ...(hoveredToken.tempHp > 0 ? [`Temp HP ${hoveredToken.tempHp}`] : []),
                    ].slice(0, 4).join(' · ')}
                  </small>
                ) : null}
              </div>
            </div>
          ) : null}

          {isDm && currentTargetActor ? (
            <TargetEffectsPanel
              target={currentTargetActor}
              isDm={isDm}
              ownActor={ownCharacter}
              sourceActors={gameState.actors ?? []}
              sourceActorId={dmEffectSourceActorId}
              onSourceActorChange={updateDmEffectSource}
              onApply={applyTargetEffect}
              onRemove={removeTargetEffect}
              onClearTarget={() => void selectMapTarget(null)}
              turnEconomy={normalizeTurnEconomy(gameState.turnEconomy?.[currentTargetActor.id], currentTargetActor)}
              onTurnOverride={(patch, label) => overrideTurnEconomy(currentTargetActor.id, patch, label)}
              onTurnReset={() => resetTurnEconomyOverride(currentTargetActor.id)}
            />
          ) : null}

          {!isDm && ownCharacter && !playerSpellHudOpen && !playerAttackHudOpen && !playerCharacterHudOpen ? (
            <button
              type="button"
              className="player-quick-cast-trigger"
              onClick={() => { setPlayerAttackHudOpen(false); setPlayerSpellHudOpen(true) }}
            >
              <span aria-hidden="true">✦</span>
              Quick Cast
            </button>
          ) : null}

          {!isDm && ownCharacter && !playerSpellHudOpen && !playerAttackHudOpen && !playerCharacterHudOpen ? (
            <button
              type="button"
              className="player-quick-character-trigger"
              onClick={() => {
                setPlayerSpellHudOpen(false)
                setPlayerAttackHudOpen(false)
                setPlayerCharacterHudOpen(true)
              }}
            >
              <span aria-hidden="true">◆</span>
              Character
            </button>
          ) : null}

        </div>
      </section>
      )}

      {isDm ? (
        <aside className="inspector">
          <FloatingTurnOrder
            status={combat.active ? `Round ${combat.round}` : combat.phase === 'setup' ? 'Setup' : 'Ready'}
          >
            <InitiativePanel
              isDm
              currentPlayerId={currentPlayerId}
              players={initiativePlayers}
              combat={combat}
              diceLog={normalizeDiceLog(gameState.diceLog)}
              actors={gameState.actors ?? []}
              tokens={gameState.tokens ?? []}
              activeMapId={activeMap?.id ?? null}
              onPrepareCombat={prepareCombat}
              onAssignPlayerActor={assignPlayerActorForCombat}
              onRollPlayerInitiative={rollPlayerInitiative}
              onRollDmInitiative={rollDmInitiative}
              onBeginCombat={beginCombatRoundOne}
              onSetInitiative={setCombatInitiative}
              onMoveTie={moveCombatTie}
              onPreviousTurn={previousCombatTurn}
              onNextTurn={nextCombatTurn}
              onEndCombat={endCombat}
            />
          </FloatingTurnOrder>

          <section className="dm-command-center" aria-label="DM Command Center">
            <header>
              <span className="dm-command-mark"><Shield /></span>
              <div><strong>DM Command Center</strong><small>Complete control at your fingertips</small></div>
              <Sparkles aria-hidden="true" />
            </header>
            {([
              ['party', Users, 'Party', 'Players, characters, XP'],
              ['health', Swords, 'Combat', 'Initiative, turn control, effects'],
              ['maps', ImageIcon, 'Scene', 'Maps, grid, tokens, environment'],
              ['compendium', LibraryBig, 'Compendium', 'Monsters, NPCs, items'],
              ['library', BookOpenText, 'Rules Library', 'Spells, feats, equipment'],
              ['vision', Eye, 'Vision', 'LOS, fog, walls, doors, collision'],
              ['tokens', Volume2, 'Audio', 'Music, SFX, ambience'],
              ['tokens', PackagePlus, 'Token Manager', 'Tokens on map, size, ownership'],
              ['session', Settings, 'System & Session', 'Session control, snapshots, system'],
            ] as Array<[InspectorTab, typeof Users, string, string]>).map(([tab, Icon, label, note], index) => (
              <button
                key={`${tab}-${label}`}
                type="button"
                className={inspectorTab === tab && dmInspectorExpanded ? 'is-active' : ''}
                onClick={() => {
                  setInspectorTab(tab)
                  setDmInspectorExpanded(true)
                }}
              >
                <Icon aria-hidden="true" />
                <span><strong>{label}</strong><small>{note}</small></span>
                <ChevronRight aria-hidden="true" />
                {index === 0 ? <i aria-hidden="true" /> : null}
              </button>
            ))}
          </section>

          <section className="dm-recent-activity" aria-label="Recent Activity">
            <header><strong>Recent Activity</strong><small>{recentTableRolls.length} events</small></header>
            {recentTableRolls.length ? recentTableRolls.map((event, index) => (
              <p key={event.id}><CircleDot /><span>{event.text}</span><time>{index === 0 ? 'now' : `${index + 1}m`}</time></p>
            )) : <p className="is-empty"><CircleDot /><span>The table is ready.</span></p>}
          </section>

          <nav className="reference-inspector-tabs" aria-label="Inspector tabs">
            <button
              type="button"
              className={inspectorTab === 'actors' || inspectorTab === 'tokens' ? 'is-active' : ''}
              onClick={() => setInspectorTab('actors')}
            >
              Creature
            </button>
            <button
              type="button"
              className={inspectorTab === 'party' ? 'is-active' : ''}
              onClick={() => setInspectorTab('party')}
            >
              Player
            </button>
            <button
              type="button"
              className={inspectorTab === 'health' ? 'is-active' : ''}
              onClick={() => setInspectorTab('health')}
            >
              Effects
            </button>
          </nav>

          <nav className="inspector-tabs inspector-tabs-legacy" aria-label="Dungeon Master inspector tools">
            {([
              ['party', 'PARTY'],
              ['health', 'HEALTH'],
              ['grid', 'GRID'],
              ['maps', 'MAPS'],
              ['compendium', 'COMPENDIUM'],
              ['library', 'RULES'],
              ['actors', 'ACTORS'],
              ['tokens', 'TOKENS'],
              ['session', 'SESSION'],
            ] as Array<[InspectorTab, string]>).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                className={inspectorTab === tab ? 'is-active' : ''}
                onClick={() => setInspectorTab(tab)}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className={`inspector-body${dmInspectorExpanded ? ' is-open' : ''}`}>
            <header className="inspector-detail-header">
              <button type="button" onClick={() => setDmInspectorExpanded(false)} aria-label="Back to command center">‹</button>
              <span className="inspector-detail-title">
                {inspectorTab === 'party' ? <Users aria-hidden="true" />
                  : inspectorTab === 'health' ? <Swords aria-hidden="true" />
                    : inspectorTab === 'grid' ? <Grid3X3 aria-hidden="true" />
                      : inspectorTab === 'maps' ? <MapIcon aria-hidden="true" />
                        : inspectorTab === 'vision' ? <Eye aria-hidden="true" />
                          : inspectorTab === 'compendium' ? <LibraryBig aria-hidden="true" />
                          : inspectorTab === 'library' ? <BookOpenText aria-hidden="true" />
                            : inspectorTab === 'actors' ? <Users aria-hidden="true" />
                              : inspectorTab === 'tokens' ? <PackagePlus aria-hidden="true" />
                                : <Settings aria-hidden="true" />}
                <strong>{inspectorTab === 'party' ? 'Party' : inspectorTab === 'health' ? 'Combat' : inspectorTab === 'grid' ? 'Grid Settings' : inspectorTab === 'maps' ? 'Scene' : inspectorTab === 'vision' ? 'Vision' : inspectorTab === 'compendium' ? 'Compendium' : inspectorTab === 'library' ? 'Rules Library' : inspectorTab === 'actors' ? 'Characters' : inspectorTab === 'tokens' ? 'Token Manager' : 'System & Session'}</strong>
              </span>
              <button type="button" onClick={() => setDmInspectorExpanded(false)} aria-label="Close panel"><X /></button>
            </header>
            {inspectorTab === 'party' ? (
              <section className="dm-party-panel">
                <div className="party-xp-award" aria-label="Award XP to Party">
                  <strong>XP Award</strong>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    aria-label="XP awarded to each Player"
                    placeholder="XP each"
                    value={partyXpGrantDraft}
                    onChange={(event) => setPartyXpGrantDraft(event.target.value)}
                  />
                  <button
                    type="button"
                    className="primary-button"
                    disabled={Math.round(Number(partyXpGrantDraft) || 0) <= 0}
                    onClick={() => void grantXpToAllPlayers()}
                    title="Award this XP amount to every Player"
                  >
                    <Sparkles aria-hidden="true" />
                    Award
                  </button>
                </div>

                <div className="party-list">
                  {campaignPlayers.map((player) => {
                    const playerColor = getPlayerColor(player.id)
                    const connected = activePlayerIds.has(player.id)
                    const playerActor = (gameState.actors ?? []).find(
                      (actor) => actor.kind === 'player' && actor.ownerId === player.id,
                    ) ?? null
                    const playerToken = playerActor && activeMap
                      ? (gameState.tokens ?? []).find(
                          (token) => token.actorId === playerActor.id && token.mapId === activeMap.id,
                        ) ?? null
                      : null
                    const playerXp =
                      playerActor?.characterSheet?.experiencePoints ?? 0

                    return (
                      <div
                        className={`party-member party-member-with-character${connected ? ' is-online' : ''}`}
                        key={player.id}
                      >
                        <span
                          className="party-member-mark"
                          style={{
                            borderColor: playerColor,
                            color: playerColor,
                            boxShadow: `inset 0 0 0 2px ${playerColor}33`,
                          }}
                        >
                          {playerActor?.portraitUrl ? (
                            <img src={playerActor.portraitUrl} alt="" />
                          ) : (
                            player.name.slice(0, 1).toUpperCase()
                          )}
                        </span>

                        <div className="party-member-copy">
                          <div className="party-member-name-row">
                            <strong>{player.name}</strong>
                            <span className={connected ? 'party-status is-online' : 'party-status'}>
                              {connected ? 'ONLINE' : 'OFFLINE'}
                            </span>
                          </div>

                          <div className="party-player-facts">
                            <span className="party-player-id" title={player.id}>
                              <small>ID</small>
                              <code>{player.id}</code>
                            </span>
                            <span>
                              <small>LVL</small>
                              <b>{playerActor?.level ?? '—'}</b>
                            </span>
                            <span>
                              <small>XP</small>
                              <b>{playerXp.toLocaleString()}</b>
                            </span>
                          </div>
                        </div>

                        <div className="party-character-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={!playerActor}
                            onClick={() => {
                              if (!playerActor) return
                              setInspectorTab('actors')
                              setDmSheetActorId(playerActor.id)
                            }}
                          >
                            <BookOpenText aria-hidden="true" />
                            Open Sheet
                          </button>

                          {!connected ? (
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => {
                                void allowPlayerSeatRecovery(
                                  player.id,
                                  player.name,
                                )
                              }}
                            >
                              <Users aria-hidden="true" />
                              Allow Rejoin
                            </button>
                          ) : null}

                          <button
                            type="button"
                            className="secondary-button"
                            disabled={!playerActor || !activeMap || Boolean(playerToken) || !playerActor.portraitUrl}
                            onClick={() => {
                              if (playerActor) armActorPlacement(playerActor)
                            }}
                          >
                            <Crosshair aria-hidden="true" />
                            {playerToken ? 'On Map' : 'Place Token'}
                          </button>

                          <button
                            type="button"
                            className="party-kick-button"
                            onClick={() => {
                              void kickPlayerFromCampaign(
                                player.id,
                                player.name,
                              )
                            }}
                          >
                            <LogOut aria-hidden="true" />
                            Kick
                          </button>

                          <button
                            type="button"
                            className="party-ban-button"
                            onClick={() => {
                              void banPlayerFromCampaign(
                                player.id,
                                player.name,
                              )
                            }}
                          >
                            <Shield aria-hidden="true" />
                            Ban
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {bannedPlayers.length > 0 ? (
                  <section className="party-banned-list" aria-label="Banned Players">
                    <header>
                      <strong>BANNED</strong>
                      <span>{bannedPlayers.length}</span>
                    </header>

                    {bannedPlayers.map((player) => (
                      <div className="party-banned-member" key={player.id}>
                        <div>
                          <strong>{player.name}</strong>
                          <code title={player.id}>{player.id}</code>
                        </div>
                        <button
                          type="button"
                          className="party-unban-button"
                          onClick={() => {
                            void unbanPlayerFromCampaign(
                              player.id,
                              player.name,
                            )
                          }}
                        >
                          <Shield aria-hidden="true" />
                          Unban
                        </button>
                      </div>
                    ))}
                  </section>
                ) : null}
              </section>
            ) : null}

            {inspectorTab === 'health' ? (
              <section>
                <HealthPanel
                  actors={gameState.actors ?? []}
                  tokens={gameState.tokens ?? []}
                  activeMapId={activeMap?.id ?? null}
                  combat={combat}
                  turnEconomyByActorId={gameState.turnEconomy ?? {}}
                  selectedActorId={healthTargetActorId}
                  onSelectedActorIdChange={setHealthTargetActorId}
                  healthLog={normalizeHealthLog(gameState.healthLog)}
                  onApplyHealth={applyActorHealth}
                  onRollDeathSave={rollDeathSave}
                  onResolveAttack={resolveCombatAttack}
                  onUpdateActor={updateActor}
                  onMessage={setStatusMessage}
                />
              </section>
            ) : null}

            {inspectorTab === 'grid' ? (
              <section>
                {!activeMap ? (
                  <p className="empty-note">Activate a map before calibrating its grid.</p>
                ) : (
                  <div className="grid-editor">
                    <label className="toggle-row">
                      <span>Show Grid</span>
                      <input
                        type="checkbox"
                        checked={grid.enabled}
                        onChange={(event) => updateGrid({ enabled: event.target.checked })}
                      />
                    </label>

                    <label>
                      Cell Size (px)
                      <input
                        type="text"
                        inputMode="numeric"
                        value={cellSizeDraft}
                        onChange={(event) => {
                          const nextValue = event.target.value

                          if (/^\d{0,3}$/.test(nextValue)) {
                            setCellSizeDraft(nextValue)
                          }
                        }}
                        onBlur={commitCellSizeDraft}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.currentTarget.blur()
                          }

                          if (event.key === 'Escape') {
                            setCellSizeDraft(String(Math.round(grid.cellSize)))
                            event.currentTarget.blur()
                          }
                        }}
                        aria-label="Grid cell size in pixels"
                      />
                    </label>

                    <div className="two-column-inputs">
                      <label>
                        Offset X
                        <input
                          type="number"
                          step="1"
                          value={Math.round(grid.offsetX)}
                          onChange={(event) => updateGrid({ offsetX: Number(event.target.value) })}
                        />
                      </label>
                      <label>
                        Offset Y
                        <input
                          type="number"
                          step="1"
                          value={Math.round(grid.offsetY)}
                          onChange={(event) => updateGrid({ offsetY: Number(event.target.value) })}
                        />
                      </label>
                    </div>

                    <label>
                      Grid Opacity — {Math.round(grid.opacity * 100)}%
                      <input
                        type="range"
                        min="0.05"
                        max="1"
                        step="0.05"
                        value={grid.opacity}
                        onChange={(event) => updateGrid({ opacity: Number(event.target.value) })}
                      />
                    </label>

                    <details className="grid-help guide-disclosure">
                      <summary>Grid Guide</summary>
                      <div>
                        <strong>Calibration</strong>
                        <p>Match Cell Size to one square on the map. Then adjust X/Y Offset until both grids overlap.</p>
                        <p>Grid belongs to the map. Camera pan/zoom stays private to each browser.</p>
                      </div>
                    </details>
                  </div>
                )}
              </section>
            ) : null}

            {inspectorTab === 'maps' ? (
              <section className="scene-map-manager">
                <div className="scene-map-upload">
                  <label className="file-drop scene-map-file-drop">
                    <strong>Add Map</strong>
                    <small>PNG • JPG • WEBP</small>
                    <input
                      ref={mapFileInput}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                    />
                  </label>
                  <button
                    type="button"
                    className="primary-button scene-map-upload-button"
                    onClick={uploadMap}
                  >
                    <PackagePlus />
                    Add to Campaign Maps
                  </button>
                </div>

                <div className="scene-role-strip" aria-label="Current map assignments">
                  <article className="scene-role-slot is-battleground">
                    <span className="scene-role-icon"><Swords /></span>
                    <span>
                      <small>BATTLEGROUND</small>
                      <strong title={activeMap ? getMapDisplayName(activeMap) : 'Not Assigned'}>
                        {activeMap ? getMapDisplayName(activeMap) : 'Not Assigned'}
                      </strong>
                    </span>
                  </article>

                  <article className="scene-role-slot is-live-player-map">
                    <span className="scene-role-icon"><Eye /></span>
                    <span>
                      <small>PLAYER VIEW</small>
                      <strong title={publishedMap ? getMapDisplayName(publishedMap) : 'Not Published'}>
                        {publishedMap ? getMapDisplayName(publishedMap) : 'Not Published'}
                      </strong>
                    </span>
                  </article>

                  <article className="scene-role-slot is-world-map">
                    <span className="scene-role-icon"><MapIcon /></span>
                    <span>
                      <small>WORLD MAP</small>
                      <strong title={worldMap ? getMapDisplayName(worldMap) : 'Not Assigned'}>
                        {worldMap ? getMapDisplayName(worldMap) : 'Not Assigned'}
                      </strong>
                    </span>
                    {worldMap ? (
                      <span className="scene-role-slot-actions">
                        <button type="button" onClick={() => setWorldMapOpen(true)}>View</button>
                        <button type="button" onClick={() => void clearWorldMap()}>Clear</button>
                      </span>
                    ) : null}
                  </article>
                </div>

                <div className="scene-map-library-heading">
                  <strong>Campaign Maps</strong>
                  <small>{maps.length} {maps.length === 1 ? 'map' : 'maps'}</small>
                </div>

                <div className="scene-map-library">
                  {maps.length === 0 ? (
                    <div className="scene-map-empty">
                      <ImageIcon />
                      <strong>No maps uploaded</strong>
                      <small>Add a map above, prepare it for the DM, configure Vision, then publish it to Players.</small>
                    </div>
                  ) : null}

                  {maps.map((map) => {
                    const displayName = getMapDisplayName(map)
                    const isBattleground = activeMap?.id === map.id
                    const isPublished = publishedMap?.id === map.id
                    const isWorldMap = worldMap?.id === map.id
                    const isRenaming = renamingMapId === map.id
                    const visionSettings = getMapVisionSettings(map.id)
                    const visionReady = visionSettings.barriers.length > 0

                    return (
                      <article
                        key={map.id}
                        className={[
                          'scene-map-card',
                          isBattleground ? 'is-battleground' : '',
                          isBattleground && !isPublished ? 'is-dm-draft' : '',
                          isPublished ? 'is-player-live' : '',
                          isWorldMap ? 'is-world-map' : '',
                        ].filter(Boolean).join(' ')}
                      >
                        <div className="scene-map-card-main">
                          <img src={map.url} alt="" className="scene-map-card-preview" loading="lazy" decoding="async" />

                          <div className="scene-map-card-identity">
                            {isRenaming ? (
                              <div className="scene-map-rename-row">
                                <input
                                  autoFocus
                                  type="text"
                                  value={mapRenameDraft}
                                  maxLength={100}
                                  aria-label={`Rename ${displayName}`}
                                  onChange={(event) => setMapRenameDraft(event.currentTarget.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Escape') {
                                      setRenamingMapId(null)
                                      setMapRenameDraft('')
                                    }

                                    if (event.key === 'Enter') {
                                      event.preventDefault()
                                      const nextName = mapRenameDraft.trim()

                                      if (!nextName) {
                                        setStatusMessage('Map name cannot be empty.')
                                        return
                                      }

                                      void renameMap(map.id, nextName).then(() => {
                                        setRenamingMapId(null)
                                        setMapRenameDraft('')
                                      })
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  className="scene-map-icon-action"
                                  title="Save name"
                                  aria-label="Save map name"
                                  onClick={() => {
                                    const nextName = mapRenameDraft.trim()

                                    if (!nextName) {
                                      setStatusMessage('Map name cannot be empty.')
                                      return
                                    }

                                    void renameMap(map.id, nextName).then(() => {
                                      setRenamingMapId(null)
                                      setMapRenameDraft('')
                                    })
                                  }}
                                >
                                  <Check />
                                </button>
                                <button
                                  type="button"
                                  className="scene-map-icon-action"
                                  title="Cancel rename"
                                  aria-label="Cancel map rename"
                                  onClick={() => {
                                    setRenamingMapId(null)
                                    setMapRenameDraft('')
                                  }}
                                >
                                  <X />
                                </button>
                              </div>
                            ) : (
                              <strong className="scene-map-card-name" title={displayName}>
                                {displayName}
                              </strong>
                            )}

                            <div className="scene-map-card-meta">
                              <span>{(map.byteSize / 1024 / 1024).toFixed(1)} MB</span>
                              {isBattleground ? <span className="scene-map-role-badge battleground">DM Battleground</span> : null}
                              {isPublished ? <span className="scene-map-role-badge live">Live for Players</span> : null}
                              {isWorldMap ? <span className="scene-map-role-badge world">World Map</span> : null}
                              <span className={`scene-map-role-badge vision${visionReady ? ' is-ready' : ''}`}>
                                Vision {visionReady ? 'Ready' : 'Not Setup'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="scene-map-card-actions">
                          <button
                            type="button"
                            className={isBattleground ? 'is-selected' : ''}
                            disabled={isBattleground}
                            onClick={() => void activateMap(map)}
                          >
                            <Swords />
                            <span>{isBattleground ? 'Prepared for DM' : 'Prepare for DM'}</span>
                          </button>

                          <button
                            type="button"
                            className={isBattleground && !isPublished ? 'primary-button' : isPublished ? 'is-selected' : ''}
                            disabled={!isBattleground || isPublished}
                            onClick={() => void publishMapToPlayers(map)}
                          >
                            <Eye />
                            <span>{isPublished ? 'Live for Players' : 'Publish to Players'}</span>
                          </button>

                          <button
                            type="button"
                            className={isWorldMap ? 'is-selected' : ''}
                            disabled={isWorldMap}
                            onClick={() => void assignWorldMap(map)}
                          >
                            <MapIcon />
                            <span>{isWorldMap ? 'World Map' : 'Set World Map'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setVisionEditorMapId(map.id)
                            }}
                          >
                            <Eye />
                            <span>Setup Vision</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setRenamingMapId(map.id)
                              setMapRenameDraft(displayName)
                            }}
                          >
                            <Pencil />
                            <span>Rename</span>
                          </button>

                          <button
                            type="button"
                            className="is-danger"
                            onClick={() => void deleteMap(map)}
                          >
                            <Trash2 />
                            <span>Delete</span>
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>
            ) : null}

            {inspectorTab === 'vision' ? (
              <section className="dm-vision-panel">
                <div className="dm-vision-summary">
                  <Eye />
                  <span>
                    <strong>Per-Map Vision Geometry</strong>
                    <small>
                      Draw walls and doors once. Geometry is stored in normalized map space so zoom and grid changes do not move it.
                    </small>
                  </span>
                </div>

                <div className="dm-vision-publish-workflow" role="note">
                  <strong>Prepare → Review → Publish</strong>
                  <small>Preparing a map changes the DM scene only. Players keep seeing the current live map until you publish the reviewed scene.</small>
                </div>

                <div className="dm-vision-safety is-runtime">
                  <strong>VISION RUNTIME</strong>
                  <small>
                    Enabled maps now enforce Player LOS and Fog. Walls and closed/locked doors also block movement and automated attacks, spells, projectiles and effects.
                  </small>
                </div>

                <div className="dm-vision-preview-control">
                  <span>
                    <Eye aria-hidden="true" />
                    <span>
                      <strong>Preview As Player</strong>
                      <small>See the Battleground exactly through one Player's current LOS.</small>
                    </span>
                  </span>
                  <select
                    value={dmVisionPreviewPlayerId}
                    onChange={(event) => {
                      const playerId = event.currentTarget.value
                      setDmVisionPreviewPlayerId(playerId)
                      if (!playerId) {
                        setDmVisionPreview(null)
                      }
                    }}
                  >
                    <option value="">DM Full Vision</option>
                    {campaignPlayers.map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.name}
                      </option>
                    ))}
                  </select>
                  {dmVisionPreviewPlayerId ? (
                    <small className="dm-vision-preview-status">
                      {dmVisionPreview?.runtime.enabled
                        ? `${dmVisionPreview.runtime.sourceActorIds.length} vision source${dmVisionPreview.runtime.sourceActorIds.length === 1 ? '' : 's'} active`
                        : 'Vision inactive for this Player: confirm an owned token is on the Battleground and Vision is enabled.'}
                    </small>
                  ) : null}
                </div>

                <div className="dm-vision-player-ranges">
                  <div className="dm-vision-player-ranges-heading">
                    <span>
                      <Eye aria-hidden="true" />
                      <span>
                        <strong>Player Sight Range</strong>
                        <small>
                          Current geometric sight radius. Walls and closed doors still clip the visible area.
                        </small>
                      </span>
                    </span>
                    <small>5–1000 ft</small>
                  </div>

                  <div className="dm-vision-player-range-list">
                    {(gameState.actors ?? [])
                      .filter((actor) => actor.kind === 'player' && Boolean(actor.ownerId))
                      .map((actor) => (
                        <label className="dm-vision-player-range-row" key={actor.id}>
                          <span>
                            <strong>{actor.name}</strong>
                            <small>{actor.ownerId ? 'Player Character' : 'Character'}</small>
                          </span>
                          <span className="dm-vision-range-input">
                            <input
                              key={`${actor.id}:${actor.visionRangeFeet ?? 60}`}
                              type="number"
                              min={5}
                              max={1000}
                              step={5}
                              defaultValue={actor.visionRangeFeet ?? 60}
                              onBlur={(event) => {
                                const parsed = Number(event.currentTarget.value)
                                const nextRange =
                                  Number.isFinite(parsed)
                                    ? Math.max(5, Math.min(1000, Math.round(parsed / 5) * 5))
                                    : 60

                                event.currentTarget.value = String(nextRange)

                                if (nextRange !== (actor.visionRangeFeet ?? 60)) {
                                  void updateActor(
                                    actor.id,
                                    {
                                      visionRangeFeet: nextRange,
                                    },
                                  )
                                }
                              }}
                            />
                            <b>ft</b>
                          </span>
                        </label>
                      ))}
                  </div>
                </div>

                <div className="dm-vision-map-list">
                  {maps.length === 0 ? (
                    <div className="dm-vision-empty">
                      <Eye />
                      <strong>No Campaign Maps</strong>
                      <small>Add a map in Scene first.</small>
                    </div>
                  ) : null}

                  {maps.map((map) => {
                    const settings = getMapVisionSettings(map.id)
                    const ready = settings.barriers.length > 0
                    const isBattleground = activeMap?.id === map.id
                    const isPublished = publishedMap?.id === map.id

                    return (
                      <article className="dm-vision-map-card" key={map.id}>
                        <img src={map.url} alt="" />

                        <span className="dm-vision-map-copy">
                          <strong title={getMapDisplayName(map)}>
                            {getMapDisplayName(map)}
                          </strong>
                          <small>
                            {isBattleground ? 'PREPARED FOR DM · ' : ''}
                            {isPublished ? 'LIVE FOR PLAYERS · ' : ''}
                            {settings.barriers.length} barriers · {settings.enabled ? 'Enabled' : 'Safe / Disabled'}
                          </small>
                        </span>

                        <span className={`dm-vision-map-status${ready ? ' is-ready' : ''}`}>
                          {ready ? 'READY' : 'SETUP'}
                        </span>

                        <div className="dm-vision-map-actions">
                          <button
                            type="button"
                            onClick={() => setVisionEditorMapId(map.id)}
                          >
                            <Eye />
                            {ready ? 'Edit Vision' : 'Setup Vision'}
                          </button>
                          <button
                            type="button"
                            className="dm-vision-map-prepare"
                            disabled={isBattleground}
                            onClick={() => void activateMap(map)}
                          >
                            <Swords />
                            {isBattleground ? 'Prepared for DM' : 'Prepare for DM'}
                          </button>
                          <button
                            type="button"
                            className="dm-vision-map-publish"
                            disabled={!isBattleground || isPublished}
                            onClick={() => void publishMapToPlayers(map)}
                          >
                            {isPublished ? <Check /> : <Eye />}
                            {isPublished ? 'Live for Players' : 'Publish to Players'}
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>
            ) : null}

            {inspectorTab === 'compendium' ? (
              <section>
                <MonsterCompendium
                  onCreateActor={createMonsterActor}
                  onMessage={setStatusMessage}
                />
              </section>
            ) : null}

            {inspectorTab === 'library' ? (
              <section>
                <ContentLibrary />
              </section>
            ) : null}

            {inspectorTab === 'actors' ? (
              <section>
                <div className="actor-foundation-note">
                  <strong>Actor = mechanics • Token = map presence</strong>
                  <p>
                    Removing a token from a map no longer deletes the combatant. HP, AC,
                    ability scores, owner, level and speed live on the Actor and persist
                    across maps.
                  </p>
                </div>

                {dmSheetActor ? (
                  <CharacterSheetPanel
                    actor={dmSheetActor}
                    canEdit
                    canEditProgression
                    title="DM Character Editor"
                    onClose={() => setDmSheetActorId(null)}
                    onUpdate={(patch) => updateActor(dmSheetActor.id, patch)}
                    onMessage={setStatusMessage}
                    spellView="summary"
                    onOpenSpell={(spellId) => {
                      setDmSpellbookTargetId(spellId)
                      setDmSpellbookOpen(true)
                    }}
                  />
                ) : (
                  <ActorRoster
                    actors={gameState.actors ?? []}
                    tokens={gameState.tokens ?? []}
                    tokenAssets={tokenAssets}
                    players={campaignPlayers.map((player) => ({ id: player.id, name: player.name }))}
                    activeMapId={activeMap?.id ?? null}
                    pendingActorId={pendingActorId}
                    onUpdateActor={updateActor}
                    onArmPlacement={armActorPlacement}
                    onCancelPlacement={() => setPendingActorId(null)}
                    onOpenCharacterSheet={setDmSheetActorId}
                    onDeleteActor={deleteActor}
                    onMessage={setStatusMessage}
                  />
                )}
              </section>
            ) : null}

            {inspectorTab === 'tokens' ? (
              <section>
                <label className="toggle-row movement-toggle">
                  <span>
                    <strong>Player Self-Movement</strong>
                    <small>Owned visible tokens • movement budget enforced</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={gameState.allowPlayerMovement === true}
                    onChange={(event) => setPlayerMovement(event.target.checked)}
                  />
                </label>

                <label className="toggle-row movement-toggle">
                  <span>
                    <strong>Token SFX</strong>
                    <small>Pickup • drop • snap feedback</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={tokenSfxEnabled}
                    onChange={(event) => setTokenSfxEnabled(event.target.checked)}
                  />
                </label>

                <button type="button" className="secondary-button token-sfx-test" onClick={() => void testTokenSfx()}>
                  Test Token SFX
                </button>

                <label className="file-drop">
                  <strong>Choose Portrait</strong>
                  <small>PNG • JPG • WEBP</small>
                  <input
                    ref={tokenFileInput}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                  />
                </label>

                <button type="button" className="primary-button" onClick={uploadTokenAsset}>
                  Add to Token Chest
                </button>

                {pendingTokenAssetId ? (
                  <div className="token-placement-banner">
                    <strong>Placement armed</strong>
                    <span>Click the map where the token should appear.</span>
                    <button type="button" onClick={() => setPendingTokenAssetId(null)}>Cancel</button>
                  </div>
                ) : null}

                <div className="token-asset-list">
                  {tokenAssets.map((asset) => (
                    <button
                      type="button"
                      className={pendingTokenAssetId === asset.id ? 'token-asset is-selected' : 'token-asset'}
                      key={asset.id}
                      onClick={() => {
                        // Some browsers dispatch a click after a completed HTML drag.
                        // Ignore that synthetic click so drag-and-drop does not
                        // accidentally re-arm PLACE TOKEN mode.
                        if (tokenAssetDragRef.current === asset.id) {
                          tokenAssetDragRef.current = null
                          return
                        }
                        armTokenPlacement(asset)
                      }}
                      disabled={!activeMap}
                      draggable={Boolean(activeMap)}
                      onDragStart={(event) => {
                        tokenAssetDragRef.current = asset.id
                        event.dataTransfer.effectAllowed = 'copy'
                        event.dataTransfer.setData('application/x-dnd-vtt-token', asset.id)
                        event.dataTransfer.setData('text/plain', asset.id)
                        setPendingTokenAssetId(null)
                        setPendingActorId(null)
                        setToolMode('select')
                      }}
                      onDragEnd={() => {
                        window.setTimeout(() => {
                          if (tokenAssetDragRef.current === asset.id) {
                            tokenAssetDragRef.current = null
                          }
                        }, 0)
                      }}
                    >
                      <span className="token-asset-ring">
                        <img src={asset.url} alt="" draggable={false} />
                      </span>
                      <span>
                        <strong>{asset.displayName}</strong>
                        <small>
                          {activeMap
                            ? 'Reusable portrait • click or drag as many fresh copies as needed'
                            : 'Activate a map first'}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>

                <div className="token-list-heading">
                  <strong>Tokens on this map</strong>
                  <button type="button" onClick={() => void resetAllTokenMovement()}>Reset All Move</button>
                </div>

                <div className="placed-token-list">
                  {(gameState.tokens ?? [])
                    .filter((token) => token.mapId === activeMap?.id)
                    .map((token) => {
                      const actor =
                        actorForToken(
                          gameState.actors,
                          token,
                        )

                      if (!actor) {
                        return null
                      }

                      const {
                        speedFeet,
                        usedFeet,
                        remainingFeet,
                      } = tokenMovementSummary({
                        speedFeet: effectiveActorSpeed(actor),
                        movementUsedFeet: token.movementUsedFeet,
                      })

                      return (
                        <article className="placed-token" key={token.id}>
                          <img
                            src={token.imageUrl}
                            alt=""
                            style={{
                              borderColor: normalizeTokenColor(
                                token.color,
                                actor.ownerId
                                  ? getPlayerColor(actor.ownerId)
                                  : DEFAULT_TOKEN_COLOR,
                              ),
                            }}
                          />
                          <div className="placed-token-main">
                            <strong>{actor.name}</strong>
                            <small>
                              {actor.kind.toUpperCase()} • Level {actor.level} • Grid {token.gridX}, {token.gridY}
                            </small>
                            <small className={remainingFeet <= 0 ? 'movement-readout is-spent' : 'movement-readout'}>
                              Speed {speedFeet} ft • Used {usedFeet} ft • Left {remainingFeet} ft
                            </small>
                          </div>

                          <div className="placed-token-controls">
                            <label className="token-name-control">
                              <span>Name</span>
                              <input
                                key={`${actor.id}:${actor.name}`}
                                className="token-name-input"
                                type="text"
                                defaultValue={actor.name}
                                maxLength={80}
                                aria-label={`${actor.name} actor name`}
                                title="Press Enter or click outside to save. Press Escape to cancel."
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault()
                                    event.currentTarget.blur()
                                  }

                                  if (event.key === 'Escape') {
                                    event.preventDefault()
                                    event.currentTarget.value = actor.name
                                    event.currentTarget.blur()
                                  }
                                }}
                                onBlur={(event) => {
                                  const nextName = event.currentTarget.value.trim()

                                  if (!nextName) {
                                    event.currentTarget.value = actor.name
                                    setStatusMessage('Actor name cannot be empty.')
                                    return
                                  }

                                  if (nextName === actor.name) {
                                    event.currentTarget.value = actor.name
                                    return
                                  }

                                  void updateActor(actor.id, { name: nextName })
                                    .then(() => {
                                      setStatusMessage(`Actor renamed to ${nextName}.`)
                                    })
                                    .catch((error) => {
                                      event.currentTarget.value = actor.name
                                      setStatusMessage(
                                        error instanceof Error
                                          ? error.message
                                          : 'Actor rename could not be saved.',
                                      )
                                    })
                                }}
                              />
                            </label>

                            <label>
                              <span>Level</span>
                              <input
                                className="token-number-input"
                                type="number"
                                min="1"
                                max="30"
                                step="1"
                                value={actor.level}
                                aria-label={`${actor.name} level`}
                                onChange={(event) => {
                                  const level = Math.max(
                                    1,
                                    Math.min(30, Math.round(Number(event.target.value) || 1)),
                                  )
                                  void updateActor(actor.id, { level })
                                }}
                              />
                            </label>

                            <label className="token-color-control">
                              <span>Token Color</span>
                              <div className="token-color-input-row">
                                <input
                                  type="color"
                                  value={normalizeTokenColor(
                                    token.color,
                                    actor.ownerId
                                      ? getPlayerColor(actor.ownerId)
                                      : DEFAULT_TOKEN_COLOR,
                                  )}
                                  aria-label={`${actor.name} token color`}
                                  onChange={(event) => {
                                    void updateToken(token.id, {
                                      color: normalizeTokenColor(event.target.value),
                                    })
                                  }}
                                />
                                <code>
                                  {normalizeTokenColor(
                                    token.color,
                                    actor.ownerId
                                      ? getPlayerColor(actor.ownerId)
                                      : DEFAULT_TOKEN_COLOR,
                                  )}
                                </code>
                              </div>
                            </label>

                            <label>
                              <span>Size</span>
                              <select
                                aria-label={`${actor.name} token size`}
                                value={token.size}
                                onChange={(event) => updateToken(token.id, { size: Number(event.target.value) })}
                              >
                                <option value="0.5">Tiny</option>
                                <option value="1">Small / Medium</option>
                                <option value="2">Large</option>
                                <option value="3">Huge</option>
                                <option value="4">Gargantuan</option>
                              </select>
                            </label>

                            <label>
                              <span>Speed</span>
                              <select
                                aria-label={`${actor.name} speed`}
                                value={speedFeet}
                                onChange={(event) => updateActor(actor.id, { speedFeet: Number(event.target.value) })}
                              >
                                {[5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 80, 120].map((speed) => (
                                  <option key={speed} value={speed}>{speed} ft</option>
                                ))}
                              </select>
                            </label>

                            <label>
                              <span>Owner</span>
                              <select
                                aria-label={`${actor.name} owner`}
                                value={actor.ownerId ?? ''}
                                onChange={(event) => {
                                  const ownerId = event.target.value || null
                                  void updateActor(
                                    actor.id,
                                    ownerId
                                      ? { ownerId, kind: 'player' }
                                      : { ownerId },
                                  )
                                }}
                              >
                                <option value="">DM only</option>
                                {campaignPlayers.map((player) => (
                                  <option value={player.id} key={player.id}>{player.name}</option>
                                ))}
                              </select>
                            </label>
                          </div>

                          <div className="placed-token-actions">
                            <label className="token-visible-toggle">
                              <input
                                type="checkbox"
                                checked={token.visible}
                                onChange={(event) => updateToken(token.id, { visible: event.target.checked })}
                              />
                              <span>Visible</span>
                            </label>
                            <button type="button" onClick={() => void resetTokenMovement(token.id)}>Reset Move</button>
                            <button
                              type="button"
                              className="danger-button"
                              onClick={() => removeToken(token.id)}
                              aria-label={`Remove ${actor.name} from map`}
                            >
                              Remove From Map
                            </button>
                          </div>
                        </article>
                      )
                    })}
                </div>
              </section>
            ) : null}

            {inspectorTab === 'session' ? (
              <section>
                <div className="session-card">
                  <strong>{activeSession ? `Session ${activeSession.number} Active` : 'No Active Session'}</strong>
                </div>

                <button
                  type="button"
                  className="primary-button"
                  onClick={activeSession ? endSession : startSession}
                >
                  {activeSession ? 'End Session' : 'Start Session'}
                </button>

                <button type="button" className="secondary-button" onClick={createSnapshot}>
                  Create Snapshot
                </button>

                <div className="snapshot-list">
                  {snapshots.slice(0, 6).map((snapshot) => (
                    <div key={snapshot.id}>
                      <strong>{snapshot.name}</strong>
                      <small>{new Date(snapshot.createdAt).toLocaleString()}</small>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </aside>
      ) : null}

      {!isDm && playerSheetOpen ? (
        <aside className="player-sheet-panel">
          <CharacterSheetPanel
            actor={ownCharacter}
            canEdit={Boolean(ownCharacter) && !combat.active}
            canEditProgression={false}
            onCreate={createOwnCharacter}
            onClose={() => setPlayerSheetOpen(false)}
            onUpdate={updateOwnCharacter}
            onMessage={setStatusMessage}
            spellView="hidden"
            onUploadTokenImage={uploadOwnTokenPortrait}
            onPlaceToken={armOwnTokenPlacement}
            tokenPlacedOnActiveMap={Boolean(ownTokenOnActiveMap)}
            tokenColor={currentPlayerId ? getPlayerColor(currentPlayerId) : DEFAULT_TOKEN_COLOR}
            onTokenColorChange={updateOwnTokenColor}
          />
        </aside>
      ) : null}

      <nav className={isDm ? 'bottom-dock frozen-reference-dock' : 'bottom-dock frozen-reference-dock is-player'} aria-label="Table controls">
        <section className="reference-character-card" aria-label="Character summary">
          {hudActor ? (
            <>
              <button
                type="button"
                className="reference-character-portrait"
                onClick={() => {
                  if (isDm) {
                    setDmSheetActorId(hudActor.id)
                    setInspectorTab('actors')
                    setDmInspectorExpanded(true)
                  } else {
                    setPlayerSheetOpen(true)
                  }
                }}
              >
                <img src={hudActor.portraitUrl || '/assets/tokens/adventurer-token.svg'} alt={hudActor.name} />
              </button>
              <div className="reference-character-main">
                <strong>{hudActor.name}</strong>
                <small>Lv {hudActor.level} {hudActor.characterSheet?.className || (hudActor.kind === 'player' ? 'Adventurer' : hudActor.creatureType)}</small>
                <div className="reference-hp-row"><span>HP</span><i><b style={{ width: `${Math.max(0, Math.min(100, (hudActor.currentHp / Math.max(1, hudActor.maxHp)) * 100))}%` }} /></i><em>{hudActor.currentHp}/{hudActor.maxHp}</em></div>
                <div className="reference-temp-hp">Temp HP <b>{hudActor.tempHp}</b></div>
              </div>
              <div className="reference-ac-shield"><span>AC</span><strong>{hudActor.ac}</strong></div>
              <div className="reference-condition-row">
                {[...hudActor.conditions, ...(hudActor.effects ?? []).map((effect) => effect.name)].slice(0, 3).map((condition) => <span key={condition}><Shield />{condition}</span>)}
                {hudActor.conditions.length === 0 && (hudActor.effects ?? []).length === 0 ? <span><Shield />Ready</span> : null}
              </div>
            </>
          ) : (
            <button type="button" className="reference-create-character" onClick={() => { if (!isDm) setPlayerSheetOpen(true); else { setInspectorTab('party'); setDmInspectorExpanded(true) } }}>
              <Users /><span><strong>No character selected</strong><small>Open Party to choose one</small></span>
            </button>
          )}
        </section>

        <section className="reference-turn-panel" aria-label="Turn actions">
          <header>
            <Footprints aria-hidden="true" />
            <strong>{combat.active ? `Round ${combat.round} · ${activeTurnActor?.name ?? 'Current Turn'}` : 'Turn Actions'}</strong>
          </header>
            <div className="reference-economy-summary">
              <div><Footprints /><span><small>Movement</small><strong>{activeTurnMovementRemainingFeet ?? hudActor?.speedFeet ?? 0} / {activeTurnActor?.speedFeet ?? hudActor?.speedFeet ?? 0} ft</strong></span></div>
            <div className={activeTurnEconomy && activeTurnEconomy.actionUsed < activeTurnEconomy.actionMax ? 'is-ready' : ''} title={activeTurnEconomy && activeTurnEconomy.actionUsed < activeTurnEconomy.actionMax ? 'Action available: Attack, Cast, Dash, Dodge, Disengage, Help, Hide, Search, Study, Influence, Utilize, or Ready.' : 'Action spent'}><Swords /><span><small>Action</small><em>{activeTurnEconomy && activeTurnEconomy.actionUsed < activeTurnEconomy.actionMax ? 'Ready' : 'Spent'}</em></span></div>
            <div className={activeTurnEconomy && activeTurnEconomy.bonusActionUsed < activeTurnEconomy.bonusActionMax ? 'is-ready' : ''} title={activeTurnEconomy && activeTurnEconomy.bonusActionUsed < activeTurnEconomy.bonusActionMax ? 'Bonus Action available when a feature, spell, or other rule grants one.' : 'Bonus Action spent or no Bonus Action granted.'}><Sparkles /><span><small>Bonus</small><em>{activeTurnEconomy && activeTurnEconomy.bonusActionUsed < activeTurnEconomy.bonusActionMax ? 'Ready' : 'Spent'}</em></span></div>
            <div className={activeTurnEconomy && activeTurnEconomy.reactionUsed < activeTurnEconomy.reactionMax ? 'is-ready' : ''} title={activeReactionWindow ? 'A Reaction trigger is waiting for a decision.' : activeTurnEconomy && activeTurnEconomy.reactionUsed < activeTurnEconomy.reactionMax ? 'Reaction available for a valid trigger, such as an Opportunity Attack or a readied action.' : 'Reaction spent until the start of your next turn.'}><Shield /><span><small>Reaction</small><em>{activeReactionWindow ? 'Prompt' : activeTurnEconomy && activeTurnEconomy.reactionUsed < activeTurnEconomy.reactionMax ? 'Ready' : 'Spent'}</em></span></div>
          </div>
          <div className="reference-turn-buttons">
            <button
              type="button"
              disabled={!isDm && !playerCanUseTurnActions}
              onClick={() => {
                setPlayerSpellHudOpen(false)
                setPlayerAttackHudOpen(true)
              }}
            ><Swords />Attack</button>
            <button
              type="button"
              disabled={!isDm && !playerCanUseTurnActions}
              onClick={() => {
                if (combatHudActor) setPlayerSpellHudOpen(true)
                else if (isDm) setDmSpellbookOpen(true)
              }}
            ><BookOpenText />Spell</button>
            <button
              type="button"
              disabled={
                !combat.active ||
                !activeTurnActor ||
                (!isDm && !playerCanUseTurnActions)
              }
              onClick={() => setUtilityActionsOpen(true)}
            ><Crosshair />Utility</button>
            <button
              type="button"
              disabled={
                !combat.active ||
                !activeTurnActor ||
                (!isDm && !playerCanUseTurnActions)
              }
              onClick={() => setReadyActionOpen(true)}
            ><Hourglass />Ready</button>
            <button
              type="button"
              className="reference-end-turn"
              disabled={
                !combat.active ||
                !activeTurnActor ||
                (!isDm && !turnHudInteractive) ||
                (
                  !isDm &&
                  ownNeedsDeathSave &&
                  ownDeathSaveTurnActive &&
                  !ownDeathSaveRolledThisRound
                )
              }
              onClick={() => void endCurrentTurn()}
            ><ChevronRight />End Turn</button>
          </div>
        </section>

        <section className="reference-quick-dice" aria-label="Quick Dice">
          <header><strong>Quick Dice</strong><button type="button" onClick={() => setDiceTrayOpen(true)} aria-label="Open dice settings"><Settings /></button></header>
          <div>
            {([20, 12, 10, 8, 6, 4] as const).map((sides) => (
              <button key={sides} type="button" onClick={() => void performDieRoll(sides)} aria-label={`Roll ${diceCount}d${sides}`}>
                <span>d{sides}</span>
              </button>
            ))}
          </div>
        </section>

        <section
          className={`reference-world-panel${isDm ? ' is-dm' : ' is-player'}`}
          aria-label={isDm ? 'Scene Controls and World Map' : 'World Map'}
        >
          {isDm ? (
            <nav className="reference-scene-controls" aria-label="Scene controls">
              <button
                type="button"
                className={inspectorTab === 'grid' ? 'is-active' : ''}
                onClick={() => setInspectorTab('grid')}
                title="Grid"
                aria-label="Grid"
              >⌗</button>
              <button
                type="button"
                className={inspectorTab === 'maps' ? 'is-active' : ''}
                onClick={() => setInspectorTab('maps')}
                title="Maps"
                aria-label="Maps"
              >▧</button>
              <button
                type="button"
                className={inspectorTab === 'tokens' ? 'is-active' : ''}
                onClick={() => setInspectorTab('tokens')}
                title="Tokens"
                aria-label="Tokens"
              >♙</button>
              <button
                type="button"
                className={inspectorTab === 'library' ? 'is-active' : ''}
                onClick={() => setInspectorTab('library')}
                title="Rules"
                aria-label="Rules"
              >☷</button>
              <button
                type="button"
                className={inspectorTab === 'session' ? 'is-active' : ''}
                onClick={() => setInspectorTab('session')}
                title="Session"
                aria-label="Session"
              >⚙</button>
            </nav>
          ) : null}

          <button
            type="button"
            className={`reference-world-launcher${worldMap ? ' has-map' : ''}`}
            disabled={!worldMap && !isDm}
            onClick={() => {
              if (worldMap) setWorldMapOpen(true)
              else if (isDm) {
                setInspectorTab('maps')
                setDmInspectorExpanded(true)
              }
            }}
            aria-label={worldMap ? `Open World Map ${getMapDisplayName(worldMap)}` : 'Assign World Map'}
          >
            {worldMap ? <img src={worldMap.url} alt="" /> : <span className="reference-world-placeholder"><MapIcon /></span>}
            <span className="reference-world-copy">
              <small>WORLD MAP</small>
              <strong>{worldMap ? getMapDisplayName(worldMap) : 'Not Assigned'}</strong>
              <em>{worldMap ? 'Open full map' : isDm ? 'Click to assign a map' : 'Waiting for the DM'}</em>
            </span>
            <ChevronRight aria-hidden="true" />
          </button>
        </section>
      </nav>

      {diceTrayOpen && !canRollOwnDeathSave ? (
        <section className="dice-tray" aria-label="D&D dice tray">
          <header>
            <span>THE SEVEN DICE</span>
            <button type="button" onClick={() => setDiceTrayOpen(false)} aria-label="Close dice tray">×</button>
          </header>
          <div className="dice-purpose-control dice-theme-control">
            <label>
              <span>3D DICE SET</span>
              <select
                value={selectedDiceTheme.id}
                onChange={(event) => setDiceThemeId(event.target.value)}
              >
                {diceThemeCatalog.themes.map((theme) => (
                  <option key={theme.id} value={theme.id}>{theme.name}</option>
                ))}
              </select>
            </label>
            <small>SHARED ROLL · PERSONAL LOOK</small>
          </div>
          <div className="dice-purpose-control">
            <label>
              <span>ROLL TYPE</span>
              <select
                value={dicePurpose}
                onChange={(event) => setDicePurpose(event.target.value as GenericDicePurpose)}
              >
                <option value="attack">Attack Roll</option>
                <option value="damage">Damage Roll</option>
                <option value="saving-throw">Saving Throw</option>
                <option value="ability-check">Ability Check</option>
                <option value="skill-check">Skill Check</option>
                <option value="spell">Spell Roll</option>
                <option value="other">Other Roll</option>
              </select>
            </label>
            <small>
              {isDm
                ? dicePurpose === 'damage'
                  ? 'NPC DAMAGE · PUBLIC TO TABLE'
                  : 'DM / NPC ROLL · DM ONLY'
                : 'PLAYER ROLL · PUBLIC TO TABLE'}
            </small>
          </div>
          {dicePurpose === 'saving-throw' ? (
            <div className="dice-purpose-control">
              <label>
                <span>SAVE ABILITY</span>
                <select
                  value={diceSaveAbility}
                  onChange={(event) => setDiceSaveAbility(event.target.value as ActorAbility)}
                >
                  <option value="strength">Strength</option>
                  <option value="dexterity">Dexterity</option>
                  <option value="constitution">Constitution</option>
                  <option value="intelligence">Intelligence</option>
                  <option value="wisdom">Wisdom</option>
                  <option value="charisma">Charisma</option>
                </select>
              </label>
              <small>ABILITY MODIFIER + PROFICIENCY ARE RESOLVED BY THE SERVER</small>
            </div>
          ) : null}
          {dicePurpose === 'skill-check' ? (
            <div className="dice-purpose-control">
              <label>
                <span>SKILL</span>
                <select
                  value={diceSkill}
                  onChange={(event) => setDiceSkill(event.target.value as CharacterSkill)}
                >
                  {CHARACTER_SKILL_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <small>ABILITY MODIFIER + PROFICIENCY / EXPERTISE ARE RESOLVED BY THE SERVER</small>
            </div>
          ) : null}
          <div className="dice-count-control">
            <button type="button" onClick={() => setDiceCount((count) => Math.max(1, count - 1))} aria-label="Remove one die">−</button>
            <label>
              <span>NUMBER OF DICE</span>
              <input
                type="number"
                min="1"
                max="20"
                value={diceCount}
                onChange={(event) => setDiceCount(Math.max(1, Math.min(20, Math.round(Number(event.target.value) || 1))))}
              />
            </label>
            <button type="button" onClick={() => setDiceCount((count) => Math.min(20, count + 1))} aria-label="Add one die">+</button>
          </div>
          <div>
            {([4, 6, 8, 10, 100, 12, 20] as const).map((sides) => (
              <button type="button" key={sides} onClick={() => void performDieRoll(sides)}>
                <i aria-hidden="true">{sides === 100 ? '%' : sides}</i>
                <b>{diceCount}{sides === 100 ? 'd%' : `d${sides}`}</b>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {isDm && visionEditorMapId
        ? (() => {
            const editorMap =
              maps.find(
                (map) =>
                  map.id === visionEditorMapId,
              )

            if (!editorMap) {
              return null
            }

            return createPortal(
              <VisionEditor
                key={editorMap.id}
                map={editorMap}
                displayName={getMapDisplayName(editorMap)}
                initialSettings={getMapVisionSettings(editorMap.id)}
                onSave={(settings) => saveMapVisionSettings(editorMap.id, settings)}
                onClose={() => setVisionEditorMapId(null)}
              />,
              document.body,
            )
          })()
        : null}

      <WorldMapViewer
        map={worldMap}
        open={worldMapOpen}
        onClose={() => setWorldMapOpen(false)}
      />

      {statusMessage ? (
        <aside
          className={`toast toast-${statusTone}`}
          role={statusTone === 'error' ? 'alert' : 'status'}
          aria-live={statusTone === 'error' ? 'assertive' : 'polite'}
        >
          <span>{statusMessage}</span>
          <button
            type="button"
            className="toast-dismiss"
            onClick={() => setStatusMessage('')}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </aside>
      ) : null}
    </main>
  )
}

export default App
