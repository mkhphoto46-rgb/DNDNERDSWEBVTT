import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createFreshActorFromAsset,
  migrateActorState,
  nextActorName,
} from './actors'

import {
  createFreshSceneTokenInstance,
  tokenAssetFromActorPortrait,
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

test('one portrait can create independent actors and scene tokens', () => {
  const firstActor = createFreshActorFromAsset(
    skeletonAsset,
    {
      id: 'actor-a',
      name: 'Skeleton',
    },
  )

  const secondActor = createFreshActorFromAsset(
    skeletonAsset,
    {
      id: 'actor-b',
      name: 'Skeleton 2',
    },
  )

  const firstToken = createFreshSceneTokenInstance(
    skeletonAsset,
    {
      id: 'token-a',
      actorId: firstActor.id,
      mapId: 'map-1',
      gridX: 2,
      gridY: 3,
      color: '#C9954B',
    },
  )

  const secondToken = createFreshSceneTokenInstance(
    skeletonAsset,
    {
      id: 'token-b',
      actorId: secondActor.id,
      mapId: 'map-1',
      gridX: 7,
      gridY: 8,
      color: '#C9954B',
    },
  )

  firstActor.speedFeet = 60
  firstActor.currentHp = 3
  firstToken.movementUsedFeet = 25

  assert.equal(secondActor.speedFeet, 30)
  assert.equal(secondActor.currentHp, 10)
  assert.equal(secondToken.movementUsedFeet, 0)
  assert.notEqual(firstToken.actorId, secondToken.actorId)
})

test('new actors created from the same portrait receive useful unique default names', () => {
  const actors = [
    createFreshActorFromAsset(
      skeletonAsset,
      {
        id: 'actor-a',
        name: 'Skeleton',
      },
    ),
  ]

  assert.equal(
    nextActorName('Skeleton.jpg', actors),
    'Skeleton 2',
  )
})

test('legacy token-only campaign state migrates to actor plus scene token', () => {
  const migrated = migrateActorState(
    undefined,
    [
      {
        id: 'legacy-token',
        actorId: '',
        assetId: skeletonAsset.id,
        imageUrl: skeletonAsset.url,
        mapId: 'map-1',
        gridX: 1,
        gridY: 2,
        size: 1,
        visible: true,
        color: '#C9954B',
        movementUsedFeet: 5,
        name: 'Old Skeleton',
        ownerId: null,
        level: 4,
        speedFeet: 40,
      },
    ],
  )

  assert.equal(migrated.actors.length, 1)
  assert.equal(migrated.tokens.length, 1)
  assert.equal(migrated.actors[0].name, 'Old Skeleton')
  assert.equal(migrated.actors[0].level, 4)
  assert.equal(migrated.actors[0].speedFeet, 40)
  assert.equal(migrated.tokens[0].actorId, migrated.actors[0].id)
  assert.equal(migrated.tokens[0].movementUsedFeet, 5)
})

test('movement summary reads actor speed and token movement independently', () => {
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


test('actor portraits outside the Token Chest can back a scene token asset', () => {
  const actor = createFreshActorFromAsset(
    skeletonAsset,
    { id: 'actor-compendium', name: 'Compendium Skeleton' },
  )

  actor.portraitAssetId = 'compendium:srd:skeleton'
  actor.portraitUrl = '/api/compendium/monsters/srd%3Askeleton/portrait'

  const asset = tokenAssetFromActorPortrait(actor)
  assert.ok(asset)
  assert.equal(asset.id, 'compendium:srd:skeleton')
  assert.equal(asset.url, actor.portraitUrl)

  const token = createFreshSceneTokenInstance(asset, {
    id: 'scene-compendium',
    actorId: actor.id,
    mapId: 'map-1',
    gridX: 4,
    gridY: 5,
    color: '#C9954B',
  })

  assert.equal(token.imageUrl, actor.portraitUrl)
  assert.equal(token.assetId, 'compendium:srd:skeleton')
})
