import {
  type SceneToken,
  type TokenAsset,
} from '../types/scene'

export const DEFAULT_TOKEN_SPEED_FEET = 30
export const DEFAULT_TOKEN_LEVEL = 1
export const DEFAULT_TOKEN_SIZE = 1

function finiteNumber(
  value: unknown,
  fallback: number,
): number {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? parsed
    : fallback
}

function positiveSpeedOrDefault(
  value: unknown,
): number {
  const parsed = finiteNumber(
    value,
    DEFAULT_TOKEN_SPEED_FEET,
  )

  return parsed > 0
    ? Math.round(parsed)
    : DEFAULT_TOKEN_SPEED_FEET
}

export function createFreshTokenInstance(
  asset: TokenAsset,
  options: {
    id: string
    mapId: string
    gridX: number
    gridY: number
    color: string
  },
): SceneToken {
  return {
    id: options.id,
    name: asset.displayName.replace(/\.[^.]+$/, ''),
    assetId: asset.id,
    imageUrl: asset.url,
    mapId: options.mapId,
    gridX: Math.max(0, Math.round(options.gridX)),
    gridY: Math.max(0, Math.round(options.gridY)),
    size: DEFAULT_TOKEN_SIZE,
    ownerId: null,
    visible: true,
    color: options.color,
    level: DEFAULT_TOKEN_LEVEL,
    speedFeet: DEFAULT_TOKEN_SPEED_FEET,
    movementUsedFeet: 0,
  }
}

export function normalizeTokenInstance(
  token: SceneToken,
): SceneToken {
  return {
    ...token,
    level: Math.max(
      1,
      Math.round(
        finiteNumber(
          token.level,
          DEFAULT_TOKEN_LEVEL,
        ),
      ),
    ),
    size: Math.max(
      0.5,
      finiteNumber(
        token.size,
        DEFAULT_TOKEN_SIZE,
      ),
    ),
    speedFeet:
      positiveSpeedOrDefault(
        token.speedFeet,
      ),
    movementUsedFeet:
      Math.max(
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
  token: Pick<
    SceneToken,
    'speedFeet' | 'movementUsedFeet'
  >,
): {
  speedFeet: number
  usedFeet: number
  remainingFeet: number
} {
  const speedFeet =
    positiveSpeedOrDefault(
      token.speedFeet,
    )

  const usedFeet =
    Math.max(
      0,
      Math.round(
        finiteNumber(
          token.movementUsedFeet,
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
