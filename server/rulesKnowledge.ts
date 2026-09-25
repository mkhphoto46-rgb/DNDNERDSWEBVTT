import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { RULES_KNOWLEDGE_DATABASE_PATH } from './paths'

export interface RulesKnowledgeSource {
  id: string
  title: string
  filename: string
  publicationYear: number | null
  rulesVersion: string
  sourceKind: string
  sourcePriority: number
}

export interface RulesKnowledgeCategory {
  id: string
  label: string
  count: number
}

export interface RulesKnowledgeSearchResult {
  id: string
  canonicalId: string
  name: string
  category: string
  subcategory: string
  summary: string
  structured: Record<string, unknown>
  sourceId: string
  sourceTitle: string
  sourceFilename: string
  publicationYear: number | null
  rulesVersion: string
  sourcePriority: number
  pageStart: number | null
  pageEnd: number | null
  status: string
  confidence: number
}

function openDatabase(): DatabaseSync | null {
  if (!fs.existsSync(RULES_KNOWLEDGE_DATABASE_PATH)) return null
  return new DatabaseSync(RULES_KNOWLEDGE_DATABASE_PATH, { readOnly: true, timeout: 5000 })
}

function safeTerms(query: string): string[] {
  return String(query ?? '')
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]{2,}/gu)
    ?.slice(0, 12) ?? []
}

function rowToResult(row: Record<string, unknown>): RulesKnowledgeSearchResult {
  let structured: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(String(row.structured_json ?? '{}')) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      structured = parsed as Record<string, unknown>
    }
  } catch {
    structured = {}
  }

  return {
    id: String(row.id),
    canonicalId: String(row.canonical_id),
    name: String(row.name),
    category: String(row.category),
    subcategory: String(row.subcategory ?? ''),
    summary: String(row.summary ?? ''),
    structured,
    sourceId: String(row.source_id),
    sourceTitle: String(row.source_title),
    sourceFilename: String(row.source_filename),
    publicationYear: Number.isFinite(Number(row.publication_year)) ? Number(row.publication_year) : null,
    rulesVersion: String(row.rules_version),
    sourcePriority: Number(row.source_priority),
    pageStart: Number.isFinite(Number(row.source_page_start)) ? Number(row.source_page_start) : null,
    pageEnd: Number.isFinite(Number(row.source_page_end)) ? Number(row.source_page_end) : null,
    status: String(row.status),
    confidence: Number(row.confidence),
  }
}

export function rulesKnowledgeStatus() {
  const database = openDatabase()
  if (!database) {
    return {
      ready: false,
      sourceCount: 0,
      entityCount: 0,
      validatedCount: 0,
      extractedCount: 0,
      sources: [] as RulesKnowledgeSource[],
      categories: [] as RulesKnowledgeCategory[],
    }
  }

  try {
    const counts = database.prepare(`
      SELECT
        COUNT(*) AS entity_count,
        SUM(CASE WHEN status='validated' THEN 1 ELSE 0 END) AS validated_count,
        SUM(CASE WHEN status='extracted' THEN 1 ELSE 0 END) AS extracted_count
      FROM current_entity_versions
    `).get() as Record<string, unknown>

    const sources = (database.prepare(`
      SELECT id,title,filename,publication_year,rules_version,source_kind,source_priority
      FROM sources
      WHERE current_revision_id IS NOT NULL
      ORDER BY source_priority DESC, COALESCE(publication_year,0) DESC, title COLLATE NOCASE
    `).all() as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      title: String(row.title),
      filename: String(row.filename),
      publicationYear: Number.isFinite(Number(row.publication_year)) ? Number(row.publication_year) : null,
      rulesVersion: String(row.rules_version),
      sourceKind: String(row.source_kind),
      sourcePriority: Number(row.source_priority),
    }))

    const categories = (database.prepare(`
      SELECT c.id,c.label,COUNT(ev.id) AS entity_count
      FROM category_catalog c
      LEFT JOIN current_entity_versions ev ON ev.category=c.id
      GROUP BY c.id,c.label
      ORDER BY CASE WHEN COUNT(ev.id)>0 THEN 0 ELSE 1 END, COUNT(ev.id) DESC, c.label
    `).all() as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      label: String(row.label),
      count: Number(row.entity_count),
    }))

    return {
      ready: true,
      sourceCount: sources.length,
      entityCount: Number(counts.entity_count ?? 0),
      validatedCount: Number(counts.validated_count ?? 0),
      extractedCount: Number(counts.extracted_count ?? 0),
      sources,
      categories,
    }
  } finally {
    database.close()
  }
}

