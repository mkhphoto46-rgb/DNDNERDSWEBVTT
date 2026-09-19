export interface MapCamera {
  x: number
  y: number
  zoom: number
}

export interface CameraPoint {
  x: number
  y: number
}

export interface CameraSize {
  width: number
  height: number
}

export const MIN_CAMERA_ZOOM = 0.05
export const MAX_CAMERA_ZOOM = 6

export function clampZoom(zoom: number): number {
  return Math.min(MAX_CAMERA_ZOOM, Math.max(MIN_CAMERA_ZOOM, zoom))
}

export function centerCamera(
  viewport: CameraSize,
  world: CameraSize,
  zoom: number,
): MapCamera {
  const safeZoom = clampZoom(zoom)

  return {
    x: (viewport.width - world.width * safeZoom) / 2,
    y: (viewport.height - world.height * safeZoom) / 2,
    zoom: safeZoom,
  }
}

export function fitCamera(
  viewport: CameraSize,
  world: CameraSize,
  padding = 28,
): MapCamera {
  if (
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    world.width <= 0 ||
    world.height <= 0
  ) {
    return { x: 0, y: 0, zoom: 1 }
  }

  const usableWidth = Math.max(1, viewport.width - padding * 2)
  const usableHeight = Math.max(1, viewport.height - padding * 2)
  const zoom = clampZoom(
    Math.min(usableWidth / world.width, usableHeight / world.height),
  )

  return centerCamera(viewport, world, zoom)
}

export function zoomCameraAtPoint(
  camera: MapCamera,
  screenPoint: CameraPoint,
  targetZoom: number,
): MapCamera {
  const nextZoom = clampZoom(targetZoom)

  if (camera.zoom <= 0) {
    return { ...camera, zoom: nextZoom }
  }

  const worldX = (screenPoint.x - camera.x) / camera.zoom
  const worldY = (screenPoint.y - camera.y) / camera.zoom

  return {
    x: screenPoint.x - worldX * nextZoom,
    y: screenPoint.y - worldY * nextZoom,
    zoom: nextZoom,
  }
}

export function panCamera(
  camera: MapCamera,
  deltaX: number,
  deltaY: number,
): MapCamera {
  return {
    ...camera,
    x: camera.x + deltaX,
    y: camera.y + deltaY,
  }
}
