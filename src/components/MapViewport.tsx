import {
  Application,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
  type FederatedPointerEvent,
} from 'pixi.js'

import {
  forwardRef,
  lazy,
  Suspense,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'

import './MapViewport.css'
const DiceRollStage = lazy(() => import('./DiceRollStage').then((module) => ({ default: module.DiceRollStage })))

import {
  centerCamera,
  clampZoom,
  fitCamera,
  panCamera,
  type MapCamera,
  zoomCameraAtPoint,
} from '../lib/mapCamera'

import {
  clampGridPointToMap,
} from '../lib/mapGridBounds'

import type { TurnEconomyState } from '../types/actionEconomy'
import type {
  DiceRollPresentation,
  DiceThemeDefinition,
} from '../types/diceVisuals'

import type {
  GridSettings,
  PlayerVisionRuntime,
  SceneMapAsset,
  RenderableSceneToken,
  VisionDoorInteraction,
  VisionDoorState,
} from '../types/scene'

export interface MapViewportHandle {
  fitMap: () => void
  actualSize: () => void
  zoomIn: () => void
  zoomOut: () => void
  clearArcaneReach: () => void
}

export type ArcaneReachMode =
  | 'measure'
  | 'radius'
  | 'cube'
  | 'cone'
  | 'line'

export interface ArcaneReachAffectedToken {
  tokenId: string
  actorId: string
  name: string
}

export interface ArcaneReachResult {
  mode: ArcaneReachMode
  label: string
  distanceFeet: number
  affectedTokens: ArcaneReachAffectedToken[]
}

export interface ArcaneReachGridPoint {
  gridX: number
  gridY: number
}

export interface ArcaneReachPlacement {
  mode: ArcaneReachMode
  start: ArcaneReachGridPoint
  end: ArcaneReachGridPoint
}

export interface ArcaneReachSharedSigil extends ArcaneReachPlacement {
  controllerId: string
  role: 'dm' | 'player'
  mapId: string
  color: string
}

interface ArcaneReachDraft extends ArcaneReachPlacement {}

interface ArcaneReachGeometry {
  mode: ArcaneReachMode
  label: string
  distanceFeet: number
  startX: number
  startY: number
  endX: number
  endY: number
  directionX: number
  directionY: number
  normalX: number
  normalY: number
  lengthSquares: number
  radiusSquares: number
  cubeX: number
  cubeY: number
  cubeSizeSquares: number
  halfWidthSquares: number
}

function buildArcaneReachGeometry(
  mode: ArcaneReachMode,
  draft: ArcaneReachDraft,
): ArcaneReachGeometry {
  const startX = draft.start.gridX + 0.5
  const startY = draft.start.gridY + 0.5
  const pointerX = draft.end.gridX + 0.5
  const pointerY = draft.end.gridY + 0.5

  const rawDx = pointerX - startX
  const rawDy = pointerY - startY
  const rawDistance = Math.hypot(rawDx, rawDy)
  const directionX = rawDistance > 0 ? rawDx / rawDistance : 1
  const directionY = rawDistance > 0 ? rawDy / rawDistance : 0
  const normalX = -directionY
  const normalY = directionX
  const lengthSquares = Math.max(1, Math.ceil(rawDistance))
  const snappedEndX = startX + directionX * lengthSquares
  const snappedEndY = startY + directionY * lengthSquares

  const cellDx = draft.end.gridX - draft.start.gridX
  const cellDy = draft.end.gridY - draft.start.gridY
  const cubeSizeSquares = Math.max(
    1,
    Math.max(Math.abs(cellDx), Math.abs(cellDy)) + 1,
  )
  const cubeX =
    cellDx >= 0
      ? draft.start.gridX
      : draft.start.gridX - cubeSizeSquares + 1
  const cubeY =
    cellDy >= 0
      ? draft.start.gridY
      : draft.start.gridY - cubeSizeSquares + 1

  const measureFeet =
    rawDistance <= 0
      ? 0
      : Math.ceil(rawDistance) * 5

  const distanceFeet =
    mode === 'measure'
      ? measureFeet
      : mode === 'cube'
        ? cubeSizeSquares * 5
        : lengthSquares * 5

  const label =
    mode === 'measure'
      ? `${distanceFeet} ft`
      : mode === 'radius'
        ? `${distanceFeet}-ft radius`
        : mode === 'cube'
          ? `${distanceFeet}-ft cube`
          : mode === 'cone'
            ? `${distanceFeet}-ft cone`
            : `${distanceFeet} × 5-ft line`

  return {
    mode,
    label,
    distanceFeet,
    startX,
    startY,
    endX:
      mode === 'measure'
        ? pointerX
        : snappedEndX,
    endY:
      mode === 'measure'
        ? pointerY
        : snappedEndY,
    directionX,
    directionY,
    normalX,
    normalY,
    lengthSquares,
    radiusSquares: lengthSquares,
    cubeX,
    cubeY,
    cubeSizeSquares,
    halfWidthSquares:
      mode === 'cone'
        ? lengthSquares / 2
        : 0.5,
  }
}

function tokenIntersectsArcaneReach(
  geometry: ArcaneReachGeometry,
  token: RenderableSceneToken,
): boolean {
  if (geometry.mode === 'measure') {
    return false
  }

  const tokenCenterX = token.gridX + Math.max(0.5, token.size) / 2
  const tokenCenterY = token.gridY + Math.max(0.5, token.size) / 2
  const tokenHalfSize = Math.max(0.25, Math.max(0.5, token.size) / 2)

  if (geometry.mode === 'radius') {
    return (
      Math.hypot(
        tokenCenterX - geometry.startX,
        tokenCenterY - geometry.startY,
      ) <=
      geometry.radiusSquares + tokenHalfSize
    )
  }

  if (geometry.mode === 'cube') {
    return (
      tokenCenterX >= geometry.cubeX - tokenHalfSize &&
      tokenCenterX <=
        geometry.cubeX +
          geometry.cubeSizeSquares +
          tokenHalfSize &&
      tokenCenterY >= geometry.cubeY - tokenHalfSize &&
      tokenCenterY <=
        geometry.cubeY +
          geometry.cubeSizeSquares +
          tokenHalfSize
    )
  }

  const offsetX = tokenCenterX - geometry.startX
  const offsetY = tokenCenterY - geometry.startY
  const forward =
    offsetX * geometry.directionX +
    offsetY * geometry.directionY
  const side = Math.abs(
    offsetX * geometry.normalX +
    offsetY * geometry.normalY,
  )

  if (
    forward < -tokenHalfSize ||
    forward > geometry.lengthSquares + tokenHalfSize
  ) {
    return false
  }

  if (geometry.mode === 'line') {
    return side <= geometry.halfWidthSquares + tokenHalfSize
  }

  const clampedForward = Math.min(
    geometry.lengthSquares,
    Math.max(0, forward),
  )
  const coneHalfWidthAtPoint =
    (
      clampedForward /
      Math.max(1, geometry.lengthSquares)
    ) *
    geometry.halfWidthSquares

  return side <= coneHalfWidthAtPoint + tokenHalfSize
}

interface MapViewportProps {
  activeMap:
    | SceneMapAsset
    | null

  grid:
    GridSettings

  tokens:
    RenderableSceneToken[]

  movableTokenIds:
    string[]

  placementEnabled:
    boolean

  onTokenMove?:
    (
      tokenId: string,
      gridX: number,
      gridY: number,
    ) => void

  onTokenPickup?:
    (tokenId: string) => void

  onTokenSnap?:
    (tokenId: string) => void

  onTokenHover?:
    (token: RenderableSceneToken | null) => void

  onTokenSelect?:
    (token: RenderableSceneToken) => void

  showHealthBars: boolean

  onPlaceAtGrid?:
    (
      gridX: number,
      gridY: number,
    ) => void

  onAssetDrop?:
    (
      assetId: string,
      gridX: number,
      gridY: number,
    ) => void

  panEnabled:
    boolean

  onCameraChange?:
    (
      camera:
        MapCamera,
    ) => void

  visionRuntime?: PlayerVisionRuntime | null
  onMapMetrics?: (size: { width: number; height: number }) => void

  doorInteractions?: VisionDoorInteraction[]
  doorInteractionRole?: 'dm' | 'player' | null
  onDoorSetState?: (doorId: string, state: VisionDoorState) => void

  arcaneReachActive?: boolean
  arcaneReachMode?: ArcaneReachMode
  arcaneReachControllerId?: string
  arcaneReachColor?: string
  arcaneReachSigils?: ArcaneReachSharedSigil[]
  onArcaneReachResult?: (result: ArcaneReachResult | null) => void
  onArcaneReachCommit?: (placement: ArcaneReachPlacement) => void

  targetingActive?: boolean
  validTargetActorIds?: string[]
  activeTurnActorId?: string | null
  activeTurnEconomy?: TurnEconomyState | null
  activeTurnMovementRemainingFeet?: number | null
  turnHudInteractive?: boolean
  onTurnCommand?: (command: 'attack' | 'dash' | 'disengage' | 'dodge' | 'stand-up' | 'utility' | 'ready' | 'end-turn') => void
  targetAreaEnabled?: boolean
  targetArea?: { gridX: number; gridY: number; radiusFeet: number } | null
  onTargetAreaAtGrid?: (gridX: number, gridY: number) => void
  diceRoll?: DiceRollPresentation | null
  diceTheme?: DiceThemeDefinition
  onDiceRollComplete?: (rollId: string) => void
}

interface MapSize {
  width: number
  height: number
}

interface LoadedImageTexture {
  texture: Texture
  width: number
  height: number
}


function tokenColorNumber(value: string): number {
  const normalized = /^#[0-9a-f]{6}$/i.test(value)
    ? value.slice(1)
    : 'C9954B'

  return Number.parseInt(normalized, 16)
}

const INITIAL_CAMERA:
  MapCamera = {
    x: 0,
    y: 0,
    zoom: 1,
  }

function normalizeOffset(
  value: number,
  cellSize: number,
): number {
  return (
    (
      value %
      cellSize
    ) +
    cellSize
  ) %
  cellSize
}

function loadImageElement(
  url: string,
): Promise<HTMLImageElement> {
  return new Promise(
    (
      resolve,
      reject,
    ) => {
      const image =
        new Image()

      image.decoding =
        'async'

      const cleanup =
        () => {
          image.onload =
            null

          image.onerror =
            null
        }

      image.onload =
        () => {
          cleanup()

          if (
            image.naturalWidth <= 0 ||
            image.naturalHeight <= 0
          ) {
            reject(
              new Error(
                'The map image loaded without valid dimensions.',
              ),
            )

            return
          }

          resolve(
            image,
          )
        }

      image.onerror =
        () => {
          cleanup()

          reject(
            new Error(
              'The browser could not load the map image.',
            ),
          )
        }

      image.src =
        url

      if (
        image.complete &&
        image.naturalWidth > 0 &&
        image.naturalHeight > 0
      ) {
        cleanup()

        resolve(
          image,
        )
      }
    },
  )
}

async function loadTextureFromMapUrl(
  url: string,
): Promise<LoadedImageTexture> {
  const image =
    await loadImageElement(
      url,
    )

  const texture =
    Texture.from(
      image,
    )

  return {
    texture,

    width:
      image.naturalWidth,

    height:
      image.naturalHeight,
  }
}

export const MapViewport =
  forwardRef<
    MapViewportHandle,
    MapViewportProps
  >(
    function MapViewport(
      {
        activeMap,
        grid,
        tokens,
        movableTokenIds,
        placementEnabled,
        onTokenMove,
        onTokenPickup,
        onTokenSnap,
        onTokenHover,
        onTokenSelect,
        showHealthBars,
        onPlaceAtGrid,
        onAssetDrop,
        panEnabled,
        onCameraChange,
        visionRuntime = null,
        onMapMetrics,
        doorInteractions = [],
        doorInteractionRole = null,
        onDoorSetState,
        arcaneReachActive = false,
        arcaneReachMode = 'measure',
        arcaneReachControllerId = '',
        arcaneReachColor = '#78B8C8',
        arcaneReachSigils = [],
        onArcaneReachResult,
        onArcaneReachCommit,
        targetingActive = false,
        validTargetActorIds = [],
        activeTurnActorId = null,
        activeTurnEconomy = null,
        activeTurnMovementRemainingFeet = null,
        turnHudInteractive = false,
        onTurnCommand,
        targetAreaEnabled = false,
        targetArea = null,
        onTargetAreaAtGrid,
        diceRoll = null,
        diceTheme,
        onDiceRollComplete,
      },
      ref,
    ) {
      const hostRef =
        useRef<HTMLDivElement>(
          null,
        )

      const appRef =
        useRef<Application | null>(
          null,
        )

      const worldRef =
        useRef<Container | null>(
          null,
        )

      // Keep the latest interaction callbacks in a ref so UI-only React
      // re-renders (for example token hover changes) do not force Pixi token
      // containers to be destroyed and rebuilt in the middle of a drag.
      const tokenInteractionRef = useRef({
        onTokenMove,
        onTokenPickup,
        onTokenSnap,
        onTokenHover,
        onTokenSelect,
        onTurnCommand,
      })

      tokenInteractionRef.current = {
        onTokenMove,
        onTokenPickup,
        onTokenSnap,
        onTokenHover,
        onTokenSelect,
        onTurnCommand,
      }

      const mapMetricsCallbackRef =
        useRef(onMapMetrics)

      mapMetricsCallbackRef.current =
        onMapMetrics

      // App.tsx derives fresh arrays on every React render. Depend on stable
      // value signatures instead of those array identities so hover/status
      // updates cannot tear down an active Pixi drag.
      const tokenRenderSignature = JSON.stringify(
        tokens.map((token) => ({
          id: token.id,
          actorId: token.actorId,
          assetId: token.assetId,
          imageUrl: token.imageUrl,
          mapId: token.mapId,
          gridX: token.gridX,
          gridY: token.gridY,
          size: token.size,
          visible: token.visible,
          color: token.color,
          movementUsedFeet: token.movementUsedFeet,
          name: token.name,
          ownerId: token.ownerId,
          level: token.level,
          speedFeet: token.speedFeet,
          currentHp: token.currentHp,
          maxHp: token.maxHp,
          tempHp: token.tempHp,
          lifeState: token.lifeState,
          conditions: token.conditions,
          effects: token.effects,
          targetedByActorIds: token.targetedByActorIds,
          targetedByControllerIds: token.targetedByControllerIds,
          targetedByMe: token.targetedByMe,
        })),
      )

      const movableTokenIdsSignature = [...movableTokenIds]
        .sort()
        .join('\u001f')

      const validTargetActorIdsSignature = [...validTargetActorIds]
        .sort()
        .join('\u001f')

      const activeTurnEconomySignature = activeTurnEconomy
        ? JSON.stringify(activeTurnEconomy)
        : ''

      const visionRuntimeSignature =
        visionRuntime
          ? JSON.stringify(visionRuntime)
          : ''

      const doorInteractionsSignature =
        JSON.stringify(
          doorInteractions.map((door) => ({
            id: door.id,
            mapId: door.mapId,
            state: door.state,
            start: door.start,
            end: door.end,
            distanceFeet: door.distanceFeet ?? null,
          })),
        )

      const [selectedDoorId, setSelectedDoorId] =
        useState<string | null>(null)

      const selectedDoor =
        selectedDoorId
          ? doorInteractions.find((door) => door.id === selectedDoorId) ?? null
          : null

      const contentLayerRef =
        useRef<Container | null>(
          null,
        )

      const visionMaskRef =
        useRef<Graphics | null>(
          null,
        )

      const visionFogBackdropRef =
        useRef<Graphics | null>(
          null,
        )

      const mapSpriteRef =
        useRef<Sprite | null>(
          null,
        )

      const gridGraphicsRef =
        useRef<Graphics | null>(
          null,
        )

      const tokenLayerRef =
        useRef<Container | null>(
          null,
        )

      const arcaneReachLayerRef =
        useRef<Container | null>(
          null,
        )

      const doorLayerRef =
        useRef<Container | null>(
          null,
        )

      const [arcaneReachDraft, setArcaneReachDraft] =
        useState<ArcaneReachDraft | null>(null)

      const [, setArcaneReachResult] =
        useState<ArcaneReachResult | null>(null)

      const arcaneReachDragRef =
        useRef<{
          pointerId: number | null
          start: ArcaneReachGridPoint | null
          mode: ArcaneReachMode | null
        }>({
          pointerId: null,
          start: null,
          mode: null,
        })

      const arcaneReachCommitRef =
        useRef(
          onArcaneReachCommit,
        )

      arcaneReachCommitRef.current =
        onArcaneReachCommit

      const arcaneReachSigilsSignature =
        JSON.stringify(
          [...arcaneReachSigils]
            .sort((left, right) =>
              left.controllerId.localeCompare(right.controllerId),
            )
            .map((sigil) => ({
              controllerId: sigil.controllerId,
              role: sigil.role,
              mapId: sigil.mapId,
              color: sigil.color,
              mode: sigil.mode,
              start: sigil.start,
              end: sigil.end,
            })),
        )

      const mapSizeRef =
        useRef<MapSize>({
          width: 0,
          height: 0,
        })

      const cameraRef =
        useRef<MapCamera>({
          ...INITIAL_CAMERA,
        })

      const cameraModeRef =
        useRef<'fit' | 'manual'>(
          'fit',
        )

      const panEnabledRef =
        useRef(
          panEnabled,
        )

      const pointerRef =
        useRef<{
          active: boolean
          pointerId:
            | number
            | null
          lastX: number
          lastY: number
        }>({
          active: false,
          pointerId: null,
          lastX: 0,
          lastY: 0,
        })

      const touchPointsRef = useRef<Map<number, { x: number; y: number }>>(new Map())
      const pinchRef = useRef<{
        distance: number
        centerX: number
        centerY: number
      } | null>(null)

      const [
        ready,
        setReady,
      ] =
        useState(
          false,
        )

      const [
        loadError,
        setLoadError,
      ] =
        useState<
          string |
          null
        >(
          null,
        )

      const [
        mapLoading,
        setMapLoading,
      ] =
        useState(false)

      const [
        mapLoadRevision,
        setMapLoadRevision,
      ] =
        useState(0)


      useEffect(
        () => {
          panEnabledRef.current =
            panEnabled
        },
        [
          panEnabled,
        ],
      )

      useEffect(
        () => {
          onTokenHover?.(null)
        },
        [
          activeMap?.id,
          onTokenHover,
        ],
      )

      const applyCamera =
        (
          camera:
            MapCamera,
        ) => {
          cameraRef.current =
            camera

          const world =
            worldRef.current

          if (world) {
            world.position.set(
              camera.x,
              camera.y,
            )

            world.scale.set(
              camera.zoom,
            )
          }

          onCameraChange?.(
            camera,
          )
        }

      const viewportSize =
        () => {
          const app =
            appRef.current

          if (!app) {
            return {
              width: 0,
              height: 0,
            }
          }

          return {
            width:
              app.screen.width,

            height:
              app.screen.height,
          }
        }

      const fitMap =
        () => {
          const worldSize =
            mapSizeRef.current

          if (
            worldSize.width <= 0 ||
            worldSize.height <= 0
          ) {
            return
          }

          cameraModeRef.current =
            'fit'

          const viewport =
            viewportSize()

          applyCamera(
            fitCamera(
              viewport,
              worldSize,
              viewport.width <= 760 ? 6 : 18,
            ),
          )
        }

      const actualSize =
        () => {
          const worldSize =
            mapSizeRef.current

          if (
            worldSize.width <= 0 ||
            worldSize.height <= 0
          ) {
            return
          }

          cameraModeRef.current =
            'manual'

          applyCamera(
            centerCamera(
              viewportSize(),
              worldSize,
              1,
            ),
          )
        }

      const zoomBy =
        (
          factor:
            number,
        ) => {
          const size =
            viewportSize()

          if (
            size.width <= 0 ||
            size.height <= 0
          ) {
            return
          }

          const camera =
            cameraRef.current

          cameraModeRef.current =
            'manual'

          applyCamera(
            zoomCameraAtPoint(
              camera,
              {
                x:
                  size.width /
                  2,

                y:
                  size.height /
                  2,
              },
              camera.zoom *
                factor,
            ),
          )
        }

      const clearArcaneReach = () => {
        arcaneReachDragRef.current = {
          pointerId: null,
          start: null,
          mode: null,
        }
        setArcaneReachDraft(null)
        setArcaneReachResult(null)
        onArcaneReachResult?.(null)
      }

      useImperativeHandle(
        ref,
        () => ({
          fitMap,

          actualSize,

          zoomIn: () =>
            zoomBy(
              1.1,
            ),

          zoomOut: () =>
            zoomBy(
              1 / 1.1,
            ),

          clearArcaneReach,
        }),
      )

      useEffect(
        () => {
          let cancelled =
            false

          const host =
            hostRef.current

          if (!host) {
            return
          }

          const application =
            new Application()

          const initialise =
            async () => {
              try {
                await application.init({
                  resizeTo:
                    host,

                  preference:
                    'webgl',

                  antialias:
                    true,

                  autoDensity:
                    true,

                  resolution:
                    Math.min(
                      window.devicePixelRatio ||
                        1,
                      2,
                    ),

                  background:
                    '#03080b',

                  backgroundAlpha:
                    1,
                })

                if (cancelled) {
                  application.destroy(
                    true,
                  )

                  return
                }

                application.canvas.className =
                  'pixi-map-canvas'

                application.canvas.setAttribute(
                  'aria-label',
                  'Battle map viewport',
                )

                host.appendChild(
                  application.canvas,
                )

                const world =
                  new Container()

                world.sortableChildren =
                  true

                application.stage.addChild(
                  world,
                )

                appRef.current =
                  application

                worldRef.current =
                  world

                setReady(
                  true,
                )
              } catch (error) {
                setLoadError(
                  error instanceof Error
                    ? error.message
                    : 'PixiJS could not initialize the map renderer.',
                )
              }
            }

          initialise()

          return () => {
            cancelled =
              true

            setReady(
              false,
            )

            contentLayerRef.current =
              null

            visionMaskRef.current =
              null

            visionFogBackdropRef.current =
              null

            contentLayerRef.current =
              null

            visionMaskRef.current =
              null

            mapSpriteRef.current =
              null

            gridGraphicsRef.current =
              null

            tokenLayerRef.current =
              null

            arcaneReachLayerRef.current =
              null

            doorLayerRef.current =
              null

            worldRef.current =
              null

            appRef.current =
              null

            application.destroy(
              true,
            )
          }
        },
        [],
      )

      useEffect(
        () => {
          if (!ready) {
            return
          }

          const world =
            worldRef.current

          if (!world) {
            return
          }

          let cancelled =
            false

          const loadMap =
            async () => {
              setLoadError(
                null,
              )
              setMapLoading(Boolean(activeMap))
              setSelectedDoorId(null)

              if (!activeMap) {
                const previous = world.removeChildren()

                for (const child of previous) {
                  child.destroy({ children: true })
                }

                contentLayerRef.current = null
                visionMaskRef.current = null
                visionFogBackdropRef.current = null
                mapSpriteRef.current = null
                gridGraphicsRef.current = null
                tokenLayerRef.current = null
                arcaneReachLayerRef.current = null
                doorLayerRef.current = null
                mapSizeRef.current = { width: 0, height: 0 }
                setMapLoading(false)
                applyCamera({
                  ...INITIAL_CAMERA,
                })

                return
              }

              try {
                const loaded =
                  await loadTextureFromMapUrl(
                    activeMap.url,
                  )

                if (cancelled) {
                  loaded.texture.destroy()

                  return
                }

                const sprite =
                  new Sprite(
                    loaded.texture,
                  )

                sprite.position.set(
                  0,
                  0,
                )

                sprite.width =
                  loaded.width

                sprite.height =
                  loaded.height

                sprite.zIndex =
                  0

                const gridGraphics =
                  new Graphics()

                gridGraphics.zIndex =
                  10

                const arcaneReachLayer =
                  new Container()

                arcaneReachLayer.zIndex =
                  15

                const tokenLayer =
                  new Container()

                tokenLayer.zIndex =
                  20

                const doorLayer =
                  new Container()

                doorLayer.zIndex =
                  35

                const contentLayer =
                  new Container()

                contentLayer.sortableChildren =
                  true

                const visionFogBackdrop =
                  new Graphics()

                visionFogBackdrop.zIndex =
                  -5

                const visionMask =
                  new Graphics()

                visionMask.zIndex =
                  1000

                contentLayer.zIndex =
                  0

                contentLayer.addChild(
                  sprite,
                  gridGraphics,
                  arcaneReachLayer,
                  tokenLayer,
                )

                // Keep the current scene visible until the replacement map has
                // loaded successfully. This prevents a slow or failed image
                // request from leaving the entire tabletop blank.
                const previous = world.removeChildren()

                for (const child of previous) {
                  child.destroy({ children: true })
                }

                world.addChild(
                  visionFogBackdrop,
                  contentLayer,
                  doorLayer,
                  visionMask,
                )

                contentLayerRef.current =
                  contentLayer

                visionMaskRef.current =
                  visionMask

                visionFogBackdropRef.current =
                  visionFogBackdrop

                mapSpriteRef.current =
                  sprite

                gridGraphicsRef.current =
                  gridGraphics

                tokenLayerRef.current =
                  tokenLayer

                arcaneReachLayerRef.current =
                  arcaneReachLayer

                doorLayerRef.current =
                  doorLayer

                mapSizeRef.current = {
                  width:
                    loaded.width,

                  height:
                    loaded.height,
                }

                mapMetricsCallbackRef.current?.({
                  width: loaded.width,
                  height: loaded.height,
                })

                setMapLoadRevision((current) => current + 1)
                setMapLoading(false)

                requestAnimationFrame(
                  () => {
                    requestAnimationFrame(
                      () => {
                        fitMap()
                      },
                    )
                  },
                )
              } catch (error) {
                if (cancelled) return

                setMapLoading(false)
                setLoadError(
                  error instanceof Error
                    ? error.message
                    : 'Map texture failed to load.',
                )
              }
            }

          loadMap()

          return () => {
            cancelled =
              true
          }
        },
        [
          ready,
          activeMap?.id,
          activeMap?.url,
        ],
      )

      useEffect(
        () => {
          const contentLayer = contentLayerRef.current
          const mask = visionMaskRef.current
          const fogBackdrop = visionFogBackdropRef.current
          const mapSize = mapSizeRef.current

          if (!contentLayer || !mask || !fogBackdrop) {
            return
          }

          mask.clear()
          fogBackdrop.clear()
          contentLayer.mask = null

          const runtimeActive =
            Boolean(
              activeMap &&
              visionRuntime?.enabled &&
              visionRuntime.mapId === activeMap.id &&
              mapSize.width > 0 &&
              mapSize.height > 0,
            )

          if (!runtimeActive) {
            return
          }

          // Draw an explicit black battlefield behind the visibility-masked
          // content. This makes unexplored/out-of-LOS space visibly dark
          // instead of depending on transparent canvas/background behavior.
          fogBackdrop
            .rect(
              0,
              0,
              mapSize.width,
              mapSize.height,
            )
            .fill({
              color: 0x000000,
              alpha: 1,
            })

          for (const polygon of visionRuntime?.polygons ?? []) {
            if (polygon.length < 3) continue

            mask
              .poly(
                polygon.flatMap((point) => [
                  point.x * mapSize.width,
                  point.y * mapSize.height,
                ]),
              )
              .fill({
                color: 0xffffff,
                alpha: 1,
              })
          }

          // An active runtime with no valid source polygon intentionally shows
          // full fog rather than leaking the complete map.
          contentLayer.mask = mask
        },
        [
          ready,
          activeMap?.id,
          visionRuntimeSignature,
          mapLoadRevision,
        ],
      )

      useEffect(
        () => {
          const layer =
            doorLayerRef.current

          const mapSize =
            mapSizeRef.current

          if (!layer) {
            return
          }

          const previous =
            layer.removeChildren()

          for (const child of previous) {
            child.destroy({ children: true })
          }

          if (
            !activeMap ||
            mapSize.width <= 0 ||
            mapSize.height <= 0
          ) {
            return
          }

          for (const door of doorInteractions) {
            if (door.mapId !== activeMap.id) {
              continue
            }

            const startX =
              door.start.x * mapSize.width

            const startY =
              door.start.y * mapSize.height

            const endX =
              door.end.x * mapSize.width

            const endY =
              door.end.y * mapSize.height

            const midX =
              (startX + endX) / 2

            const midY =
              (startY + endY) / 2

            const selected =
              selectedDoorId === door.id

            const stateColor =
              door.state === 'open'
                ? 0x79d89a
                : door.state === 'locked'
                  ? 0xe0828b
                  : 0x86d9ef

            const holder =
              new Container()

            holder.eventMode =
              'static'

            holder.cursor =
              'pointer'

            const minX =
              Math.min(startX, endX)

            const minY =
              Math.min(startY, endY)

            const width =
              Math.max(1, Math.abs(endX - startX))

            const height =
              Math.max(1, Math.abs(endY - startY))

            holder.hitArea =
              new Rectangle(
                minX - 18,
                minY - 18,
                width + 36,
                height + 36,
              )

            const graphics =
              new Graphics()

            graphics
              .moveTo(startX, startY)
              .lineTo(endX, endY)
              .stroke({
                width:
                  Math.max(
                    selected ? 8 : 6,
                    grid.cellSize * (selected ? 0.13 : 0.1),
                  ),
                color: stateColor,
                alpha: selected ? 1 : 0.88,
              })

            graphics
              .circle(
                midX,
                midY,
                Math.max(
                  selected ? 11 : 9,
                  grid.cellSize * (selected ? 0.16 : 0.13),
                ),
              )
              .fill({
                color: 0x06151c,
                alpha: 0.94,
              })
              .stroke({
                width: selected ? 3 : 2,
                color: stateColor,
                alpha: 1,
              })

            const glyph =
              new Text({
                text:
                  door.state === 'locked'
                    ? 'L'
                    : door.state === 'open'
                      ? 'O'
                      : 'D',
                style: {
                  fontFamily:
                    'Georgia, serif',
                  fontSize:
                    Math.max(
                      10,
                      Math.min(
                        16,
                        grid.cellSize * 0.18,
                      ),
                    ),
                  fontWeight:
                    '700',
                  fill:
                    stateColor,
                },
              })

            glyph.anchor.set(
              0.5,
            )

            glyph.position.set(
              midX,
              midY,
            )

            graphics.eventMode =
              'none'

            glyph.eventMode =
              'none'

            holder.addChild(
              graphics,
              glyph,
            )

            holder.on(
              'pointertap',
              (event) => {
                event.stopPropagation()
                setSelectedDoorId(
                  (current) =>
                    current === door.id
                      ? null
                      : door.id,
                )
              },
            )

            layer.addChild(
              holder,
            )
          }
        },
        [
          ready,
          activeMap?.id,
          doorInteractionsSignature,
          selectedDoorId,
          grid.cellSize,
          mapLoadRevision,
        ],
      )

      useEffect(
        () => {
          if (
            selectedDoorId &&
            !doorInteractions.some(
              (door) => door.id === selectedDoorId,
            )
          ) {
            setSelectedDoorId(null)
          }
        },
        [
          activeMap?.id,
          doorInteractionsSignature,
          selectedDoorId,
        ],
      )

      useEffect(
        () => {
          arcaneReachDragRef.current = {
            pointerId: null,
            start: null,
            mode: null,
          }
          setArcaneReachDraft(null)
          setArcaneReachResult(null)
          onArcaneReachResult?.(null)
        },
        [
          activeMap?.id,
        ],
      )

      useEffect(
        () => {
          if (!arcaneReachDraft) {
            setArcaneReachResult(null)
            onArcaneReachResult?.(null)
            return
          }

          const geometry =
            buildArcaneReachGeometry(
              arcaneReachDraft.mode,
              arcaneReachDraft,
            )

          const result: ArcaneReachResult = {
            mode: arcaneReachDraft.mode,
            label: geometry.label,
            distanceFeet: geometry.distanceFeet,
            affectedTokens:
              tokens
                .filter((token) =>
                  tokenIntersectsArcaneReach(
                    geometry,
                    token,
                  ),
                )
                .map((token) => ({
                  tokenId: token.id,
                  actorId: token.actorId,
                  name: token.name,
                })),
          }

          setArcaneReachResult(result)
          onArcaneReachResult?.(result)
        },
        [
          arcaneReachDraft?.mode,
          arcaneReachDraft?.start.gridX,
          arcaneReachDraft?.start.gridY,
          arcaneReachDraft?.end.gridX,
          arcaneReachDraft?.end.gridY,
          tokenRenderSignature,
        ],
      )

      useEffect(
        () => {
          const layer =
            arcaneReachLayerRef.current

          if (!layer) {
            return
          }

          const previous =
            layer.removeChildren()

          for (const child of previous) {
            child.destroy({ children: true })
          }

          if (!activeMap) {
            return
          }

          const toPixelX =
            (gridX: number) =>
              grid.offsetX +
              gridX *
                grid.cellSize

          const toPixelY =
            (gridY: number) =>
              grid.offsetY +
              gridY *
                grid.cellSize

          const visibleSharedSigils =
            arcaneReachSigils.filter(
              (sigil) =>
                sigil.mapId === activeMap.id &&
                !(
                  arcaneReachDraft &&
                  arcaneReachControllerId &&
                  sigil.controllerId === arcaneReachControllerId
                ),
            )

          const renderSigils: ArcaneReachSharedSigil[] = [
            ...visibleSharedSigils,
            ...(
              arcaneReachDraft
                ? [{
                    controllerId:
                      arcaneReachControllerId || '__local__',
                    role: 'dm' as const,
                    mapId: activeMap.id,
                    color: arcaneReachColor,
                    mode: arcaneReachDraft.mode,
                    start: arcaneReachDraft.start,
                    end: arcaneReachDraft.end,
                  }]
                : []
            ),
          ]

          for (const sigil of renderSigils) {
            const geometry =
              buildArcaneReachGeometry(
                sigil.mode,
                sigil,
              )

            const graphics =
              new Graphics()

            const sigilColor =
              tokenColorNumber(
                sigil.color,
              )

            const stroke = {
              width: 3,
              color: sigilColor,
              alpha: 0.98,
            }

            const fill = {
              color: sigilColor,
              alpha: 0.18,
            }

            if (
              geometry.mode === 'measure'
            ) {
              graphics
                .moveTo(
                  toPixelX(
                    geometry.startX,
                  ),
                  toPixelY(
                    geometry.startY,
                  ),
                )
                .lineTo(
                  toPixelX(
                    geometry.endX,
                  ),
                  toPixelY(
                    geometry.endY,
                  ),
                )
                .stroke(
                  stroke,
                )

              graphics
                .circle(
                  toPixelX(
                    geometry.startX,
                  ),
                  toPixelY(
                    geometry.startY,
                  ),
                  Math.max(
                    4,
                    grid.cellSize *
                      0.08,
                  ),
                )
                .fill({
                  color: sigilColor,
                  alpha: 1,
                })

              graphics
                .circle(
                  toPixelX(
                    geometry.endX,
                  ),
                  toPixelY(
                    geometry.endY,
                  ),
                  Math.max(
                    4,
                    grid.cellSize *
                      0.08,
                  ),
                )
                .fill({
                  color: sigilColor,
                  alpha: 1,
                })
            } else if (
              geometry.mode === 'radius'
            ) {
              graphics
                .circle(
                  toPixelX(
                    geometry.startX,
                  ),
                  toPixelY(
                    geometry.startY,
                  ),
                  geometry.radiusSquares *
                    grid.cellSize,
                )
                .fill(
                  fill,
                )
                .stroke(
                  stroke,
                )
            } else if (
              geometry.mode === 'cube'
            ) {
              graphics
                .rect(
                  toPixelX(
                    geometry.cubeX,
                  ),
                  toPixelY(
                    geometry.cubeY,
                  ),
                  geometry.cubeSizeSquares *
                    grid.cellSize,
                  geometry.cubeSizeSquares *
                    grid.cellSize,
                )
                .fill(
                  fill,
                )
                .stroke(
                  stroke,
                )
            } else {
              const startX =
                toPixelX(
                  geometry.startX,
                )
              const startY =
                toPixelY(
                  geometry.startY,
                )
              const endX =
                toPixelX(
                  geometry.endX,
                )
              const endY =
                toPixelY(
                  geometry.endY,
                )
              const halfWidthPixels =
                geometry.halfWidthSquares *
                grid.cellSize
              const normalPixelX =
                geometry.normalX *
                halfWidthPixels
              const normalPixelY =
                geometry.normalY *
                halfWidthPixels

              const points =
                geometry.mode === 'cone'
                  ? [
                      startX,
                      startY,
                      endX +
                        normalPixelX,
                      endY +
                        normalPixelY,
                      endX -
                        normalPixelX,
                      endY -
                        normalPixelY,
                    ]
                  : [
                      startX +
                        normalPixelX,
                      startY +
                        normalPixelY,
                      endX +
                        normalPixelX,
                      endY +
                        normalPixelY,
                      endX -
                        normalPixelX,
                      endY -
                        normalPixelY,
                      startX -
                        normalPixelX,
                      startY -
                        normalPixelY,
                    ]

              graphics
                .poly(
                  points,
                )
                .fill(
                  fill,
                )
                .stroke(
                  stroke,
                )
            }

            graphics.eventMode =
              'none'

            const label =
              new Text({
                text:
                  geometry.label,
                style: {
                  fontFamily:
                    'Georgia, serif',
                  fontSize:
                    Math.max(
                      13,
                      Math.min(
                        20,
                        grid.cellSize *
                          0.26,
                      ),
                    ),
                  fontWeight:
                    '700',
                  fill:
                    sigilColor,
                  stroke: {
                    color:
                      0x081116,
                    width:
                      4,
                  },
                },
              })

            label.position.set(
              toPixelX(
                geometry.endX,
              ) +
                10,
              toPixelY(
                geometry.endY,
              ) -
                24,
            )

            label.eventMode =
              'none'

            layer.addChild(
              graphics,
              label,
            )
          }
        },
        [
          ready,
          activeMap?.id,
          arcaneReachDraft?.mode,
          arcaneReachDraft?.start.gridX,
          arcaneReachDraft?.start.gridY,
          arcaneReachDraft?.end.gridX,
          arcaneReachDraft?.end.gridY,
          arcaneReachControllerId,
          arcaneReachColor,
          arcaneReachSigilsSignature,
          grid.cellSize,
          grid.offsetX,
          grid.offsetY,
        ],
      )

      useEffect(
        () => {
          const layer =
            tokenLayerRef.current

          if (!layer || !activeMap) return

          let cancelled = false

          const renderTokens = async () => {
            const previous = layer.removeChildren()
            for (const child of previous) child.destroy({ children: true })

            if (targetArea && targetArea.radiusFeet > 0) {
              const area = new Graphics()
              const centerX = grid.offsetX + (targetArea.gridX + 0.5) * grid.cellSize
              const centerY = grid.offsetY + (targetArea.gridY + 0.5) * grid.cellSize
              const radiusPixels = (targetArea.radiusFeet / 5) * grid.cellSize
              area
                .circle(centerX, centerY, radiusPixels)
                .fill({ color: 0xc9954b, alpha: 0.12 })
                .stroke({ width: 2.5, color: 0xf1cf78, alpha: 0.9 })
              area.eventMode = 'none'
              layer.addChild(area)
            }

            const visibleSharedSigils =
              activeMap
                ? arcaneReachSigils.filter(
                    (sigil) =>
                      sigil.mapId === activeMap.id &&
                      !(
                        arcaneReachDraft &&
                        arcaneReachControllerId &&
                        sigil.controllerId === arcaneReachControllerId
                      ),
                  )
                : []

            const effectiveArcaneSigils: ArcaneReachSharedSigil[] = [
              ...visibleSharedSigils,
              ...(
                activeMap && arcaneReachDraft
                  ? [{
                      controllerId:
                        arcaneReachControllerId || '__local__',
                      role: 'dm' as const,
                      mapId: activeMap.id,
                      color: arcaneReachColor,
                      mode: arcaneReachDraft.mode,
                      start: arcaneReachDraft.start,
                      end: arcaneReachDraft.end,
                    }]
                  : []
              ),
            ]

            const arcaneGeometries =
              effectiveArcaneSigils.map((sigil) => ({
                sigil,
                geometry:
                  buildArcaneReachGeometry(
                    sigil.mode,
                    sigil,
                  ),
              }))

            for (const token of tokens) {
              try {
                const loaded = await loadTextureFromMapUrl(token.imageUrl)
                if (cancelled) {
                  loaded.texture.destroy()
                  return
                }

                const diameter =
                  Math.max(0.5, token.size) * grid.cellSize

                const holder = new Container()
                holder.position.set(
                  grid.offsetX + token.gridX * grid.cellSize,
                  grid.offsetY + token.gridY * grid.cellSize,
                )
                holder.zIndex = 20
                const canMoveToken =
                  !arcaneReachActive &&
                  movableTokenIds.includes(token.id)

                holder.eventMode =
                  arcaneReachActive
                    ? 'none'
                    : 'static'

                holder.cursor =
                  canMoveToken
                    ? 'grab'
                    : 'default'
                holder.hitArea = new Rectangle(0, 0, diameter, diameter)

                const showTokenInfo =
                  () => {
                    tokenInteractionRef.current.onTokenHover?.(token)
                  }

                holder.on('pointerover', showTokenInfo)
                holder.on('pointerout', () => {
                  tokenInteractionRef.current.onTokenHover?.(null)
                })

                holder.on('pointerdown', () => {
                  tokenInteractionRef.current.onTokenSelect?.(token)
                })

                if (canMoveToken) {
                  let dragging = false
                  let pointerOffsetX = 0
                  let pointerOffsetY = 0

                  const worldPoint =
                    (event: FederatedPointerEvent) => ({
                      x: (event.global.x - cameraRef.current.x) / cameraRef.current.zoom,
                      y: (event.global.y - cameraRef.current.y) / cameraRef.current.zoom,
                    })

                  const startDrag =
                    (event: FederatedPointerEvent) => {
                      event.stopPropagation()
                      const point = worldPoint(event)
                      dragging = true
                      pointerOffsetX = point.x - holder.x
                      pointerOffsetY = point.y - holder.y
                      holder.cursor = 'grabbing'
                      holder.alpha = 0.88
                      tokenInteractionRef.current.onTokenHover?.(null)
                      tokenInteractionRef.current.onTokenPickup?.(token.id)
                    }

                  const moveDrag =
                    (event: FederatedPointerEvent) => {
                      if (!dragging) return
                      event.stopPropagation()
                      const point = worldPoint(event)
                      holder.position.set(
                        point.x - pointerOffsetX,
                        point.y - pointerOffsetY,
                      )
                    }

                  const endDrag =
                    (event: FederatedPointerEvent) => {
                      if (!dragging) return
                      event.stopPropagation()
                      dragging = false
                      holder.cursor = 'grab'
                      holder.alpha = 1

                      const snappedPoint =
                        clampGridPointToMap(
                          {
                            gridX:
                              Math.round(
                                (
                                  holder.x -
                                  grid.offsetX
                                ) /
                                grid.cellSize,
                              ),

                            gridY:
                              Math.round(
                                (
                                  holder.y -
                                  grid.offsetY
                                ) /
                                grid.cellSize,
                              ),
                          },
                          mapSizeRef.current,
                          grid,
                          token.size,
                        )

                      holder.position.set(
                        grid.offsetX +
                          snappedPoint.gridX *
                            grid.cellSize,

                        grid.offsetY +
                          snappedPoint.gridY *
                            grid.cellSize,
                      )

                      tokenInteractionRef.current.onTokenMove?.(
                        token.id,
                        snappedPoint.gridX,
                        snappedPoint.gridY,
                      )
                      tokenInteractionRef.current.onTokenSnap?.(token.id)
                    }

                  holder.on('pointerdown', startDrag)
                  holder.on('globalpointermove', moveDrag)
                  holder.on('pointerup', endDrag)
                  holder.on('pointerupoutside', endDrag)
                }

                const shadow = new Graphics()
                shadow
                  .circle(diameter / 2 + 3, diameter / 2 + 5, diameter / 2 + 5)
                  .fill({ color: 0x000000, alpha: 0.58 })

                const portrait = new Sprite(loaded.texture)
                portrait.width = diameter - 8
                portrait.height = diameter - 8
                portrait.position.set(4, 4)

                const mask = new Graphics()
                mask.circle(diameter / 2, diameter / 2, diameter / 2 - 5).fill(0xffffff)
                portrait.mask = mask

                const ring = new Graphics()
                ring
                  .circle(diameter / 2, diameter / 2, diameter / 2 + 2)
                  .stroke({
                    width: 2,
                    color: 0x120a06,
                    alpha: 0.92,
                  })
                  .circle(diameter / 2, diameter / 2, diameter / 2 - 2)
                  .stroke({
                    width: 5,
                    color: tokenColorNumber(token.color),
                    alpha: 1,
                  })
                  .circle(diameter / 2, diameter / 2, diameter / 2 - 6)
                  .stroke({ width: 1.5, color: 0x3b1c0c, alpha: 1 })

                // Small cardinal ornaments make the portrait read as a carved
                // tabletop token rather than a plain circular avatar.
                const ornamentRadius = diameter / 2 - 2
                for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
                  const x = diameter / 2 + Math.cos(angle) * ornamentRadius
                  const y = diameter / 2 + Math.sin(angle) * ornamentRadius
                  ring
                    .circle(x, y, Math.max(2.2, diameter * 0.038))
                    .fill({ color: 0xf1cf78, alpha: 0.95 })
                    .circle(x, y, Math.max(1, diameter * 0.018))
                    .fill({ color: 0x4b2410, alpha: 1 })
                }

                const arcaneColors =
                  [...new Set(
                    arcaneGeometries
                      .filter(({ geometry }) =>
                        tokenIntersectsArcaneReach(
                          geometry,
                          token,
                        ),
                      )
                      .map(({ sigil }) =>
                        /^#[0-9a-f]{6}$/i.test(sigil.color)
                          ? sigil.color.toUpperCase()
                          : '#78B8C8',
                      ),
                  )]

                const arcaneRings =
                  arcaneColors.map(
                    (color, index) => {
                      const arcaneRing =
                        new Graphics()

                      arcaneRing
                        .circle(
                          diameter / 2,
                          diameter / 2,
                          diameter / 2 +
                            6 +
                            index * 4,
                        )
                        .stroke({
                          width: 2.5,
                          color:
                            tokenColorNumber(
                              color,
                            ),
                          alpha: 0.96,
                        })

                      arcaneRing.eventMode =
                        'none'

                      return arcaneRing
                    },
                  )

                const tokenChildren = [shadow, portrait, mask, ring, ...arcaneRings]

                if (targetingActive) {
                  const legal = validTargetActorIds.includes(token.actorId)
                  const legalityRing = new Graphics()
                  legalityRing
                    .circle(diameter / 2, diameter / 2, diameter / 2 + 14)
                    .stroke({
                      width: legal ? 2.5 : 1.5,
                      color: legal ? 0x72bf79 : 0x7d6b61,
                      alpha: legal ? 0.9 : 0.38,
                    })
                  tokenChildren.push(legalityRing)
                  if (!legal && !token.targetedByMe) holder.alpha = 0.7
                }

                if (token.targetedByControllerIds.length > 0) {
                  const targetMark = new Graphics()
                  const targetColor = token.targetedByMe ? 0xf1c15f : 0xd35a47
                  targetMark
                    .circle(diameter / 2, diameter / 2, diameter / 2 + 8)
                    .stroke({
                      width: token.targetedByMe ? 4 : 2.5,
                      color: targetColor,
                      alpha: token.targetedByMe ? 1 : 0.82,
                    })

                  const notch = Math.max(5, diameter * 0.11)
                  const outer = diameter / 2 + 12
                  for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
                    const cx = diameter / 2 + Math.cos(angle) * outer
                    const cy = diameter / 2 + Math.sin(angle) * outer
                    const tx = -Math.sin(angle) * notch
                    const ty = Math.cos(angle) * notch
                    targetMark
                      .moveTo(cx - tx, cy - ty)
                      .lineTo(cx + tx, cy + ty)
                      .stroke({ width: 2.5, color: targetColor, alpha: 0.95 })
                  }

                  tokenChildren.push(targetMark)
                }

                const publicStatusCount =
                  token.conditions.length +
                  token.effects.filter((effect) => effect.kind !== 'condition').length +
                  (token.tempHp > 0 ? 1 : 0)

                if (publicStatusCount > 0) {
                  const statusMarks = new Graphics()
                  const markCount = Math.min(5, publicStatusCount)
                  const markRadius = Math.max(2.8, diameter * 0.045)
                  const totalWidth = markCount * markRadius * 2 + (markCount - 1) * 3
                  let markX = (diameter - totalWidth) / 2 + markRadius
                  const markY = diameter + markRadius + 5

                  for (let index = 0; index < markCount; index += 1) {
                    statusMarks
                      .circle(markX, markY, markRadius + 1.5)
                      .fill({ color: 0x160b06, alpha: 0.98 })
                      .circle(markX, markY, markRadius)
                      .fill({
                        color: token.tempHp > 0 && index === 0 ? 0x7da8c9 : 0xb9823e,
                        alpha: 1,
                      })
                    markX += markRadius * 2 + 3
                  }

                  tokenChildren.push(statusMarks)
                }

                if (showHealthBars) {
                  const barWidth = Math.max(34, diameter - 6)
                  const barHeight = Math.max(4, Math.min(7, diameter * 0.08))
                  const barX = (diameter - barWidth) / 2
                  const barY = -barHeight - 7
                  const hpPercent = token.maxHp > 0
                    ? Math.max(0, Math.min(1, token.currentHp / token.maxHp))
                    : 0

                  const healthBar = new Graphics()
                  healthBar
                    .roundRect(barX - 1, barY - 1, barWidth + 2, barHeight + 2, 2)
                    .fill({ color: 0x120a06, alpha: 0.94 })
                    .roundRect(barX, barY, barWidth, barHeight, 2)
                    .fill({ color: 0x2a1611, alpha: 0.96 })

                  if (hpPercent > 0) {
                    healthBar
                      .roundRect(barX, barY, Math.max(1, barWidth * hpPercent), barHeight, 2)
                      .fill({ color: 0xb64b3b, alpha: 0.98 })
                  } else if (token.lifeState !== 'conscious') {
                    const stateColor = token.lifeState === 'dead'
                      ? 0x5f5b57
                      : token.lifeState === 'stable'
                        ? 0x9a7b38
                        : 0xb45d32
                    healthBar
                      .roundRect(barX, barY, barWidth, barHeight, 2)
                      .fill({ color: stateColor, alpha: 0.96 })
                  }

                  if (token.tempHp > 0) {
                    const tempWidth = Math.min(
                      barWidth,
                      barWidth * Math.max(0.08, token.tempHp / Math.max(1, token.maxHp)),
                    )
                    healthBar
                      .roundRect(barX, barY - 3, tempWidth, 2, 1)
                      .fill({ color: 0x7da8c9, alpha: 0.98 })
                  }

                  tokenChildren.push(healthBar)
                }

                if (token.actorId === activeTurnActorId && activeTurnEconomy) {
                  const hud = new Container()
                  hud.zIndex = 100
                  hud.position.set(diameter + 10, -8)

                  const makePill = (
                    text: string,
                    y: number,
                    tone: 'ready' | 'spent' | 'info' = 'info',
                    command?: 'attack' | 'dash' | 'disengage' | 'dodge' | 'stand-up' | 'utility' | 'ready' | 'end-turn',
                  ) => {
                    const pill = new Container()
                    pill.position.set(0, y)
                    const width = Math.max(86, text.length * 6.3 + 18)
                    const bg = new Graphics()
                    const fill = tone === 'ready' ? 0x2f442c : tone === 'spent' ? 0x4b2823 : 0x2a2119
                    const border = tone === 'ready' ? 0x8dc176 : tone === 'spent' ? 0xb56858 : 0xc9954b
                    bg.roundRect(0, 0, width, 22, 6)
                      .fill({ color: fill, alpha: 0.95 })
                      .stroke({ width: 1.25, color: border, alpha: 0.95 })
                    const label = new Text({
                      text,
                      style: {
                        fontFamily: 'Georgia, serif',
                        fontSize: 10.5,
                        fontWeight: '600',
                        fill: 0xf4e4c2,
                      },
                    })
                    label.position.set(8, 4)
                    pill.addChild(bg, label)
                    if (command && turnHudInteractive) {
                      pill.eventMode = 'static'
                      pill.cursor = 'pointer'
                      pill.on('pointertap', (event) => {
                        event.stopPropagation()
                        tokenInteractionRef.current.onTurnCommand?.(command)
                      })
                    } else {
                      pill.eventMode = 'none'
                    }
                    hud.addChild(pill)
                  }

                  const actionRemaining = Math.max(0, activeTurnEconomy.actionMax - activeTurnEconomy.actionUsed)
                  const bonusRemaining = Math.max(0, activeTurnEconomy.bonusActionMax - activeTurnEconomy.bonusActionUsed)
                  const reactionRemaining = Math.max(0, activeTurnEconomy.reactionMax - activeTurnEconomy.reactionUsed)
                  makePill(`ACTION ${actionRemaining}/${activeTurnEconomy.actionMax}`, 0, actionRemaining > 0 ? 'ready' : 'spent')
                  makePill(`MOVE ${Math.max(0, Math.round(activeTurnMovementRemainingFeet ?? 0))} ft`, 25, 'info')
                  makePill(`BONUS ${bonusRemaining}/${activeTurnEconomy.bonusActionMax}`, 50, bonusRemaining > 0 ? 'ready' : 'spent')
                  makePill(`REACTION ${reactionRemaining}/${activeTurnEconomy.reactionMax}`, 75, reactionRemaining > 0 ? 'ready' : 'spent')
                  if (activeTurnEconomy.attackLimit > 1 || activeTurnEconomy.attacksUsed > 0) {
                    makePill(`ATTACKS ${activeTurnEconomy.attacksUsed}/${activeTurnEconomy.attackLimit}`, 100, 'info')
                  }

                  if (turnHudInteractive) {
                    const quick = new Container()
                    quick.position.set(0, activeTurnEconomy.attackLimit > 1 || activeTurnEconomy.attacksUsed > 0 ? 128 : 103)
                    const buttons: Array<[string, 'attack' | 'dash' | 'disengage' | 'dodge' | 'stand-up' | 'utility' | 'ready' | 'end-turn']> = [
                      ['ATK', 'attack'],
                      ['DASH', 'dash'],
                      ['DISC', 'disengage'],
                      ['DODGE', 'dodge'],
                      ['UTIL', 'utility'],
                      ['READY', 'ready'],
                      ...(token.conditions.some((condition) => condition.toLowerCase() === 'prone')
                        ? [['STAND', 'stand-up'] as [string, 'stand-up']]
                        : []),
                      ['END', 'end-turn'],
                    ]
                    let x = 0
                    for (const [text, command] of buttons) {
                      const button = new Container()
                      button.position.set(x, 0)
                      const width = Math.max(34, text.length * 6 + 14)
                      const bg = new Graphics()
                      bg.roundRect(0, 0, width, 20, 5)
                        .fill({ color: command === 'end-turn' ? 0x542c25 : 0x2b241b, alpha: 0.96 })
                        .stroke({ width: 1, color: command === 'end-turn' ? 0xd07a68 : 0xb99355, alpha: 0.9 })
                      const label = new Text({
                        text,
                        style: { fontFamily: 'Georgia, serif', fontSize: 9, fontWeight: '700', fill: 0xf5e7c9 },
                      })
                      label.position.set(6, 4)
                      button.addChild(bg, label)
                      button.eventMode = 'static'
                      button.cursor = 'pointer'
                      button.on('pointertap', (event) => {
                        event.stopPropagation()
                        tokenInteractionRef.current.onTurnCommand?.(command)
                      })
                      quick.addChild(button)
                      x += width + 4
                    }
                    hud.addChild(quick)
                  }

                  holder.addChild(hud)
                }

                holder.addChild(...tokenChildren)
                layer.addChild(holder)
              } catch {
                // A missing portrait must not prevent the map from rendering.
              }
            }
          }

          renderTokens()

          return () => {
            cancelled = true
          }
        },
        [
          ready,
          activeMap?.id,
          tokenRenderSignature,
          grid.cellSize,
          grid.offsetX,
          grid.offsetY,
          movableTokenIdsSignature,
          validTargetActorIdsSignature,
          arcaneReachActive,
          arcaneReachDraft?.mode,
          arcaneReachDraft?.start.gridX,
          arcaneReachDraft?.start.gridY,
          arcaneReachDraft?.end.gridX,
          arcaneReachDraft?.end.gridY,
          arcaneReachControllerId,
          arcaneReachColor,
          arcaneReachSigilsSignature,
          targetingActive,
          activeTurnActorId,
          activeTurnEconomySignature,
          activeTurnMovementRemainingFeet,
          turnHudInteractive,
          targetArea?.gridX,
          targetArea?.gridY,
          targetArea?.radiusFeet,
          showHealthBars,
        ],
      )

      useEffect(
        () => {
          const graphics =
            gridGraphicsRef.current

          const size =
            mapSizeRef.current

          if (
            !graphics ||
            size.width <= 0 ||
            size.height <= 0
          ) {
            return
          }

          graphics.clear()

          if (
            !grid.enabled
          ) {
            return
          }

          const cellSize =
            Math.max(
              10,
              grid.cellSize,
            )

          const startX =
            normalizeOffset(
              grid.offsetX,
              cellSize,
            )

          const startY =
            normalizeOffset(
              grid.offsetY,
              cellSize,
            )

          let lineCount =
            0

          const maximumLines =
            5000

          for (
            let x =
              startX;
            x <=
              size.width &&
            lineCount <
              maximumLines;
            x +=
              cellSize
          ) {
            graphics
              .moveTo(
                x,
                0,
              )
              .lineTo(
                x,
                size.height,
              )

            lineCount +=
              1
          }

          for (
            let y =
              startY;
            y <=
              size.height &&
            lineCount <
              maximumLines;
            y +=
              cellSize
          ) {
            graphics
              .moveTo(
                0,
                y,
              )
              .lineTo(
                size.width,
                y,
              )

            lineCount +=
              1
          }

          graphics.stroke({
            width:
              1.25,

            color:
              0xe5d7ad,

            alpha:
              grid.opacity,
          })
        },
        [
          ready,
          activeMap?.id,
          grid.enabled,
          grid.cellSize,
          grid.offsetX,
          grid.offsetY,
          grid.opacity,
        ],
      )

      useEffect(
        () => {
          if (!ready) {
            return
          }

          const app =
            appRef.current

          if (!app) {
            return
          }

          const canvas =
            app.canvas

          const gridPointFromClient =
            (clientX: number, clientY: number) => {
              const rect = canvas.getBoundingClientRect()
              const camera = cameraRef.current
              const screenX = clientX - rect.left
              const screenY = clientY - rect.top
              const worldX = (screenX - camera.x) / camera.zoom
              const worldY = (screenY - camera.y) / camera.zoom
              const cellSize = Math.max(10, grid.cellSize)

              return clampGridPointToMap(
                {
                  gridX:
                    Math.floor(
                      (
                        worldX -
                        grid.offsetX
                      ) /
                      cellSize,
                    ),

                  gridY:
                    Math.floor(
                      (
                        worldY -
                        grid.offsetY
                      ) /
                      cellSize,
                    ),
                },
                mapSizeRef.current,
                grid,
                1,
              )
            }

          const onDragOver =
            (event: DragEvent) => {
              if (!activeMap || !onAssetDrop) return

              const assetId = event.dataTransfer?.types.includes('application/x-dnd-vtt-token')
              if (!assetId) return

              event.preventDefault()
              if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
              hostRef.current?.classList.add('is-token-drop-target')
            }

          const onDragLeave =
            (event: DragEvent) => {
              if (event.relatedTarget && hostRef.current?.contains(event.relatedTarget as Node)) {
                return
              }
              hostRef.current?.classList.remove('is-token-drop-target')
            }

          const onDrop =
            (event: DragEvent) => {
              hostRef.current?.classList.remove('is-token-drop-target')
              if (!activeMap || !onAssetDrop) return

              const assetId = event.dataTransfer?.getData('application/x-dnd-vtt-token') ?? ''
              if (!assetId) return

              event.preventDefault()
              const point = gridPointFromClient(event.clientX, event.clientY)
              onAssetDrop(assetId, point.gridX, point.gridY)
            }

          const onPlacementClick =
            (event: MouseEvent) => {
              if (!activeMap) return
              if (arcaneReachActive) return
              const point = gridPointFromClient(event.clientX, event.clientY)

              if (targetAreaEnabled && onTargetAreaAtGrid) {
                onTargetAreaAtGrid(point.gridX, point.gridY)
                return
              }

              if (!placementEnabled || !onPlaceAtGrid) return
              onPlaceAtGrid(point.gridX, point.gridY)
            }

          const onWheel =
            (
              event:
                WheelEvent,
            ) => {
              if (!activeMap) {
                return
              }

              event.preventDefault()

              const rect =
                canvas.getBoundingClientRect()

              const point = {
                x:
                  event.clientX -
                  rect.left,

                y:
                  event.clientY -
                  rect.top,
              }

              const current =
                cameraRef.current

              const factor =
                Math.exp(
                  -event.deltaY *
                    0.0009,
                )

              cameraModeRef.current =
                'manual'

              applyCamera(
                zoomCameraAtPoint(
                  current,
                  point,
                  clampZoom(
                    current.zoom *
                      factor,
                  ),
                ),
              )
            }

          const onPointerDown =
            (
              event:
                PointerEvent,
            ) => {
              if (event.pointerType === 'touch') {
                touchPointsRef.current.set(event.pointerId, {
                  x: event.clientX,
                  y: event.clientY,
                })
                canvas.setPointerCapture(event.pointerId)

                const touches = [...touchPointsRef.current.values()]
                if (touches.length >= 2) {
                  const [first, second] = touches
                  pinchRef.current = {
                    distance: Math.hypot(second.x - first.x, second.y - first.y),
                    centerX: (first.x + second.x) / 2,
                    centerY: (first.y + second.y) / 2,
                  }
                  pointerRef.current.active = false
                  event.preventDefault()
                  return
                }
              }

              if (
                arcaneReachActive &&
                activeMap &&
                event.button === 0
              ) {
                event.preventDefault()

                const point =
                  gridPointFromClient(
                    event.clientX,
                    event.clientY,
                  )

                arcaneReachDragRef.current = {
                  pointerId:
                    event.pointerId,
                  start:
                    point,
                  mode:
                    arcaneReachMode,
                }

                setArcaneReachDraft({
                  mode:
                    arcaneReachMode,
                  start:
                    point,
                  end:
                    point,
                })

                canvas.setPointerCapture(
                  event.pointerId,
                )

                return
              }

              const shouldPan =
                (
                  panEnabledRef.current &&
                  event.button === 0
                ) ||
                event.button === 1

              if (
                !activeMap ||
                !shouldPan
              ) {
                return
              }

              event.preventDefault()

              pointerRef.current = {
                active:
                  true,

                pointerId:
                  event.pointerId,

                lastX:
                  event.clientX,

                lastY:
                  event.clientY,
              }

              canvas.setPointerCapture(
                event.pointerId,
              )

              canvas.classList.add(
                'is-dragging',
              )
            }

          const onPointerMove =
            (
              event:
                PointerEvent,
            ) => {
              if (event.pointerType === 'touch' && touchPointsRef.current.has(event.pointerId)) {
                touchPointsRef.current.set(event.pointerId, {
                  x: event.clientX,
                  y: event.clientY,
                })
                const touches = [...touchPointsRef.current.values()]

                if (touches.length >= 2) {
                  event.preventDefault()
                  const [first, second] = touches
                  const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y))
                  const centerX = (first.x + second.x) / 2
                  const centerY = (first.y + second.y) / 2
                  const previous = pinchRef.current

                  if (previous) {
                    cameraModeRef.current =
                      'manual'

                    const rect = canvas.getBoundingClientRect()
                    const zoomed = zoomCameraAtPoint(
                      cameraRef.current,
                      { x: centerX - rect.left, y: centerY - rect.top },
                      clampZoom(cameraRef.current.zoom * (distance / Math.max(1, previous.distance))),
                    )
                    applyCamera(panCamera(
                      zoomed,
                      centerX - previous.centerX,
                      centerY - previous.centerY,
                    ))
                  }

                  pinchRef.current = { distance, centerX, centerY }
                  return
                }
              }

              const arcaneDrag =
                arcaneReachDragRef.current

              if (
                arcaneReachActive &&
                arcaneDrag.pointerId ===
                  event.pointerId &&
                arcaneDrag.start
              ) {
                event.preventDefault()

                const end =
                  gridPointFromClient(
                    event.clientX,
                    event.clientY,
                  )

                setArcaneReachDraft({
                  mode:
                    arcaneDrag.mode ?? arcaneReachMode,
                  start:
                    arcaneDrag.start,
                  end,
                })

                return
              }

              const pointer =
                pointerRef.current

              if (
                !pointer.active ||
                pointer.pointerId !==
                  event.pointerId
              ) {
                return
              }

              const deltaX =
                event.clientX -
                pointer.lastX

              const deltaY =
                event.clientY -
                pointer.lastY

              pointer.lastX =
                event.clientX

              pointer.lastY =
                event.clientY

              cameraModeRef.current =
                'manual'

              applyCamera(
                panCamera(
                  cameraRef.current,
                  deltaX,
                  deltaY,
                ),
              )
            }

          const endPointer =
            (
              event:
                PointerEvent,
            ) => {
              const arcaneDrag =
                arcaneReachDragRef.current

              if (
                arcaneReachActive &&
                arcaneDrag.pointerId ===
                  event.pointerId &&
                arcaneDrag.start
              ) {
                const end =
                  gridPointFromClient(
                    event.clientX,
                    event.clientY,
                  )

                const placement: ArcaneReachPlacement = {
                  mode:
                    arcaneDrag.mode ?? arcaneReachMode,
                  start:
                    arcaneDrag.start,
                  end,
                }

                setArcaneReachDraft(
                  placement,
                )

                arcaneReachCommitRef.current?.(
                  placement,
                )

                arcaneReachDragRef.current = {
                  pointerId: null,
                  start: null,
                  mode: null,
                }

                if (
                  event.pointerType ===
                  'touch'
                ) {
                  touchPointsRef.current.delete(
                    event.pointerId,
                  )
                  pinchRef.current =
                    null
                }

                if (
                  canvas.hasPointerCapture(
                    event.pointerId,
                  )
                ) {
                  canvas.releasePointerCapture(
                    event.pointerId,
                  )
                }

                return
              }

              if (event.pointerType === 'touch') {
                touchPointsRef.current.delete(event.pointerId)
                pinchRef.current = null

                const remaining = [...touchPointsRef.current.entries()][0]
                if (remaining && panEnabledRef.current) {
                  pointerRef.current = {
                    active: true,
                    pointerId: remaining[0],
                    lastX: remaining[1].x,
                    lastY: remaining[1].y,
                  }
                }
              }

              const pointer =
                pointerRef.current

              if (
                pointer.pointerId !==
                  event.pointerId
              ) {
                return
              }

              pointer.active =
                false

              pointer.pointerId =
                null

              canvas.classList.remove(
                'is-dragging',
              )

              if (
                canvas.hasPointerCapture(
                  event.pointerId,
                )
              ) {
                canvas.releasePointerCapture(
                  event.pointerId,
                )
              }
            }

          const onDoubleClick =
            () => {
              fitMap()
            }

          canvas.addEventListener('dragover', onDragOver)
          canvas.addEventListener('dragleave', onDragLeave)
          canvas.addEventListener('drop', onDrop)
          canvas.addEventListener('click', onPlacementClick)

          canvas.addEventListener(
            'wheel',
            onWheel,
            {
              passive:
                false,
            },
          )

          canvas.addEventListener(
            'pointerdown',
            onPointerDown,
          )

          canvas.addEventListener(
            'pointermove',
            onPointerMove,
          )

          canvas.addEventListener(
            'pointerup',
            endPointer,
          )

          canvas.addEventListener(
            'pointercancel',
            endPointer,
          )

          canvas.addEventListener(
            'dblclick',
            onDoubleClick,
          )

          return () => {
            hostRef.current?.classList.remove('is-token-drop-target')
            canvas.removeEventListener('dragover', onDragOver)
            canvas.removeEventListener('dragleave', onDragLeave)
            canvas.removeEventListener('drop', onDrop)
            canvas.removeEventListener('click', onPlacementClick)

            canvas.removeEventListener(
              'wheel',
              onWheel,
            )

            canvas.removeEventListener(
              'pointerdown',
              onPointerDown,
            )

            canvas.removeEventListener(
              'pointermove',
              onPointerMove,
            )

            canvas.removeEventListener(
              'pointerup',
              endPointer,
            )

            canvas.removeEventListener(
              'pointercancel',
              endPointer,
            )

            canvas.removeEventListener(
              'dblclick',
              onDoubleClick,
            )
          }
        },
        [
          ready,
          activeMap?.id,
          panEnabled,
          placementEnabled,
          arcaneReachActive,
          arcaneReachMode,
          grid.cellSize,
          grid.offsetX,
          grid.offsetY,
          onAssetDrop,
          onPlaceAtGrid,
          targetAreaEnabled,
          onTargetAreaAtGrid,
        ],
      )

      useEffect(
        () => {
          const host =
            hostRef.current

          if (
            !host ||
            !ready
          ) {
            return
          }

          let previousWidth =
            host.clientWidth

          let previousHeight =
            host.clientHeight

          const observer =
            new ResizeObserver(
              () => {
                const nextWidth =
                  host.clientWidth

                const nextHeight =
                  host.clientHeight

                if (
                  nextWidth <= 0 ||
                  nextHeight <= 0
                ) {
                  return
                }

                appRef.current?.renderer.resize(
                  nextWidth,
                  nextHeight,
                )

                const worldSize =
                  mapSizeRef.current

                if (
                  cameraModeRef.current === 'fit' &&
                  worldSize.width > 0 &&
                  worldSize.height > 0
                ) {
                  previousWidth =
                    nextWidth

                  previousHeight =
                    nextHeight

                  applyCamera(
                    fitCamera(
                      {
                        width: nextWidth,
                        height: nextHeight,
                      },
                      worldSize,
                      nextWidth <= 760 ? 6 : 18,
                    ),
                  )

                  return
                }

                if (
                  previousWidth <= 0 ||
                  previousHeight <= 0
                ) {
                  previousWidth =
                    nextWidth

                  previousHeight =
                    nextHeight

                  return
                }

                const camera =
                  cameraRef.current

                const worldCenterX =
                  (
                    previousWidth /
                      2 -
                    camera.x
                  ) /
                  camera.zoom

                const worldCenterY =
                  (
                    previousHeight /
                      2 -
                    camera.y
                  ) /
                  camera.zoom

                previousWidth =
                  nextWidth

                previousHeight =
                  nextHeight

                applyCamera({
                  x:
                    nextWidth /
                      2 -
                    worldCenterX *
                      camera.zoom,

                  y:
                    nextHeight /
                      2 -
                    worldCenterY *
                      camera.zoom,

                  zoom:
                    camera.zoom,
                })
              },
            )

          observer.observe(
            host,
          )

          return () => {
            observer.disconnect()
          }
        },
        [
          ready,
        ],
      )

      return (
        <div
          ref={
            hostRef
          }
          className={[
            'pixi-map-host',
            panEnabled
              ? 'is-pan-mode'
              : '',
            placementEnabled
              ? 'is-token-placement-mode'
              : '',
            arcaneReachActive
              ? 'is-arcane-reach-mode'
              : '',
            activeMap
              ? 'has-map'
              : 'is-empty',
          ].join(' ')}
        >
          {!activeMap
            ? (
              <div className="pixi-empty-map">
                <div className="pixi-empty-map-mark">
                  ◇
                </div>

                <strong>
                  No map revealed
                </strong>

                <span>
                  The active battle map will appear here.
                </span>
              </div>
            )
            : null}

          {loadError
            ? (
              <div className="pixi-map-error">
                <strong>
                  Map failed to render
                </strong>

                <span>
                  {loadError}
                </span>

                <code>
                  {activeMap?.url}
                </code>
              </div>
            )
            : null}

          {mapLoading
            ? (
              <div className="pixi-map-loading" role="status" aria-live="polite">
                <span className="pixi-map-loading-spinner" aria-hidden="true" />
                <strong>Preparing scene</strong>
                <span>{activeMap?.displayName ?? 'Loading map…'}</span>
                <small>The current map stays visible until the new one is ready.</small>
              </div>
            )
            : null}

          {activeMap && diceRoll && diceTheme
            ? (
              <Suspense fallback={null}>
                <DiceRollStage
                  roll={diceRoll}
                  theme={diceTheme}
                  onComplete={onDiceRollComplete ?? (() => undefined)}
                />
              </Suspense>
            )
            : null}

          {selectedDoor
            ? (
              <section
                className={[
                  'pixi-door-control',
                  `is-${selectedDoor.state}`,
                ].join(' ')}
                aria-label="Door controls"
              >
                <header>
                  <span>
                    <small>
                      {doorInteractionRole === 'dm'
                        ? 'DM DOOR CONTROL'
                        : 'DOOR INTERACTION'}
                    </small>
                    <strong>
                      {selectedDoor.state === 'open'
                        ? 'Open Door'
                        : selectedDoor.state === 'locked'
                          ? 'Locked Door'
                          : 'Closed Door'}
                    </strong>
                    {typeof selectedDoor.distanceFeet === 'number'
                      ? (
                        <em>
                          {selectedDoor.distanceFeet.toFixed(1)} ft away
                        </em>
                      )
                      : null}
                  </span>

                  <button
                    type="button"
                    className="pixi-door-close-panel"
                    aria-label="Close Door controls"
                    onClick={() => setSelectedDoorId(null)}
                  >
                    ×
                  </button>
                </header>

                {doorInteractionRole === 'dm'
                  ? (
                    <div className="pixi-door-actions">
                      <button
                        type="button"
                        className={selectedDoor.state === 'open' ? 'is-active' : ''}
                        onClick={() => onDoorSetState?.(selectedDoor.id, 'open')}
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        className={selectedDoor.state === 'closed' ? 'is-active' : ''}
                        onClick={() => onDoorSetState?.(selectedDoor.id, 'closed')}
                      >
                        Close
                      </button>
                      <button
                        type="button"
                        className={selectedDoor.state === 'locked' ? 'is-active is-danger' : 'is-danger'}
                        onClick={() => onDoorSetState?.(selectedDoor.id, 'locked')}
                      >
                        Lock
                      </button>
                    </div>
                  )
                  : selectedDoor.state === 'locked'
                    ? (
                      <div className="pixi-door-locked-note">
                        Locked — the DM must unlock it.
                      </div>
                    )
                    : (
                      <div className="pixi-door-actions is-player">
                        <button
                          type="button"
                          onClick={() =>
                            onDoorSetState?.(
                              selectedDoor.id,
                              selectedDoor.state === 'open'
                                ? 'closed'
                                : 'open',
                            )}
                        >
                          {selectedDoor.state === 'open'
                            ? 'Close Door'
                            : 'Open Door'}
                        </button>
                      </div>
                    )}
              </section>
            )
            : null}

        </div>
      )
    },
  )
