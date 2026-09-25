import { randomBytes, randomInt } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  SYSTEM_BACKUPS_ROOT,
  SYSTEM_DATABASE_PATH,
  campaignBackupsRoot,
  campaignDatabasePath,
  ensureBaseDirectories,
  ensureCampaignDirectories,
} from './paths'


export interface PersistenceAuditEntry {
  id: string
  ok: boolean
  detail: string
}

export interface PersistenceAuditReport {
  ok: boolean
  system: PersistenceAuditEntry
  campaigns: PersistenceAuditEntry[]
}

export class StateConflictError extends Error {
  readonly expectedRevision: number
  readonly actualRevision: number

  constructor(
    expectedRevision: number,
    actualRevision: number,
  ) {
    super(
      `Campaign state changed while this edit was being saved (expected revision ${expectedRevision}, current revision ${actualRevision}).`,
    )

    this.name = 'StateConflictError'
    this.expectedRevision = expectedRevision
    this.actualRevision = actualRevision
  }
}

const CAMPAIGN_SCHEMA_VERSION = 4
const CAMPAIGN_BACKUP_RETENTION = 20
const SYSTEM_BACKUP_RETENTION = 10
const AUTO_BACKUP_INTERVAL_MS = 5 * 60 * 1000
const lastAutomaticBackupAt = new Map<string, number>()

export interface CampaignRecord {
  id: string
  name: string
  joinCode: string
  createdAt: string
  updatedAt: string
  lastOpenedAt: string | null
}

export interface PlayerRecord {
  id: string
  name: string
  createdAt: string
  lastSeenAt: string
}

export interface SessionRecord {
  id: string
  number: number
  startedAt: string
  endedAt: string | null
}

export interface SnapshotRecord {
  id: string
  name: string
  createdAt: string
}

export interface CharacterVaultRecord {
  playerKey: string
  sourceCampaignId: string
  character: unknown
  updatedAt: string
}

interface CampaignRow {
  id: string
  name: string
  join_code: string
  created_at: string
  updated_at: string
  last_opened_at: string | null
}

interface PlayerRow {
  id: string
  player_key?: string
  name: string
  created_at: string
  last_seen_at: string
  is_active?: number
  is_banned?: number
}

interface SessionRow {
  id: string
  session_number: number
  started_at: string
  ended_at: string | null
}

interface SnapshotRow {
  id: string
  name: string
  created_at: string
}

ensureBaseDirectories()

const systemDatabase =
  new DatabaseSync(
    SYSTEM_DATABASE_PATH,
    {
      timeout: 5000,
    },
  )

