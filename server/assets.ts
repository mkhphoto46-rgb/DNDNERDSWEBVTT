import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  campaignDatabasePath,
  campaignRoot,
  ensureCampaignDirectories,
} from './paths'

import {
  getCampaign,
} from './store'

export type AssetType =
  | 'map'
  | 'token'
  | 'avatar'
  | 'handout'
  | 'audio'

export interface AssetRecord {
  id: string
  assetType: AssetType
  displayName: string
  relativePath: string
  contentHash: string
  byteSize: number
  mimeType: string
  updatedAt: string
  url: string
}

interface AssetRow {
  id: string
  asset_type: AssetType
  display_name: string
  relative_path: string
  content_hash: string
  byte_size: number
  mime_type: string
  updated_at: string
}

const MIME_EXTENSION_MAP:
  Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
  }

function now(): string {
  return new Date()
    .toISOString()
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

  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS asset_manifest (
      id TEXT PRIMARY KEY,
      asset_type TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
  `)

  ensureAssetColumns(
    database,
  )

  return database
}

function ensureAssetColumns(
  database: DatabaseSync,
): void {
  const columns =
    database.prepare(`
      PRAGMA table_info(asset_manifest)
    `).all() as unknown as Array<{
      name: string
    }>

  const existingColumns =
    new Set(
      columns.map(
        (column) =>
          column.name,
      ),
    )

  if (
    !existingColumns.has(
      'display_name',
    )
  ) {
    database.exec(`
      ALTER TABLE asset_manifest
      ADD COLUMN display_name TEXT
      NOT NULL DEFAULT '';
    `)
  }

  if (
    !existingColumns.has(
      'mime_type',
    )
  ) {
    database.exec(`
      ALTER TABLE asset_manifest
      ADD COLUMN mime_type TEXT
      NOT NULL DEFAULT
      'application/octet-stream';
    `)
  }
}

function safeBaseName(
  originalName: string,
): string {
  const parsed =
    path.parse(
      originalName,
    )

  const cleaned =
    parsed.name
      .normalize('NFKD')
      .replace(
        /[^a-zA-Z0-9_-]+/g,
        '-',
      )
      .replace(
        /-+/g,
        '-',
      )
      .replace(
        /^[-_]+|[-_]+$/g,
        '',
      )
      .slice(
        0,
        70,
      )

  return (
    cleaned ||
    'map'
  )
}

function assetToUrl(
  campaignId: string,
  assetId: string,
): string {
  return (
    '/campaign-assets/' +
    encodeURIComponent(
      campaignId,
    ) +
    '/' +
    encodeURIComponent(
      assetId,
    )
  )
}

function rowToAsset(
  campaignId: string,
  row: AssetRow,
): AssetRecord {
  return {
    id:
      row.id,

    assetType:
      row.asset_type,

    displayName:
      row.display_name,

    relativePath:
      row.relative_path,

    contentHash:
      row.content_hash,

    byteSize:
      Number(
        row.byte_size,
      ),

    mimeType:
      row.mime_type,

    updatedAt:
      row.updated_at,

    url:
      assetToUrl(
        campaignId,
        row.id,
      ),
  }
}

export function saveMapAsset(
  campaignId: string,
  originalName: string,
  mimeType: string,
  buffer: Buffer,
): AssetRecord {
  const extension =
    MIME_EXTENSION_MAP[
      mimeType
    ]

  if (!extension) {
    throw new Error(
      'Only PNG, JPG and WEBP maps are allowed.',
    )
  }

  if (
    buffer.length < 1
  ) {
    throw new Error(
      'Uploaded map is empty.',
    )
  }

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

  const contentHash =
    crypto
      .createHash(
        'sha256',
      )
      .update(
        buffer,
      )
      .digest(
        'hex',
      )

  const shortHash =
    contentHash.slice(
      0,
      20,
    )

  const assetId =
    'map_' +
    shortHash

  const displayName =
    originalName
      .trim()
      .slice(
        0,
        150,
      ) ||
    'Map'

  const filename =
    safeBaseName(
      originalName,
    ) +
    '-' +
    shortHash +
    extension

  const mapsDirectory =
    path.join(
      campaignRoot(
        campaignId,
      ),
      'maps',
    )

  fs.mkdirSync(
    mapsDirectory,
    {
      recursive: true,
    },
  )

  const absolutePath =
    path.join(
      mapsDirectory,
      filename,
    )

  if (
    !fs.existsSync(
      absolutePath,
    )
  ) {
    fs.writeFileSync(
      absolutePath,
      buffer,
    )
  }

  const relativePath =
    (
      'maps/' +
      filename
    )

  const updatedAt =
    now()

  const database =
    openCampaignDatabase(
      campaignId,
    )

  database.prepare(`
    INSERT INTO asset_manifest (
      id,
      asset_type,
      display_name,
      relative_path,
      content_hash,
      byte_size,
      mime_type,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)

    ON CONFLICT(id)
    DO UPDATE SET
      asset_type =
        excluded.asset_type,

      display_name =
        excluded.display_name,

      relative_path =
        excluded.relative_path,

      content_hash =
        excluded.content_hash,

      byte_size =
        excluded.byte_size,

      mime_type =
        excluded.mime_type,

      updated_at =
        excluded.updated_at
  `).run(
    assetId,
    'map',
    displayName,
    relativePath,
    contentHash,
    buffer.length,
    mimeType,
    updatedAt,
  )

  database.close()

  return {
    id:
      assetId,

    assetType:
      'map',

    displayName,

    relativePath,

    contentHash,

    byteSize:
      buffer.length,

    mimeType,

    updatedAt,

    url:
      assetToUrl(
        campaignId,
        assetId,
      ),
  }
}

export function listAssets(
  campaignId: string,
  assetType?: AssetType,
): AssetRecord[] {
  const database =
    openCampaignDatabase(
      campaignId,
    )

  let rows:
    AssetRow[]

  if (assetType) {
    rows =
      database.prepare(`
        SELECT
          id,
          asset_type,
          display_name,
          relative_path,
          content_hash,
          byte_size,
          mime_type,
          updated_at
        FROM asset_manifest
        WHERE asset_type = ?
        ORDER BY updated_at DESC
      `).all(
        assetType,
      ) as unknown as AssetRow[]
  } else {
    rows =
      database.prepare(`
        SELECT
          id,
          asset_type,
          display_name,
          relative_path,
          content_hash,
          byte_size,
          mime_type,
          updated_at
        FROM asset_manifest
        ORDER BY updated_at DESC
      `).all() as unknown as AssetRow[]
  }

  database.close()

  return rows.map(
    (row) =>
      rowToAsset(
        campaignId,
        row,
      ),
  )
}

export function getAsset(
  campaignId: string,
  assetId: string,
): AssetRecord | null {
  const database =
    openCampaignDatabase(
      campaignId,
    )

  const row =
    database.prepare(`
      SELECT
        id,
        asset_type,
        display_name,
        relative_path,
        content_hash,
        byte_size,
        mime_type,
        updated_at
      FROM asset_manifest
      WHERE id = ?
      LIMIT 1
    `).get(
      assetId,
    ) as unknown as
      | AssetRow
      | undefined

  database.close()

  if (!row) {
    return null
  }

  return rowToAsset(
    campaignId,
    row,
  )
}

export function getAssetAbsolutePath(
  campaignId: string,
  asset: AssetRecord,
): string {
  const root =
    path.resolve(
      campaignRoot(
        campaignId,
      ),
    )

  const absolute =
    path.resolve(
      root,
      asset.relativePath,
    )

  const expectedPrefix =
    root +
    path.sep

  if (
    !absolute.startsWith(
      expectedPrefix,
    )
  ) {
    throw new Error(
      'Invalid asset path.',
    )
  }

  return absolute
}