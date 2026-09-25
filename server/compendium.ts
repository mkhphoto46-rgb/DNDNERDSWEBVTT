import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  MONSTER_COMPENDIUM_DATABASE_PATH,
  ensureBaseDirectories,
} from './paths'

import {
  monsterPortraitUrl,
} from './monsterPortraits'

const DATASET_VERSION = 'srd-5.2.1-adkinn-1.4.0'
const DATASET_SOURCE = 'D&D SRD 5.2.1 / CC-BY-4.0'
const PACKAGE_DATA_PATH = '@adkinn/fifth-edition-srd-mcp/data/monsters.json'

interface SourceMonster {
  id?: unknown
  name?: unknown
  size?: unknown
  type?: unknown
  cr?: unknown
  cr_numeric?: unknown
  armor_class?: unknown
  hp_max?: unknown
  hp_formula?: unknown
  initiative_modifier?: unknown
  source?: unknown
  attribution?: unknown
  stat_block_json?: unknown
}

interface SourceDocument {
  _license?: unknown
  monsters?: unknown
}

interface MonsterRow {
  id: string
  name: string
  size: string
  type: string
  cr: string
  cr_numeric: number
  armor_class: number
  hp_max: number
  hp_formula: string
  initiative_modifier: number
  source: string
  attribution: string
  stat_block_json: string
}

export interface CompendiumMonsterSummary {
  id: string
  name: string
  size: string
  type: string
  cr: string
  crNumeric: number
  armorClass: number
  hitPoints: number
  hitPointFormula: string
  initiativeModifier: number
  source: string
  portraitUrl: string | null
}

export interface CompendiumMonster extends CompendiumMonsterSummary {
  attribution: string
  statBlock: Record<string, unknown>
}

export interface MonsterCompendiumStatus {
  ready: boolean
  count: number
  source: string
  version: string
  databasePath: string
  error?: string
}

ensureBaseDirectories()

const database = new DatabaseSync(
  MONSTER_COMPENDIUM_DATABASE_PATH,
  { timeout: 5000 },
)

database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS monsters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_lower TEXT NOT NULL,
    size TEXT NOT NULL,
    type TEXT NOT NULL,
    cr TEXT NOT NULL,
    cr_numeric REAL NOT NULL,
    armor_class INTEGER NOT NULL,
    hp_max INTEGER NOT NULL,
    hp_formula TEXT NOT NULL,
    initiative_modifier INTEGER NOT NULL,
    source TEXT NOT NULL,
    attribution TEXT NOT NULL,
    search_text TEXT NOT NULL,
    stat_block_json TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_monsters_name_lower
    ON monsters(name_lower);

  CREATE INDEX IF NOT EXISTS idx_monsters_type
    ON monsters(type);

  CREATE INDEX IF NOT EXISTS idx_monsters_size
    ON monsters(size);

  CREATE INDEX IF NOT EXISTS idx_monsters_cr_numeric
    ON monsters(cr_numeric);
`)

let startupError: string | undefined

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : fallback
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function metadata(key: string): string | null {
  const row = database.prepare(`
    SELECT value
    FROM metadata
    WHERE key = ?
    LIMIT 1
  `).get(key) as { value?: unknown } | undefined

  return typeof row?.value === 'string'
    ? row.value
    : null
}

function setMetadata(key: string, value: string): void {
  database.prepare(`
    INSERT INTO metadata (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value)
}

function monsterCount(): number {
  const row = database.prepare(`
    SELECT COUNT(*) AS count
    FROM monsters
  `).get() as { count?: unknown } | undefined

  return Math.max(0, Math.round(numberValue(row?.count, 0)))
}

function resolveDatasetPath(): string {
  const override = String(process.env.DND_VTT_MONSTER_DATA_PATH ?? '').trim()

  if (override) {
    const absolute = path.resolve(override)

    if (!fs.existsSync(absolute)) {
      throw new Error(`Monster dataset override not found: ${absolute}`)
    }

    return absolute
  }

  const require = createRequire(import.meta.url)

  try {
    return require.resolve(PACKAGE_DATA_PATH)
  } catch {
    throw new Error(
      'SRD monster dataset package is not installed. Run: npm.cmd install --save-exact @adkinn/fifth-edition-srd-mcp@1.4.0',
    )
  }
}

function readDataset(): {
  license: string
  monsters: SourceMonster[]
} {
  const datasetPath = resolveDatasetPath()
  const parsed = JSON.parse(fs.readFileSync(datasetPath, 'utf8')) as SourceDocument

  if (!Array.isArray(parsed.monsters)) {
    throw new Error('SRD monster dataset is malformed: monsters[] is missing.')
  }

  return {
    license: stringValue(parsed._license, DATASET_SOURCE),
    monsters: parsed.monsters.filter(
      (entry): entry is SourceMonster => Boolean(entry && typeof entry === 'object'),
    ),
  }
}

