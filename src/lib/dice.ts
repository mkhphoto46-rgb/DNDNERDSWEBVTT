import {
  type DiceRollEntry,
  type DiceRollReason,
  type DiceRollVisibility,
  type DiceRollerRole,
} from '../types/dice'

export type GenericDiceActivityVisibility =
  | 'public'
  | 'dm-private'

export type GenericDiceMode = 'normal' | 'advantage' | 'disadvantage'

export type GenericDicePurpose =
  | 'attack'
  | 'damage'
  | 'saving-throw'
  | 'ability-check'
  | 'skill-check'
  | 'spell'
  | 'other'

export interface GenericDiceActivity {
  type: 'dice-roll'
  id: string
  rollerId: string
  rollerName: string
  role: DiceRollerRole
  purpose: GenericDicePurpose
  sides: 4 | 6 | 8 | 10 | 12 | 20 | 100
  count: number
  modifier: number
  mode: GenericDiceMode
  rolls: number[][]
  total: number
  natural: number | null
  visibility: GenericDiceActivityVisibility
  createdAt: string
}

function finiteInteger(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback
}

function validVisibility(value: unknown): DiceRollVisibility {
  if (value === 'dm') return 'dm'
  if (value === 'player-dm') return 'player-dm'
  return 'public'
}

function validRole(value: unknown): DiceRollerRole {
  return value === 'dm' ? 'dm' : 'player'
}

function validReason(value: unknown): DiceRollReason {
  if (value === 'initiative') return 'initiative'
  if (value === 'death-save') return 'death-save'
  if (value === 'concentration') return 'concentration'
  return 'd20'
}


function validGenericVisibility(value: unknown): GenericDiceActivityVisibility {
  return value === 'dm-private' ? 'dm-private' : 'public'
}

function validGenericMode(value: unknown): GenericDiceMode {
  if (value === 'advantage' || value === 'disadvantage') return value
  return 'normal'
}

function validGenericPurpose(value: unknown): GenericDicePurpose {
  if (value === 'attack') return 'attack'
  if (value === 'damage') return 'damage'
  if (value === 'saving-throw') return 'saving-throw'
  if (value === 'ability-check') return 'ability-check'
  if (value === 'skill-check') return 'skill-check'
  if (value === 'spell') return 'spell'
  return 'other'
}

function validGenericSides(value: unknown): GenericDiceActivity['sides'] | null {
  const sides = finiteInteger(value, 0)
  return [4, 6, 8, 10, 12, 20, 100].includes(sides)
    ? sides as GenericDiceActivity['sides']
    : null
}

export function genericDiceVisibilityForRoll(
  role: DiceRollerRole,
  purpose: GenericDicePurpose,
): GenericDiceActivityVisibility {
  if (role === 'player') {
    return 'public'
  }

  // Stage 04 table policy:
  // DM/NPC damage is public; every other DM/NPC roll stays DM-only.
  return purpose === 'damage' ? 'public' : 'dm-private'
}

export function structuredRollVisibilityForRole(
  role: DiceRollerRole,
): DiceRollVisibility {
  return role === 'player' ? 'public' : 'dm'
}

export function structuredRollVisibilityForOwnedActor(
  ownerId: string | null,
): DiceRollVisibility {
  return ownerId ? 'public' : 'dm'
}

export function canPlayerViewGenericDiceActivity(
  entry: GenericDiceActivity,
): boolean {
  return entry.visibility === 'public'
}

export function normalizeGenericDiceActivity(
  value: unknown,
): GenericDiceActivity | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const raw = value as Record<string, unknown>

  if (raw.type !== 'dice-roll') {
    return null
  }

  const id = String(raw.id ?? '').trim()
  const rollerId = String(raw.rollerId ?? '').trim()
  const rollerName = String(raw.rollerName ?? '').trim()
  const sides = validGenericSides(raw.sides)
  const count = Math.max(1, Math.min(20, finiteInteger(raw.count, 1)))
  const modifier = Math.max(-100, Math.min(100, finiteInteger(raw.modifier, 0)))
  const total = Math.max(-2000, Math.min(4000, finiteInteger(raw.total, 0)))
  const rolls = Array.isArray(raw.rolls)
    ? raw.rolls
        .filter((set): set is unknown[] => Array.isArray(set))
        .slice(0, 2)
        .map((set) =>
          set
            .slice(0, 20)
            .map((roll) => Math.max(1, Math.min(sides ?? 100, finiteInteger(roll, 1)))),
        )
    : []

  if (!id || !rollerId || !rollerName || sides === null || rolls.length === 0) {
    return null
  }

  const naturalValue = Number(raw.natural)
  const natural = Number.isFinite(naturalValue)
    ? Math.max(1, Math.min(sides, Math.round(naturalValue)))
    : null

  return {
    type: 'dice-roll',
    id,
    rollerId,
    rollerName,
    role: validRole(raw.role),
    purpose: validGenericPurpose(raw.purpose),
    sides,
    count,
    modifier,
    mode: validGenericMode(raw.mode),
    rolls,
    total,
    natural,
    visibility: validGenericVisibility(raw.visibility),
    createdAt:
      typeof raw.createdAt === 'string' && raw.createdAt
        ? raw.createdAt
        : new Date(0).toISOString(),
  }
}


export function canPlayerViewDiceRoll(
  entry: DiceRollEntry,
  viewerUserId: string,
): boolean {
  if (entry.visibility === 'public') {
    return true
  }

  if (entry.visibility === 'player-dm') {
    return Boolean(viewerUserId) && entry.rollerId === viewerUserId
  }

  return false
}

export function normalizeDiceRollEntry(value: unknown): DiceRollEntry | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const raw = value as Partial<DiceRollEntry>
  const id = String(raw.id ?? '').trim()
  const rollerId = String(raw.rollerId ?? '').trim()
  const rollerName = String(raw.rollerName ?? '').trim()

  if (!id || !rollerId || !rollerName) {
    return null
  }

  const rawRoll = Math.max(1, Math.min(20, finiteInteger(raw.rawRoll, 1)))
  const modifier = Math.max(-100, Math.min(100, finiteInteger(raw.modifier, 0)))
  const total = Math.max(-100, Math.min(200, finiteInteger(raw.total, rawRoll + modifier)))
  const actorId = typeof raw.actorId === 'string' && raw.actorId.trim()
    ? raw.actorId.trim()
    : null
  const actorName = typeof raw.actorName === 'string' && raw.actorName.trim()
    ? raw.actorName.trim()
    : null

  return {
    id,
    createdAt:
      typeof raw.createdAt === 'string' && raw.createdAt
        ? raw.createdAt
        : new Date(0).toISOString(),
    visibility: validVisibility(raw.visibility),
    rollerRole: validRole(raw.rollerRole),
    rollerId,
    rollerName,
    reason: validReason(raw.reason),
    die: 'd20',
    rawRoll,
    modifier,
    total,
    actorId,
    actorName,
  }
}

export function normalizeDiceLog(value: unknown): DiceRollEntry[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(normalizeDiceRollEntry)
    .filter((entry): entry is DiceRollEntry => entry !== null)
    .slice(-100)
}