systemDatabase.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    join_code TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_opened_at TEXT
  ) STRICT;

  CREATE TABLE IF NOT EXISTS player_character_vaults (
    player_key TEXT PRIMARY KEY,
    source_campaign_id TEXT NOT NULL,
    character_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
`)

function now(): string {
  return new Date().toISOString()
}


function normalizePlayerKey(
  rawPlayerKey: string,
): string {
  return rawPlayerKey
    .trim()
    .slice(0, 120)
}

export function saveCharacterVault(
  rawPlayerKey: string,
  sourceCampaignId: string,
  character: unknown,
): void {
  const playerKey = normalizePlayerKey(rawPlayerKey)

  if (playerKey.length < 8) {
    return
  }

  if (
    !character ||
    typeof character !== 'object' ||
    Array.isArray(character)
  ) {
    return
  }

  const updatedAt = now()

  systemDatabase.prepare(`
    INSERT INTO player_character_vaults (
      player_key,
      source_campaign_id,
      character_json,
      updated_at
    )
    VALUES (?, ?, ?, ?)
    ON CONFLICT(player_key)
    DO UPDATE SET
      source_campaign_id = excluded.source_campaign_id,
      character_json = excluded.character_json,
      updated_at = excluded.updated_at
  `).run(
    playerKey,
    sourceCampaignId,
    JSON.stringify(character),
    updatedAt,
  )
}

export function loadCharacterVault(
  rawPlayerKey: string,
): CharacterVaultRecord | null {
  const playerKey = normalizePlayerKey(rawPlayerKey)

  if (playerKey.length < 8) {
    return null
  }

  const row = systemDatabase.prepare(`
    SELECT
      player_key,
      source_campaign_id,
      character_json,
      updated_at
    FROM player_character_vaults
    WHERE player_key = ?
    LIMIT 1
  `).get(
    playerKey,
  ) as unknown as
    | {
        player_key: string
        source_campaign_id: string
        character_json: string
        updated_at: string
      }
    | undefined

  if (!row) {
    return null
  }

  try {
    return {
      playerKey: row.player_key,
      sourceCampaignId: row.source_campaign_id,
      character: JSON.parse(row.character_json),
      updatedAt: row.updated_at,
    }
  } catch {
    return null
  }
}

function copyCharacterVault(
  rawPreviousPlayerKey: string,
  rawNextPlayerKey: string,
): void {
  const previousPlayerKey = normalizePlayerKey(rawPreviousPlayerKey)
  const nextPlayerKey = normalizePlayerKey(rawNextPlayerKey)

  if (
    previousPlayerKey.length < 8 ||
    nextPlayerKey.length < 8 ||
    previousPlayerKey === nextPlayerKey
  ) {
    return
  }

  const existing = loadCharacterVault(previousPlayerKey)

  if (!existing) {
    return
  }

  saveCharacterVault(
    nextPlayerKey,
    existing.sourceCampaignId,
    existing.character,
  )
}

function syncCharacterVaultActors(
  campaignId: string,
  state: Record<string, unknown>,
  playerKeysById: Map<string, string>,
): void {
  const actors =
    Array.isArray(state.actors)
      ? state.actors
      : []

  for (const entry of actors) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry)
    ) {
      continue
    }

    const actor = entry as Record<string, unknown>

    if (actor.kind !== 'player') {
      continue
    }

    const ownerId =
      typeof actor.ownerId === 'string'
        ? actor.ownerId
        : ''

    if (!ownerId) {
      continue
    }

    const playerKey =
      playerKeysById.get(ownerId)

    if (!playerKey) {
      continue
    }

    saveCharacterVault(
      playerKey,
      campaignId,
      actor,
    )
  }
}

function safeTimestamp(): string {
  return now()
    .replace(/[:.]/g, '-')
}

function safeReason(rawReason: string): string {
  const cleaned = rawReason
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 50)

  return cleaned || 'backup'
}

function quickCheckDatabase(
  database: DatabaseSync,
): string[] {
  const rows = database.prepare(`
    PRAGMA quick_check
  `).all() as unknown as Array<Record<string, unknown>>

  return rows.map((row) =>
    String(
      row.quick_check ??
      Object.values(row)[0] ??
      '',
    ),
  )
}

function databaseIsHealthy(
  database: DatabaseSync,
): boolean {
  const result = quickCheckDatabase(database)
  return result.length === 1 && result[0].toLowerCase() === 'ok'
}

function checkpointDatabase(
  database: DatabaseSync,
): void {
  database.exec(`
    PRAGMA wal_checkpoint(TRUNCATE);
  `)
}

function pruneBackups(
  directory: string,
  prefix: string,
  retention: number,
): void {
  if (!fs.existsSync(directory)) return

  const files = fs.readdirSync(directory)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.sqlite'))
    .map((name) => ({
      name,
      absolutePath: path.join(directory, name),
      modifiedAt: fs.statSync(path.join(directory, name)).mtimeMs,
    }))
    .sort((a, b) => b.modifiedAt - a.modifiedAt)

  for (const file of files.slice(retention)) {
    fs.rmSync(file.absolutePath, { force: true })
  }
}

function createId(
  prefix: string,
): string {
  return (
    prefix +
    '_' +
    randomBytes(8)
      .toString('hex')
  )
}

function campaignFromRow(
  row: CampaignRow,
): CampaignRecord {
  return {
    id: row.id,
    name: row.name,
    joinCode: row.join_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at,
  }
}

function playerFromRow(
  row: PlayerRow,
): PlayerRecord {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  }
}

function sessionFromRow(
  row: SessionRow,
): SessionRecord {
  return {
    id: row.id,
    number: row.session_number,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  }
}

function snapshotFromRow(
  row: SnapshotRow,
): SnapshotRecord {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
  }
}

const JOIN_CHARACTERS =
  'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function randomJoinCode(): string {
  let result = ''

  for (
    let index = 0;
    index < 6;
    index += 1
  ) {
    const randomIndex =
      randomInt(
        JOIN_CHARACTERS.length,
      )

    result +=
      JOIN_CHARACTERS[randomIndex]
  }

  return result
}

function createUniqueJoinCode(): string {
  const statement =
    systemDatabase.prepare(`
      SELECT id
      FROM campaigns
      WHERE join_code = ?
      LIMIT 1
    `)

  for (
    let attempt = 0;
    attempt < 100;
    attempt += 1
  ) {
    const code =
      randomJoinCode()

    const existing =
      statement.get(
        code,
      )

    if (!existing) {
      return code
    }
  }

  throw new Error(
    'Could not generate a unique join code.',
  )
}

function ensureCampaignSchema(
  database: DatabaseSync,
): void {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS session_state (
      id INTEGER PRIMARY KEY
        CHECK (id = 1),
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0
    ) STRICT;

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      state_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS asset_manifest (
      id TEXT PRIMARY KEY,
      asset_type TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      session_number INTEGER NOT NULL UNIQUE,
      started_at TEXT NOT NULL,
      ended_at TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      player_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_banned INTEGER NOT NULL DEFAULT 0
    ) STRICT;
  `)

  const sessionStateColumns =
    database.prepare(`
      PRAGMA table_info(session_state)
    `).all() as unknown as Array<{
      name: string
    }>

  if (
    !sessionStateColumns.some(
      (column) => column.name === 'revision',
    )
  ) {
    database.exec(`
      ALTER TABLE session_state
      ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
    `)
  }

  const playerColumns =
    database.prepare(`
      PRAGMA table_info(players)
    `).all() as unknown as Array<{
      name: string
    }>

  if (
    !playerColumns.some(
      (column) => column.name === 'is_active',
    )
  ) {
    database.exec(`
      ALTER TABLE players
      ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
    `)
  }

  if (
    !playerColumns.some(
      (column) => column.name === 'is_banned',
    )
  ) {
    database.exec(`
      ALTER TABLE players
      ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0;
    `)
  }

  database.prepare(`
    INSERT INTO metadata (key, value)
    VALUES ('schema_version', ?)
    ON CONFLICT(key)
    DO UPDATE SET value = excluded.value
  `).run(String(CAMPAIGN_SCHEMA_VERSION))

  const existingState =
    database.prepare(`
      SELECT id
      FROM session_state
      WHERE id = 1
    `).get()

  if (!existingState) {
    database.prepare(`
      INSERT INTO session_state (
        id,
        state_json,
        updated_at,
        revision
      )
      VALUES (
        1,
        ?,
        ?,
        0
      )
    `).run(
      JSON.stringify({
        version: 1,
        activeSceneId: null,
        combat: null,
      }),
      now(),
    )
  }
}

