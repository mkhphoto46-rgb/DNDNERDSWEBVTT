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

interface CampaignRow {
  id: string
  name: string
  join_code: string
  created_at: string
  updated_at: string
  last_opened_at: string | null
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

function createCampaignId(): string {
  return (
    'camp_' +
    randomBytes(6)
      .toString('hex')
  )
}

const JOIN_CHARACTERS =
  'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function randomJoinCode(): string {
  let result = ''

  for (let index = 0; index < 6; index += 1) {
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
      statement.get(code)

    if (!existing) {
      return code
    }
  }

  throw new Error(
    'Could not generate a unique campaign join code.',
  )
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
  `)

  const metadataInsert =
    database.prepare(`
      INSERT OR REPLACE
      INTO metadata (
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

  database.close()
}

export function createCampaign(
  rawName: string,
): CampaignRecord {
  const name =
    rawName.trim()

  if (name.length < 1) {
    throw new Error(
      'Campaign name is required.',
    )
  }

  if (name.length > 80) {
    throw new Error(
      'Campaign name must be 80 characters or fewer.',
    )
  }

  const timestamp =
    now()

  const campaign: CampaignRecord = {
    id: createCampaignId(),
    name,
    joinCode:
      createUniqueJoinCode(),
    createdAt: timestamp,
    updatedAt: timestamp,
    lastOpenedAt: null,
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
    ? campaignFromRow(row)
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
    ? campaignFromRow(row)
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
  const campaign =
    getCampaign(campaignId)

  if (!campaign) {
    throw new Error(
      'Campaign not found.',
    )
  }

  const database =
    new DatabaseSync(
      campaignDatabasePath(
        campaignId,
      ),
      {
        timeout: 5000,
      },
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
  const campaign =
    getCampaign(campaignId)

  if (!campaign) {
    throw new Error(
      'Campaign not found.',
    )
  }

  const database =
    new DatabaseSync(
      campaignDatabasePath(
        campaignId,
      ),
      {
        timeout: 5000,
      },
    )

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
    JSON.stringify(state),
    now(),
  )

  database.close()

  const timestamp =
    now()

  systemDatabase.prepare(`
    UPDATE campaigns
    SET updated_at = ?
    WHERE id = ?
  `).run(
    timestamp,
    campaignId,
  )
}