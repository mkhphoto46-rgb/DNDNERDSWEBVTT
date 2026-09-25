import { useState } from 'react'

import { playSpellSfx } from '../lib/audioManager'
import { automaticSpellcastingAbility } from '../lib/characterAutomation'
import {
  featureGrantedSpells,
  openSpellCatalog,
  selectedSpells,
  spellLevelLabel,
} from '../lib/characterRulesCatalog'
import {
  canSpendSpellSlot,
  normalizeSpentSlots,
  spellSlotPool,
} from '../lib/spellRuntime'
import { signed } from '../lib/characterSheet'
import { spellAttackBonus, spellSaveDc } from '../rules/dnd2024'
import { DEFAULT_CHARACTER_SHEET, type Actor } from '../types/actor'
import type { TurnEconomyState } from '../types/actionEconomy'
import { castingTimeActionCost, spellHasAutomatedRule, spellRuleLabel } from '../lib/spellAutomation'
import { remainingTurnResource } from '../lib/actionEconomy'

interface PlayerSpellHudProps {
  actor: Actor
  isDm: boolean
  turnEconomy: TurnEconomyState | null
  inActiveCombat: boolean
  isCurrentTurn: boolean
  onClose: () => void
  onCast: (spellId: string, castLevel: number, actorId?: string) => Promise<void>
  onEndConcentration: (actorId?: string) => Promise<void>
  onMessage: (message: string) => void
  onOpenSpell: (spellId: string) => void
}