function openCampaignDatabase(
  campaignId: string,
): DatabaseSync {
  const campaign =
    getCampaign(
      campaignId,
    )

  if (!campaign) {
    throw new Error(
      'Campaign not found.',
    )
  }

  ensureCampaignDirectories(
    campaignId,
  )

  const database =
    new DatabaseSync(
      campaignDatabasePath(
        campaignId,
      ),
      {
        timeout: 5000,
      },
    )

  ensureCampaignSchema(
    database,
  )

  return database
}

function initialiseCampaignDatabase(
  campaign: CampaignRecord,
): void {
  ensureCampaignDirectories(
    campaign.id,
  )

  const database =
    new DatabaseSync(
      campaignDatabasePath(
        campaign.id,
      ),
      {
        timeout: 5000,
      },
    )

  ensureCampaignSchema(
    database,
  )

  const metadataInsert =
    database.prepare(`
      INSERT OR REPLACE INTO metadata (
        key,
        value
      )
      VALUES (?, ?)
    `)

  metadataInsert.run(
    'campaign_id',
    campaign.id,
  )

  metadataInsert.run(
    'campaign_name',
    campaign.name,
  )

  metadataInsert.run(
    'created_at',
    campaign.createdAt,
  )

  database.close()
}

export function createCampaign(
  rawName: string,
): CampaignRecord {
  const name =
    rawName.trim()

  if (!name) {
    throw new Error(
      'Campaign name is required.',
    )
  }

  if (
    name.length > 80
  ) {
    throw new Error(
      'Campaign name must be 80 characters or fewer.',
    )
  }

  const timestamp =
    now()

  const campaign: CampaignRecord = {
    id:
      createId(
        'camp',
      ),

    name,

    joinCode:
      createUniqueJoinCode(),

    createdAt:
      timestamp,

    updatedAt:
      timestamp,

    lastOpenedAt:
      null,
  }

  initialiseCampaignDatabase(
    campaign,
  )

  systemDatabase.prepare(`
    INSERT INTO campaigns (
      id,
      name,
      join_code,
      created_at,
      updated_at,
      last_opened_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    campaign.id,
    campaign.name,
    campaign.joinCode,
    campaign.createdAt,
    campaign.updatedAt,
    campaign.lastOpenedAt,
  )

  backupCampaignDatabase(
    campaign.id,
    'campaign-created',
  )

  backupSystemDatabase(
    'campaign-created',
  )

  return campaign
}

export function listCampaigns():
  CampaignRecord[] {
  const rows =
    systemDatabase.prepare(`
      SELECT
        id,
        name,
        join_code,
        created_at,
        updated_at,
        last_opened_at
      FROM campaigns
      ORDER BY
        COALESCE(
          last_opened_at,
          created_at
        ) DESC
    `).all() as unknown as CampaignRow[]

  return rows.map(
    campaignFromRow,
  )
}

export function getCampaign(
  campaignId: string,
): CampaignRecord | null {
  const row =
    systemDatabase.prepare(`
      SELECT
        id,
        name,
        join_code,
        created_at,
        updated_at,
        last_opened_at
      FROM campaigns
      WHERE id = ?
      LIMIT 1
    `).get(
      campaignId,
    ) as unknown as
      | CampaignRow
      | undefined

  return row
    ? campaignFromRow(
        row,
      )
    : null
}

export function getCampaignByJoinCode(
  rawJoinCode: string,
): CampaignRecord | null {
  const joinCode =
    rawJoinCode
      .trim()
      .toUpperCase()

  const row =
    systemDatabase.prepare(`
      SELECT
        id,
        name,
        join_code,
        created_at,
        updated_at,
        last_opened_at
      FROM campaigns
      WHERE join_code = ?
      LIMIT 1
    `).get(
      joinCode,
    ) as unknown as
      | CampaignRow
      | undefined

  return row
    ? campaignFromRow(
        row,
      )
    : null
}

export function touchCampaign(
  campaignId: string,
): void {
  const timestamp =
    now()

  systemDatabase.prepare(`
    UPDATE campaigns
    SET
      last_opened_at = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    timestamp,
    timestamp,
    campaignId,
  )
}