export function searchRulesKnowledge(
  query: string,
  category = '',
  sourceId = '',
  rulesVersion = '',
  status = '',
  limit = 80,
): RulesKnowledgeSearchResult[] {
  const database = openDatabase()
  if (!database) return []

  const boundedLimit = Math.max(1, Math.min(200, Math.trunc(limit) || 80))
  const terms = safeTerms(query)

  try {
    if (terms.length) {
      const match = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' AND ')
      const rows = database.prepare(`
        SELECT
          ev.id,ev.canonical_id,ev.name,ev.category,ev.subcategory,ev.summary,ev.structured_json,
          ev.source_id,s.title AS source_title,s.filename AS source_filename,s.publication_year,
          ev.rules_version,ev.source_priority,ev.source_page_start,ev.source_page_end,ev.status,ev.confidence
        FROM entity_fts
        JOIN entity_versions ev ON ev.id=entity_fts.entity_version_id
        JOIN sources s ON s.id=ev.source_id
        WHERE entity_fts MATCH ?
          AND ev.revision_id=s.current_revision_id
          AND (?='' OR ev.category=?)
          AND (?='' OR ev.source_id=?)
          AND (?='' OR ev.rules_version=?)
          AND (?='' OR ev.status=?)
        ORDER BY
          CASE ev.rules_version WHEN '2024' THEN 0 ELSE 1 END,
          ev.source_priority DESC,
          bm25(entity_fts),
          ev.name COLLATE NOCASE
        LIMIT ?
      `).all(
        match,
        category, category,
        sourceId, sourceId,
        rulesVersion, rulesVersion,
        status, status,
        boundedLimit,
      ) as Array<Record<string, unknown>>
      return rows.map(rowToResult)
    }

    const rows = database.prepare(`
      SELECT
        ev.id,ev.canonical_id,ev.name,ev.category,ev.subcategory,ev.summary,ev.structured_json,
        ev.source_id,s.title AS source_title,s.filename AS source_filename,s.publication_year,
        ev.rules_version,ev.source_priority,ev.source_page_start,ev.source_page_end,ev.status,ev.confidence
      FROM current_entity_versions ev
      JOIN sources s ON s.id=ev.source_id
      WHERE (?='' OR ev.category=?)
        AND (?='' OR ev.source_id=?)
        AND (?='' OR ev.rules_version=?)
        AND (?='' OR ev.status=?)
      ORDER BY
        CASE ev.rules_version WHEN '2024' THEN 0 ELSE 1 END,
        ev.source_priority DESC,
        ev.name COLLATE NOCASE
      LIMIT ?
    `).all(
      category, category,
      sourceId, sourceId,
      rulesVersion, rulesVersion,
      status, status,
      boundedLimit,
    ) as Array<Record<string, unknown>>
    return rows.map(rowToResult)
  } finally {
    database.close()
  }
}

export interface CharacterCatalogOption {
  id: string
  name: string
  rulesVersion: string
  sourceId: string
  sourceTitle: string
  sourcePage: number | null
}

export interface CharacterSubclassCatalogOption extends CharacterCatalogOption {
  className: string
}

export interface CharacterCatalogPayload {
  ready: boolean
  classes: CharacterCatalogOption[]
  subclasses: CharacterSubclassCatalogOption[]
  species: CharacterCatalogOption[]
  backgrounds: CharacterCatalogOption[]
}

export interface BackendCatalogFamily {
  id: string
  label: string
  count: number
}

export interface BackendCatalogStatus {
  ready: boolean
  totalRecords: number
  families: BackendCatalogFamily[]
}

export interface BackendCatalogEntry {
  id: string
  name: string
  family: string
  category: string
  subcategory: string
  rulesVersion: string
  sourceId: string
  sourceTitle: string
  sourcePage: number | null
  validationScope: string
  summary: string
  structured: Record<string, unknown>
}

