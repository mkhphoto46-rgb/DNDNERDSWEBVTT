import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clampGridPointToMap,
  normalizeGridIndex,
  tokenGridBounds,
} from './mapGridBounds'

import type {
  GridSettings,
} from '../types/scene'

const grid:
  GridSettings = {
    enabled: true,
    cellSize: 70,
    offsetX: 0,
    offsetY: 0,
    opacity: 0.4,
  }

test(
  'token grid bounds keep a one-cell token fully inside the map',
  () => {
    const bounds =
      tokenGridBounds(
        {
          width: 700,
          height: 560,
        },
        grid,
        1,
      )

    assert.deepEqual(
      bounds,
      {
        minGridX: 0,
        maxGridX: 9,
        minGridY: 0,
        maxGridY: 7,
      },
    )
  },
)

test(
  'edge movement clamps to the nearest usable square instead of disappearing past the map',
  () => {
    assert.deepEqual(
      clampGridPointToMap(
        {
          gridX: 50,
          gridY: 50,
        },
        {
          width: 700,
          height: 560,
        },
        grid,
        1,
      ),
      {
        gridX: 9,
        gridY: 7,
      },
    )
  },
)

test(
  'valid negative grid indices are supported when calibrated offsets require them',
  () => {
    const offsetGrid:
      GridSettings = {
        ...grid,
        offsetX: 90,
        offsetY: 90,
      }

    const bounds =
      tokenGridBounds(
        {
          width: 700,
          height: 560,
        },
        offsetGrid,
        1,
      )

    assert.equal(
      bounds.minGridX,
      -1,
    )

    assert.equal(
      bounds.minGridY,
      -1,
    )

    assert.deepEqual(
      clampGridPointToMap(
        {
          gridX: -1,
          gridY: -1,
        },
        {
          width: 700,
          height: 560,
        },
        offsetGrid,
        1,
      ),
      {
        gridX: -1,
        gridY: -1,
      },
    )
  },
)

test(
  'grid coordinates remain safely bounded for persistence',
  () => {
    assert.equal(
      normalizeGridIndex(
        -999999,
      ),
      -10000,
    )

    assert.equal(
      normalizeGridIndex(
        999999,
      ),
      10000,
    )
  },
)