export function loadCampaignState(
  campaignId: string,
): unknown {
  const database =
    openCampaignDatabase(
      campaignId,
    )

  try {
    const row =
      database.prepare(`
        SELECT
          state_json,
          revision
        FROM session_state
        WHERE id = 1
      `).get() as unknown as
        | {
            state_json: string
            revision: number
          }
        | undefined

    if (!row) {
      return {
        stateRevision: 0,
      }
    }

    const parsed =
      JSON.parse(
        row.state_json,
      )

    const base =
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {}

    return {
      ...base,
      stateRevision:
        Math.max(
          0,
          Math.trunc(
            Number(row.revision) || 0,
          ),
        ),
    }
  } finally {
    database.close()
  }
}

export function saveCampaignState(
  campaignId: string,
  state: unknown,
  expectedRevision?: number,
): unknown {
  const database =
    openCampaignDatabase(
      campaignId,
    )

  const timestamp =
    now()

  const rawState =
    state &&
    typeof state === 'object' &&
    !Array.isArray(state)
      ? state as Record<string, unknown>
      : {}

  const {
    stateRevision: _ignoredStateRevision,
    ...persistedState
  } = rawState

  let nextRevision = 0
  let previousPersistedState: Record<string, unknown> = {}
  let playerKeysById = new Map<string, string>()

  try {
    database.exec('BEGIN IMMEDIATE')

    const current =
      database.prepare(`
        SELECT
          revision,
          state_json
        FROM session_state
        WHERE id = 1
      `).get() as unknown as {
        revision: number
        state_json: string
      }

    try {
      const parsedPrevious =
        JSON.parse(current.state_json)

      previousPersistedState =
        parsedPrevious &&
        typeof parsedPrevious === 'object' &&
        !Array.isArray(parsedPrevious)
          ? parsedPrevious as Record<string, unknown>
          : {}
    } catch {
      previousPersistedState = {}
    }

    const currentRevision =
      Math.max(
        0,
        Math.trunc(
          Number(current.revision) || 0,
        ),
      )

    if (
      expectedRevision !== undefined &&
      expectedRevision !== currentRevision
    ) {
      throw new StateConflictError(
        expectedRevision,
        currentRevision,
      )
    }

    nextRevision =
      currentRevision + 1

    database.prepare(`
      UPDATE session_state
      SET
        state_json = ?,
        updated_at = ?,
        revision = ?
      WHERE id = 1
    `).run(
      JSON.stringify(
        persistedState,
      ),
      timestamp,
      nextRevision,
    )

    database.exec('COMMIT')

    const playerRows =
      database.prepare(`
        SELECT
          id,
          player_key
        FROM players
      `).all() as unknown as Array<{
        id: string
        player_key: string
      }>

    playerKeysById =
      new Map(
        playerRows.map(
          (row) => [
            row.id,
            row.player_key,
          ],
        ),
      )
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } catch {
      // The transaction may already be closed.
    }

    throw error
  } finally {
    database.close()
  }

  syncCharacterVaultActors(
    campaignId,
    previousPersistedState,
    playerKeysById,
  )

  syncCharacterVaultActors(
    campaignId,
    persistedState,
    playerKeysById,
  )

  systemDatabase.prepare(`
    UPDATE campaigns
    SET updated_at = ?
    WHERE id = ?
  `).run(
    timestamp,
    campaignId,
  )

  maybeBackupCampaignDatabase(
    campaignId,
  )

  return {
    ...persistedState,
    stateRevision: nextRevision,
  }
}

export function getActiveSession(
  campaignId: string,
): SessionRecord | null {
  const database =
    openCampaignDatabase(
      campaignId,
    )

  const row =
    database.prepare(`
      SELECT
        id,
        session_number,
        started_at,
        ended_at
      FROM sessions
      WHERE ended_at IS NULL
      ORDER BY session_number DESC
      LIMIT 1
    `).get() as unknown as
      | SessionRow
      | undefined

  database.close()

  return row
    ? sessionFromRow(
        row,
      )
    : null
}

function getNextSessionNumber(
  database: DatabaseSync,
): number {
  const row =
    database.prepare(`
      SELECT
        COALESCE(
          MAX(session_number),
          0
        ) AS max_number
      FROM sessions
    `).get() as unknown as {
      max_number: number
    }

  return (
    Number(
      row.max_number,
    ) + 1
  )
}

