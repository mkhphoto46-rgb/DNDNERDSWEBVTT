import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import {
  Check,
  DoorOpen,
  Eye,
  Hand,
  Lock,
  Maximize2,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  Save,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'

import './VisionEditor.css'

import {
  channelsForVisionBarrier,
  createVisionId,
  effectiveVisionChannels,
} from '../lib/visionGeometry'

import {
  normalizeMapVisionSettings,
  type MapAsset,
  type MapVisionSettings,
  type VisionBarrier,
  type VisionBarrierChannels,
  type VisionDoorState,
  type VisionPoint,
} from '../types/scene'

type VisionEditorTool =
  | 'select'
  | 'pan'
  | 'wall'
  | 'door'

interface VisionEditorProps {
  map: MapAsset
  displayName: string
  initialSettings: MapVisionSettings
  onSave: (
    settings: MapVisionSettings,
  ) => Promise<void>
  onClose: () => void
}

const SNAP_DISTANCE_PX = 12
const MIN_SEGMENT_PX = 5
const MIN_ZOOM = 0.5
const MAX_ZOOM = 4
const ZOOM_STEP = 0.25

function clampEditorZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value))
}

function cloneBarriers(
  barriers: VisionBarrier[],
): VisionBarrier[] {
  return barriers.map(
    (barrier) => ({
      ...barrier,
      start: {
        ...barrier.start,
      },
      end: {
        ...barrier.end,
      },
      channels: {
        ...barrier.channels,
      },
    }),
  )
}

function normalizedPoint(
  event:
    ReactPointerEvent<SVGSVGElement>,
): VisionPoint {
  const rect =
    event.currentTarget.getBoundingClientRect()

  return {
    x:
      Math.max(
        0,
        Math.min(
          1,
          (event.clientX - rect.left) /
            Math.max(1, rect.width),
        ),
      ),
    y:
      Math.max(
        0,
        Math.min(
          1,
          (event.clientY - rect.top) /
            Math.max(1, rect.height),
        ),
      ),
  }
}

function pointDistancePixels(
  left: VisionPoint,
  right: VisionPoint,
  rect: DOMRect,
): number {
  return Math.hypot(
    (left.x - right.x) * rect.width,
    (left.y - right.y) * rect.height,
  )
}

function nearestEndpoint(
  point: VisionPoint,
  barriers: VisionBarrier[],
  rect: DOMRect,
): VisionPoint {
  let best =
    point

  let bestDistance =
    SNAP_DISTANCE_PX

  for (const barrier of barriers) {
    for (
      const endpoint
      of [barrier.start, barrier.end]
    ) {
      const distance =
        pointDistancePixels(
          point,
          endpoint,
          rect,
        )

      if (distance <= bestDistance) {
        bestDistance =
          distance

        best = {
          ...endpoint,
        }
      }
    }
  }

  return best
}

function barrierLabel(
  barrier: VisionBarrier,
): string {
  if (barrier.kind === 'wall') {
    return 'Wall'
  }

  const state =
    barrier.doorState ?? 'closed'

  return `Door · ${state}`
}

function channelLabel(
  channel: keyof VisionBarrierChannels,
): string {
  switch (channel) {
    case 'blocksSight':
      return 'Sight'
    case 'blocksMovement':
      return 'Movement'
    case 'blocksLight':
      return 'Light'
    case 'blocksEffects':
      return 'Effects'
    case 'blocksProjectiles':
      return 'Projectiles'
  }
}

function doorStateLabel(
  state: VisionDoorState,
): string {
  switch (state) {
    case 'open':
      return 'Open'
    case 'locked':
      return 'Locked'
    default:
      return 'Closed'
  }
}

