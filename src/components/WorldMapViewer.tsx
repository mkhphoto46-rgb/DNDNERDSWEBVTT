import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'

import {
  centerCamera,
  fitCamera,
  panCamera,
  zoomCameraAtPoint,
  type CameraSize,
  type MapCamera,
} from '../lib/mapCamera'

import type {
  SceneMapAsset,
} from '../types/scene'

interface WorldMapLauncherProps {
  map: SceneMapAsset | null
  onOpen: () => void
  compact?: boolean
  canAssign?: boolean
  onAssignRequest?: () => void
}

export function WorldMapLauncher({
  map,
  onOpen,
  compact = false,
  canAssign = false,
  onAssignRequest,
}: WorldMapLauncherProps) {
  const canInteract = Boolean(map) || Boolean(canAssign && onAssignRequest)
  const handleClick = () => {
    if (map) {
      onOpen()
      return
    }

    if (canAssign) {
      onAssignRequest?.()
    }
  }

  return (
    <button
      type="button"
      className={compact ? 'world-map-launcher is-compact' : 'world-map-launcher'}
      onClick={handleClick}
      disabled={!canInteract}
      title={
        map
          ? 'Open World Map'
          : canAssign
            ? 'Assign a World Map'
            : 'World Map has not been assigned yet'
      }
      aria-label={
        map
          ? 'Open World Map'
          : canAssign
            ? 'Assign World Map'
            : 'World Map unavailable'
      }
    >
      {map ? (
        <img src={map.url} alt="" draggable={false} />
      ) : (
        <span className="world-map-launcher-empty" aria-hidden="true">✦</span>
      )}

      <span className="world-map-launcher-copy">
        <small>WORLD MAP</small>
        <strong>{map?.displayName ?? 'Not Assigned'}</strong>
        <em>
          {map
            ? 'Click to explore'
            : canAssign
              ? 'Click to assign a map'
              : 'Waiting for the Dungeon Master'}
        </em>
      </span>

      <span className="world-map-launcher-expand" aria-hidden="true">
        {map ? '⛶' : canAssign ? '+' : '—'}
      </span>
    </button>
  )
}

interface PointerDragState {
  pointerId: number
  x: number
  y: number
}

interface WorldMapViewerProps {
  map: SceneMapAsset | null
  open: boolean
  onClose: () => void
}

const WORLD_MAP_ZOOM_STEP = 1.2

