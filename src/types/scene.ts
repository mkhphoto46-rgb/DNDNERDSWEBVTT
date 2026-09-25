import type { ActorEffect, ActorLifeState } from './actor'


export interface TargetSelection {
  controllerId: string
  controllerName: string
  role: 'dm' | 'player'
  sourceActorId: string | null
  /** Primary target kept for backward compatibility. */
  targetActorId: string
  /** Ordered multi-target selection used by rules-driven actions/spells. */
  targetActorIds: string[]
  updatedAt: string
}

export interface GridSettings {
  enabled: boolean
  cellSize: number
  offsetX: number
  offsetY: number
  opacity: number
}

export type VisionBarrierKind =
  | 'wall'
  | 'door'

export type VisionDoorState =
  | 'open'
  | 'closed'
  | 'locked'

export interface VisionPoint {
  /** Normalized map-space X coordinate in the inclusive range 0..1. */
  x: number
  /** Normalized map-space Y coordinate in the inclusive range 0..1. */
  y: number
}

export interface VisionBarrierChannels {
  blocksSight: boolean
  blocksMovement: boolean
  blocksLight: boolean
  blocksEffects: boolean
  blocksProjectiles: boolean
}

export interface VisionBarrier {
  id: string
  kind: VisionBarrierKind
  start: VisionPoint
  end: VisionPoint
  doorState?: VisionDoorState
  channels: VisionBarrierChannels
}

export interface MapVisionSettings {
  /** Runtime schema marker. Older Phase-1 geometry is auto-activated once migrated. */
  runtimeVersion?: number
  /** When false, geometry remains saved but runtime LOS/Fog/Collision is disabled. */
  enabled: boolean
  barriers: VisionBarrier[]
  /** Natural image dimensions used to convert grid/token coordinates to map-space. */
  mapWidth?: number
  mapHeight?: number
  updatedAt?: string
}

export interface VisionDoorInteraction {
  id: string
  mapId: string
  state: VisionDoorState
  start: VisionPoint
  end: VisionPoint
  /** Distance from the controlling token footprint to the door edge. */
  distanceFeet?: number
}

export interface PlayerVisionRuntime {
  enabled: boolean
  mapId: string | null
  /** One polygon per Player-controlled vision source on the active map. */
  polygons: VisionPoint[][]
  sourceActorIds: string[]
  /** Safe, nearby Door segments only. Full DM geometry is never exposed here. */
  doors: VisionDoorInteraction[]
}

export type VisionSettingsByMapId =
  Record<string, MapVisionSettings>

export const DEFAULT_VISION_BARRIER_CHANNELS: VisionBarrierChannels = {
  blocksSight: true,
  blocksMovement: true,
  blocksLight: true,
  blocksEffects: true,
  blocksProjectiles: true,
}

export const DEFAULT_MAP_VISION_SETTINGS: MapVisionSettings = {
  runtimeVersion: 2,
  enabled: false,
  barriers: [],
  mapWidth: 0,
  mapHeight: 0,
}

export interface MapAsset {
  id: string
  assetType: 'map'
  displayName: string
  relativePath: string
  contentHash: string
  byteSize: number
  mimeType: string
  updatedAt: string
  url: string
}

export interface TokenAsset {
  id: string
  assetType: 'token'
  displayName: string
  relativePath: string
  contentHash: string
  byteSize: number
  mimeType: string
  updatedAt: string
  url: string
}

/**
 * SceneToken stores only scene-specific state.
 * Character/combatant mechanics belong to Actor and are linked by actorId.
 *
 * The optional legacy fields are accepted only so older campaign saves can be
 * migrated safely. New token instances do not write these fields.
 */
export interface SceneToken {
  id: string
  actorId: string
  assetId: string
  imageUrl: string
  mapId: string
  gridX: number
  gridY: number
  size: number
  visible: boolean
  color: string
  movementUsedFeet: number

  /** @deprecated Legacy save compatibility only. */
  name?: string
  /** @deprecated Legacy save compatibility only. */
  ownerId?: string | null
  /** @deprecated Legacy save compatibility only. */
  level?: number
  /** @deprecated Legacy save compatibility only. */
  speedFeet?: number
}

/**
 * RenderableSceneToken is a client-side view model made by combining a
 * SceneToken with its Actor. It is never the authoritative persistence model.
 */
