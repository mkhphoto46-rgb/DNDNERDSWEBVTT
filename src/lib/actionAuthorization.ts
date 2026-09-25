import type { TurnResource } from '../types/actionEconomy'

export type CoreTurnAction =
  | 'attack'
  | 'dash'
  | 'disengage'
  | 'dodge'
  | 'stand-up'

export function authoritativeCoreActionResource(
  rawAction: unknown,
  rawRequestedResource: unknown,
): TurnResource | null {
  const action = String(rawAction ?? '')

  const authoritativeResource: TurnResource | null =
    action === 'stand-up'
      ? null
      : action === 'attack' ||
          action === 'dash' ||
          action === 'disengage' ||
          action === 'dodge'
        ? 'action'
        : null

  if (authoritativeResource === null && action !== 'stand-up') {
    throw new Error('Unknown core action.')
  }

  // Compatibility: the current UI still sends resource: "action".
  // The client may express intent, but it may never choose Bonus Action or Reaction.
  if (
    rawRequestedResource !== undefined &&
    rawRequestedResource !== null &&
    rawRequestedResource !== ''
  ) {
    const requestedResource = String(rawRequestedResource)
    if (requestedResource !== 'action') {
      throw new Error(
        'Turn resource is server-authoritative. Core actions cannot choose Bonus Action or Reaction from the client.',
      )
    }
  }

  return authoritativeResource
}
