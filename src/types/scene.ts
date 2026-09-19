export interface GridSettings {
  enabled: boolean
  cellSize: number
  offsetX: number
  offsetY: number
  opacity: number
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

export interface SceneToken {
  id: string
  name: string
  assetId: string
  imageUrl: string
  mapId: string
  gridX: number
  gridY: number
  size: number
  ownerId: string | null
  visible: boolean
  speedFeet: number
  movementUsedFeet: number
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