export interface RenderableSceneToken extends SceneToken {
  name: string
  ownerId: string | null
  level: number
  speedFeet: number
  currentHp: number
  maxHp: number
  tempHp: number
  lifeState: ActorLifeState
  conditions: string[]
  effects: ActorEffect[]
  targetedByActorIds: string[]
  targetedByControllerIds: string[]
  targetedByMe: boolean
}

export interface SceneMapAsset extends MapAsset {
  grid?: GridSettings
}

export type MapSettingsByAssetId = Record<string, GridSettings>

export const DEFAULT_GRID_SETTINGS: GridSettings = {
  enabled: false,
  cellSize: 70,
  offsetX: 0,
  offsetY: 0,
  opacity: 0.42,
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function num(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeVisionPoint(
  value: unknown,
): VisionPoint | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const input = value as Partial<VisionPoint>
  const x = Number(input.x)
  const y = Number(input.y)

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null
  }

  return {
    x: clamp(x, 0, 1),
    y: clamp(y, 0, 1),
  }
}

function normalizeVisionChannels(
  value: unknown,
): VisionBarrierChannels {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_VISION_BARRIER_CHANNELS }
  }

  const input =
    value as Partial<VisionBarrierChannels>

  return {
    blocksSight:
      input.blocksSight !== false,
    blocksMovement:
      input.blocksMovement !== false,
    blocksLight:
      input.blocksLight !== false,
    blocksEffects:
      input.blocksEffects !== false,
    blocksProjectiles:
      input.blocksProjectiles !== false,
  }
}

function normalizeVisionBarrier(
  value: unknown,
): VisionBarrier | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const input =
    value as Partial<VisionBarrier>

  const id =
    typeof input.id === 'string'
      ? input.id.trim().slice(0, 120)
      : ''

  const kind: VisionBarrierKind | null =
    input.kind === 'wall' || input.kind === 'door'
      ? input.kind
      : null

  const start =
    normalizeVisionPoint(input.start)

  const end =
    normalizeVisionPoint(input.end)

  if (!id || !kind || !start || !end) {
    return null
  }

  const dx = end.x - start.x
  const dy = end.y - start.y

  if (Math.hypot(dx, dy) < 0.0001) {
    return null
  }

  const doorState: VisionDoorState | undefined =
    kind === 'door'
      ? (
          input.doorState === 'open' ||
          input.doorState === 'locked'
            ? input.doorState
            : 'closed'
        )
      : undefined

  return {
    id,
    kind,
    start,
    end,
    ...(doorState ? { doorState } : {}),
    channels:
      normalizeVisionChannels(input.channels),
  }
}

export function normalizeMapVisionSettings(
  value: unknown,
): MapVisionSettings {
  if (!value || typeof value !== 'object') {
    return {
      ...DEFAULT_MAP_VISION_SETTINGS,
      barriers: [],
    }
  }

  const input =
    value as Partial<MapVisionSettings>

  const rawBarriers =
    Array.isArray(input.barriers)
      ? input.barriers
      : []

  const barriers =
    rawBarriers
      .map(normalizeVisionBarrier)
      .filter(
        (barrier):
          barrier is VisionBarrier =>
            Boolean(barrier),
      )
      .slice(0, 5000)

  const runtimeVersion =
    Number.isFinite(Number(input.runtimeVersion))
      ? Math.max(0, Math.round(Number(input.runtimeVersion)))
      : 0

  const migratedEnabled =
    runtimeVersion >= 2
      ? Boolean(input.enabled)
      : Boolean(input.enabled) || barriers.length > 0

  return {
    runtimeVersion: 2,
    enabled: migratedEnabled,
    barriers,
    mapWidth:
      clamp(num(input.mapWidth, 0), 0, 50000),
    mapHeight:
      clamp(num(input.mapHeight, 0), 0, 50000),
    updatedAt:
      typeof input.updatedAt === 'string'
        ? input.updatedAt
        : undefined,
  }
}

export function normalizeGridSettings(value: unknown): GridSettings {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_GRID_SETTINGS }
  }

  const input = value as Partial<GridSettings>

  return {
    enabled: Boolean(input.enabled),
    cellSize: clamp(num(input.cellSize, DEFAULT_GRID_SETTINGS.cellSize), 10, 500),
    offsetX: clamp(num(input.offsetX, 0), -5000, 5000),
    offsetY: clamp(num(input.offsetY, 0), -5000, 5000),
    opacity: clamp(num(input.opacity, DEFAULT_GRID_SETTINGS.opacity), 0.05, 1),
  }
}
