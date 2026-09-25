import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import {
  type MonsterCompendiumStatus,
  type MonsterSummary,
  type MonsterTemplate,
} from '../types/compendium'

interface MonsterCompendiumProps {
  onCreateActor: (monster: MonsterTemplate) => Promise<void>
  onMessage: (message: string) => void
}

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  const body = await response.json().catch(() => null) as T | { error?: unknown } | null

  if (!response.ok) {
    const error =
      body && typeof body === 'object' && 'error' in body
        ? String(body.error ?? 'Compendium request failed.')
        : 'Compendium request failed.'

    throw new Error(error)
  }

  return body as T
}

function formatField(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(', ')
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => `${key}: ${String(entry)}`)
      .join(' • ')
  }

  return value === undefined || value === null || value === ''
    ? '—'
    : String(value)
}

function StatEntries({
  title,
  entries,
}: {
  title: string
  entries: unknown
}) {
  if (!Array.isArray(entries) || entries.length === 0) return null

  return (
    <section className="monster-stat-section">
      <h4>{title}</h4>
      {entries.map((entry, index) => {
        const value = entry && typeof entry === 'object'
          ? entry as Record<string, unknown>
          : {}

        return (
          <article key={`${title}-${String(value.name ?? index)}`}>
            <strong>{String(value.name ?? title)}</strong>
            <p>{String(value.description ?? '')}</p>
          </article>
        )
      })}
    </section>
  )
}

function monsterInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return words.slice(0, 2).map((word) => word.slice(0, 1)).join('').toUpperCase() || 'M'
}

