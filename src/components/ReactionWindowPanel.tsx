import { useMemo, useState } from 'react'
import { attackProfilesForActor } from '../lib/combatActions'
import { spellById } from '../lib/characterRulesCatalog'
import { spellTargetRule } from '../lib/spellAutomation'
import type { Actor } from '../types/actor'
import type { ReactionDecision, ReactionWindow } from '../types/reaction'

interface Props {
  window: ReactionWindow
  reactor: Actor
  triggerActor: Actor | null
  actors: Actor[]
  onRespond: (
    windowId: string,
    decision: ReactionDecision,
    attackId?: string,
    targetActorId?: string,
    spellTargetActorIds?: string[],
    areaGridX?: number,
    areaGridY?: number,
  ) => Promise<void>
  onMessage: (message: string) => void
}

export function ReactionWindowPanel({ window, reactor, triggerActor, actors, onRespond, onMessage }: Props) {
  const opportunityAttacks = useMemo(
    () => window.kind === 'opportunity-attack'
      ? attackProfilesForActor(reactor).filter((profile) => (
          profile.attackType === 'melee' && window.eligibleAttackIds.includes(profile.id)
        ))
      : [],
    [reactor, window],
  )
  const [attackId, setAttackId] = useState(opportunityAttacks[0]?.id ?? '')
  const initialReadyTarget = window.kind === 'readied-action'
    ? window.preparedTargetActorId ?? actors.find((candidate) => candidate.id !== reactor.id)?.id ?? ''
    : ''
  const [targetActorId, setTargetActorId] = useState(initialReadyTarget)
  const [spellTargetActorIds, setSpellTargetActorIds] = useState<string[]>([])
  const [areaGridX, setAreaGridX] = useState(0)
  const [areaGridY, setAreaGridY] = useState(0)
  const [busy, setBusy] = useState(false)

  const readySpell = window.kind === 'readied-action' && window.readyActionKind === 'spell'
    ? spellById(window.readySpellId ?? '')
    : null
  const readySpellRule = readySpell
    ? spellTargetRule(readySpell, window.kind === 'readied-action' ? window.readySpellCastLevel ?? readySpell.level : readySpell.level)
    : null

  const toggleSpellTarget = (actorId: string) => {
    if (!readySpellRule || readySpellRule.mode !== 'creatures') return
    setSpellTargetActorIds((current) => {
      if (current.includes(actorId)) return current.filter((candidate) => candidate !== actorId)
      if (current.length >= readySpellRule.maxTargets) return current
      return [...current, actorId]
    })
  }

  const respond = (decision: ReactionDecision) => {
    if (busy) return
    if (window.kind === 'opportunity-attack' && decision === 'use' && !attackId) {
      onMessage('No eligible melee attack is available for this Opportunity Attack.')
      return
    }
    if (
      window.kind === 'readied-action' &&
      window.readyActionKind === 'attack' &&
      decision === 'use' &&
      !targetActorId
    ) {
      onMessage('Choose a target for the readied Attack.')
      return
    }
    if (window.kind === 'readied-action' && window.readyActionKind === 'spell' && decision === 'use') {
      if (!readySpell || !readySpellRule) {
        onMessage('The prepared spell rule is no longer available.')
        return
      }
      if (readySpellRule.mode === 'creatures' && (
        spellTargetActorIds.length < readySpellRule.minTargets ||
        spellTargetActorIds.length > readySpellRule.maxTargets
      )) {
        onMessage(`Choose ${readySpellRule.minTargets === readySpellRule.maxTargets ? readySpellRule.maxTargets : `${readySpellRule.minTargets}-${readySpellRule.maxTargets}`} legal spell target(s).`)
        return
      }
    }
    setBusy(true)
    void onRespond(
      window.id,
      decision,
      window.kind === 'opportunity-attack' && decision === 'use' ? attackId : undefined,
      window.kind === 'readied-action' && window.readyActionKind === 'attack' && decision === 'use'
        ? targetActorId
        : undefined,
      window.kind === 'readied-action' && window.readyActionKind === 'spell' && decision === 'use'
        ? readySpellRule?.mode === 'self'
          ? [reactor.id]
          : readySpellRule?.mode === 'creatures'
            ? spellTargetActorIds
            : []
        : undefined,
      window.kind === 'readied-action' && window.readyActionKind === 'spell' && decision === 'use' && readySpellRule?.mode === 'point-area'
        ? areaGridX
        : undefined,
      window.kind === 'readied-action' && window.readyActionKind === 'spell' && decision === 'use' && readySpellRule?.mode === 'point-area'
        ? areaGridY
        : undefined,
    )
      .catch((error) => onMessage(error instanceof Error ? error.message : 'Reaction failed.'))
      .finally(() => setBusy(false))
  }

  if (window.kind === 'readied-action') {
    return <section className="map-action-target-bar" aria-label="Readied action reaction window">
      <div>
        <span>REACTION WINDOW</span>
        <strong>Ready: {window.readyActionLabel}</strong>
        <small>Trigger confirmed by DM: {window.triggerText}</small>
        <em>{reactor.name} can use the prepared action now or ignore this trigger.</em>
        {window.readyActionKind === 'spell' ? <small>The spell slot and Action were already spent when the spell was readied. Using it now spends only the Reaction.</small> : null}
      </div>
      <div className="map-action-target-actions">
        {window.readyActionKind === 'attack' ? (
          <select
            value={targetActorId}
            disabled={busy || Boolean(window.preparedTargetActorId)}
            onChange={(event) => setTargetActorId(event.target.value)}
          >
            <option value="">Choose target…</option>
            {actors.filter((candidate) => candidate.id !== reactor.id).map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
            ))}
          </select>
        ) : null}
        {window.readyActionKind === 'spell' && readySpellRule?.mode === 'creatures' ? (
          <div style={{ display: 'grid', gap: 4, maxHeight: 150, overflowY: 'auto' }}>
            <small>{readySpellRule.label}</small>
            {actors.map((candidate) => (
              <label key={candidate.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={spellTargetActorIds.includes(candidate.id)}
                  disabled={busy || (!spellTargetActorIds.includes(candidate.id) && spellTargetActorIds.length >= readySpellRule.maxTargets)}
                  onChange={() => toggleSpellTarget(candidate.id)}
                />
                <span>{candidate.name}</span>
              </label>
            ))}
          </div>
        ) : null}
        {window.readyActionKind === 'spell' && readySpellRule?.mode === 'point-area' ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <label><span>Grid X</span><input type="number" value={areaGridX} disabled={busy} onChange={(event) => setAreaGridX(Number(event.target.value))} /></label>
            <label><span>Grid Y</span><input type="number" value={areaGridY} disabled={busy} onChange={(event) => setAreaGridY(Number(event.target.value))} /></label>
          </div>
        ) : null}
        <button type="button" disabled={busy} onClick={() => respond('decline')}>Ignore Trigger</button>
        <button type="button" className="is-confirm" disabled={busy} onClick={() => respond('use')}>
          {busy ? 'Resolving…' : `Use ${window.readyActionLabel}`}
        </button>
      </div>
    </section>
  }

  const selectedAttack = opportunityAttacks.find((attack) => attack.id === attackId) ?? opportunityAttacks[0] ?? null
  return <section className="map-action-target-bar" aria-label="Reaction window">
    <div>
      <span>REACTION WINDOW</span>
      <strong>Opportunity Attack</strong>
      <small>{reactor.name} can react to {triggerActor?.name ?? 'the moving creature'} leaving reach.</small>
      <em>Reaction is validated and spent by the server.</em>
    </div>
    <div className="map-action-target-actions">
      {opportunityAttacks.length > 1 ? (
        <select value={attackId} onChange={(event) => setAttackId(event.target.value)} disabled={busy}>
          {opportunityAttacks.map((attack) => <option key={attack.id} value={attack.id}>{attack.name}</option>)}
        </select>
      ) : null}
      <button type="button" disabled={busy} onClick={() => respond('decline')}>Decline</button>
      <button type="button" className="is-confirm" disabled={busy || opportunityAttacks.length === 0} onClick={() => respond('use')}>
        {busy ? 'Resolving…' : `Use ${selectedAttack?.name ?? 'Reaction'}`}
      </button>
    </div>
  </section>
}