export function PlayerSpellHud({ actor, isDm, turnEconomy, inActiveCombat, isCurrentTurn, onClose, onCast, onEndConcentration, onMessage, onOpenSpell }: PlayerSpellHudProps) {
  const [castLevels, setCastLevels] = useState<Record<string, number>>({})
  const sheet = actor.characterSheet ?? { ...DEFAULT_CHARACTER_SHEET }
  const manualSpells = selectedSpells(sheet.knownSpellIds ?? [])
  const grantedSpells = featureGrantedSpells(sheet.className, sheet.subclassName, actor.level)
  const grantedIds = new Set(grantedSpells.map((spell) => spell.id))
  const spells = (isDm ? openSpellCatalog() : [...manualSpells, ...grantedSpells])
    .filter((spell, index, entries) => entries.findIndex((entry) => entry.id === spell.id) === index)
    .sort((left, right) => left.level - right.level || left.name.localeCompare(right.name))
  const preparedIds = new Set(sheet.preparedSpellIds ?? [])
  const pool = spellSlotPool(sheet.className, actor.level)
  const spent = normalizeSpentSlots(pool.slots, sheet.spentSpellSlots)
  const spellcastingAbility = automaticSpellcastingAbility(sheet.className)
  const spellcastingScore = spellcastingAbility ? actor.abilities[spellcastingAbility] : 10
  const concentrationSpell = spells.find((spell) => spell.id === sheet.concentratingSpellId) ?? null

  const castSpell = async (spellId: string, castLevel: number) => {
    const spell = spells.find((entry) => entry.id === spellId)
    if (!spell) return

    if (!spellHasAutomatedRule(spell.id)) {
      onMessage(`${spell.name}: automatic rules resolution is not registered yet. Nothing was spent.`)
      return
    }

    if (!isDm && spell.level > 0 && !grantedIds.has(spell.id) && !preparedIds.has(spell.id)) {
      onMessage(`${spell.name} is known but not prepared.`)
      return
    }

    if (!(isDm && !actor.characterSheet) && !canSpendSpellSlot(pool.slots, spent, castLevel)) {
      onMessage(`No level ${castLevel} spell slot remains.`)
      return
    }

    const cost = castingTimeActionCost(spell.castingTime)
    if (cost === 'reaction') {
      onMessage(`${spell.name} must be cast from a server-authored Reaction Window.`)
      return
    }
    if (inActiveCombat && !isDm && !isCurrentTurn) {
      onMessage(`${spell.name} cannot be cast because it is not your turn.`)
      return
    }
    if (inActiveCombat && !isDm && spell.level > 0 && turnEconomy?.spellSlotExpendedTurnKey) {
      onMessage('You already expended a spell slot to cast a spell on this turn.')
      return
    }
    if (inActiveCombat && (cost === 'long-cast' || cost === 'none')) {
      onMessage(`${spell.name} does not have a supported combat casting time.`)
      return
    }
    if (inActiveCombat && turnEconomy) {
      if (cost === 'action' && remainingTurnResource(turnEconomy, 'action') < 1) {
        onMessage('Your Action is already spent.')
        return
      }
      if (cost === 'bonus-action' && remainingTurnResource(turnEconomy, 'bonus-action') < 1) {
        onMessage('Your Bonus Action is already spent.')
        return
      }
    }

    try {
      await onCast(spell.id, castLevel, actor.id)
      void playSpellSfx(spell)
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Spell casting could not be resolved.')
    }
  }

  return (
    <aside className="player-spell-hud" aria-label="Player spell casting">
      <header className="player-spell-hud-header">
        <div>
        <span>{isDm ? 'DM SPELL CASTING' : 'ARCANE QUICK CAST'}</span>
          <h2>{actor.name}</h2>
        </div>
        <div className="player-spell-hud-header-actions">
          <button type="button" className="player-spell-hud-open-book" onClick={() => onOpenSpell('')}>Spell List</button>
          <button type="button" className="player-spell-hud-close" onClick={onClose} aria-label="Close spell casting">×</button>
        </div>
      </header>

      <div className="player-spell-statline">
        <div><small>HP</small><strong>{actor.currentHp}/{actor.maxHp}</strong></div>
        <div><small>AC</small><strong>{actor.ac}</strong></div>
        <div><small>SPEED</small><strong>{actor.speedFeet}</strong></div>
        <div><small>SAVE DC</small><strong>{spellcastingAbility ? spellSaveDc(actor.level, spellcastingScore) : '—'}</strong></div>
        <div><small>ATTACK</small><strong>{spellcastingAbility ? signed(spellAttackBonus(actor.level, spellcastingScore)) : '—'}</strong></div>
      </div>

      {pool.slots.some((maximum) => maximum > 0) ? (
        <div className="player-spell-slots" aria-label="Remaining spell slots">
          {pool.slots.map((maximum, index) => maximum > 0 ? (
            <div key={index + 1}>
              <span>L{index + 1}</span>
              <b>{Math.max(0, maximum - (spent[index] ?? 0))}/{maximum}</b>
            </div>
          ) : null)}
        </div>
      ) : null}

      {concentrationSpell ? (
        <div className="player-spell-concentration">
          <span>CONCENTRATION</span>
          <strong>{concentrationSpell.name}</strong>
          <button type="button" onClick={() => void onEndConcentration(actor.id)}>End</button>
        </div>
      ) : null}

      <div className="player-spell-cast-list">
        {spells.length ? spells.map((spell) => {
          const prepared = spell.level === 0 || grantedIds.has(spell.id) || preparedIds.has(spell.id)
          const availableLevels = spell.level === 0
            ? [0]
            : isDm && !actor.characterSheet
              ? Array.from({ length: 10 - spell.level }, (_, index) => spell.level + index)
            : pool.kind === 'pact' && pool.pactSlotLevel
              ? pool.pactSlotLevel >= spell.level ? [pool.pactSlotLevel] : []
              : pool.slots
                .map((maximum, index) => ({ maximum, level: index + 1 }))
                .filter(({ maximum, level }) => maximum > 0 && level >= spell.level)
                .map(({ level }) => level)
          const chosenLevel = availableLevels.includes(castLevels[spell.id])
            ? castLevels[spell.id]
            : availableLevels.find((level) => level === 0 || canSpendSpellSlot(pool.slots, spent, level))
              ?? availableLevels[0]
              ?? spell.level
          const hasSlot = (isDm && !actor.characterSheet) || spell.level === 0 || canSpendSpellSlot(pool.slots, spent, chosenLevel)
          const automated = spellHasAutomatedRule(spell.id)
          const cost = castingTimeActionCost(spell.castingTime)
          const reactionRequiresWindow = cost === 'reaction'
          const slotBlockedThisTurn = Boolean(
            inActiveCombat &&
            isCurrentTurn &&
            spell.level > 0 &&
            turnEconomy?.spellSlotExpendedTurnKey,
          )
          const wrongTurn = inActiveCombat && !isCurrentTurn
          const unsupportedCombatTime = inActiveCombat && (cost === 'long-cast' || cost === 'none')
          const resourceAvailable = !inActiveCombat || !turnEconomy || (
            cost === 'action'
              ? remainingTurnResource(turnEconomy, 'action') > 0
              : cost === 'bonus-action'
                ? remainingTurnResource(turnEconomy, 'bonus-action') > 0
                : true
          )
          const canCast = Boolean(
            automated &&
            (isDm || prepared) &&
            hasSlot &&
            actor.lifeState === 'conscious' &&
            !reactionRequiresWindow &&
            !slotBlockedThisTurn &&
            !wrongTurn &&
            !unsupportedCombatTime &&
            resourceAvailable,
          )

          const castBlockLabel = reactionRequiresWindow
            ? 'Trigger Required'
            : slotBlockedThisTurn
              ? 'Slot Used This Turn'
              : wrongTurn
                ? 'Not Your Turn'
                : unsupportedCombatTime
                  ? 'Combat Timing Pending'
                  : !resourceAvailable
                    ? cost === 'bonus-action' ? 'Bonus Action Spent' : 'Action Spent'
                    : null

          return (
            <article
              className={canCast ? 'player-spell-cast-row is-ready' : 'player-spell-cast-row'}
              key={spell.id}
              tabIndex={0}
              title="Double-click for the complete spell description"
              onDoubleClick={(event) => {
                if ((event.target as Element).closest('button, select')) return
                onOpenSpell(spell.id)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onOpenSpell(spell.id)
              }}
            >
              <div className="player-spell-cast-name">
                <span>{spellLevelLabel(spell.level)}</span>
                <strong>{spell.name}</strong>
                <small>
                  {spell.concentration ? 'Concentration · ' : ''}
                  {!automated
                    ? spellRuleLabel(spell.id)
                    : grantedIds.has(spell.id) ? 'Always prepared' : prepared ? 'Ready' : 'Not prepared'}
                </small>
              </div>
              {spell.level > 0 ? (
                <label>
                  <span>CAST AT</span>
                  <select
                    value={chosenLevel}
                    onChange={(event) => setCastLevels((current) => ({
                      ...current,
                      [spell.id]: Number(event.target.value),
                    }))}
                  >
                    {availableLevels.map((level) => (
                      <option key={level} value={level}>Level {level}</option>
                    ))}
                  </select>
                </label>
              ) : <span className="player-spell-cantrip-mark">∞</span>}
              <button
                type="button"
                disabled={!canCast}
                onClick={() => void castSpell(spell.id, chosenLevel)}
              >
                {!automated
                  ? 'Unavailable'
                  : !prepared
                    ? 'Prepare'
                    : !hasSlot
                      ? 'No Slot'
                      : actor.lifeState !== 'conscious'
                        ? actor.lifeState
                        : castBlockLabel ?? 'Cast'}
              </button>
            </article>
          )
        }) : (
          <p className="player-spell-empty">Add spells in your Character Sheet. Feature-granted spells appear here automatically.</p>
        )}
      </div>
    </aside>
  )
}
