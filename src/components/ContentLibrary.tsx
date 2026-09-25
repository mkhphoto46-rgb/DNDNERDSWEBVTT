import { useEffect, useMemo, useState } from 'react'
import { OPEN_RULES_LIBRARY, searchRulesLibrary } from '../lib/contentLibrary'
import type { ContentEntryType, ContentLibraryEntry } from '../types/contentLibrary'
import type {
  BackendCatalogEntry,
  BackendCatalogStatus,
} from '../lib/backendCatalog'

const TYPE_OPTIONS: Array<[ContentEntryType | 'all', string]> = [
  ['all', 'All records'],
  ['spell', 'Spells'],
  ['cantrip', 'Cantrips'],
  ['weapon', 'Weapons'],
  ['armor', 'Armor'],
  ['equipment', 'Equipment'],
  ['pack', 'Packs'],
  ['magic-item', 'Magic items'],
  ['background', 'Backgrounds'],
  ['feat', 'Feats'],
  ['class-feature', 'Class features'],
  ['poison', 'Poisons'],
]

function typeLabel(type: ContentEntryType): string {
  return TYPE_OPTIONS.find(([value]) => value === type)?.[1] ?? type
}

interface RulebookSummary {
  id: string
  title: string
  year: number | null
  rulesVersion: string
  filename: string
  pageCount: number
  indexedPageCount: number
}

interface RulebookStatus {
  ready: boolean
  bookCount: number
  pageCount: number
  indexedPageCount: number
  books: RulebookSummary[]
}

interface RulebookSearchResult {
  bookId: string
  bookTitle: string
  year: number | null
  pageNumber: number
  excerpt: string
}

interface KnowledgeSource {
  id: string
  title: string
  filename: string
  publicationYear: number | null
  rulesVersion: string
  sourceKind: string
  sourcePriority: number
}

interface KnowledgeCategory {
  id: string
  label: string
  count: number
}

interface KnowledgeStatus {
  ready: boolean
  sourceCount: number
  entityCount: number
  validatedCount: number
  extractedCount: number
  sources: KnowledgeSource[]
  categories: KnowledgeCategory[]
}

