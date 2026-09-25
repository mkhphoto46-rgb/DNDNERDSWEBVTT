import {
  DEFAULT_VISION_BARRIER_CHANNELS,
  type VisionBarrier,
  type VisionBarrierChannels,
  type VisionBarrierKind,
  type VisionDoorState,
  type VisionPoint,
} from '../types/scene'

export type VisionBlockChannel =
  | 'blocksSight'
  | 'blocksMovement'
  | 'blocksLight'
  | 'blocksEffects'
  | 'blocksProjectiles'

export function createVisionId(): string {
  const cryptoApi =
    typeof window !== 'undefined'
      ? window.crypto
      : undefined

  if (
    cryptoApi &&
    typeof cryptoApi.randomUUID === 'function'
  ) {
    try {
      return cryptoApi.randomUUID()
    } catch {
      // Continue to compatibility fallback.
    }
  }

  if (
    cryptoApi &&
    typeof cryptoApi.getRandomValues === 'function'
  ) {
    const bytes = new Uint8Array(16)
    cryptoApi.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80

    const hex =
      Array.from(
        bytes,
        (value) =>
          value
            .toString(16)
            .padStart(2, '0'),
      )

    return [
      hex.slice(0, 4).join(''),
      hex.slice(4, 6).join(''),
      hex.slice(6, 8).join(''),
      hex.slice(8, 10).join(''),
      hex.slice(10, 16).join(''),
    ].join('-')
  }

  return [
    'vision',
    Date.now().toString(36),
    Math.random().toString(36).slice(2, 10),
    Math.random().toString(36).slice(2, 10),
  ].join('-')
}

export function channelsForVisionBarrier(
  kind: VisionBarrierKind,
  doorState: VisionDoorState = 'closed',
): VisionBarrierChannels {
  if (
    kind === 'door' &&
    doorState === 'open'
  ) {
    return {
      blocksSight: false,
      blocksMovement: false,
      blocksLight: false,
      blocksEffects: false,
      blocksProjectiles: false,
    }
  }

  return {
    ...DEFAULT_VISION_BARRIER_CHANNELS,
  }
}

export function effectiveVisionChannels(
  barrier: VisionBarrier,
): VisionBarrierChannels {
  if (
    barrier.kind === 'door' &&
    barrier.doorState === 'open'
  ) {
    return channelsForVisionBarrier(
      'door',
      'open',
    )
  }

  return {
    ...barrier.channels,
  }
}

export function barrierBlocks(
  barrier: VisionBarrier,
  channel: VisionBlockChannel,
): boolean {
  return effectiveVisionChannels(
    barrier,
  )[channel]
}

function orientation(
  a: VisionPoint,
  b: VisionPoint,
  c: VisionPoint,
): number {
  return (
    (b.x - a.x) * (c.y - a.y) -
    (b.y - a.y) * (c.x - a.x)
  )
}

function pointOnSegment(
  point: VisionPoint,
  a: VisionPoint,
  b: VisionPoint,
  epsilon = 0.000001,
): boolean {
  if (
    Math.abs(
      orientation(a, b, point),
    ) > epsilon
  ) {
    return false
  }

  return (
    point.x >= Math.min(a.x, b.x) - epsilon &&
    point.x <= Math.max(a.x, b.x) + epsilon &&
    point.y >= Math.min(a.y, b.y) - epsilon &&
    point.y <= Math.max(a.y, b.y) + epsilon
  )
}

export function segmentsIntersect(
  a: VisionPoint,
  b: VisionPoint,
  c: VisionPoint,
  d: VisionPoint,
  epsilon = 0.000001,
): boolean {
  const o1 = orientation(a, b, c)
  const o2 = orientation(a, b, d)
  const o3 = orientation(c, d, a)
  const o4 = orientation(c, d, b)

  const opposite =
    (
      (o1 > epsilon && o2 < -epsilon) ||
      (o1 < -epsilon && o2 > epsilon)
    ) &&
    (
      (o3 > epsilon && o4 < -epsilon) ||
      (o3 < -epsilon && o4 > epsilon)
    )

  if (opposite) {
    return true
  }

  return (
    (
      Math.abs(o1) <= epsilon &&
      pointOnSegment(c, a, b, epsilon)
    ) ||
    (
      Math.abs(o2) <= epsilon &&
      pointOnSegment(d, a, b, epsilon)
    ) ||
    (
      Math.abs(o3) <= epsilon &&
      pointOnSegment(a, c, d, epsilon)
    ) ||
    (
      Math.abs(o4) <= epsilon &&
      pointOnSegment(b, c, d, epsilon)
    )
  )
}

export function segmentBlockedByVision(
  start: VisionPoint,
  end: VisionPoint,
  barriers: VisionBarrier[],
  channel: VisionBlockChannel,
): boolean {
  return barriers.some(
    (barrier) =>
      barrierBlocks(
        barrier,
        channel,
      ) &&
      segmentsIntersect(
        start,
        end,
        barrier.start,
        barrier.end,
      ),
  )
}