function readStateFromDatabase(
  database: DatabaseSync,
): string {
  const row =
    database.prepare(`
      SELECT state_json
      FROM session_state
      WHERE id = 1
    `).get() as unknown as {
      state_json: string
    }

  return row.state_json
}

function createSnapshotInDatabase(
  database: DatabaseSync,
  name: string,
): SnapshotRecord {
  const snapshotId =
    createId(
      'snap',
    )

  const createdAt =
    now()

  const stateJson =
    readStateFromDatabase(
      database,
    )

  database.prepare(`
    INSERT INTO snapshots (
      id,
      name,
      state_json,
      created_at
    )
    VALUES (?, ?, ?, ?)
  `).run(
    snapshotId,
    name,
    stateJson,
    createdAt,
  )

  return {
    id:
      snapshotId,

    name,

    createdAt,
  }
}

export function startSession(
  campaignId: string,
): SessionRecord {
  const database =
    openCampaignDatabase(
      campaignId,
    )

  const active =
    database.prepare(`
      SELECT id
      FROM sessions
      WHERE ended_at IS NULL
      LIMIT 1
    `).get()

  if (active) {
    database.close()

    throw new Error(
      'A session is already active.',
    )
  }

  const sessionNumber =
    getNextSessionNumber(
      database,
    )

  const id =
    createId(
      'session',
    )

  const startedAt =
    now()

  createSnapshotInDatabase(
    database,
    `Session ${sessionNumber} — Start`,
  )

  database.prepare(`
    INSERT INTO sessions (
      id,
      session_number,
      started_at,
      ended_at
    )
    VALUES (?, ?, ?, NULL)
  `).run(
    id,
    sessionNumber,
    startedAt,
  )

  database.close()

  touchCampaign(
    campaignId,
  )

  backupCampaignDatabase(
    campaignId,
    `session-${sessionNumber}-start`,
  )

  return {
    id,
    number:
      sessionNumber,
    startedAt,
    endedAt:
      null,
  }
}

export function endSession(
  campaignId: string,
): SessionRecord {
  const database =
    openCampaignDatabase(
      campaignId,
    )

  const row =
    database.prepare(`
      SELECT
        id,
        session_number,
        started_at,
        ended_at
      FROM sessions
      WHERE ended_at IS NULL
      ORDER BY session_number DESC
      LIMIT 1
    `).get() as unknown as
      | SessionRow
      | undefined

  if (!row) {
    database.close()

    throw new Error(
      'No active session.',
    )
  }

  const endedAt =
    now()

  createSnapshotInDatabase(
    database,
    `Session ${row.session_number} — End`,
  )

  database.prepare(`
    UPDATE sessions
    SET ended_at = ?
    WHERE id = ?
  `).run(
    endedAt,
    row.id,
  )

  database.close()

  touchCampaign(
    campaignId,
  )

  backupCampaignDatabase(
    campaignId,
    `session-${row.session_number}-end`,
  )

  return {
    id:
      row.id,

    number:
      row.session_number,

    startedAt:
      row.started_at,

    endedAt,
  }
}

export function createSnapshot(
  campaignId: string,
  rawName: string,
): SnapshotRecord {
  const database =
    openCampaignDatabase(
      campaignId,
    )

  const trimmed =
    rawName.trim()

  const name =
    trimmed ||
    `Manual Snapshot — ${new Date().toLocaleString()}`

  const snapshot =
    createSnapshotInDatabase(
      database,
      name.slice(
        0,
        100,
      ),
    )

  database.close()

  backupCampaignDatabase(
    campaignId,
    'manual-snapshot',
  )

  return snapshot
}

export function listSnapshots(
  campaignId: string,
): SnapshotRecord[] {
  const database =
    openCampaignDatabase(
      campaignId,
    )

  const rows =
    database.prepare(`
      SELECT
        id,
        name,
        created_at
      FROM snapshots
      ORDER BY created_at DESC
    `).all() as unknown as SnapshotRow[]

  database.close()

  return rows.map(
    snapshotFromRow,
  )
}

export function restoreSnapshot(
  campaignId: string,
  snapshotId: string,
): void {
  backupCampaignDatabase(
    campaignId,
    'pre-restore',
  )

  const database =
    openCampaignDatabase(
      campaignId,
    )

  try {
    const snapshot =
      database.prepare(`
        SELECT state_json
        FROM snapshots
        WHERE id = ?
        LIMIT 1
      `).get(
        snapshotId,
      ) as unknown as
        | {
            state_json: string
          }
        | undefined

    if (!snapshot) {
      throw new Error(
        'Snapshot not found.',
      )
    }

    database.exec('BEGIN IMMEDIATE')

    createSnapshotInDatabase(
      database,
      'Automatic Backup Before Restore',
    )

    database.prepare(`
      UPDATE session_state
      SET
        state_json = ?,
        updated_at = ?,
        revision = revision + 1
      WHERE id = 1
    `).run(
      snapshot.state_json,
      now(),
    )

    database.exec('COMMIT')
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } catch {
      // The transaction may already be closed.
    }

    throw error
  } finally {
    database.close()
  }

  touchCampaign(
    campaignId,
  )

  backupCampaignDatabase(
    campaignId,
    'post-restore',
  )
}

