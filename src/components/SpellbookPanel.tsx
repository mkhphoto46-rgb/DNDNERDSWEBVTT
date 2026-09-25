import { useEffect, useMemo, useState } from 'react'

import {
  openSpellCatalog,
  spellLevelLabel,
  spellMechanicSummary,
} from '../lib/characterRulesCatalog'
import { playSpellSfx } from '../lib/audioManager'

interface SpellbookPanelProps {
  onClose: () => void
  onMessage: (message: string) => void
  initialSpellId?: string
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

function formatProgression(values: Record<string, string>): string {
  return Object.entries(values)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([level, formula]) => `${level}: ${formula}`)
    .join(' · ')
}

export function SpellbookPanel({ onClose, onMessage, initialSpellId = '' }: SpellbookPanelProps) {
  const spells = openSpellCatalog()
  const [query, setQuery] = useState('')
  const [levelFilter, setLevelFilter] = useState('all')
  const [classFilter, setClassFilter] = useState('all')
  const [schoolFilter, setSchoolFilter] = useState('all')
  const [concentrationOnly, setConcentrationOnly] = useState(false)
  const [ritualOnly, setRitualOnly] = useState(false)
  const [selectedSpellId, setSelectedSpellId] = useState(initialSpellId || spells[0]?.id || '')
  const [playingSfx, setPlayingSfx] = useState(false)

  useEffect(() => {
    if (!initialSpellId) return
    setQuery('')
    setLevelFilter('all')
    setClassFilter('all')
    setSchoolFilter('all')
    setConcentrationOnly(false)
    setRitualOnly(false)
    setSelectedSpellId(initialSpellId)
  }, [initialSpellId])

  const classes = useMemo(
    () => unique(spells.flatMap((spell) => spell.classes)),
    [spells],
  )

  const schools = useMemo(
    () => unique(spells.map((spell) => spell.school)),
    [spells],
  )

  const visibleSpells = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return spells.filter((spell) => {
      const searchable = [
        spell.name,
        spell.school,
        spell.damageType,
        ...spell.classes,
      ].join(' ').toLowerCase()

      if (normalizedQuery && !searchable.includes(normalizedQuery)) return false
      if (levelFilter !== 'all' && spell.level !== Number(levelFilter)) return false
      if (classFilter !== 'all' && !spell.classes.includes(classFilter)) return false
      if (schoolFilter !== 'all' && spell.school !== schoolFilter) return false
      if (concentrationOnly && !spell.concentration) return false
      if (ritualOnly && !spell.ritual) return false
      return true
    })
  }, [spells, query, levelFilter, classFilter, schoolFilter, concentrationOnly, ritualOnly])

  const selectedSpell = visibleSpells.find((spell) => spell.id === selectedSpellId)
    ?? visibleSpells[0]
    ?? null

  const playSelectedSpellSfx = async () => {
    if (!selectedSpell || playingSfx) return

    setPlayingSfx(true)
    try {
      const played = await playSpellSfx(selectedSpell)
      onMessage(
        played
          ? `${selectedSpell.name} SFX played.`
          : `No available SFX cue was found for ${selectedSpell.name}.`,
      )
    } finally {
      setPlayingSfx(false)
    }
  }

  return (
    <section className="dm-spellbook-panel">
      <header className="dm-spellbook-header">
        <div>
          <span>ARCANE INDEX</span>
          <h2>DM Spellbook</h2>
          <p>{spells.length} locally synced open spells · browse, inspect, filter, and preview the current SFX mapping.</p>
        </div>
        <button type="button" onClick={onClose}>Return to Map</button>
      </header>

      <div className="dm-spellbook-layout">
        <aside className="dm-spellbook-browser">
          <div className="dm-spellbook-filters">
            <label className="dm-spellbook-search">
              <span>Search</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Spell, class, school, damage..."
              />
            </label>

            <label>
              <span>Level</span>
              <select value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)}>
                <option value="all">All Levels</option>
                <option value="0">Cantrip</option>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => (
                  <option key={level} value={level}>Level {level}</option>
                ))}
              </select>
            </label>

            <label>
              <span>Class</span>
              <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
                <option value="all">All Classes</option>
                {classes.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
              </select>
            </label>

            <label>
              <span>School</span>
              <select value={schoolFilter} onChange={(event) => setSchoolFilter(event.target.value)}>
                <option value="all">All Schools</option>
                {schools.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
              </select>
            </label>

            <div className="dm-spellbook-toggle-filters">
              <label>
                <input
                  type="checkbox"
                  checked={concentrationOnly}
                  onChange={(event) => setConcentrationOnly(event.target.checked)}
                />
                <span>Concentration</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={ritualOnly}
                  onChange={(event) => setRitualOnly(event.target.checked)}
                />
                <span>Ritual</span>
              </label>
            </div>
          </div>

          <div className="dm-spellbook-list" aria-label="Spell list">
            {visibleSpells.map((spell) => (
              <button
                type="button"
                key={spell.id}
                className={selectedSpell?.id === spell.id ? 'is-active' : ''}
                onClick={() => setSelectedSpellId(spell.id)}
              >
                <span>{spellLevelLabel(spell.level)}</span>
                <strong>{spell.name}</strong>
                <small>{spell.school} · {spell.classes.join(', ')}</small>
              </button>
            ))}
            {!visibleSpells.length ? <p className="dm-spellbook-empty">No spells match these filters.</p> : null}
          </div>
        </aside>

        <main className="dm-spellbook-detail">
          {selectedSpell ? (
            <>
              <div className="dm-spell-title-row">
                <div>
                  <span>{spellLevelLabel(selectedSpell.level)} · {selectedSpell.school}</span>
                  <h3>{selectedSpell.name}</h3>
                </div>
                <button
                  type="button"
                  className="dm-spell-sfx-button"
                  disabled={playingSfx}
                  onClick={() => void playSelectedSpellSfx()}
                >
                  {playingSfx ? 'Playing...' : 'Play Spell SFX'}
                </button>
              </div>

              <div className="character-spell-tags dm-spellbook-tags">
                {spellMechanicSummary(selectedSpell).map((tag) => <span key={tag}>{tag}</span>)}
              </div>

              <dl className="dm-spellbook-facts">
                <div><dt>Classes</dt><dd>{selectedSpell.classes.join(', ') || '—'}</dd></div>
                <div><dt>Casting Time</dt><dd>{selectedSpell.castingTime || '—'}</dd></div>
                <div><dt>Range</dt><dd>{selectedSpell.range || '—'}</dd></div>
                <div><dt>Duration</dt><dd>{selectedSpell.duration || '—'}</dd></div>
                <div><dt>Components</dt><dd>{selectedSpell.components.join(', ') || '—'}</dd></div>
                <div><dt>Attack</dt><dd>{selectedSpell.attackType || '—'}</dd></div>
                <div><dt>Save</dt><dd>{selectedSpell.saveAbility || '—'}{selectedSpell.saveEffect ? ` · ${selectedSpell.saveEffect}` : ''}</dd></div>
                <div><dt>Area</dt><dd>{selectedSpell.area || '—'}</dd></div>
                <div><dt>Damage Type</dt><dd>{selectedSpell.damageType || '—'}</dd></div>
                <div><dt>Ritual</dt><dd>{selectedSpell.ritual ? 'Yes' : 'No'}</dd></div>
                <div><dt>Concentration</dt><dd>{selectedSpell.concentration ? 'Yes' : 'No'}</dd></div>
                <div><dt>Material</dt><dd>{selectedSpell.material || '—'}</dd></div>
              </dl>

              {Object.keys(selectedSpell.damageAtSlotLevel).length ? (
                <section className="dm-spellbook-progression">
                  <strong>Damage by Slot</strong>
                  <span>{formatProgression(selectedSpell.damageAtSlotLevel)}</span>
                </section>
              ) : null}

              {Object.keys(selectedSpell.damageAtCharacterLevel).length ? (
                <section className="dm-spellbook-progression">
                  <strong>Damage by Character Level</strong>
                  <span>{formatProgression(selectedSpell.damageAtCharacterLevel)}</span>
                </section>
              ) : null}

              {Object.keys(selectedSpell.healAtSlotLevel).length ? (
                <section className="dm-spellbook-progression">
                  <strong>Healing by Slot</strong>
                  <span>{formatProgression(selectedSpell.healAtSlotLevel)}</span>
                </section>
              ) : null}

              <p className="dm-spell-description">{selectedSpell.description}</p>
              {selectedSpell.higherLevel ? (
                <p className="dm-spell-higher"><b>Higher Level:</b> {selectedSpell.higherLevel}</p>
              ) : null}
            </>
          ) : (
            <p className="dm-spellbook-empty">Select a spell.</p>
          )}
        </main>
      </div>
    </section>
  )
}
