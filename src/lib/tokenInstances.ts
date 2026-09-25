import {
  DEFAULT_ACTOR_SPEED_FEET,
} from './actors'

import {
  normalizeGridIndex,
} from './mapGridBounds'

import {
  type SceneToken,
  type TokenAsset,
} from '../types/scene'

import {
  type Actor,
} from '../types/actor'

export const DEFAULT_TOKEN_SIZE = 1

export function tokenAssetFromActorPortrait(actor: Actor): TokenAsset | null {
  const url = actor.portraitUrl.trim()
  if (!url) return null

  return {
    id: actor.portraitAssetId || `actor-portrait:${actor.id}`,
    assetType: 'token',
    displayName: actor.name,
    relativePath: '',
    contentHash: '',
    byteSize: 0,
    mimeType: url.endsWith('.svg') || url.includes('/portrait')
      ? 'image/svg+xml'
      : 'image/*',
    updatedAt: '',
    url,
  }
}

function finiteNumber(
  value: unknown,
  fallback: number,
): number {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? parsed
    : fallback
}

export function createFreshSceneTokenInstance(
  asset: TokenAsset,
  options: {
    id: string
    actorId: string
    mapId: string
    gridX: number
    gridY: number
    color: string
  },
): SceneToken {
  return {
    id: options.id,
    actorId: options.actorId,
    assetId: asset.id,
    imageUrl: asset.url,
    mapId: options.mapId,
    gridX: normalizeGridIndex(options.gridX),
    gridY: normalizeGridIndex(options.gridY),
    size: DEFAULT_TOKEN_SIZE,
    visible: true,
    color: options.color,
    movementUsedFeet: 0,
  }
}

export function normalizeSceneTokenInstance(
  token: SceneToken,
): SceneToken {
  return {
    id: String(token.id ?? ''),
    actorId:
      typeof token.actorId === 'string' && token.actorId
        ? token.actorId
        : `actor-${String(token.id ?? '')}`,
    assetId: String(token.assetId ?? ''),
    imageUrl: String(token.imageUrl ?? ''),
    mapId: String(token.mapId ?? ''),
    gridX: normalizeGridIndex(token.gridX),
    gridY: normalizeGridIndex(token.gridY),
    size: Math.max(0.5, finiteNumber(token.size, DEFAULT_TOKEN_SIZE)),
    visible: token.visible !== false,
    color:
      typeof token.color === 'string' && token.color.trim()
        ? token.color
        : '#C9954B',
    movementUsedFeet: Math.max(
      0,
      Math.round(
        finiteNumber(
          token.movementUsedFeet,
          0,
        ),
      ),
    ),
  }
}

export function tokenMovementSummary(
  value: {
    speedFeet: number
    movementUsedFeet: number
  },
): {
  speedFeet: number
  usedFeet: number
  remainingFeet: number
} {
  const rawSpeed =
    Math.round(
      finiteNumber(
        value.speedFeet,
        DEFAULT_ACTOR_SPEED_FEET,
      ),
    )

  const speedFeet =
    rawSpeed > 0
      ? rawSpeed
      : DEFAULT_ACTOR_SPEED_FEET

  const usedFeet =
    Math.max(
      0,
      Math.round(
        finiteNumber(
          value.movementUsedFeet,
          0,
        ),
      ),
    )

  return {
    speedFeet,
    usedFeet,
    remainingFeet:
      Math.max(
        0,
        speedFeet - usedFeet,
      ),
  }
}