export function listPlayers(
  campaignId: string,
): PlayerRecord[] {
  const database =
    openCampaignDatabase(
      campaignId,
    )

  const rows =
    database.prepare(`
      SELECT
        id,
        name,
        created_at,
        last_seen_at
      FROM players
      WHERE is_active = 1
        AND is_banned = 0
      ORDER BY last_seen_at DESC, name COLLATE NOCASE ASC
    `).all() as unknown as PlayerRow[]

  database.close()

  return rows.map(playerFromRow)
}

export function kickPlayerSeat(
  campaignId: string,
  playerId: string,
): PlayerRecord | null {
  const database =
    openCampaignDatabase(
      campaignId,
    )

  const row =
    database.prepare(`
      SELECT
        id,
        name,
        created_at,
        last_seen_at
      FROM players
      WHERE id = ?
        AND is_active = 1
      LIMIT 1
    `).get(
      playerId,
    ) as unknown as
      | PlayerRow
      | undefined

  if (!row) {
    database.close()
    return null
  }

  database.prepare(`
    UPDATE players
    SET
      is_active = 0,
      last_seen_at = ?
    WHERE id = ?
  `).run(
    now(),
    playerId,
  )

  database.close()

  touchCampaign(
    campaignId,
  )

  return playerFromRow(row)
}

export function listBannedPlayers(
  campaignId: string,
): PlayerRecord[] {
  const database =
    openCampaignDatabase(
      campaignId,
    )

  const rows =
    database.prepare(`
      SELECT
        id,
        name,
        created_at,
        last_seen_at
      FROM players
      WHERE is_banned = 1
      ORDER BY last_seen_at DESC, name COLLATE NOCASE ASC
    `).all() as unknown as PlayerRow[]

  database.close()

  return rows.map(playerFromRow)
}

export function banPlayerSeat(
  campaignId: string,
  playerId: string,
): PlayerRecord | null {
  const database =
    openCampaignDatabase(
      campaignId,
    )

  const row =
    database.prepare(`
      SELECT
        id,
        name,
        created_at,
        last_seen_at
      FROM players
      WHERE id = ?
        AND is_banned = 0
      LIMIT 1
    `).get(
      playerId,
    ) as unknown as
      | PlayerRow
      | undefined

  if (!row) {
    database.close()
    return null
  }

  database.prepare(`
    UPDATE players
    SET
      is_active = 0,
      is_banned = 1,
      last_seen_at = ?
    WHERE id = ?
  `).run(
    now(),
    playerId,
  )

  database.close()

  touchCampaign(
    campaignId,
  )

  return playerFromRow(row)
}

export function unbanPlayerSeat(
  campaignId: string,
  playerId: string,
): PlayerRecord | null {
  const database =
    openCampaignDatabase(
      campaignId,
    )

  const row =
    database.prepare(`
      SELECT
        id,
        name,
        created_at,
        last_seen_at
      FROM players
      WHERE id = ?
        AND is_banned = 1
      LIMIT 1
    `).get(
      playerId,
    ) as unknown as
      | PlayerRow
      | undefined

  if (!row) {
    database.close()
    return null
  }

  database.prepare(`
    UPDATE players
    SET
      is_banned = 0,
      is_active = 0,
      last_seen_at = ?
    WHERE id = ?
  `).run(
    now(),
    playerId,
  )

  database.close()

  touchCampaign(
    campaignId,
  )

  return playerFromRow(row)
}