interface BackendCatalogSpec {
  id: string
  label: string
  table: string
  idColumn: string
  nameColumn: string
  categoryExpression: string
  subcategoryExpression: string
  rulesVersionColumn: string
  sourceIdColumn: string
  sourceTitleColumn: string
  sourcePageExpression: string
  validationScopeExpression: string
  entityVersionExpression: string
}

const BACKEND_CATALOG_SPECS: readonly BackendCatalogSpec[] = [
  {
    id: 'core-rules',
    label: 'Core Rules',
    table: 'core_rule_registry',
    idColumn: 'concept_id',
    nameColumn: 'concept_name',
    categoryExpression: "COALESCE(r.core_category,'Core Rule')",
    subcategoryExpression: "''",
    rulesVersionColumn: 'rules_version',
    sourceIdColumn: 'source_id',
    sourceTitleColumn: 'source_title',
    sourcePageExpression: 'source_page_start',
    validationScopeExpression: 'validation_status',
    entityVersionExpression: 'effective_entity_version_id',
  },
  {
    id: 'classes',
    label: 'Classes',
    table: 'class_registry',
    idColumn: 'class_id',
    nameColumn: 'class_name',
    categoryExpression: "'Class'",
    subcategoryExpression: "''",
    rulesVersionColumn: 'rules_version',
    sourceIdColumn: 'source_id',
    sourceTitleColumn: 'source_title',
    sourcePageExpression: 'source_page',
    validationScopeExpression: 'validation_scope',
    entityVersionExpression: 'entity_version_id',
  },
  {
    id: 'subclasses',
    label: 'Subclasses',
    table: 'subclass_registry',
    idColumn: 'subclass_id',
    nameColumn: 'subclass_name',
    categoryExpression: "'Subclass'",
    subcategoryExpression: 'class_name',
    rulesVersionColumn: 'rules_version',
    sourceIdColumn: 'source_id',
    sourceTitleColumn: 'source_title',
    sourcePageExpression: 'source_page',
    validationScopeExpression: 'validation_scope',
    entityVersionExpression: 'entity_version_id',
  },
  {
    id: 'species',
    label: 'Species',
    table: 'species_registry',
    idColumn: 'species_id',
    nameColumn: 'species_name',
    categoryExpression: "'Species'",
    subcategoryExpression: "''",
    rulesVersionColumn: 'rules_version',
    sourceIdColumn: 'source_id',
    sourceTitleColumn: 'source_title',
    sourcePageExpression: 'source_page',
    validationScopeExpression: 'validation_scope',
    entityVersionExpression: 'entity_version_id',
  },
  {
    id: 'backgrounds',
    label: 'Backgrounds',
    table: 'background_registry',
    idColumn: 'background_id',
    nameColumn: 'background_name',
    categoryExpression: "'Background'",
    subcategoryExpression: "''",
    rulesVersionColumn: 'rules_version',
    sourceIdColumn: 'source_id',
    sourceTitleColumn: 'source_title',
    sourcePageExpression: 'source_page',
    validationScopeExpression: 'validation_scope',
    entityVersionExpression: 'entity_version_id',
  },
  {
    id: 'feats',
    label: 'Feats',
    table: 'feat_registry',
    idColumn: 'feat_id',
    nameColumn: 'feat_name',
    categoryExpression: "COALESCE(r.feat_type,'Feat')",
    subcategoryExpression: "''",
    rulesVersionColumn: 'rules_version',
    sourceIdColumn: 'source_id',
    sourceTitleColumn: 'source_title',
    sourcePageExpression: 'source_page',
    validationScopeExpression: 'validation_scope',
    entityVersionExpression: 'entity_version_id',
  },
  {
    id: 'class-features',
    label: 'Class Features',
    table: 'class_feature_registry',
    idColumn: 'feature_id',
    nameColumn: 'feature_name',
    categoryExpression: "COALESCE(r.class_name,'Class Feature')",
    subcategoryExpression: "CASE WHEN COALESCE(r.subclass_name,'')<>'' THEN r.subclass_name ELSE 'Level ' || r.feature_level END",
    rulesVersionColumn: 'rules_version',
    sourceIdColumn: 'source_id',
    sourceTitleColumn: 'source_title',
    sourcePageExpression: 'source_page',
    validationScopeExpression: 'validation_scope',
    entityVersionExpression: 'entity_version_id',
  },
  {
    id: 'spells',
    label: 'Runtime Spells',
    table: 'spell_registry',
    idColumn: 'spell_id',
    nameColumn: 'spell_name',
    categoryExpression: "COALESCE(r.category,'Spell')",
    subcategoryExpression: "'Level ' || r.spell_level",
    rulesVersionColumn: 'rules_version',
    sourceIdColumn: 'source_id',
    sourceTitleColumn: 'source_title',
    sourcePageExpression: 'NULL',
    validationScopeExpression: 'validation_scope',
    entityVersionExpression: 'entity_version_id',
  },
  {
    id: 'book-spells',
    label: 'Book Spells',
    table: 'book_spell_registry',
    idColumn: 'book_spell_id',
    nameColumn: 'spell_name',
    categoryExpression: "COALESCE(r.category,'Spell')",
    subcategoryExpression: "'Level ' || r.spell_level",
    rulesVersionColumn: 'rules_version',
    sourceIdColumn: 'source_id',
    sourceTitleColumn: 'source_title',
    sourcePageExpression: 'source_page',
    validationScopeExpression: 'validation_scope',
    entityVersionExpression: 'entity_version_id',
  },
  {
    id: 'equipment',
    label: 'Equipment',
    table: 'equipment_registry',
    idColumn: 'equipment_id',
    nameColumn: 'item_name',
    categoryExpression: "COALESCE(r.item_category,'Equipment')",
    subcategoryExpression: "''",
    rulesVersionColumn: 'rules_version',
    sourceIdColumn: 'source_id',
    sourceTitleColumn: 'source_title',
    sourcePageExpression: 'NULL',
    validationScopeExpression: 'validation_scope',
    entityVersionExpression: 'entity_version_id',
  },
  {
    id: 'magic-items',
    label: 'Runtime Magic Items',
    table: 'magic_item_registry',
    idColumn: 'magic_item_id',
    nameColumn: 'item_name',
    categoryExpression: "'Magic Item'",
    subcategoryExpression: "'Runtime'",
    rulesVersionColumn: 'rules_version',
    sourceIdColumn: 'source_id',
    sourceTitleColumn: 'source_title',
    sourcePageExpression: 'NULL',
    validationScopeExpression: 'validation_scope',
    entityVersionExpression: 'entity_version_id',
  },
  {
    id: 'book-magic-items',
    label: 'Book Magic Items',
    table: 'book_magic_item_registry',
    idColumn: 'book_magic_item_id',
    nameColumn: 'item_name',
    categoryExpression: "'Magic Item'",
    subcategoryExpression: "'Book validated'",
    rulesVersionColumn: 'rules_version',
    sourceIdColumn: 'source_id',
    sourceTitleColumn: 'source_title',
    sourcePageExpression: 'source_page',
    validationScopeExpression: 'validation_scope',
    entityVersionExpression: 'entity_version_id',
  },
  {
    id: 'poisons',
    label: 'Runtime Poisons',
    table: 'poison_registry',
    idColumn: 'poison_id',
    nameColumn: 'poison_name',
    categoryExpression: "'Poison'",
    subcategoryExpression: "'Runtime'",
    rulesVersionColumn: 'rules_version',
    sourceIdColumn: 'source_id',
    sourceTitleColumn: 'source_title',
    sourcePageExpression: 'NULL',
    validationScopeExpression: 'validation_scope',
    entityVersionExpression: 'entity_version_id',
  },
  {
    id: 'book-poisons',
    label: 'Book Poisons',
    table: 'book_poison_registry',
    idColumn: 'book_poison_id',
    nameColumn: 'poison_name',
    categoryExpression: "'Poison'",
    subcategoryExpression: "'Book validated'",
    rulesVersionColumn: 'rules_version',
    sourceIdColumn: 'source_id',
    sourceTitleColumn: 'source_title',
    sourcePageExpression: 'source_page',
    validationScopeExpression: 'validation_scope',
    entityVersionExpression: 'entity_version_id',
  },
]

