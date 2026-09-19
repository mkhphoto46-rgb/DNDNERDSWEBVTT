import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

import {
  SYSTEM_DATABASE_PATH,
  campaignDatabasePath,
  ensureBaseDirectories,
  ensureCampaignDirectories,
} from './paths'

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
  name: string
  created_at: string
  last_seen_at: string
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
`)

function now(): string {
  return new Date().toISOString()
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
      Math.floor(
        Math.random() *
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
      updated_at TEXT NOT NULL
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
      last_seen_at TEXT NOT NULL
    ) STRICT;
  `)

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
        updated_at
      )
      VALUES (
        1,
        ?,
        ?
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

  const row =
    database.prepare(`
      SELECT state_json
      FROM session_state
      WHERE id = 1
    `).get() as unknown as
      | {
          state_json: string
        }
      | undefined

  database.close()

  if (!row) {
    return {}
  }

  return JSON.parse(
    row.state_json,
  )
}

export function saveCampaignState(
  campaignId: string,
  state: unknown,
): void {
  const database =
    openCampaignDatabase(
      campaignId,
    )

  const timestamp =
    now()

  database.prepare(`
    INSERT INTO session_state (
      id,
      state_json,
      updated_at
    )
    VALUES (
      1,
      ?,
      ?
    )
    ON CONFLICT(id)
    DO UPDATE SET
      state_json = excluded.state_json,
      updated_at = excluded.updated_at
  `).run(
    JSON.stringify(
      state,
    ),
    timestamp,
  )

  database.close()

  systemDatabase.prepare(`
    UPDATE campaigns
    SET updated_at = ?
    WHERE id = ?
  `).run(
    timestamp,
    campaignId,
  )
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
  const database =
    openCampaignDatabase(
      campaignId,
    )

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
    database.close()

    throw new Error(
      'Snapshot not found.',
    )
  }

  createSnapshotInDatabase(
    database,
    'Automatic Backup Before Restore',
  )

  database.prepare(`
    UPDATE session_state
    SET
      state_json = ?,
      updated_at = ?
    WHERE id = 1
  `).run(
    snapshot.state_json,
    now(),
  )

  database.close()

  touchCampaign(
    campaignId,
  )
}

export function registerOrResumePlayer(
  campaignId: string,
  rawPlayerKey: string,
  rawName: string,
): PlayerRecord {
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
        name,
        created_at,
        last_seen_at
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

  if (existing) {
    database.prepare(`
      UPDATE players
      SET
        name = ?,
        last_seen_at = ?
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