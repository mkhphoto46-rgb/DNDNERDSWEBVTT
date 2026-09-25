import {
  type MapVisionSettings,
  type VisionBarrier,
  type VisionPoint,
} from '../types/scene'

import {
  barrierBlocks,
  type VisionBlockChannel,
} from './visionGeometry'

interface PixelPoint {
  x: number
  y: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function toPixel(
  point: VisionPoint,
  width: number,
  height: number,
): PixelPoint {
  return {
    x: point.x * width,
    y: point.y * height,
  }
}

function toNormalized(
  point: PixelPoint,
  width: number,
  height: number,
): VisionPoint {
  return {
    x: clamp(point.x / width, 0, 1),
    y: clamp(point.y / height, 0, 1),
  }
}

function cross(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return ax * by - ay * bx
}

function raySegmentDistance(
  origin: PixelPoint,
  direction: PixelPoint,
  a: PixelPoint,
  b: PixelPoint,
): number | null {
  const sx = b.x - a.x
  const sy = b.y - a.y
  const denominator = cross(direction.x, direction.y, sx, sy)

  if (Math.abs(denominator) < 1e-9) {
    return null
  }

  const qpx = a.x - origin.x
  const qpy = a.y - origin.y
  const t = cross(qpx, qpy, sx, sy) / denominator
  const u = cross(qpx, qpy, direction.x, direction.y) / denominator

  if (t < 0 || u < -1e-8 || u > 1 + 1e-8) {
    return null
  }

  return t
}

function mapBoundarySegments(
  width: number,
  height: number,
): Array<[PixelPoint, PixelPoint]> {
  const topLeft = { x: 0, y: 0 }
  const topRight = { x: width, y: 0 }
  const bottomRight = { x: width, y: height }
  const bottomLeft = { x: 0, y: height }

  return [
    [topLeft, topRight],
    [topRight, bottomRight],
    [bottomRight, bottomLeft],
    [bottomLeft, topLeft],
  ]
}

function blockingSegments(
  settings: MapVisionSettings,
  channel: VisionBlockChannel,
): Array<[PixelPoint, PixelPoint]> {
  const width = Math.max(1, settings.mapWidth ?? 0)
  const height = Math.max(1, settings.mapHeight ?? 0)

  return settings.barriers
    .filter((barrier) => barrierBlocks(barrier, channel))
    .map((barrier) => [
      toPixel(barrier.start, width, height),
      toPixel(barrier.end, width, height),
    ])
}

/**
 * Builds a current-visibility polygon using endpoint ray casting.
 * Geometry is evaluated in pixel space so normalized coordinates do not distort
 * angles on non-square maps.
 */
export function buildVisibilityPolygon(
  origin: VisionPoint,
  settings: MapVisionSettings,
  channel: VisionBlockChannel = 'blocksSight',
  maxDistancePixels: number | null = null,
): VisionPoint[] {
  const width = Math.max(1, Number(settings.mapWidth) || 1)
  const height = Math.max(1, Number(settings.mapHeight) || 1)

  const originPx = toPixel(origin, width, height)
  const obstacleSegments = blockingSegments(settings, channel)
  const boundary = mapBoundarySegments(width, height)
  const allSegments = [...obstacleSegments, ...boundary]

  const endpointAngles: number[] = []
  const epsilon = 0.00002
  const fullTurn = Math.PI * 2
  const normalizeAngle = (angle: number) =>
    ((angle % fullTurn) + fullTurn) % fullTurn

  for (const [a, b] of allSegments) {
    for (const point of [a, b]) {
      const base = Math.atan2(point.y - originPx.y, point.x - originPx.x)
      endpointAngles.push(
        normalizeAngle(base - epsilon),
        normalizeAngle(base),
        normalizeAngle(base + epsilon),
      )
    }
  }

  // A finite sight radius needs enough evenly spaced rays to render a smooth
  // circle even in a completely open room. Barrier endpoint rays are added on
  // top so wall corners remain precise.
  const radialSamples = 128
  for (let index = 0; index < radialSamples; index += 1) {
    endpointAngles.push((fullTurn * index) / radialSamples)
  }

  const finiteRange =
    Number.isFinite(Number(maxDistancePixels)) &&
    Number(maxDistancePixels) > 0
      ? Number(maxDistancePixels)
      : null

  const hits = endpointAngles
    .map((angle) => {
      const direction = {
        x: Math.cos(angle),
        y: Math.sin(angle),
      }

      let nearest =
        finiteRange ?? Number.POSITIVE_INFINITY

      for (const [a, b] of allSegments) {
        const distance = raySegmentDistance(originPx, direction, a, b)
        if (distance !== null && distance < nearest) {
          nearest = distance
        }
      }

      if (!Number.isFinite(nearest)) {
        return null
      }

      const hit = {
        x: originPx.x + direction.x * nearest,
        y: originPx.y + direction.y * nearest,
      }

      return {
        angle,
        point: toNormalized(hit, width, height),
      }
    })
    .filter(
      (entry): entry is { angle: number; point: VisionPoint } => entry !== null,
    )
    .sort((left, right) => left.angle - right.angle)

  const polygon: VisionPoint[] = []

  for (const entry of hits) {
    const previous = polygon.at(-1)
    if (
      previous &&
      Math.hypot(previous.x - entry.point.x, previous.y - entry.point.y) < 0.00001
    ) {
      continue
    }

    polygon.push(entry.point)
  }

  return polygon
}

export function pointInsideVisibilityPolygon(
  point: VisionPoint,
  polygon: VisionPoint[],
): boolean {
  if (polygon.length < 3) {
    return false
  }

  let inside = false

  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]
    const b = polygon[previous]

