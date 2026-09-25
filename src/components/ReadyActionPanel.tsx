import { useEffect, useMemo, useState } from 'react'
import { attackProfilesForActor } from '../lib/combatActions'
import { featureGrantedSpells, selectedSpells } from '../lib/characterRulesCatalog'
import { castingTimeActionCost, spellHasAutomatedRule } from '../lib/spellAutomation'
import { canSpendSpellSlot, normalizeSpentSlots, spellSlotPool } from '../lib/spellRuntime'
import {
  ALL_CHARACTER_SKILLS,
  INFLUENCE_SKILLS,
  SEARCH_SKILLS,
  STUDY_SKILLS,
  type CoreUtilityAction,
  type HelpUtilityMode,
} from '../lib/utilityActions'
import type { Actor, CharacterSkill } from '../types/actor'
import type { TurnEconomyState } from '../types/actionEconomy'
import type { ReadiedActionKind, ReadiedSpellPayload, ReadiedUtilityPayload } from '../types/readyAction'

export interface ReadyActionPrepareRequest {
  kind: ReadiedActionKind
  triggerText: string
  attackId?: string
  preparedTargetActorId?: string
  utility?: ReadiedUtilityPayload
  spell?: ReadiedSpellPayload
}

interface Props {
  actor: Actor
  actors: Actor[]
  turnEconomy: TurnEconomyState | null
  defaultTargetActorId?: string
  onClose: () => void
  onPrepare: (request: ReadyActionPrepareRequest) => Promise<void> | void
}

const UTILITY_LABELS: Record<CoreUtilityAction, string> = {
  help: 'Help', hide: 'Hide', influence: 'Influence', search: 'Search', study: 'Study', utilize: 'Utilize',
}

const SKILL_LABELS: Record<CharacterSkill, string> = {
  acrobatics: 'Acrobatics', animalHandling: 'Animal Handling', arcana: 'Arcana', athletics: 'Athletics',
  deception: 'Deception', history: 'History', insight: 'Insight', intimidation: 'Intimidation',
  investigation: 'Investigation', medicine: 'Medicine', nature: 'Nature', perception: 'Perception',
  performance: 'Performance', persuasion: 'Persuasion', religion: 'Religion', sleightOfHand: 'Sleight of Hand',
  stealth: 'Stealth', survival: 'Survival',
}

