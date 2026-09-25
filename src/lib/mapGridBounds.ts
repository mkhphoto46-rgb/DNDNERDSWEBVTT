import type {
  GridSettings,
} from '../types/scene'

export interface MapPixelSize {
  width: number
  height: number
}

export interface GridPoint {
  gridX: number
  gridY: number
}

export interface TokenGridBounds {
  minGridX: number
  maxGridX: number
  minGridY: number
  maxGridY: number
}

const MIN_GRID_INDEX = -10000
const MAX_GRID_INDEX = 10000

function finiteNumber(
  value: unknown,
  fallback: number,
): number {
  const parsed =
    Number(value)

  return Number.isFinite(parsed)
    ? parsed
    : fallback
}

export function normalizeGridIndex(
  value: unknown,
): number {
  return Math.max(
    MIN_GRID_INDEX,
    Math.min(
      MAX_GRID_INDEX,
      Math.round(
        finiteNumber(
          value,
          0,
        ),
      ),
    ),
  )
}

export function tokenGridBounds(
  mapSize: MapPixelSize,
  grid: GridSettings,
  tokenSize = 1,
): TokenGridBounds {
  const cellSize =
    Math.max(
      10,
      finiteNumber(
        grid.cellSize,
        70,
      ),
    )

  const diameter =
    Math.max(
      0.5,
      finiteNumber(
        tokenSize,
        1,
      ),
    ) *
    cellSize

  const width =
    Math.max(
      0,
      finiteNumber(
        mapSize.width,
        0,
      ),
    )

  const height =
    Math.max(
      0,
      finiteNumber(
        mapSize.height,
        0,
      ),
    )

  if (
    width <= 0 ||
    height <= 0
  ) {
    return {
      minGridX:
        MIN_GRID_INDEX,
      maxGridX:
        MAX_GRID_INDEX,
      minGridY:
        MIN_GRID_INDEX,
      maxGridY:
        MAX_GRID_INDEX,
    }
  }

  const rawMinGridX =
    Math.ceil(
      (
        0 -
        grid.offsetX
      ) /
      cellSize,
    )

  const rawMinGridY =
    Math.ceil(
      (
        0 -
        grid.offsetY
      ) /
      cellSize,
    )

  const rawMaxGridX =
    Math.floor(
      (
        width -
        diameter -
        grid.offsetX
      ) /
      cellSize,
    )

  const rawMaxGridY =
    Math.floor(
      (
        height -
        diameter -
        grid.offsetY
      ) /
      cellSize,
    )

  const minGridX =
    normalizeGridIndex(
      rawMinGridX,
    )

  const minGridY =
    normalizeGridIndex(
      rawMinGridY,
    )

  return {
    minGridX,

    maxGridX:
      Math.max(
        minGridX,
        normalizeGridIndex(
          rawMaxGridX,
        ),
      ),

    minGridY,

    maxGridY:
      Math.max(
        minGridY,
        normalizeGridIndex(
          rawMaxGridY,
        ),
      ),
  }
}

export function clampGridPointToMap(
  point: GridPoint,
  mapSize: MapPixelSize,
  grid: GridSettings,
  tokenSize = 1,
): GridPoint {
  const bounds =
    tokenGridBounds(
      mapSize,
      grid,
      tokenSize,
    )

  return {
    gridX:
      Math.max(
        bounds.minGridX,
        Math.min(
          bounds.maxGridX,
          normalizeGridIndex(
            point.gridX,
          ),
        ),
      ),

    gridY:
      Math.max(
        bounds.minGridY,
        Math.min(
          bounds.maxGridY,
          normalizeGridIndex(
            point.gridY,
          ),
        ),
      ),
  }
}