    const crosses =
      (a.y > point.y) !== (b.y > point.y) &&
      point.x <
        ((b.x - a.x) * (point.y - a.y)) /
          ((b.y - a.y) || Number.EPSILON) +
        a.x

    if (crosses) {
      inside = !inside
    }
  }

  return inside
}

export function pointHasLineOfEffect(
  start: VisionPoint,
  end: VisionPoint,
  settings: MapVisionSettings,
  channel: VisionBlockChannel,
): boolean {
  if (!settings.enabled || settings.barriers.length === 0) {
    return true
  }

  const width = Math.max(1, Number(settings.mapWidth) || 1)
  const height = Math.max(1, Number(settings.mapHeight) || 1)

  const a = toPixel(start, width, height)
  const b = toPixel(end, width, height)
  const direction = {
    x: b.x - a.x,
    y: b.y - a.y,
  }
  const targetDistance = Math.hypot(direction.x, direction.y)

  if (targetDistance < 0.001) {
    return true
  }

  const normalizedDirection = {
    x: direction.x / targetDistance,
    y: direction.y / targetDistance,
  }

  for (const barrier of settings.barriers) {
    if (!barrierBlocks(barrier, channel)) {
      continue
    }

    const distance = raySegmentDistance(
      a,
      normalizedDirection,
      toPixel(barrier.start, width, height),
      toPixel(barrier.end, width, height),
    )

    // Ignore an intersection exactly at the source or target point. This keeps
    // tokens standing beside a wall from becoming "stuck" to that wall.
    if (
      distance !== null &&
      distance > 0.5 &&
      distance < targetDistance - 0.5
    ) {
      return false
    }
  }

  return true
}

export function visionSettingsUsable(
  settings: MapVisionSettings | null | undefined,
): settings is MapVisionSettings {
  return Boolean(
    settings &&
    settings.enabled &&
    settings.barriers.length > 0,
  )
}

export function barrierChannelCount(
  barriers: VisionBarrier[],
  channel: VisionBlockChannel,
): number {
  return barriers.filter((barrier) => barrierBlocks(barrier, channel)).length
}