export function ReadyActionPanel({ actor, actors, turnEconomy, defaultTargetActorId = '', onClose, onPrepare }: Props) {
  const attacks = useMemo(() => attackProfilesForActor(actor), [actor])
  const [kind, setKind] = useState<ReadiedActionKind>('attack')
  const [triggerText, setTriggerText] = useState('')
  const [attackId, setAttackId] = useState(attacks[0]?.id ?? '')
  const [preparedTargetActorId, setPreparedTargetActorId] = useState(defaultTargetActorId)
  const [utilityAction, setUtilityAction] = useState<CoreUtilityAction>('search')
  const [helpMode, setHelpMode] = useState<HelpUtilityMode>('ability-check')
  const [utilityTargetActorId, setUtilityTargetActorId] = useState(defaultTargetActorId)
  const [skill, setSkill] = useState<CharacterSkill>('perception')
  const [objectName, setObjectName] = useState('')
  const [spellId, setSpellId] = useState('')
  const [spellCastLevels, setSpellCastLevels] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)

  const sheet = actor.characterSheet
  const readiableSpells = useMemo(() => {
    if (!sheet) return []
    const manual = selectedSpells(sheet.knownSpellIds ?? [])
    const granted = featureGrantedSpells(sheet.className, sheet.subclassName, actor.level)
    const grantedIds = new Set(granted.map((spell) => spell.id))
    const preparedIds = new Set(sheet.preparedSpellIds ?? [])
    return [...manual, ...granted]
      .filter((spell, index, entries) => entries.findIndex((entry) => entry.id === spell.id) === index)
      .filter((spell) => (spell.level === 0 || grantedIds.has(spell.id) || preparedIds.has(spell.id)))
      .filter((spell) => spellHasAutomatedRule(spell.id) && castingTimeActionCost(spell.castingTime) === 'action')
      .sort((left, right) => left.level - right.level || left.name.localeCompare(right.name))
  }, [actor.level, sheet])

  useEffect(() => {
    if (!spellId && readiableSpells[0]) setSpellId(readiableSpells[0].id)
    if (spellId && !readiableSpells.some((spell) => spell.id === spellId)) setSpellId(readiableSpells[0]?.id ?? '')
  }, [readiableSpells, spellId])

  const selectedSpell = readiableSpells.find((spell) => spell.id === spellId) ?? null
  const pool = sheet ? spellSlotPool(sheet.className, actor.level) : { slots: [], kind: 'full' as const, pactSlotLevel: null }
  const spent = sheet ? normalizeSpentSlots(pool.slots, sheet.spentSpellSlots) : []
  const spellAvailableLevels = selectedSpell
    ? selectedSpell.level === 0
      ? [0]
      : pool.kind === 'pact' && pool.pactSlotLevel
        ? pool.pactSlotLevel >= selectedSpell.level ? [pool.pactSlotLevel] : []
        : pool.slots
          .map((maximum, index) => ({ maximum, level: index + 1 }))
          .filter(({ maximum, level }) => maximum > 0 && level >= selectedSpell.level)
          .map(({ level }) => level)
    : []
  const selectedCastLevel = selectedSpell
    ? spellAvailableLevels.includes(spellCastLevels[selectedSpell.id])
      ? spellCastLevels[selectedSpell.id]
      : spellAvailableLevels.find((level) => level === 0 || canSpendSpellSlot(pool.slots, spent, level))
        ?? spellAvailableLevels[0]
        ?? selectedSpell.level
    : 0
  const spellHasSlot = !selectedSpell || selectedSpell.level === 0 || canSpendSpellSlot(pool.slots, spent, selectedCastLevel)
  const spellSlotGateOpen = !selectedSpell || selectedSpell.level === 0 || !turnEconomy?.spellSlotExpendedTurnKey

  const helperSkills = useMemo(() => {
    if (!sheet) return [] as CharacterSkill[]
    return ALL_CHARACTER_SKILLS.filter((candidate) =>
      sheet.skillProficiencies.includes(candidate) || sheet.skillExpertise.includes(candidate),
    )
  }, [sheet])

  const actionSkills: readonly CharacterSkill[] = utilityAction === 'search'
    ? SEARCH_SKILLS
    : utilityAction === 'study'
      ? STUDY_SKILLS
      : utilityAction === 'influence'
        ? INFLUENCE_SKILLS
        : utilityAction === 'hide'
          ? ['stealth']
          : utilityAction === 'help' && helpMode === 'ability-check'
            ? helperSkills
            : []

  useEffect(() => {
    if (actionSkills.length > 0 && !actionSkills.includes(skill)) setSkill(actionSkills[0])
  }, [actionSkills, skill])

  const utilityTargets = actors.filter((candidate) => {
    if (candidate.id === actor.id) return false
    if (utilityAction === 'influence') return candidate.kind !== 'player'
    if (utilityAction === 'help' && helpMode === 'ability-check') return (candidate.kind === 'player') === (actor.kind === 'player')
    if (utilityAction === 'help' && helpMode === 'attack-roll') return (candidate.kind === 'player') !== (actor.kind === 'player')
    return true
  })

  const utilityNeedsTarget = utilityAction === 'help' || utilityAction === 'influence'
  const utilityNeedsSkill = utilityAction === 'hide' || utilityAction === 'search' || utilityAction === 'study' || utilityAction === 'influence' || (utilityAction === 'help' && helpMode === 'ability-check')

  const submit = async () => {
    const trigger = triggerText.trim()
    if (!trigger) return
    setBusy(true)
    try {
      if (kind === 'attack') {
        await onPrepare({ kind, triggerText: trigger, attackId, preparedTargetActorId: preparedTargetActorId || undefined })
      } else if (kind === 'spell') {
        if (!selectedSpell) return
        await onPrepare({
          kind,
          triggerText: trigger,
          spell: { spellId: selectedSpell.id, castLevel: selectedCastLevel },
        })
      } else {
        const utility: ReadiedUtilityPayload = {
          action: utilityAction,
          helpMode: utilityAction === 'help' ? helpMode : null,
          targetActorId: utilityNeedsTarget ? (utilityTargetActorId || null) : null,
          skill: utilityNeedsSkill ? (utilityAction === 'hide' ? 'stealth' : skill) : null,
          objectName: utilityAction === 'utilize' ? (objectName.trim() || null) : null,
        }
        await onPrepare({ kind, triggerText: trigger, utility })
      }
    } finally {
      setBusy(false)
    }
  }

  const canSubmit = !busy && Boolean(triggerText.trim()) && (
    kind === 'attack'
      ? Boolean(attackId)
      : kind === 'spell'
        ? Boolean(selectedSpell && spellHasSlot && spellSlotGateOpen)
        : (!utilityNeedsTarget || Boolean(utilityTargetActorId)) &&
          (!utilityNeedsSkill || actionSkills.length > 0) &&
          (utilityAction !== 'utilize' || Boolean(objectName.trim()))
  )

  return <section className="player-attack-hud" aria-label="Ready action setup">
    <header><div><span>2024 READY ACTION</span><strong>{actor.name}</strong></div><button type="button" onClick={onClose} aria-label="Close">×</button></header>
    <label><span>Perceivable Trigger</span><textarea value={triggerText} maxLength={240} rows={3} placeholder="When the ogre crosses the doorway…" onChange={(event) => setTriggerText(event.target.value)} /></label>
    <label><span>Readied Action</span><select value={kind} onChange={(event) => setKind(event.target.value as ReadiedActionKind)}><option value="attack">Attack</option><option value="utility">Utility Action</option><option value="spell">Spell (Action casting time)</option></select></label>

    {kind === 'attack' ? <>
      <label><span>Attack</span><select value={attackId} onChange={(event) => setAttackId(event.target.value)}>{attacks.map((attack) => <option key={attack.id} value={attack.id}>{attack.name}</option>)}</select></label>
      <label><span>Prepared Target (optional)</span><select value={preparedTargetActorId} onChange={(event) => setPreparedTargetActorId(event.target.value)}><option value="">Choose when triggered</option>{actors.filter((candidate) => candidate.id !== actor.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
    </> : kind === 'spell' ? <>
      <label><span>Spell</span><select value={spellId} onChange={(event) => setSpellId(event.target.value)}><option value="">Choose…</option>{readiableSpells.map((spell) => <option key={spell.id} value={spell.id}>{spell.name} · {spell.level === 0 ? 'Cantrip' : `Level ${spell.level}`}</option>)}</select></label>
      {selectedSpell && selectedSpell.level > 0 ? <label><span>Cast At</span><select value={selectedCastLevel} onChange={(event) => setSpellCastLevels((current) => ({ ...current, [selectedSpell.id]: Number(event.target.value) }))}>{spellAvailableLevels.map((level) => <option key={level} value={level}>Level {level}</option>)}</select></label> : null}
      {!selectedSpell ? <p className="player-attack-meta">No prepared, automated Action-casting-time spell is available.</p> : !spellHasSlot ? <p className="player-attack-meta">No matching spell slot remains.</p> : !spellSlotGateOpen ? <p className="player-attack-meta">A spell slot was already expended to cast a spell on this turn.</p> : <p className="player-attack-meta">The spell is cast now: Action and slot are spent now, and holding its energy requires Concentration until your next turn. Targets are chosen and revalidated when the trigger is used.</p>}
    </> : <>
      <label><span>Utility Action</span><select value={utilityAction} onChange={(event) => setUtilityAction(event.target.value as CoreUtilityAction)}>{Object.entries(UTILITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {utilityAction === 'help' ? <label><span>Help Type</span><select value={helpMode} onChange={(event) => setHelpMode(event.target.value as HelpUtilityMode)}><option value="ability-check">Assist Ability Check</option><option value="attack-roll">Assist Attack Roll</option></select></label> : null}
      {utilityNeedsTarget ? <label><span>Target</span><select value={utilityTargetActorId} onChange={(event) => setUtilityTargetActorId(event.target.value)}><option value="">Choose…</option>{utilityTargets.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label> : null}
      {utilityNeedsSkill ? <label><span>Skill</span><select value={utilityAction === 'hide' ? 'stealth' : skill} disabled={utilityAction === 'hide'} onChange={(event) => setSkill(event.target.value as CharacterSkill)}>{actionSkills.map((candidate) => <option key={candidate} value={candidate}>{SKILL_LABELS[candidate]}</option>)}</select></label> : null}
      {utilityAction === 'utilize' ? <label><span>Nonmagical Object</span><input value={objectName} maxLength={100} onChange={(event) => setObjectName(event.target.value)} placeholder="Door lever, healer's kit…" /></label> : null}
    </>}

    <p className="player-attack-meta">The Action is spent now. Only the DM can confirm that the trigger occurred. If triggered, using the prepared action spends your Reaction.</p>
    <button type="button" className="combat-resolve-button" disabled={!canSubmit} onClick={() => void submit()}>{busy ? 'Preparing…' : 'Ready Action'}</button>
  </section>
}
