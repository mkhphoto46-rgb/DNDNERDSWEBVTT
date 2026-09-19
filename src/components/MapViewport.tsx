import {
  Application,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
  type FederatedPointerEvent,
} from 'pixi.js'

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'

import './MapViewport.css'

import {
  centerCamera,
  clampZoom,
  fitCamera,
  panCamera,
  type MapCamera,
  zoomCameraAtPoint,
} from '../lib/mapCamera'

import type {
  GridSettings,
  SceneMapAsset,
  SceneToken,
} from '../types/scene'

export interface MapViewportHandle {
  fitMap: () => void
  actualSize: () => void
  zoomIn: () => void
  zoomOut: () => void
}

interface MapViewportProps {
  activeMap:
    | SceneMapAsset
    | null

  grid:
    GridSettings

  tokens:
    SceneToken[]

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
        onPlaceAtGrid,
        onAssetDrop,
        panEnabled,
        onCameraChange,
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

      const mapSizeRef =
        useRef<MapSize>({
          width: 0,
          height: 0,
        })

      const cameraRef =
        useRef<MapCamera>({
          ...INITIAL_CAMERA,
        })

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

      useEffect(
        () => {
          panEnabledRef.current =
            panEnabled
        },
        [
          panEnabled,
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

          applyCamera(
            fitCamera(
              viewportSize(),
              worldSize,
              34,
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

      useImperativeHandle(
        ref,
        () => ({
          fitMap,

          actualSize,

          zoomIn: () =>
            zoomBy(
              1.2,
            ),

          zoomOut: () =>
            zoomBy(
              1 / 1.2,
            ),
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
                    '#050403',

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

            mapSpriteRef.current =
              null

            gridGraphicsRef.current =
              null

            tokenLayerRef.current =
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

              const previous =
                world.removeChildren()

              for (
                const child
                of previous
              ) {
                child.destroy()
              }

              mapSpriteRef.current =
                null

              gridGraphicsRef.current =
                null

              tokenLayerRef.current =
                null

              mapSizeRef.current = {
                width: 0,
                height: 0,
              }

              if (!activeMap) {
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

                const tokenLayer =
                  new Container()

                tokenLayer.zIndex =
                  20

                world.addChild(
                  sprite,
                )

                world.addChild(
                  gridGraphics,
                )

                world.addChild(
                  tokenLayer,
                )

                mapSpriteRef.current =
                  sprite

                gridGraphicsRef.current =
                  gridGraphics

                tokenLayerRef.current =
                  tokenLayer

                mapSizeRef.current = {
                  width:
                    loaded.width,

                  height:
                    loaded.height,
                }

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
          const layer =
            tokenLayerRef.current

          if (!layer || !activeMap) return

          let cancelled = false

          const renderTokens = async () => {
            const previous = layer.removeChildren()
            for (const child of previous) child.destroy({ children: true })

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
                const canMoveToken = movableTokenIds.includes(token.id)
                holder.eventMode = canMoveToken ? 'static' : 'none'
                holder.cursor = canMoveToken ? 'grab' : 'default'
                holder.hitArea = new Rectangle(0, 0, diameter, diameter)

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
                      onTokenPickup?.(token.id)
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

                      const snappedGridX = Math.max(
                        0,
                        Math.round((holder.x - grid.offsetX) / grid.cellSize),
                      )
                      const snappedGridY = Math.max(
                        0,
                        Math.round((holder.y - grid.offsetY) / grid.cellSize),
                      )

                      holder.position.set(
                        grid.offsetX + snappedGridX * grid.cellSize,
                        grid.offsetY + snappedGridY * grid.cellSize,
                      )

                      onTokenMove?.(token.id, snappedGridX, snappedGridY)
                      onTokenSnap?.(token.id)
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
                  .circle(diameter / 2, diameter / 2, diameter / 2 - 2)
                  .stroke({ width: 4, color: 0xd1a252, alpha: 1 })
                  .circle(diameter / 2, diameter / 2, diameter / 2 - 6)
                  .stroke({ width: 1.5, color: 0x3b1c0c, alpha: 1 })

                holder.addChild(shadow, portrait, mask, ring)
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
          tokens,
          grid.cellSize,
          grid.offsetX,
          grid.offsetY,
          movableTokenIds,
          onTokenMove,
          onTokenPickup,
          onTokenSnap,
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

              return {
                gridX: Math.max(0, Math.floor((worldX - grid.offsetX) / cellSize)),
                gridY: Math.max(0, Math.floor((worldY - grid.offsetY) / cellSize)),
              }
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
              if (!placementEnabled || !activeMap || !onPlaceAtGrid) return

              const point = gridPointFromClient(event.clientX, event.clientY)
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
                    0.0014,
                )

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
          grid.cellSize,
          grid.offsetX,
          grid.offsetY,
          onAssetDrop,
          onPlaceAtGrid,
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
        </div>
      )
    },
  )