function MonsterTokenAvatar({
  monster,
  size = 'small',
}: {
  monster: MonsterSummary
  size?: 'small' | 'large'
}) {
  const [imageFailed, setImageFailed] = useState(false)
  const portraitUrl = imageFailed ? null : monster.portraitUrl
  const tokenClass = [
    'monster-token-avatar',
    `is-${size}`,
    `type-${monster.type.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  ].join(' ')

  return (
    <span className={tokenClass} aria-hidden="true">
      {portraitUrl ? (
        <img src={portraitUrl} alt="" onError={() => setImageFailed(true)} />
      ) : (
        <b>{monsterInitials(monster.name)}</b>
      )}
    </span>
  )
}

export function MonsterCompendium({
  onCreateActor,
  onMessage,
}: MonsterCompendiumProps) {
  const [status, setStatus] = useState<MonsterCompendiumStatus | null>(null)
  const [query, setQuery] = useState('')
  const [type, setType] = useState('')
  const [size, setSize] = useState('')
  const [cr, setCr] = useState('')
  const [results, setResults] = useState<MonsterSummary[]>([])
  const [selected, setSelected] = useState<MonsterTemplate | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    requestJson<MonsterCompendiumStatus>('/api/compendium/monsters/status')
      .then(setStatus)
      .catch((error) => {
        setStatus({
          ready: false,
          count: 0,
          source: 'SRD 5.2.1',
          version: 'unknown',
          error: error instanceof Error ? error.message : 'Compendium unavailable.',
        })
      })
  }, [])

  useEffect(() => {
    if (!status?.ready) return

    const timer = window.setTimeout(() => {
      const params = new URLSearchParams()
      if (query.trim()) params.set('q', query.trim())
      if (type) params.set('type', type)
      if (size) params.set('size', size)
      if (cr) params.set('cr', cr)
      params.set('limit', '100')

      setLoading(true)

      requestJson<MonsterSummary[]>(`/api/compendium/monsters?${params.toString()}`)
        .then((monsters) => {
          setResults(monsters)
          if (
            selected &&
            !monsters.some((monster) => monster.id === selected.id)
          ) {
            setSelected(null)
          }
        })
        .catch((error) => {
          onMessage(error instanceof Error ? error.message : 'Monster search failed.')
        })
        .finally(() => setLoading(false))
    }, 100)

    return () => window.clearTimeout(timer)
  }, [query, type, size, cr, status?.ready])

  const types = useMemo(
    () => [...new Set(results.map((monster) => monster.type))].sort(),
    [results],
  )

  const loadMonster = async (monsterId: string) => {
    try {
      const monster = await requestJson<MonsterTemplate>(
        `/api/compendium/monsters/${encodeURIComponent(monsterId)}`,
      )
      setSelected(monster)
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Monster stat block could not be loaded.')
    }
  }

  if (!status) {
    return <p className="empty-note">Loading local monster compendium…</p>
  }

  if (!status.ready) {
    return (
      <div className="compendium-error">
        <strong>Local Compendium is not initialized.</strong>
        <p>{status.error ?? 'No local monster data found.'}</p>
        <code>npm.cmd install --save-exact @adkinn/fifth-edition-srd-mcp@1.4.0</code>
        <p>Then restart the VTT server once. The SQLite database will be created locally.</p>
      </div>
    )
  }

  const block = selected?.statBlock ?? {}
  const abilities =
    block.ability_scores && typeof block.ability_scores === 'object'
      ? block.ability_scores as Record<string, unknown>
      : {}

  return (
    <div className="monster-compendium">
      <div className="compendium-status">
        <strong>{status.count} local SRD monsters</strong>
        <small>SQLite • offline at game time • {status.source}</small>
      </div>

      <div className="compendium-search-grid">
        <input
          type="search"
          value={query}
          placeholder="Search monster…"
          onChange={(event) => setQuery(event.target.value)}
        />
        <select value={type} onChange={(event) => setType(event.target.value)}>
          <option value="">All Types</option>
          {types.map((entry) => (
            <option value={entry} key={entry}>{entry}</option>
          ))}
        </select>
        <select value={size} onChange={(event) => setSize(event.target.value)}>
          <option value="">All Sizes</option>
          {['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'].map((entry) => (
            <option value={entry.toLowerCase()} key={entry}>{entry}</option>
          ))}
        </select>
        <input
          type="text"
          value={cr}
          placeholder="CR e.g. 1/4"
          onChange={(event) => setCr(event.target.value.trim())}
        />
      </div>

      <div className="compendium-results">
        <div className="compendium-result-list">
          {loading ? <small>Searching local database…</small> : null}
          {results.map((monster) => (
            <button
              type="button"
              className={selected?.id === monster.id ? 'compendium-result is-active' : 'compendium-result'}
              key={monster.id}
              onClick={() => void loadMonster(monster.id)}
            >
              <MonsterTokenAvatar monster={monster} />
              <span className="compendium-result-copy">
                <strong>{monster.name}</strong>
                <span>{monster.size} {monster.type}</span>
                <small>CR {monster.cr} • AC {monster.armorClass} • HP {monster.hitPoints}</small>
              </span>
            </button>
          ))}
        </div>

        {selected ? (
          <article className="monster-stat-block">
            <header>
              <MonsterTokenAvatar monster={selected} size="large" />
              <div>
                <h3>{selected.name}</h3>
                <p>{selected.size} {selected.type} • CR {selected.cr}</p>
              </div>
              <button
                type="button"
                className="primary-button compendium-add-button"
                onClick={() => {
                  void onCreateActor(selected).catch((error) => {
                    onMessage(
                      error instanceof Error
                        ? error.message
                        : 'Monster could not be added to the campaign.',
                    )
                  })
                }}
              >
                Add to Actors
              </button>
            </header>

            <div className="monster-stat-line">
              <b>AC {selected.armorClass}</b>
              <b>HP {selected.hitPoints}</b>
              <b>Initiative {selected.initiativeModifier >= 0 ? '+' : ''}{selected.initiativeModifier}</b>
            </div>
            <p><strong>HP Formula:</strong> {selected.hitPointFormula || '—'}</p>
            <p><strong>Speed:</strong> {formatField(block.speed)}</p>

            <div className="monster-abilities">
              {['str', 'dex', 'con', 'int', 'wis', 'cha'].map((ability) => (
                <span key={ability}>
                  <b>{ability.toUpperCase()}</b>
                  {formatField(abilities[ability])}
                </span>
              ))}
            </div>

            {block.saving_throws ? <p><strong>Saves:</strong> {formatField(block.saving_throws)}</p> : null}
            {block.skills ? <p><strong>Skills:</strong> {formatField(block.skills)}</p> : null}
            {block.damage_resistances ? <p><strong>Resistances:</strong> {formatField(block.damage_resistances)}</p> : null}
            {block.damage_immunities ? <p><strong>Immunities:</strong> {formatField(block.damage_immunities)}</p> : null}
            {block.condition_immunities ? <p><strong>Condition Immunities:</strong> {formatField(block.condition_immunities)}</p> : null}
            {block.senses ? <p><strong>Senses:</strong> {formatField(block.senses)}</p> : null}
            {block.languages ? <p><strong>Languages:</strong> {formatField(block.languages)}</p> : null}

            <StatEntries title="Traits" entries={block.traits} />
            <StatEntries title="Actions" entries={block.actions} />
            <StatEntries title="Bonus Actions" entries={block.bonus_actions} />
            <StatEntries title="Reactions" entries={block.reactions} />

            {block.legendary_actions && typeof block.legendary_actions === 'object' ? (
              <StatEntries
                title="Legendary Actions"
                entries={(block.legendary_actions as Record<string, unknown>).actions}
              />
            ) : null}

            <footer>
              {selected.attribution}
            </footer>
          </article>
        ) : (
          <div className="compendium-empty-stat">
            Select a monster to open its local stat block.
          </div>
        )}
      </div>
    </div>
  )
}
