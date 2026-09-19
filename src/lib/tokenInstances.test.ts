import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createFreshTokenInstance,
  DEFAULT_TOKEN_SPEED_FEET,
  normalizeTokenInstance,
  tokenMovementSummary,
} from './tokenInstances'

import {
  type TokenAsset,
} from '../types/scene'

const skeletonAsset: TokenAsset = {
  id: 'token_skeleton',
  assetType: 'token',
  displayName: 'Skeleton.jpg',
  relativePath: 'tokens/Skeleton.jpg',
  contentHash: 'hash',
  byteSize: 123,
  mimeType: 'image/jpeg',
  updatedAt: '2026-09-19T00:00:00.000Z',
  url: '/campaign-assets/campaign/token_skeleton',
}

test('one portrait can spawn multiple independent token instances', () => {
  const first =
    createFreshTokenInstance(
      skeletonAsset,
      {
        id: 'instance-a',
        mapId: 'map-1',
        gridX: 2,
        gridY: 3,
        color: '#C9954B',
      },
    )

  const second =
    createFreshTokenInstance(
      skeletonAsset,
      {
        id: 'instance-b',
        mapId: 'map-1',
        gridX: 7,
        gridY: 8,
        color: '#C9954B',
      },
    )

  assert.notEqual(first.id, second.id)
  assert.equal(first.assetId, second.assetId)

  assert.equal(first.speedFeet, DEFAULT_TOKEN_SPEED_FEET)
  assert.equal(second.speedFeet, DEFAULT_TOKEN_SPEED_FEET)

  assert.equal(first.movementUsedFeet, 0)
  assert.equal(second.movementUsedFeet, 0)

  first.speedFeet = 60
  first.movementUsedFeet = 25
  first.name = 'Skeleton A'

  assert.equal(second.speedFeet, DEFAULT_TOKEN_SPEED_FEET)
  assert.equal(second.movementUsedFeet, 0)
  assert.equal(second.name, 'Skeleton')
})

test('fresh token instances always start with fresh movement defaults', () => {
  const token =
    createFreshTokenInstance(
      skeletonAsset,
      {
        id: 'fresh-instance',
        mapId: 'map-1',
        gridX: 0,
        gridY: 0,
        color: '#C9954B',
      },
    )

  assert.equal(token.speedFeet, 30)
  assert.equal(token.movementUsedFeet, 0)
})

test('legacy invalid zero speed is repaired to the current default', () => {
  const token =
    createFreshTokenInstance(
      skeletonAsset,
      {
        id: 'legacy-instance',
        mapId: 'map-1',
        gridX: 0,
        gridY: 0,
        color: '#C9954B',
      },
    )

  token.speedFeet = 0
  token.movementUsedFeet = -20

  const normalized =
    normalizeTokenInstance(token)

  assert.equal(normalized.speedFeet, 30)
  assert.equal(normalized.movementUsedFeet, 0)
})

test('movement summary distinguishes speed, used and remaining movement', () => {
  assert.deepEqual(
    tokenMovementSummary({
      speedFeet: 30,
      movementUsedFeet: 10,
    }),
    {
      speedFeet: 30,
      usedFeet: 10,
      remainingFeet: 20,
    },
  )
})