export function VisionEditor({
  map,
  displayName,
  initialSettings,
  onSave,
  onClose,
}: VisionEditorProps) {
  const normalizedInitial =
    useMemo(
      () =>
        normalizeMapVisionSettings(
          initialSettings,
        ),
      [
        initialSettings,
      ],
    )

  const [
    barriers,
    setBarriers,
  ] =
    useState<VisionBarrier[]>(
      () =>
        cloneBarriers(
          normalizedInitial.barriers,
        ),
    )

  const [
    enabled,
    setEnabled,
  ] =
    useState(
      normalizedInitial.enabled,
    )

  const [
    tool,
    setTool,
  ] =
    useState<VisionEditorTool>(
      'select',
    )

  const [
    selectedBarrierId,
    setSelectedBarrierId,
  ] =
    useState<string | null>(
      null,
    )

  const [
    draftStart,
    setDraftStart,
  ] =
    useState<VisionPoint | null>(
      null,
    )

  const [
    dirty,
    setDirty,
  ] =
    useState(false)

  const [
    saving,
    setSaving,
  ] =
    useState(false)

  const [
    mapPixelSize,
    setMapPixelSize,
  ] =
    useState(() => ({
      width: Math.max(0, normalizedInitial.mapWidth ?? 0),
      height: Math.max(0, normalizedInitial.mapHeight ?? 0),
    }))

  const [
    zoom,
    setZoom,
  ] =
    useState(1)

  const [
    pan,
    setPan,
  ] =
    useState({ x: 0, y: 0 })

  const previewLineRef =
    useRef<SVGLineElement | null>(null)

  const panGestureRef =
    useRef<{
      pointerId: number
      clientX: number
      clientY: number
      startX: number
      startY: number
    } | null>(null)

  const undoStackRef =
    useRef<VisionBarrier[][]>([])

  const redoStackRef =
    useRef<VisionBarrier[][]>([])

  const selectedBarrier =
    barriers.find(
      (barrier) =>
        barrier.id ===
        selectedBarrierId,
    ) ?? null

  const pushBarrierState =
    (
      next:
        VisionBarrier[],
    ) => {
      // Barrier objects are immutable. Store array snapshots by reference instead
      // of deep-cloning the complete geometry on every click. This keeps long
      // wall outlines responsive even after hundreds of segments.
      undoStackRef.current.push(
        barriers,
      )

      if (
        undoStackRef.current.length >
        100
      ) {
        undoStackRef.current.shift()
      }

      redoStackRef.current = []

      setBarriers(
        next,
      )

      setDirty(true)
    }

  const undo =
    () => {
      const previous =
        undoStackRef.current.pop()

      if (!previous) {
        return
      }

      redoStackRef.current.push(
        barriers,
      )

      setBarriers(
        previous,
      )

      setSelectedBarrierId(null)
      setDraftStart(null)
      setDirty(true)
    }

  const redo =
    () => {
      const next =
        redoStackRef.current.pop()

      if (!next) {
        return
      }

      undoStackRef.current.push(
        barriers,
      )

      setBarriers(
        next,
      )

      setSelectedBarrierId(null)
      setDraftStart(null)
      setDirty(true)
    }

  const deleteSelected =
    () => {
      if (!selectedBarrierId) {
        return
      }

      pushBarrierState(
        barriers.filter(
          (barrier) =>
            barrier.id !==
            selectedBarrierId,
        ),
      )

      setSelectedBarrierId(null)
    }

  const updateSelectedBarrier =
    (
      updater:
        (
          barrier:
            VisionBarrier,
        ) =>
          VisionBarrier,
    ) => {
      if (!selectedBarrierId) {
        return
      }

      pushBarrierState(
        barriers.map(
          (barrier) =>
            barrier.id ===
            selectedBarrierId
              ? updater(barrier)
              : barrier,
        ),
      )
    }

  const changeDoorState =
    (
      state:
        VisionDoorState,
    ) => {
      updateSelectedBarrier(
        (barrier) => ({
          ...barrier,
          doorState:
            state,
          channels:
            channelsForVisionBarrier(
              'door',
              state,
            ),
        }),
      )
    }

  const toggleWallChannel =
    (
      channel:
        keyof VisionBarrierChannels,
    ) => {
      updateSelectedBarrier(
        (barrier) => ({
          ...barrier,
          channels: {
            ...barrier.channels,
            [channel]:
              !barrier.channels[channel],
          },
        }),
      )
    }

  const chooseTool =
    (
      next:
        VisionEditorTool,
    ) => {
      setTool(next)
      setDraftStart(null)

      if (next !== 'select') {
        setSelectedBarrierId(null)
      }
    }

  const handleCanvasPointerDown =
    (
      event:
        ReactPointerEvent<SVGSVGElement>,
    ) => {
      if (
        tool === 'pan' ||
        event.button === 1
      ) {
        event.preventDefault()

        panGestureRef.current = {
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          startX: pan.x,
          startY: pan.y,
        }

        event.currentTarget.setPointerCapture(
          event.pointerId,
        )

        return
      }

      if (event.button !== 0) {
        return
      }

      const rect =
        event.currentTarget.getBoundingClientRect()

      const point =
        nearestEndpoint(
          normalizedPoint(event),
          barriers,
          rect,
        )

      if (tool === 'select') {
        setSelectedBarrierId(null)
        return
      }

      if (!draftStart) {
        setDraftStart(point)
        return
      }

      if (
        pointDistancePixels(
          draftStart,
          point,
          rect,
        ) < MIN_SEGMENT_PX
      ) {
        return
      }

      const doorState:
        VisionDoorState | undefined =
          tool === 'door'
            ? 'closed'
            : undefined

      const nextBarrier:
        VisionBarrier = {
          id:
            `vision-${createVisionId()}`,
          kind:
            tool,
          start:
            { ...draftStart },
          end:
            { ...point },
          ...(doorState
            ? { doorState }
            : {}),
          channels:
            channelsForVisionBarrier(
              tool,
              doorState,
            ),
        }

      pushBarrierState([
        ...barriers,
        nextBarrier,
      ])

      setSelectedBarrierId(
        nextBarrier.id,
      )

      // Continue the same outline. Escape, right-click or Finish Outline
      // clears this anchor so the next click can begin anywhere else.
      setDraftStart(
        point,
      )
    }

  const handleCanvasPointerMove =
    (
      event:
        ReactPointerEvent<SVGSVGElement>,
    ) => {
      const panGesture =
        panGestureRef.current

      if (
        panGesture &&
        panGesture.pointerId === event.pointerId
      ) {
        event.preventDefault()

        setPan({
          x:
            panGesture.startX +
            (event.clientX - panGesture.clientX),
          y:
            panGesture.startY +
            (event.clientY - panGesture.clientY),
        })

        return
      }

      if (!draftStart) {
        return
      }

      const rect =
        event.currentTarget.getBoundingClientRect()

      const point =
        nearestEndpoint(
          normalizedPoint(event),
          barriers,
          rect,
        )

      // Do not put the live pointer preview in React state. Updating one SVG
      // line directly avoids re-rendering every saved barrier on every mouse
      // movement, which was the main source of editor slowdown.
      if (previewLineRef.current) {
        previewLineRef.current.setAttribute(
          'x2',
          String(point.x),
        )
        previewLineRef.current.setAttribute(
          'y2',
          String(point.y),
        )
      }
    }

  const handleCanvasPointerUp =
    (
      event:
        ReactPointerEvent<SVGSVGElement>,
    ) => {
      const panGesture =
        panGestureRef.current

      if (
        !panGesture ||
        panGesture.pointerId !== event.pointerId
      ) {
        return
      }

      panGestureRef.current = null

      if (
        event.currentTarget.hasPointerCapture(
          event.pointerId,
        )
      ) {
        event.currentTarget.releasePointerCapture(
          event.pointerId,
        )
      }
    }

  const cancelDraft =
    () => {
      setDraftStart(null)

      if (previewLineRef.current) {
        previewLineRef.current.setAttribute(
          'x2',
          '0',
        )
        previewLineRef.current.setAttribute(
          'y2',
          '0',
        )
      }
    }

  const changeZoom =
    (
      nextZoom: number,
    ) => {
      setZoom(
        clampEditorZoom(nextZoom),
      )
    }

  const fitView =
    () => {
      setZoom(1)
      setPan({ x: 0, y: 0 })
    }

  const handleClose =
    () => {
      if (
        dirty &&
        !window.confirm(
          'Close Vision Editor without saving the latest geometry changes?',
        )
      ) {
        return
      }

      onClose()
    }

  const save =
    async () => {
      if (saving) {
        return
      }

      setSaving(true)

      try {
        await onSave({
          runtimeVersion: 2,
          enabled,
          barriers:
            cloneBarriers(
              barriers,
            ),
          mapWidth: mapPixelSize.width,
          mapHeight: mapPixelSize.height,
          updatedAt:
            new Date().toISOString(),
        })

        setDirty(false)
      } finally {
        setSaving(false)
      }
    }

  useEffect(
    () => {
      const onKeyDown =
        (
          event:
            KeyboardEvent,
        ) => {
          const element =
            event.target as
              | HTMLElement
              | null

          if (
            element?.tagName === 'INPUT' ||
            element?.tagName === 'TEXTAREA' ||
            element?.tagName === 'SELECT'
          ) {
            return
          }

          if (
            (
              event.ctrlKey ||
              event.metaKey
            ) &&
            event.key.toLowerCase() === 'z'
          ) {
            event.preventDefault()

            if (event.shiftKey) {
              redo()
            } else {
              undo()
            }

            return
          }

          if (
            (
              event.ctrlKey ||
              event.metaKey
            ) &&
            event.key.toLowerCase() === 'y'
          ) {
            event.preventDefault()
            redo()
            return
          }

          if (
            event.key === 'Delete' ||
            event.key === 'Backspace'
          ) {
            if (selectedBarrierId) {
              event.preventDefault()
              deleteSelected()
            }

            return
          }

          if (event.key === 'Escape') {
            // In a drawing tool, Escape always finishes only the current
            // chain. It never closes the editor, so the next click can begin
            // a fresh outline anywhere on the map.
            if (tool === 'wall' || tool === 'door') {
              event.preventDefault()
              cancelDraft()
              return
            }

            if (tool === 'pan') {
              event.preventDefault()
              chooseTool('select')
              return
            }

            if (selectedBarrierId) {
              setSelectedBarrierId(null)
              return
            }

            handleClose()
          }
        }

      window.addEventListener(
        'keydown',
        onKeyDown,
      )

      return () => {
        window.removeEventListener(
          'keydown',
          onKeyDown,
        )
      }
    },
    [
      barriers,
      draftStart,
      selectedBarrierId,
      tool,
      dirty,
      saving,
    ],
  )

  const effectiveChannels =
    selectedBarrier
      ? effectiveVisionChannels(
          selectedBarrier,
        )
      : null

  const setupLabel =
    barriers.length === 0
      ? 'NOT SET UP'
      : enabled
        ? 'VISION RUNTIME ACTIVE'
        : 'SAVED · DISABLED'

  return (
    <section
      className="vision-editor-shell"
      aria-label={`Vision Editor for ${displayName}`}
    >
      <header className="vision-editor-topbar">
        <span className="vision-editor-brand">
          <Eye />
          <span>
            <small>MAP VISION</small>
            <strong>{displayName}</strong>
          </span>
        </span>

        <span
          className={[
            'vision-editor-status',
            enabled
              ? 'is-enabled'
              : '',
          ].filter(Boolean).join(' ')}
        >
          {setupLabel}
        </span>

        <span className="vision-editor-top-actions">
          <span className="vision-editor-zoom-controls" aria-label="Vision editor zoom">
            <button
              type="button"
              onClick={() => changeZoom(zoom - ZOOM_STEP)}
              disabled={zoom <= MIN_ZOOM}
              title="Zoom out"
            >
              <Minus />
            </button>
            <button
              type="button"
              className="vision-editor-fit"
              onClick={fitView}
              title="Fit map"
            >
              <Maximize2 />
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={() => changeZoom(zoom + ZOOM_STEP)}
              disabled={zoom >= MAX_ZOOM}
              title="Zoom in"
            >
              <Plus />
            </button>
          </span>

          <button
            type="button"
            onClick={undo}
            disabled={
              undoStackRef.current.length === 0
            }
            title="Undo (Ctrl+Z)"
          >
            <Undo2 />
            Undo
          </button>

          <button
            type="button"
            onClick={redo}
            disabled={
              redoStackRef.current.length === 0
            }
            title="Redo (Ctrl+Y)"
          >
            <Redo2 />
            Redo
          </button>

          <button
            type="button"
            className="vision-editor-save"
            onClick={() => void save()}
            disabled={saving}
          >
            <Save />
            {saving
              ? 'Saving…'
              : dirty
                ? 'Save Geometry'
                : 'Saved'}
          </button>

          <button
            type="button"
            className="vision-editor-close"
            onClick={handleClose}
            aria-label="Close Vision Editor"
          >
            <X />
          </button>
        </span>
      </header>

      <div className="vision-editor-layout">
        <aside className="vision-editor-sidebar">
          <section>
            <header>
              <strong>DRAW</strong>
              <small>{barriers.length} barriers</small>
            </header>

            <div className="vision-editor-tool-grid">
              <button
                type="button"
                className={tool === 'select' ? 'is-active' : ''}
                onClick={() => chooseTool('select')}
              >
                <MousePointer2 />
                <span>Select</span>
              </button>

              <button
                type="button"
                className={tool === 'pan' ? 'is-active' : ''}
                onClick={() => chooseTool('pan')}
              >
                <Hand />
                <span>Pan</span>
              </button>

              <button
                type="button"
                className={tool === 'wall' ? 'is-active' : ''}
                onClick={() => chooseTool('wall')}
              >
                <span className="vision-wall-glyph" aria-hidden="true">┃</span>
                <span>Wall</span>
              </button>

              <button
                type="button"
                className={tool === 'door' ? 'is-active' : ''}
                onClick={() => chooseTool('door')}
              >
                <DoorOpen />
                <span>Door</span>
              </button>
            </div>

            {tool === 'wall' || tool === 'door' ? (
              <>
                <p className="vision-editor-hint">
                  Click endpoints to continue an outline. Esc, right-click or Finish Outline cuts the chain; your next click starts somewhere new.
                </p>
                {draftStart ? (
                  <button
                    type="button"
                    className="vision-editor-finish-outline"
                    onClick={cancelDraft}
                  >
                    <Check />
                    Finish Outline
                  </button>
                ) : null}
              </>
            ) : tool === 'pan' ? (
              <p className="vision-editor-hint">
                Drag the map to inspect another area. Mouse wheel zooms. Esc returns to Select.
              </p>
            ) : (
              <p className="vision-editor-hint">
                Select a segment to inspect, change or delete it. Mouse wheel zooms at any time.
              </p>
            )}
          </section>

          <section className="vision-editor-runtime-switch">
            <header>
              <strong>VISION STATUS</strong>
            </header>

            <label>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => {
                  setEnabled(event.currentTarget.checked)
                  setDirty(true)
                }}
              />

              <span>
                <b>Enable Player Vision & Collision</b>
                <small>
                  Wall and closed-door geometry now drives Player LOS, Fog, movement and action collision.
                </small>
              </span>
            </label>
          </section>

          {selectedBarrier ? (
            <section className="vision-editor-selection">
              <header>
                <strong>SELECTED</strong>
                <small>{barrierLabel(selectedBarrier)}</small>
              </header>

              {selectedBarrier.kind === 'door' ? (
                <>
                  <div className="vision-door-state-grid">
                    {(
                      [
                        'open',
                        'closed',
                        'locked',
                      ] as
                        VisionDoorState[]
                    ).map(
                      (state) => (
                        <button
                          type="button"
                          key={state}
                          className={
                            selectedBarrier.doorState === state
                              ? 'is-active'
                              : ''
                          }
                          onClick={() => changeDoorState(state)}
                        >
                          {state === 'locked'
                            ? <Lock />
                            : state === 'open'
                              ? <DoorOpen />
                              : <Check />}
                          {doorStateLabel(state)}
                        </button>
                      ),
                    )}
                  </div>

                  <div className="vision-channel-readout">
                    {effectiveChannels
                      ? (
                          Object.keys(
                            effectiveChannels,
                          ) as
                            Array<
                              keyof VisionBarrierChannels
                            >
                        ).map(
                          (channel) => (
                            <span
                              key={channel}
                              className={
                                effectiveChannels[channel]
                                  ? 'is-blocked'
                                  : ''
                              }
                            >
                              {channelLabel(channel)}
                              <b>
                                {effectiveChannels[channel]
                                  ? 'BLOCK'
                                  : 'PASS'}
                              </b>
                            </span>
                          ),
                        )
                      : null}
                  </div>
                </>
              ) : (
                <div className="vision-channel-editor">
                  {(
                    Object.keys(
                      selectedBarrier.channels,
                    ) as
                      Array<
                        keyof VisionBarrierChannels
                      >
                  ).map(
                    (channel) => (
                      <label key={channel}>
                        <input
                          type="checkbox"
                          checked={
                            selectedBarrier.channels[channel]
                          }
                          onChange={() => toggleWallChannel(channel)}
                        />
                        <span>{channelLabel(channel)}</span>
                      </label>
                    ),
                  )}
                </div>
              )}

              <button
                type="button"
                className="vision-editor-delete"
                onClick={deleteSelected}
              >
                <Trash2 />
                Delete Segment
              </button>
            </section>
          ) : null}

          <section className="vision-editor-foundation">
            <strong>FOUNDATION CHANNELS</strong>
            <small>
              Sight · Movement · Light · Effects · Projectiles
            </small>
            <p>
              Geometry uses normalized map coordinates, so changing grid size or zoom will not move your walls.
            </p>
          </section>
        </aside>

        <main className="vision-editor-workspace">
          <div
            className="vision-editor-map-viewport"
            onWheel={(event) => {
              event.preventDefault()
              changeZoom(
                zoom *
                  (event.deltaY < 0 ? 1.12 : 0.89),
              )
            }}
          >
            <div
              className="vision-editor-map-wrap"
              style={{
                transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
              }}
            >
              <img
                src={map.url}
                alt={displayName}
                draggable={false}
                onLoad={(event) => {
                  const image = event.currentTarget
                  const width = image.naturalWidth
                  const height = image.naturalHeight

                  if (width > 0 && height > 0) {
                    setMapPixelSize((current) =>
                      current.width === width && current.height === height
                        ? current
                        : { width, height },
                    )
                  }
                }}
              />

              <svg
                className={[
                  'vision-editor-overlay',
                  tool === 'select'
                    ? 'is-selecting'
                    : tool === 'pan'
                      ? 'is-panning'
                      : 'is-drawing',
                ].join(' ')}
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                onPointerCancel={handleCanvasPointerUp}
                onContextMenu={(event) => {
                  event.preventDefault()
                  cancelDraft()
                }}
              >
              {barriers.map(
                (barrier) => {
                  const selected =
                    barrier.id ===
                    selectedBarrierId

                  const openDoor =
                    barrier.kind === 'door' &&
                    barrier.doorState === 'open'

                  const lockedDoor =
                    barrier.kind === 'door' &&
                    barrier.doorState === 'locked'

                  const lineClass =
                    [
                      'vision-barrier-line',
                      `is-${barrier.kind}`,
                      selected
                        ? 'is-selected'
                        : '',
                      openDoor
                        ? 'is-open'
                        : '',
                      lockedDoor
                        ? 'is-locked'
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' ')

                  const midX =
                    (
                      barrier.start.x +
                      barrier.end.x
                    ) / 2

                  const midY =
                    (
                      barrier.start.y +
                      barrier.end.y
                    ) / 2

                  return (
                    <g key={barrier.id}>
                      <line
                        className="vision-barrier-hit"
                        x1={barrier.start.x}
                        y1={barrier.start.y}
                        x2={barrier.end.x}
                        y2={barrier.end.y}
                        vectorEffect="non-scaling-stroke"
                        onPointerDown={(event) => {
                          if (tool !== 'select') {
                            return
                          }

                          event.stopPropagation()
                          setSelectedBarrierId(barrier.id)
                        }}
                      />

                      <line
                        className={lineClass}
                        x1={barrier.start.x}
                        y1={barrier.start.y}
                        x2={barrier.end.x}
                        y2={barrier.end.y}
                        vectorEffect="non-scaling-stroke"
                      />

                      {selected ? (
                        <>
                          <circle
                            className="vision-barrier-node"
                            cx={barrier.start.x}
                            cy={barrier.start.y}
                            r={0.004}
                            vectorEffect="non-scaling-stroke"
                          />

                          <circle
                            className="vision-barrier-node"
                            cx={barrier.end.x}
                            cy={barrier.end.y}
                            r={0.004}
                            vectorEffect="non-scaling-stroke"
                          />
                        </>
                      ) : null}

                      {barrier.kind === 'door' ? (
                        <>
                          <circle
                            className={lineClass}
                            cx={midX}
                            cy={midY}
                            r={0.009}
                            vectorEffect="non-scaling-stroke"
                          />
                        </>
                      ) : null}
                    </g>
                  )
                },
              )}

                {draftStart ? (
                  <line
                    ref={previewLineRef}
                    className={`vision-barrier-preview is-${tool}`}
                    x1={draftStart.x}
                    y1={draftStart.y}
                    x2={draftStart.x}
                    y2={draftStart.y}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
              </svg>
            </div>
          </div>

          <footer className="vision-editor-workspace-footer">
            <span>
              <b>Endpoint Snap:</b> {SNAP_DISTANCE_PX}px
            </span>
            <span>
              <b>Map Space:</b> normalized coordinates
            </span>
            <span>
              <b>Esc / Right Click:</b> finish current chain
            </span>
          </footer>
        </main>
      </div>
    </section>
  )
}
