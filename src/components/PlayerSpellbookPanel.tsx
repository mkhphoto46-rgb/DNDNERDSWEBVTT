import { useEffect, useMemo, useState } from 'react'

import {
  featureGrantedSpells,
  openSpellCatalog,
  spellIsAvailableToCharacter,
  spellLevelLabel,
  spellMechanicSummary,
} from '../lib/characterRulesCatalog'
import { automaticSpellcastingAbility } from '../lib/characterAutomation'
import {
  addSelectedSpellPatch,
  removeSelectedSpellPatch,
  spellSelectionAvailability,
  togglePreparedSpellPatch,
} from '../lib/spellSelectionRules'
import { DEFAULT_CHARACTER_SHEET, type Actor } from '../types/actor'

interface PlayerSpellbookPanelProps {
  actor: Actor
  onClose: () => void
  onUpdate: (patch: Partial<Actor>) => Promise<void>
  onMessage: (message: string) => void
  initialSpellId?: string
}

export function PlayerSpellbookPanel({ actor, onClose, onUpdate, onMessage, initialSpellId = '' }: PlayerSpellbookPanelProps) {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<'mine' | 'all'>('all')
  const [selectedId, setSelectedId] = useState(initialSpellId)
  const sheet = actor.characterSheet ?? { ...DEFAULT_CHARACTER_SHEET }
  const catalog = useMemo(() => openSpellCatalog(), [])
  const granted = featureGrantedSpells(sheet.className, sheet.subclassName, actor.level)
  const grantedIds = new Set(granted.map((spell) => spell.id))
  const knownIds = new Set(sheet.knownSpellIds ?? [])
  const preparedIds = new Set(sheet.preparedSpellIds ?? [])
  const spellcastingAbility = automaticSpellcastingAbility(sheet.className)
  const spellcastingScore = spellcastingAbility ? actor.abilities[spellcastingAbility] : 10
  const selection = spellSelectionAvailability(sheet, actor.level, spellcastingScore)

  useEffect(() => {
    if (!initialSpellId) return
    setQuery('')
    setScope('mine')
    setSelectedId(initialSpellId)
  }, [initialSpellId])
  const normalizedQuery = query.trim().toLowerCase()
  const filtered = catalog.filter((spell) => {
    const belongsToCharacter = spellIsAvailableToCharacter(spell, sheet.className, actor.level) || grantedIds.has(spell.id)
    if (scope === 'mine' && !belongsToCharacter) return false
    if (!normalizedQuery) return true
    return `${spell.name} ${spell.school} ${spell.classes.join(' ')} ${spell.damageType}`
      .toLowerCase()
      .includes(normalizedQuery)
  })
  const selected = catalog.find((spell) => spell.id === selectedId) ?? filtered[0] ?? null

  const updateSheet = async (patch: Partial<typeof sheet>, success: string) => {
    try {
      await onUpdate({ characterSheet: { ...sheet, ...patch } })
      onMessage(success)
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Spellbook change could not be saved.')
    }
  }

  const eligible = selected
    ? spellIsAvailableToCharacter(selected, sheet.className, actor.level) || grantedIds.has(selected.id)
    : false
  const known = selected ? knownIds.has(selected.id) || grantedIds.has(selected.id) : false
  const prepared = selected
    ? selected.level === 0 || grantedIds.has(selected.id) || (
        selection.rules.wizardSpellbook ? preparedIds.has(selected.id) : knownIds.has(selected.id)
      )
    : false

  const changeSelectedSpell = (spellId: string) => {
    if (!selected) return
    const patch = addSelectedSpellPatch(sheet, actor.level, spellId, spellcastingScore)
    if (!patch) {
      onMessage(selection.summary)
      return
    }
    void updateSheet(patch, `${selected.name} added to your spell list.`)
  }

  const changeSpellPreparation = (nextPrepared: boolean) => {
    if (!selected) return
    const patch = togglePreparedSpellPatch(sheet, actor.level, selected.id, nextPrepared, spellcastingScore)
    if (!patch) {
      onMessage('Wizard spell preparation can be changed during a Long Rest, up to the class limit.')
      return
    }
    void updateSheet(patch, nextPrepared ? `${selected.name} prepared.` : `${selected.name} is no longer prepared.`)
  }

  const removeSelectedSpell = () => {
    if (!selected) return
    const patch = removeSelectedSpellPatch(sheet, actor.level, selected.id, spellcastingScore)
    if (!patch) {
      onMessage(selection.summary)
      return
    }
    void updateSheet(patch, `${selected.name} removed from your spell list.`)
  }

  return (
    <section className="player-spellbook-panel">
      <header className="player-spellbook-header">
        <div>
          <span>PLAYER SPELLBOOK</span>
          <h2>{actor.name} · {sheet.className || 'Choose a class'}</h2>
          <p>Search the complete local spell catalog. Only spells allowed by your class, subclass features, and level can be learned.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close player spellbook">×</button>
      </header>

      <div className="player-spellbook-toolbar">
        <label>
          <span>SEARCH ALL SPELLS</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, school, class, damage…" />
        </label>
        <div role="tablist" aria-label="Spellbook filter">
          <button type="button" role="tab" aria-selected={scope === 'mine'} className={scope === 'mine' ? 'is-active' : ''} onClick={() => setScope('mine')}>My List</button>
          <button type="button" role="tab" aria-selected={scope === 'all'} className={scope === 'all' ? 'is-active' : ''} onClick={() => setScope('all')}>All Spells</button>
        </div>
      </div>

      <div className="spell-selection-rules-status">
        <b>
          {selection.knownCantripCount}/{selection.rules.maxCantrips} cantrips
          {' · '}{selection.knownLevelSpellCount}/{selection.rules.maxKnownSpells} spells
          {selection.rules.wizardSpellbook ? ` · ${selection.preparedLevelSpellCount}/${selection.rules.maxPreparedSpells} prepared` : ''}
        </b>
        <small>{selection.summary}. Cantrips and level 1+ spells have separate class-level limits.</small>
        {sheet.spellLongRestActive ? <small>DM has completed a Long Rest; its spell-change window is open.</small> : null}
      </div>

      <div className="player-spellbook-layout">
        <nav className="player-spellbook-list" aria-label="Spell results">
          {filtered.map((spell) => {
            const available = spellIsAvailableToCharacter(spell, sheet.className, actor.level) || grantedIds.has(spell.id)
            const owned = knownIds.has(spell.id) || grantedIds.has(spell.id)
            return (
              <button
                type="button"
                key={spell.id}
                className={[selected?.id === spell.id ? 'is-active' : '', available ? 'is-eligible' : 'is-locked'].filter(Boolean).join(' ')}
                onClick={() => setSelectedId(spell.id)}
              >
                <span>{spell.level === 0 ? 'C' : spell.level}</span>
                <strong>{spell.name}</strong>
                <small>{spell.school} · {available ? owned ? 'Known' : 'Available' : 'View only'}</small>
              </button>
            )
          })}
          {!filtered.length ? <p>No spells match this search.</p> : null}
        </nav>

        <article className="player-spellbook-detail">
          {selected ? (
            <>
              <div className="player-spellbook-title">
                <div>
                  <span>{spellLevelLabel(selected.level)} · {selected.school}</span>
                  <h3>{selected.name}</h3>
                </div>
                <div className="player-spellbook-actions">
                  {grantedIds.has(selected.id) ? (
                    <b>Always Prepared</b>
                  ) : !known ? (
                    <button
                      type="button"
                      disabled={!eligible || (selected.level === 0 ? !selection.canAddCantrip : !selection.canAddLevelSpell)}
                      onClick={() => changeSelectedSpell(selected.id)}
                    >
                      {!eligible
                        ? 'Not Your Spell'
                        : selected.level === 0
                          ? selection.canAddCantrip ? 'Learn Cantrip' : 'Cantrip Limit'
                          : selection.canAddLevelSpell ? 'Learn Spell' : 'Spell Limit'}
                    </button>
                  ) : (
                    <>
                      {selected.level > 0 && selection.rules.wizardSpellbook ? (
                        <button
                          type="button"
                          className={prepared ? 'is-prepared' : ''}
                          disabled={prepared ? !selection.canUnprepareLevelSpell : !selection.canPrepareLevelSpell}
                          onClick={() => changeSpellPreparation(!prepared)}
                        >
                          {prepared ? 'Prepared ✓' : 'Prepare'}
                        </button>
                      ) : selected.level === 0 ? <b>Cantrip · Always Ready</b> : <b>Prepared automatically</b>}
                      {selected.level > 0 && !selection.rules.wizardSpellbook && !grantedIds.has(selected.id) ? (
                        <button
                          type="button"
                          className="is-remove"
                          disabled={selected.level === 0 ? !selection.canRemoveCantrip : !selection.canRemoveLevelSpell}
                          onClick={removeSelectedSpell}
                        >
                          Replace
                        </button>
                      ) : null}
                      {selected.level === 0 && !grantedIds.has(selected.id) ? (
                        <button
                          type="button"
                          className="is-remove"
                          disabled={!selection.canRemoveCantrip}
                          onClick={removeSelectedSpell}
                        >
                          Replace Cantrip
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              </div>

              <div className="character-spell-tags">
                {spellMechanicSummary(selected).map((tag) => <span key={tag}>{tag}</span>)}
              </div>
              <dl className="player-spellbook-facts">
                <div><dt>Casting</dt><dd>{selected.castingTime}</dd></div>
                <div><dt>Range</dt><dd>{selected.range}</dd></div>
                <div><dt>Duration</dt><dd>{selected.duration}</dd></div>
                <div><dt>Components</dt><dd>{selected.components.join(', ') || '—'}</dd></div>
              </dl>
              <p className="player-spellbook-description">{selected.description}</p>
              {selected.higherLevel ? <p className="player-spellbook-higher"><b>Higher Level:</b> {selected.higherLevel}</p> : null}
            </>
          ) : <p>Select a spell to inspect it.</p>}
        </article>
      </div>
    </section>
  )
}