export function WorldMapViewer({
  map,
  open,
  onClose,
}: WorldMapViewerProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<PointerDragState | null>(null)

  const [imageSize, setImageSize] = useState<CameraSize>({
    width: 0,
    height: 0,
  })
  const [camera, setCamera] = useState<MapCamera>({
    x: 0,
    y: 0,
    zoom: 1,
  })
  const [dragging, setDragging] = useState(false)
  const [loadError, setLoadError] = useState(false)

  const zoomPercent = useMemo(
    () => Math.round(camera.zoom * 100),
    [camera.zoom],
  )

  const viewportSize = (): CameraSize => {
    const rect = viewportRef.current?.getBoundingClientRect()

    return {
      width: rect?.width ?? 0,
      height: rect?.height ?? 0,
    }
  }

  const fit = () => {
    if (imageSize.width <= 0 || imageSize.height <= 0) return
    setCamera(fitCamera(viewportSize(), imageSize, 36))
  }

  const actualSize = () => {
    if (imageSize.width <= 0 || imageSize.height <= 0) return
    setCamera(centerCamera(viewportSize(), imageSize, 1))
  }

  const zoomBy = (factor: number) => {
    const viewport = viewportSize()
    if (viewport.width <= 0 || viewport.height <= 0) return

    const center = {
      x: viewport.width / 2,
      y: viewport.height / 2,
    }

    setCamera((current) =>
      zoomCameraAtPoint(
        current,
        center,
        current.zoom * factor,
      ),
    )
  }

  useEffect(() => {
    if (!open || !map) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, map, onClose])

  useEffect(() => {
    if (!open || !map) return

    const viewport = viewportRef.current
    if (!viewport || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      if (imageSize.width <= 0 || imageSize.height <= 0) return

      setCamera((current) => {
        const size = viewportSize()
        const worldCenterX = (size.width / 2 - current.x) / current.zoom
        const worldCenterY = (size.height / 2 - current.y) / current.zoom

        return {
          ...current,
          x: size.width / 2 - worldCenterX * current.zoom,
          y: size.height / 2 - worldCenterY * current.zoom,
        }
      })
    })

    observer.observe(viewport)
    return () => observer.disconnect()
  }, [open, map, imageSize.width, imageSize.height])

  useEffect(() => {
    setImageSize({ width: 0, height: 0 })
    setCamera({ x: 0, y: 0, zoom: 1 })
    setLoadError(false)
    dragRef.current = null
    setDragging(false)
  }, [map?.id])

  if (!open || !map) {
    return null
  }

  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || loadError) return

    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    }
    setDragging(true)
  }

  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    const deltaX = event.clientX - drag.x
    const deltaY = event.clientY - drag.y

    dragRef.current = {
      pointerId: drag.pointerId,
      x: event.clientX,
      y: event.clientY,
    }

    setCamera((current) => panCamera(current, deltaX, deltaY))
  }

  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    dragRef.current = null
    setDragging(false)
  }

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (loadError) return

    const rect = event.currentTarget.getBoundingClientRect()
    const screenPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
    const factor = event.deltaY < 0
      ? WORLD_MAP_ZOOM_STEP
      : 1 / WORLD_MAP_ZOOM_STEP

    setCamera((current) =>
      zoomCameraAtPoint(
        current,
        screenPoint,
        current.zoom * factor,
      ),
    )
  }

  return (
    <section
      className="world-map-modal"
      role="dialog"
      aria-modal="true"
      aria-label="World Map"
    >
      <button
        type="button"
        className="world-map-backdrop"
        aria-label="Close World Map"
        onClick={onClose}
      />

      <div className="world-map-window">
        <header className="world-map-header">
          <div>
            <span>WORLD MAP</span>
            <strong>{map.displayName}</strong>
          </div>

          <nav className="world-map-controls" aria-label="World Map camera controls">
            <button type="button" onClick={() => zoomBy(1 / WORLD_MAP_ZOOM_STEP)} aria-label="Zoom out">−</button>
            <output>{zoomPercent}%</output>
            <button type="button" onClick={() => zoomBy(WORLD_MAP_ZOOM_STEP)} aria-label="Zoom in">+</button>
            <button type="button" onClick={fit}>Fit</button>
            <button type="button" onClick={actualSize}>1:1</button>
            <button type="button" className="world-map-close" onClick={onClose} aria-label="Close World Map">×</button>
          </nav>
        </header>

        <div
          ref={viewportRef}
          className={dragging ? 'world-map-viewport is-dragging' : 'world-map-viewport'}
          onPointerDown={beginPan}
          onPointerMove={movePan}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          onWheel={handleWheel}
          onDoubleClick={fit}
        >
          {loadError ? (
            <div className="world-map-load-error" role="alert">
              <strong>World Map could not be loaded.</strong>
              <span>The assignment is still saved. Re-open the map or ask the DM to reassign the image.</span>
            </div>
          ) : null}

          <img
            className="world-map-image"
            src={map.url}
            alt={map.displayName}
            draggable={false}
            onLoad={(event) => {
              const nextSize = {
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              }

              setLoadError(false)
              setImageSize(nextSize)
              setCamera(fitCamera(viewportSize(), nextSize, 36))
            }}
            onError={() => setLoadError(true)}
            style={{
              width: imageSize.width || undefined,
              height: imageSize.height || undefined,
              transform: `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.zoom})`,
            }}
          />

          <div className="world-map-compass" aria-hidden="true">
            <b>N</b>
            <span>✥</span>
          </div>

          <div className="world-map-help">
            Drag to pan · Wheel to zoom · Double-click to fit · Esc to close
          </div>
        </div>
      </div>
    </section>
  )
}