export function registerOrResumePlayer(
  campaignId: string,
  rawPlayerKey: string,
  rawName: string,
  options: {
    allowNameRecovery?: boolean
  } = {},
): PlayerRecord {
  const allowNameRecovery =
    options.allowNameRecovery === true

  const playerKey =
    rawPlayerKey
      .trim()
      .slice(
        0,
        120,
      )

  const name =
    rawName
      .trim()
      .slice(
        0,
        40,
      )

  if (
    playerKey.length < 8
  ) {
    throw new Error(
      'Invalid player identity.',
    )
  }

  if (!name) {
    throw new Error(
      'Player name is required.',
    )
  }

  const database =
    openCampaignDatabase(
      campaignId,
    )

  const existing =
    database.prepare(`
      SELECT
        id,
        player_key,
        name,
        created_at,
        last_seen_at,
        is_banned
      FROM players
      WHERE player_key = ?
      LIMIT 1
    `).get(
      playerKey,
    ) as unknown as
      | PlayerRow
      | undefined

  const timestamp =
    now()

  if (existing?.is_banned === 1) {
    database.close()

    throw new Error(
      'This Player is banned from this campaign.',
    )
  }

  if (existing) {
    const state = loadCampaignState(campaignId) as { actors?: Array<{ ownerId?: unknown }> }
    const ownerIds = new Set(
      (Array.isArray(state?.actors) ? state.actors : [])
        .map((actor) => typeof actor?.ownerId === 'string' ? actor.ownerId : '')
        .filter(Boolean),
    )

    // Repair an identity created during an earlier failed resume: if the
    // current key points at an empty duplicate seat but exactly one seat with
    // the same name owns a character, reconnect to the character-owning seat.
    if (allowNameRecovery && !ownerIds.has(existing.id)) {
      const linkedSameName =
        database.prepare(`
          SELECT
            id,
            player_key,
            name,
            created_at,
            last_seen_at,
            is_active,
            is_banned
          FROM players
          WHERE name = ? COLLATE NOCASE
            AND id <> ?
          ORDER BY last_seen_at DESC
        `).all(
          name,
          existing.id,
        ) as unknown as PlayerRow[]

      const linkedSeats = linkedSameName.filter(
        (candidate) =>
          candidate.is_banned !== 1 &&
          ownerIds.has(candidate.id),
      )
      if (linkedSeats.length === 1) {
        const recovered = linkedSeats[0]
        database.exec('BEGIN IMMEDIATE')
        try {
          copyCharacterVault(
            recovered.player_key ?? '',
            playerKey,
          )

          database.prepare('DELETE FROM players WHERE id = ?').run(existing.id)
          database.prepare(`
            UPDATE players
            SET player_key = ?, name = ?, last_seen_at = ?, is_active = 1
            WHERE id = ?
          `).run(playerKey, name, timestamp, recovered.id)
          database.exec('COMMIT')
        } catch (error) {
          database.exec('ROLLBACK')
          throw error
        }
        database.close()

        return {
          id: recovered.id,
          name,
          createdAt: recovered.created_at,
          lastSeenAt: timestamp,
        }
      }
    }

    database.prepare(`
      UPDATE players
      SET
        name = ?,
        last_seen_at = ?,
        is_active = 1
      WHERE id = ?
    `).run(
      name,
      timestamp,
      existing.id,
    )

    database.close()

    return {
      id:
        existing.id,

      name,

      createdAt:
        existing.created_at,

      lastSeenAt:
        timestamp,
    }
  }

  // A browser origin change (for example switching from one LAN address to
  // another) gives the same physical player a fresh localStorage identity.
  // On a private local table, a unique case-insensitive seat name is a safe
  // recovery path and prevents a second blank character from being created.
  const sameNamePlayers =
    database.prepare(`
      SELECT
        id,
        player_key,
        name,
        created_at,
        last_seen_at,
        is_active,
        is_banned
      FROM players
      WHERE name = ? COLLATE NOCASE
      ORDER BY last_seen_at DESC
    `).all(
      name,
    ) as unknown as PlayerRow[]

  const bannedSameNamePlayer =
    sameNamePlayers.find(
      (candidate) => candidate.is_banned === 1,
    )

  if (bannedSameNamePlayer) {
    database.close()

    throw new Error(
      'This Player is banned from this campaign.',
    )
  }

  const activeSameNamePlayers =
    sameNamePlayers.filter(
      (candidate) => candidate.is_active !== 0,
    )

  if (activeSameNamePlayers.length > 0 && !allowNameRecovery) {
    database.close()

    throw new Error(
      'That player name already has a campaign seat. Rejoin from the original browser/device or ask the DM to resolve the seat.',
    )
  }

  let recovered = sameNamePlayers.length === 1
    ? sameNamePlayers[0]
    : undefined

  if (!recovered && sameNamePlayers.length > 1) {
    const state = loadCampaignState(campaignId) as { actors?: Array<{ ownerId?: unknown }> }
    const ownerIds = new Set(
      (Array.isArray(state?.actors) ? state.actors : [])
        .map((actor) => typeof actor?.ownerId === 'string' ? actor.ownerId : '')
        .filter(Boolean),
    )
    const linkedSeats = sameNamePlayers.filter((candidate) => ownerIds.has(candidate.id))
    if (linkedSeats.length === 1) recovered = linkedSeats[0]
  }

  if (recovered) {
    copyCharacterVault(
      recovered.player_key ?? '',
      playerKey,
    )

    database.prepare(`
      UPDATE players
      SET
        player_key = ?,
        name = ?,
        last_seen_at = ?,
        is_active = 1
      WHERE id = ?
    `).run(
      playerKey,
      name,
      timestamp,
      recovered.id,
    )

    database.close()

    return {
      id: recovered.id,
      name,
      createdAt: recovered.created_at,
      lastSeenAt: timestamp,
    }
  }

  const id =
    createId(
      'player',
    )

  database.prepare(`
    INSERT INTO players (
      id,
      player_key,
      name,
      created_at,
      last_seen_at
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(
    id,
    playerKey,
    name,
    timestamp,
    timestamp,
  )

  database.close()

  return {
    id,
    name,
    createdAt:
      timestamp,
    lastSeenAt:
      timestamp,
  }
}

function maybeBackupCampaignDatabase(
  campaignId: string,
): void {
  const timestamp = Date.now()
  const lastBackup =
    lastAutomaticBackupAt.get(campaignId) ?? 0

  if (
    timestamp - lastBackup < AUTO_BACKUP_INTERVAL_MS
  ) {
    return
  }

  try {
    backupCampaignDatabase(
      campaignId,
      'automatic',
    )

    lastAutomaticBackupAt.set(
      campaignId,
      timestamp,
    )
  } catch (error) {
    console.error(
      `[Persistence] Automatic backup failed for ${campaignId}:`,
      error,
    )
  }
}

export function backupCampaignDatabase(
  campaignId: string,
  reason = 'manual',
): string {
  const campaign =
    getCampaign(
      campaignId,
    )

  if (!campaign) {
    throw new Error(
      'Campaign not found.',
    )
  }

  ensureCampaignDirectories(
    campaignId,
  )

  const databasePath =
    campaignDatabasePath(
      campaignId,
    )

  const database =
    new DatabaseSync(
      databasePath,
      {
        timeout: 5000,
      },
    )

  try {
    ensureCampaignSchema(database)

    if (!databaseIsHealthy(database)) {
      throw new Error(
        'Campaign database integrity check failed. Backup was not created.',
      )
    }

    checkpointDatabase(database)
  } finally {
    database.close()
  }

  const directory =
    campaignBackupsRoot(
      campaignId,
    )

  fs.mkdirSync(
    directory,
    {
      recursive: true,
    },
  )

  const filename =
    `campaign-${safeTimestamp()}-${safeReason(reason)}.sqlite`

  const destination =
    path.join(
      directory,
      filename,
    )

  fs.copyFileSync(
    databasePath,
    destination,
  )

  pruneBackups(
    directory,
    'campaign-',
    CAMPAIGN_BACKUP_RETENTION,
  )

  return destination
}

export function backupSystemDatabase(
  reason = 'manual',
): string {
  if (!databaseIsHealthy(systemDatabase)) {
    throw new Error(
      'System database integrity check failed. Backup was not created.',
    )
  }

  checkpointDatabase(systemDatabase)

  fs.mkdirSync(
    SYSTEM_BACKUPS_ROOT,
    {
      recursive: true,
    },
  )

  const filename =
    `system-${safeTimestamp()}-${safeReason(reason)}.sqlite`

  const destination =
    path.join(
      SYSTEM_BACKUPS_ROOT,
      filename,
    )

  fs.copyFileSync(
    SYSTEM_DATABASE_PATH,
    destination,
  )

  pruneBackups(
    SYSTEM_BACKUPS_ROOT,
    'system-',
    SYSTEM_BACKUP_RETENTION,
  )

  return destination
}

export function backupAllCriticalDatabases(
  reason = 'manual',
): {
  system: string
  campaigns: Array<{
    campaignId: string
    path: string
  }>
} {
  const campaigns =
    listCampaigns()
      .map((campaign) => ({
        campaignId: campaign.id,
        path: backupCampaignDatabase(
          campaign.id,
          reason,
        ),
      }))

  return {
    system:
      backupSystemDatabase(
        reason,
      ),
    campaigns,
  }
}

export function auditPersistence(): PersistenceAuditReport {
  const systemOk =
    databaseIsHealthy(
      systemDatabase,
    )

  const campaignReports: PersistenceAuditEntry[] = []

  for (const campaign of listCampaigns()) {
    let database: DatabaseSync | null = null

    try {
      database =
        openCampaignDatabase(
          campaign.id,
        )

      const ok =
        databaseIsHealthy(
          database,
        )

      campaignReports.push({
        id: campaign.id,
        ok,
        detail:
          ok
            ? 'ok'
            : 'PRAGMA quick_check failed.',
      })
    } catch (error) {
      campaignReports.push({
        id: campaign.id,
        ok: false,
        detail:
          error instanceof Error
            ? error.message
            : 'Unknown persistence error.',
      })
    } finally {
      database?.close()
    }
  }

  return {
    ok:
      systemOk &&
      campaignReports.every(
        (entry) => entry.ok,
      ),
    system: {
      id: 'system',
      ok: systemOk,
      detail:
        systemOk
          ? 'ok'
          : 'PRAGMA quick_check failed.',
    },
    campaigns: campaignReports,
  }
}

let storeClosed = false

export function closeStore(): void {
  if (storeClosed) return

  checkpointDatabase(
    systemDatabase,
  )

  systemDatabase.close()
  storeClosed = true
}