function importDataset(): void {
  const dataset = readDataset()

  const insert = database.prepare(`
    INSERT INTO monsters (
      id,
      name,
      name_lower,
      size,
      type,
      cr,
      cr_numeric,
      armor_class,
      hp_max,
      hp_formula,
      initiative_modifier,
      source,
      attribution,
      search_text,
      stat_block_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  database.exec('BEGIN IMMEDIATE;')

  try {
    database.exec('DELETE FROM monsters;')

    for (const raw of dataset.monsters) {
      const id = stringValue(raw.id)
      const name = stringValue(raw.name)

      if (!id || !name) continue

      const size = stringValue(raw.size, 'Unknown')
      const type = stringValue(raw.type, 'unknown')
      const cr = stringValue(raw.cr, '0')
      const crNumeric = numberValue(raw.cr_numeric, numberValue(cr, 0))
      const armorClass = Math.max(0, Math.round(numberValue(raw.armor_class, 10)))
      const hitPoints = Math.max(1, Math.round(numberValue(raw.hp_max, 1)))
      const hitPointFormula = stringValue(raw.hp_formula)
      const initiativeModifier = Math.round(numberValue(raw.initiative_modifier, 0))
      const source = stringValue(raw.source, 'srd-5.2.1')
      const attribution = stringValue(raw.attribution, 'SRD 5.2.1 / CC-BY 4.0')
      const statBlock =
        raw.stat_block_json && typeof raw.stat_block_json === 'object'
          ? raw.stat_block_json
          : {}

      const searchText = [
        name,
        type,
        size,
        cr,
        source,
      ].join(' ').toLowerCase()

      insert.run(
        id,
        name,
        name.toLowerCase(),
        size,
        type.toLowerCase(),
        cr,
        crNumeric,
        armorClass,
        hitPoints,
        hitPointFormula,
        initiativeModifier,
        source,
        attribution,
        searchText,
        JSON.stringify(statBlock),
      )
    }

    setMetadata('dataset_version', DATASET_VERSION)
    setMetadata('dataset_source', DATASET_SOURCE)
    setMetadata('dataset_license', dataset.license)
    setMetadata('imported_at', new Date().toISOString())

    database.exec('COMMIT;')
  } catch (error) {
    database.exec('ROLLBACK;')
    throw error
  }
}

export function ensureMonsterCompendium(): MonsterCompendiumStatus {
  startupError = undefined

  try {
    const count = monsterCount()
    const version = metadata('dataset_version')

    if (count === 0 || version !== DATASET_VERSION) {
      importDataset()
    }
  } catch (error) {
    startupError = error instanceof Error
      ? error.message
      : 'Could not initialize the local monster compendium.'
  }

  return getMonsterCompendiumStatus()
}

export function getMonsterCompendiumStatus(): MonsterCompendiumStatus {
  const count = monsterCount()

  return {
    ready: count > 0,
    count,
    source: metadata('dataset_source') ?? DATASET_SOURCE,
    version: metadata('dataset_version') ?? DATASET_VERSION,
    databasePath: MONSTER_COMPENDIUM_DATABASE_PATH,
    ...(startupError ? { error: startupError } : {}),
  }
}

function summaryFromRow(row: MonsterRow): CompendiumMonsterSummary {
  return {
    id: row.id,
    name: row.name,
    size: row.size,
    type: row.type,
    cr: row.cr,
    crNumeric: row.cr_numeric,
    armorClass: row.armor_class,
    hitPoints: row.hp_max,
    hitPointFormula: row.hp_formula,
    initiativeModifier: row.initiative_modifier,
    source: row.source,
    portraitUrl: monsterPortraitUrl(row.id),
  }
}

export function searchMonsters(options: {
  query?: string
  type?: string
  size?: string
  cr?: string
  limit?: number
}): CompendiumMonsterSummary[] {
  const clauses: string[] = []
  const values: Array<string | number> = []

  const query = String(options.query ?? '').trim().toLowerCase()
  const type = String(options.type ?? '').trim().toLowerCase()
  const size = String(options.size ?? '').trim().toLowerCase()
  const cr = String(options.cr ?? '').trim()
  const limit = Math.max(1, Math.min(200, Math.round(Number(options.limit) || 80)))

  if (query) {
    const terms = query.split(/\s+/).filter(Boolean).slice(0, 8)

    for (const term of terms) {
      clauses.push('search_text LIKE ?')
      values.push(`%${term}%`)
    }
  }

  if (type) {
    clauses.push('type = ?')
    values.push(type)
  }

  if (size) {
    clauses.push('LOWER(size) = ?')
    values.push(size)
  }

  if (cr) {
    clauses.push('cr = ?')
    values.push(cr)
  }

  const where = clauses.length > 0
    ? `WHERE ${clauses.join(' AND ')}`
    : ''

  const rows = database.prepare(`
    SELECT
      id,
      name,
      size,
      type,
      cr,
      cr_numeric,
      armor_class,
      hp_max,
      hp_formula,
      initiative_modifier,
      source,
      attribution,
      stat_block_json
    FROM monsters
    ${where}
    ORDER BY
      CASE WHEN name_lower = ? THEN 0 ELSE 1 END,
      cr_numeric ASC,
      name COLLATE NOCASE ASC
    LIMIT ?
  `).all(...values, query, limit) as unknown as MonsterRow[]

  return rows.map(summaryFromRow)
}

export function getMonsterById(id: string): CompendiumMonster | null {
  const row = database.prepare(`
    SELECT
      id,
      name,
      size,
      type,
      cr,
      cr_numeric,
      armor_class,
      hp_max,
      hp_formula,
      initiative_modifier,
      source,
      attribution,
      stat_block_json
    FROM monsters
    WHERE id = ?
    LIMIT 1
  `).get(id) as unknown as MonsterRow | undefined

  if (!row) return null

  let statBlock: Record<string, unknown> = {}

  try {
    const parsed = JSON.parse(row.stat_block_json)
    statBlock = parsed && typeof parsed === 'object'
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    statBlock = {}
  }

  return {
    ...summaryFromRow(row),
    attribution: row.attribution,
    statBlock,
  }
}

export function getCompendiumLicense(): string {
  return metadata('dataset_license') ?? DATASET_SOURCE
}