interface KnowledgeResult {
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

type LibraryMode = 'open' | 'structured' | 'backend' | 'owned'

export function ContentLibrary() {
  const [mode, setMode] = useState<LibraryMode>('backend')
  const [query, setQuery] = useState('')
  const [type, setType] = useState<ContentEntryType | 'all'>('all')
  const [rarity, setRarity] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [rulebookStatus, setRulebookStatus] = useState<RulebookStatus | null>(null)
  const [rulebookId, setRulebookId] = useState('')
  const [rulebookResults, setRulebookResults] = useState<RulebookSearchResult[]>([])
  const [rulebookLoading, setRulebookLoading] = useState(false)
  const [knowledgeStatus, setKnowledgeStatus] = useState<KnowledgeStatus | null>(null)
  const [backendStatus, setBackendStatus] = useState<BackendCatalogStatus | null>(null)

  const rarityOptions = useMemo(
    () => [...new Set(OPEN_RULES_LIBRARY.map((item) => item.rarity).filter(Boolean))].sort(),
    [],
  )
  const matches = useMemo(
    () => searchRulesLibrary(OPEN_RULES_LIBRARY, query, type, rarity),
    [query, rarity, type],
  )
  const selected = OPEN_RULES_LIBRARY.find((item) => item.id === selectedId) ?? matches[0] ?? null

  useEffect(() => {
    fetch('/api/library/rulebooks/status', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() as Promise<RulebookStatus> : Promise.reject(new Error('Rulebook index unavailable.')))
      .then(setRulebookStatus)
      .catch(() => setRulebookStatus(null))

    fetch('/api/library/rules/status', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() as Promise<KnowledgeStatus> : Promise.reject(new Error('Structured rules corpus unavailable.')))
      .then(setKnowledgeStatus)
      .catch(() => setKnowledgeStatus(null))

    fetch('/api/library/catalog/status', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() as Promise<BackendCatalogStatus> : Promise.reject(new Error('Backend catalog unavailable.')))
      .then(setBackendStatus)
      .catch(() => setBackendStatus(null))
  }, [])

  useEffect(() => {
    if (mode !== 'owned' || query.trim().length < 2) {
      setRulebookResults([])
      setRulebookLoading(false)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setRulebookLoading(true)
      const parameters = new URLSearchParams({ q: query.trim(), limit: '60' })
      if (rulebookId) parameters.set('bookId', rulebookId)
      fetch(`/api/library/rulebooks/search?${parameters}`, { cache: 'no-store', signal: controller.signal })
        .then((response) => response.ok ? response.json() as Promise<RulebookSearchResult[]> : Promise.reject(new Error('Rulebook search failed.')))
        .then(setRulebookResults)
        .catch((error) => {
          if (!(error instanceof DOMException && error.name === 'AbortError')) setRulebookResults([])
        })
        .finally(() => setRulebookLoading(false))
    }, 220)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [mode, query, rulebookId])

  const heroCount = mode === 'open'
    ? `${OPEN_RULES_LIBRARY.length.toLocaleString()} indexed records`
    : mode === 'structured'
      ? `${(knowledgeStatus?.entityCount ?? 0).toLocaleString()} structured records`
      : mode === 'backend'
        ? `${(backendStatus?.totalRecords ?? 0).toLocaleString()} validated registry rows`
        : `${rulebookStatus?.bookCount ?? 0} books · ${(rulebookStatus?.indexedPageCount ?? 0).toLocaleString()} searchable pages`

  return (
    <div className="rules-library">
      <div className="rules-library-hero">
        <div>
          <small>
            {mode === 'open'
              ? 'OPEN RULES ARCHIVE'
              : mode === 'structured'
                ? 'SOURCE INSPECTOR (QA / OCR)'
                : mode === 'backend'
                  ? 'VALIDATED BACKEND CATALOG'
                  : 'RAW PRIVATE BOOK ARCHIVE'}
          </small>
          <strong>{heroCount}</strong>
        </div>
        <span>
          {mode === 'structured'
            ? '2024 priority · source-versioned'
            : mode === 'backend'
              ? 'Validated registries · DB-backed'
              : mode === 'open'
                ? 'SRD 5.2.1 · 2024'
                : 'Local raw source'}
        </span>
      </div>

      <div className="rules-library-mode" aria-label="Library source">
        <button type="button" className={mode === 'backend' ? 'is-active' : ''} onClick={() => setMode('backend')}>Rules Catalog</button>
        <button type="button" className={mode === 'open' ? 'is-active' : ''} onClick={() => setMode('open')}>Open Rules</button>
        <button type="button" className={mode === 'structured' ? 'is-active' : ''} onClick={() => setMode('structured')}>Source Inspector</button>
        <button type="button" className={mode === 'owned' ? 'is-active' : ''} onClick={() => setMode('owned')}>Raw Source</button>
      </div>

      {mode === 'structured' ? (
        <>
          <p className="rules-library-inspector-warning">
            Source Inspector is a DM/QA view of extracted source text. OCR artifacts can appear here; use Rules Catalog for normal play.
          </p>
          <StructuredCorpus initialStatus={knowledgeStatus} query={query} onQueryChange={setQuery} />
        </>
      ) : mode === 'backend' ? (
        <BackendCatalog initialStatus={backendStatus} query={query} onQueryChange={setQuery} />
      ) : mode === 'owned' ? (
        <OwnedRulebooks
          query={query}
          onQueryChange={setQuery}
          selectedBookId={rulebookId}
          onBookChange={setRulebookId}
          status={rulebookStatus}
          results={rulebookResults}
          loading={rulebookLoading}
        />
      ) : (
        <>
          <div className="rules-library-controls">
            <label className="rules-library-search">
              <span>Search name, class, category or tag</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the open archive…" />
            </label>
            <div className="rules-library-filters">
              <label>
                Type
                <select value={type} onChange={(event) => setType(event.target.value as ContentEntryType | 'all')}>
                  {TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label>
                Rarity
                <select value={rarity} onChange={(event) => setRarity(event.target.value)}>
                  <option value="">All rarities</option>
                  {rarityOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label>
                Source
                <select value="srd-5.2.1" disabled>
                  <option value="srd-5.2.1">SRD 5.2.1 · 2024</option>
                </select>
              </label>
            </div>
          </div>

          <div className="rules-library-layout">
            <div className="rules-library-results" role="list" aria-label="Rules library results">
              <div className="rules-library-result-count">{matches.length.toLocaleString()} results</div>
              {matches.slice(0, 400).map((item) => (
                <button
                  type="button"
                  role="listitem"
                  key={item.id}
                  className={selected?.id === item.id ? 'rules-library-row is-active' : 'rules-library-row'}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className={`rules-library-sigil type-${item.type}`}>{item.name.slice(0, 1)}</span>
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.summary || item.category}</small>
                  </span>
                  <em>{typeLabel(item.type)}</em>
                </button>
              ))}
              {matches.length > 400 ? <p className="empty-note">Refine the search to view the remaining {matches.length - 400} records.</p> : null}
              {!matches.length ? <p className="empty-note">No record matches these filters.</p> : null}
            </div>

            <article className="rules-library-detail">
              {selected ? <LibraryDetail entry={selected} /> : <p className="empty-note">Choose a record.</p>}
            </article>
          </div>

          <p className="rules-library-license">
            Open structured content: SRD 5.2.1, licensed under CC BY 4.0.
          </p>
        </>
      )}
    </div>
  )
}


function BackendCatalog({
  initialStatus,
  query,
  onQueryChange,
}: {
  initialStatus: BackendCatalogStatus | null
  query: string
  onQueryChange: (value: string) => void
}) {
  const [status, setStatus] = useState<BackendCatalogStatus | null>(initialStatus)
  const [family, setFamily] = useState('')
  const [rulesVersion, setRulesVersion] = useState('')
  const [results, setResults] = useState<BackendCatalogEntry[]>([])
  const [selectedKey, setSelectedKey] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => setStatus(initialStatus), [initialStatus])

  useEffect(() => {
    if (!family) {
      setResults([])
      setLoading(false)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      const parameters = new URLSearchParams({
        family,
        limit: '180',
      })

      if (query.trim()) parameters.set('q', query.trim())
      if (rulesVersion) parameters.set('rulesVersion', rulesVersion)

      fetch(`/api/library/catalog/search?${parameters}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
        .then((response) => response.ok
          ? response.json() as Promise<BackendCatalogEntry[]>
          : Promise.reject(new Error('Backend catalog search failed.')))
        .then(setResults)
        .catch((error) => {
          if (!(error instanceof DOMException && error.name === 'AbortError')) {
            setResults([])
          }
        })
        .finally(() => setLoading(false))
    }, 140)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [family, query, rulesVersion])

  const selected = results.find(
    (item) => `${item.family}:${item.id}` === selectedKey,
  ) ?? results[0] ?? null

  return (
    <>
      <div className="rules-library-controls">
        <label className="rules-library-search">
          <span>Search the validated backend registries</span>
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search backend records…"
          />
        </label>

        <div className="rules-library-filters">
          <label>
            Registry
            <select value={family} onChange={(event) => {
              setFamily(event.target.value)
              setSelectedKey('')
            }}>
              <option value="">Choose a registry</option>
              {(status?.families ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label} ({item.count})
                </option>
              ))}
            </select>
          </label>

          <label>
            Rules version
            <select value={rulesVersion} onChange={(event) => setRulesVersion(event.target.value)}>
              <option value="">All versions</option>
              <option value="2024">2024 only</option>
              <option value="2014">2014 only</option>
            </select>
          </label>
        </div>
      </div>

      <div className="rules-library-layout">
        <div className="rules-library-results" role="list" aria-label="Backend catalog results">
          <div className="rules-library-result-count">
            {!family
              ? `${status?.families.length ?? 0} registries available`
              : loading
                ? 'Loading registry…'
                : `${results.length} records`}
          </div>

          {!family ? (
            <>
              {(status?.families ?? []).map((item) => (
                <button
                  type="button"
                  role="listitem"
                  className="rules-library-row"
                  key={item.id}
                  onClick={() => {
                    setFamily(item.id)
                    setSelectedKey('')
                  }}
                >
                  <span className="rules-library-sigil">{item.label.slice(0, 1)}</span>
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.count.toLocaleString()} validated rows</small>
                  </span>
                  <em>DB</em>
                </button>
              ))}
            </>
          ) : null}

          {results.map((item) => {
            const key = `${item.family}:${item.id}`
            return (
              <button
                type="button"
                role="listitem"
                key={key}
                className={selected && `${selected.family}:${selected.id}` === key ? 'rules-library-row is-active' : 'rules-library-row'}
                onClick={() => setSelectedKey(key)}
              >
                <span className="rules-library-sigil">{item.name.slice(0, 1)}</span>
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {item.category}
                    {item.subcategory ? ` · ${item.subcategory}` : ''}
                    {' · '}
                    {item.sourceTitle}
                    {item.sourcePage ? ` p.${item.sourcePage}` : ''}
                  </small>
                </span>
                <em>{item.rulesVersion}</em>
              </button>
            )
          })}

          {family && !loading && !results.length ? (
            <p className="empty-note">No validated backend record matches these filters.</p>
          ) : null}
        </div>

        <article className="rules-library-detail">
          {selected ? (
            <>
              <header>
                <span>{selected.category}{selected.subcategory ? ` · ${selected.subcategory}` : ''}</span>
                <h3>{selected.name}</h3>
                <div className="rules-library-badges">
                  <b>{selected.rulesVersion} rules</b>
                  <b>{selected.sourceTitle}</b>
                  {selected.sourcePage ? <b>Page {selected.sourcePage}</b> : null}
                  {selected.validationScope ? <b>{selected.validationScope}</b> : null}
                </div>
              </header>

              {Object.keys(selected.structured).length ? (
                <dl className="rules-library-facts">
                  {Object.entries(selected.structured).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{Array.isArray(value) ? value.join(', ') : String(value ?? '—')}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              {selected.summary ? (
                <div className="rules-library-description">{selected.summary}</div>
              ) : (
                <p className="empty-note">
                  This registry row is validated and source-backed, but it does not expose additional summary text.
                </p>
              )}
            </>
          ) : (
            <p className="empty-note">
              Choose a backend registry to inspect exactly what is currently stored and validated.
            </p>
          )}
        </article>
      </div>

      <p className="rules-library-license">
        Backend Catalog shows validated registry rows. Visibility here does not imply that every record already has runtime automation.
      </p>
    </>
  )
}

function StructuredCorpus({
  initialStatus,
  query,
  onQueryChange,
}: {
  initialStatus: KnowledgeStatus | null
  query: string
  onQueryChange: (value: string) => void
}) {
  const [status, setStatus] = useState<KnowledgeStatus | null>(initialStatus)
  const [category, setCategory] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [rulesVersion, setRulesVersion] = useState('')
  const [validationStatus, setValidationStatus] = useState('')
  const [results, setResults] = useState<KnowledgeResult[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => setStatus(initialStatus), [initialStatus])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      const parameters = new URLSearchParams({ limit: '120' })
      if (query.trim()) parameters.set('q', query.trim())
      if (category) parameters.set('category', category)
      if (sourceId) parameters.set('sourceId', sourceId)
      if (rulesVersion) parameters.set('rulesVersion', rulesVersion)
      if (validationStatus) parameters.set('status', validationStatus)

      fetch(`/api/library/rules/search?${parameters}`, { cache: 'no-store', signal: controller.signal })
        .then((response) => response.ok ? response.json() as Promise<KnowledgeResult[]> : Promise.reject(new Error('Structured rules search failed.')))
        .then(setResults)
        .catch((error) => {
          if (!(error instanceof DOMException && error.name === 'AbortError')) setResults([])
        })
        .finally(() => setLoading(false))
    }, 180)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [category, query, rulesVersion, sourceId, validationStatus])

  const selected = results.find((item) => item.id === selectedId) ?? results[0] ?? null

  return (
    <>
      <div className="rules-library-controls">
        <label className="rules-library-search">
          <span>Search spells, cantrips, classes, subclasses, actions, rests, items, rules…</span>
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search structured rules…" />
        </label>

        <div className="rules-library-filters">
          <label>
            Category
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">All categories</option>
              {(status?.categories ?? []).map((item) => (
                <option key={item.id} value={item.id}>{item.label} ({item.count})</option>
              ))}
            </select>
          </label>

          <label>
            Source book
            <select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
              <option value="">All sources</option>
              {(status?.sources ?? []).map((source) => (
                <option key={source.id} value={source.id}>
                  {source.rulesVersion} · {source.publicationYear ?? '—'} · {source.title}
                </option>
              ))}
            </select>
          </label>

          <label>
            Rules version
            <select value={rulesVersion} onChange={(event) => setRulesVersion(event.target.value)}>
              <option value="">2014 + 2024</option>
              <option value="2024">2024 only</option>
              <option value="2014">2014 only</option>
            </select>
          </label>

          <label>
            Record status
            <select value={validationStatus} onChange={(event) => setValidationStatus(event.target.value)}>
              <option value="">All statuses</option>
              <option value="validated">Validated structured data</option>
              <option value="extracted">PDF extracted candidate</option>
              <option value="engine-ready">Engine ready</option>
              <option value="automated">Automated</option>
              <option value="tested">Tested</option>
            </select>
          </label>
        </div>
      </div>

      <div className="rules-library-layout">
        <div className="rules-library-results" role="list" aria-label="Structured rules results">
          <div className="rules-library-result-count">
            {loading ? 'Searching…' : `${results.length} results`}
          </div>
          {results.map((item) => (
            <button
              type="button"
              role="listitem"
              key={item.id}
              className={selected?.id === item.id ? 'rules-library-row is-active' : 'rules-library-row'}
              onClick={() => setSelectedId(item.id)}
            >
              <span className="rules-library-sigil">{item.name.slice(0, 1)}</span>
              <span>
                <strong>{item.name}</strong>
                <small>
                  {item.summary || item.subcategory || item.category}
                  {' · '}
                  {item.sourceTitle}
                  {item.pageStart ? ` p.${item.pageStart}` : ''}
                </small>
              </span>
              <em>{item.rulesVersion} · {item.category}</em>
            </button>
          ))}
          {!loading && !results.length ? <p className="empty-note">No structured record matches these filters.</p> : null}
        </div>

        <article className="rules-library-detail">
          {selected ? (
            <>
              <header>
                <span>{selected.category}{selected.subcategory ? ` · ${selected.subcategory}` : ''}</span>
                <h3>{selected.name}</h3>
                <div className="rules-library-badges">
                  <b>{selected.rulesVersion} rules</b>
                  <b>{selected.status}</b>
                  <b>{selected.sourceTitle}</b>
                  {selected.pageStart ? <b>Page {selected.pageStart}</b> : null}
                </div>
              </header>

              <dl className="rules-library-facts">
                <div><dt>Source</dt><dd>{selected.sourceTitle}</dd></div>
                <div><dt>Publication</dt><dd>{selected.publicationYear ?? '—'}</dd></div>
                <div><dt>Priority</dt><dd>{selected.sourcePriority}</dd></div>
                <div><dt>Confidence</dt><dd>{Math.round(selected.confidence * 100)}%</dd></div>
              </dl>

              {Object.keys(selected.structured).length ? (
                <dl className="rules-library-facts">
                  {Object.entries(selected.structured).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{Array.isArray(value) ? value.join(', ') : String(value ?? '—')}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              <div className="rules-library-description">{selected.summary}</div>

              {selected.status === 'extracted' ? (
                <p className="empty-note">
                  Extracted candidate: searchable and source-attributed, but not yet authoritative for game automation.
                </p>
              ) : null}
            </>
          ) : (
            <p className="empty-note">
              Build the Rules Knowledge database, then choose a structured record.
            </p>
          )}
        </article>
      </div>

      <p className="rules-library-license">
        2024 validated records resolve before older equivalents. Older sources remain searchable. PDF-extracted candidates never become engine-authoritative until validated.
      </p>
    </>
  )
}

function OwnedRulebooks({
  query,
  onQueryChange,
  selectedBookId,
  onBookChange,
  status,
  results,
  loading,
}: {
  query: string
  onQueryChange: (value: string) => void
  selectedBookId: string
  onBookChange: (value: string) => void
  status: RulebookStatus | null
  results: RulebookSearchResult[]
  loading: boolean
}) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selected = results[selectedIndex] ?? results[0] ?? null
  return (
    <>
      <div className="rules-library-controls">
        <label className="rules-library-search">
          <span>Search exact source text</span>
          <input value={query} onChange={(event) => { onQueryChange(event.target.value); setSelectedIndex(0) }} placeholder="Search raw rulebook pages…" />
        </label>
        <label>
          Book source
          <select value={selectedBookId} onChange={(event) => { onBookChange(event.target.value); setSelectedIndex(0) }}>
            <option value="">All owned books</option>
            {(status?.books ?? []).map((book) => (
              <option key={book.id} value={book.id}>{book.rulesVersion} rules · {book.year ? `${book.year} · ` : ''}{book.title}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="rules-library-layout">
        <div className="rules-library-results" role="list" aria-label="Owned rulebook results">
          <div className="rules-library-result-count">{loading ? 'Searching…' : `${results.length} page matches`}</div>
          {results.map((result, index) => (
            <button
              type="button"
              role="listitem"
              key={`${result.bookId}:${result.pageNumber}:${index}`}
              className={selected === result ? 'rules-library-row is-active' : 'rules-library-row'}
              onClick={() => setSelectedIndex(index)}
            >
              <span className="rules-library-sigil">{result.pageNumber}</span>
              <span><strong>{result.bookTitle}</strong><small>{result.excerpt}</small></span>
              <em>PAGE {result.pageNumber}</em>
            </button>
          ))}
          {!loading && query.trim().length < 2 ? <p className="empty-note">Type at least two letters to search all indexed pages.</p> : null}
          {!loading && query.trim().length >= 2 && !results.length ? <p className="empty-note">No matching page found.</p> : null}
        </div>
        <article className="rules-library-detail">
          {selected ? (
            <>
              <header>
                <span>RAW OWNED SOURCE · PAGE {selected.pageNumber}</span>
                <h3>{selected.bookTitle}</h3>
                <div className="rules-library-badges"><b>{selected.year ?? 'Edition not set'}</b><b>Local PDF index</b></div>
              </header>
              <div className="rules-library-description">{selected.excerpt}</div>
            </>
          ) : (
            <div className="rulebook-shelf">
              {(status?.books ?? []).map((book) => (
                <div key={book.id}><strong>{book.title}</strong><small>{book.rulesVersion} rules · Published {book.year ?? 'Unknown'} · {book.indexedPageCount}/{book.pageCount} pages</small></div>
              ))}
            </div>
          )}
        </article>
      </div>
      <p className="rules-library-license">Private raw index from locally supplied PDFs. Raw source text stays separate from structured engine data.</p>
    </>
  )
}

function LibraryDetail({ entry }: { entry: ContentLibraryEntry }) {
  return (
    <>
      <header>
        <span>{typeLabel(entry.type)} · {entry.category}</span>
        <h3>{entry.name}</h3>
        <div className="rules-library-badges">
          <b>{entry.sourceLabel}</b>
          {entry.rarity ? <b>{entry.rarity}</b> : null}
        </div>
      </header>
      {entry.facts.length ? (
        <dl className="rules-library-facts">
          {entry.facts.map((fact) => <div key={`${fact.label}:${fact.value}`}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
        </dl>
      ) : null}
      {entry.description ? <div className="rules-library-description">{entry.description}</div> : <p className="empty-note">No additional rules text.</p>}
    </>
  )
}