function databaseTableNames(database: DatabaseSync): Set<string> {
  return new Set(
    (database.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type='table'
    `).all() as Array<Record<string, unknown>>)
      .map((row) => String(row.name)),
  )
}

function parseStructuredJson(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) return {}

  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function catalogSpec(id: string): BackendCatalogSpec | null {
  return BACKEND_CATALOG_SPECS.find((spec) => spec.id === id) ?? null
}

export function characterCatalogOptions(
  rulesVersion = '2024',
): CharacterCatalogPayload {
  const database = openDatabase()
  if (!database) {
    return {
      ready: false,
      classes: [],
      subclasses: [],
      species: [],
      backgrounds: [],
    }
  }

  try {
    const tables = databaseTableNames(database)
    const version = String(rulesVersion ?? '').trim()

    const classRows = tables.has('class_registry')
      ? database.prepare(`
          SELECT
            class_id AS id,
            class_name AS name,
            rules_version,
            source_id,
            source_title,
            source_page
          FROM class_registry
          WHERE (?='' OR rules_version=?)
          ORDER BY class_name COLLATE NOCASE
        `).all(version, version) as Array<Record<string, unknown>>
      : []

    const subclassRows = tables.has('subclass_registry')
      ? database.prepare(`
          SELECT
            subclass_id AS id,
            subclass_name AS name,
            class_name,
            rules_version,
            source_id,
            source_title,
            source_page
          FROM subclass_registry
          WHERE (?='' OR rules_version=?)
          ORDER BY class_name COLLATE NOCASE, subclass_name COLLATE NOCASE
        `).all(version, version) as Array<Record<string, unknown>>
      : []

    const speciesRows = tables.has('species_registry')
      ? database.prepare(`
          SELECT
            species_id AS id,
            species_name AS name,
            rules_version,
            source_id,
            source_title,
            source_page
          FROM species_registry
          WHERE (?='' OR rules_version=?)
          ORDER BY species_name COLLATE NOCASE
        `).all(version, version) as Array<Record<string, unknown>>
      : []

    const backgroundRows = tables.has('background_registry')
      ? database.prepare(`
          SELECT
            background_id AS id,
            background_name AS name,
            rules_version,
            source_id,
            source_title,
            source_page
          FROM background_registry
          WHERE (?='' OR rules_version=?)
          ORDER BY background_name COLLATE NOCASE
        `).all(version, version) as Array<Record<string, unknown>>
      : []

    const toOption = (row: Record<string, unknown>): CharacterCatalogOption => ({
      id: String(row.id),
      name: String(row.name),
      rulesVersion: String(row.rules_version),
      sourceId: String(row.source_id),
      sourceTitle: String(row.source_title),
      sourcePage: Number.isFinite(Number(row.source_page))
        ? Number(row.source_page)
        : null,
    })

    return {
      ready: true,
      classes: classRows.map(toOption),
      subclasses: subclassRows.map((row) => ({
        ...toOption(row),
        className: String(row.class_name),
      })),
      species: speciesRows.map(toOption),
      backgrounds: backgroundRows.map(toOption),
    }
  } finally {
    database.close()
  }
}

export function backendCatalogStatus(): BackendCatalogStatus {
  const database = openDatabase()
  if (!database) {
    return {
      ready: false,
      totalRecords: 0,
      families: [],
    }
  }

  try {
    const tables = databaseTableNames(database)
    const families = BACKEND_CATALOG_SPECS
      .filter((spec) => tables.has(spec.table))
      .map((spec) => {
        const row = database.prepare(
          `SELECT COUNT(*) AS count FROM "${spec.table}"`,
        ).get() as Record<string, unknown>

        return {
          id: spec.id,
          label: spec.label,
          count: Number(row.count ?? 0),
        }
      })

    const phase8Count = tables.has('phase8_semantic_profiles')
      ? Number(
          (database.prepare(`
            SELECT COUNT(*) AS count
            FROM phase8_semantic_profiles
          `).get() as Record<string, unknown>).count ?? 0,
        )
      : 0

    if (tables.has('phase8_semantic_profiles')) {
      families.push({
        id: 'phase8-rules',
        label: 'Phase 8 Semantic Rules',
        count: phase8Count,
      })
    }

    return {
      ready: true,
      totalRecords: families.reduce((sum, family) => sum + family.count, 0),
      families,
    }
  } finally {
    database.close()
  }
}

export function searchBackendCatalog(
  family: string,
  query = '',
  rulesVersion = '',
  limit = 120,
): BackendCatalogEntry[] {
  const database = openDatabase()
  if (!database) return []

  const boundedLimit = Math.max(1, Math.min(300, Math.trunc(limit) || 120))
  const needle = String(query ?? '').trim().toLocaleLowerCase()
  const version = String(rulesVersion ?? '').trim()

  try {
    const tables = databaseTableNames(database)

    if (family === 'phase8-rules') {
      if (!tables.has('phase8_semantic_profiles')) return []

      const rows = database.prepare(`
        SELECT
          p.semantic_key AS id,
          p.semantic_key AS name,
          p.kind AS category,
          p.automation_scope AS subcategory,
          r.rules_version AS rules_version,
          r.source_id AS source_id,
          r.source_title AS source_title,
          r.page_start AS source_page,
          'semantic-profile' AS validation_scope,
          '' AS summary,
          p.profile_json AS structured_json
        FROM phase8_semantic_profiles p
        JOIN phase8_rule_registry r ON r.section_id=p.section_id
        WHERE (?='' OR LOWER(p.semantic_key) LIKE ?)
          AND (?='' OR r.rules_version=?)
        ORDER BY p.semantic_key COLLATE NOCASE
        LIMIT ?
      `).all(
        needle,
        needle ? `%${needle}%` : '',
        version,
        version,
        boundedLimit,
      ) as Array<Record<string, unknown>>

      return rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        family: 'phase8-rules',
        category: String(row.category),
        subcategory: String(row.subcategory),
        rulesVersion: String(row.rules_version),
        sourceId: String(row.source_id),
        sourceTitle: String(row.source_title),
        sourcePage: Number.isFinite(Number(row.source_page))
          ? Number(row.source_page)
          : null,
        validationScope: String(row.validation_scope),
        summary: String(row.summary ?? ''),
        structured: parseStructuredJson(row.structured_json),
      }))
    }

    const spec = catalogSpec(family)
    if (!spec || !tables.has(spec.table)) return []

    const rows = database.prepare(`
      SELECT
        r.${spec.idColumn} AS id,
        r.${spec.nameColumn} AS name,
        ${spec.categoryExpression} AS category,
        ${spec.subcategoryExpression} AS subcategory,
        r.${spec.rulesVersionColumn} AS rules_version,
        r.${spec.sourceIdColumn} AS source_id,
        r.${spec.sourceTitleColumn} AS source_title,
        ${spec.sourcePageExpression === 'NULL' ? 'NULL' : `r.${spec.sourcePageExpression}`} AS source_page,
        ${spec.validationScopeExpression === "''" ? "''" : `r.${spec.validationScopeExpression}`} AS validation_scope,
        COALESCE(ev.summary,'') AS summary,
        COALESCE(ev.structured_json,'{}') AS structured_json
      FROM "${spec.table}" r
      LEFT JOIN entity_versions ev ON ev.id=r.${spec.entityVersionExpression}
      WHERE (?='' OR LOWER(r.${spec.nameColumn}) LIKE ?)
        AND (?='' OR r.${spec.rulesVersionColumn}=?)
      ORDER BY
        CASE r.${spec.rulesVersionColumn} WHEN '2024' THEN 0 ELSE 1 END,
        r.${spec.nameColumn} COLLATE NOCASE
      LIMIT ?
    `).all(
      needle,
      needle ? `%${needle}%` : '',
      version,
      version,
      boundedLimit,
    ) as Array<Record<string, unknown>>

    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      family: spec.id,
      category: String(row.category ?? spec.label),
      subcategory: String(row.subcategory ?? ''),
      rulesVersion: String(row.rules_version),
      sourceId: String(row.source_id),
      sourceTitle: String(row.source_title),
      sourcePage: Number.isFinite(Number(row.source_page))
        ? Number(row.source_page)
        : null,
      validationScope: String(row.validation_scope ?? ''),
      summary: String(row.summary ?? ''),
      structured: parseStructuredJson(row.structured_json),
    }))
  } finally {
    database.close()
  }
}
