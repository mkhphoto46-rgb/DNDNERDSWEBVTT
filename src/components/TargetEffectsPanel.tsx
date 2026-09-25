import { useMemo, useState } from 'react'

import { MECHANICAL_CONDITIONS } from '../lib/effects'

import type {
  Actor,
  ActorEffectKind,
  ActorEffectScope,
} from '../types/actor'
import type { TurnEconomyOverridePatch, TurnEconomyState } from '../types/actionEconomy'

export type TargetApplyKind = Exclude<ActorEffectKind, 'dice-bonus'> | 'temp-hp'

export interface TargetEffectDraft {
  kind: TargetApplyKind
  scope: ActorEffectScope
  value: number
  name: string
  sourceActorId: string | null
}

interface TargetEffectsPanelProps {
  target: Actor
  isDm: boolean
  ownActor: Actor | null
  sourceActors: Actor[]
  sourceActorId: string
  onSourceActorChange: (actorId: string) => void
  onApply: (draft: TargetEffectDraft) => Promise<void>
  onRemove: (effectId: string) => Promise<void>
  onClearTarget: () => void
  turnEconomy: TurnEconomyState | null
  onTurnOverride: (patch: TurnEconomyOverridePatch, label: string) => Promise<void>
  onTurnReset: () => Promise<void>
}

const EFFECT_LABELS: Record<TargetApplyKind, string> = {
  advantage: 'Advantage',
  disadvantage: 'Disadvantage',
  'roll-modifier': 'd20 Modifier',
  'speed-modifier': 'Speed Modifier',
  condition: 'Condition',
  'temp-hp': 'Temporary HP',
}

const SCOPE_LABELS: Record<ActorEffectScope, string> = {
  'all-d20': 'All d20 Rolls',
  attack: 'Attack Rolls',
  'saving-throw': 'Saving Throws',
  'attack-save': 'Attack + Saving Throws',
  'ability-check': 'Ability Checks',
  'skill-check': 'Skill Checks',
  spell: 'Spell Rolls',
}

function needsScope(kind: TargetApplyKind): boolean {
  return kind === 'advantage' ||
    kind === 'disadvantage' ||
    kind === 'roll-modifier'
}

function needsValue(kind: TargetApplyKind): boolean {
  return kind === 'roll-modifier' ||
    kind === 'speed-modifier' ||
    kind === 'temp-hp'
}

export function TargetEffectsPanel({
  target,
  isDm,
  ownActor,
  sourceActors,
  sourceActorId,
  onSourceActorChange,
  onApply,
  onRemove,
  onClearTarget,
  turnEconomy,
  onTurnOverride,
  onTurnReset,
}: TargetEffectsPanelProps) {
  const [kind, setKind] = useState<TargetApplyKind>('advantage')
  const [scope, setScope] = useState<ActorEffectScope>('all-d20')
  const [value, setValue] = useState(1)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const visibleEffects = target.effects ?? []
  const statusLabels = useMemo(
    () => [
      ...target.conditions.map((condition) => `Condition: ${condition}`),
      ...visibleEffects
        .filter((effect) => effect.kind !== 'condition')
        .map((effect) => effect.name),
      ...(target.tempHp > 0 ? [`Temp HP: ${target.tempHp}`] : []),
    ],
    [target.conditions, target.tempHp, visibleEffects],
  )

  const submit = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onApply({
        kind,
        scope,
        value,
        name,
        sourceActorId: isDm && sourceActorId ? sourceActorId : ownActor?.id ?? null,
      })
      if (kind === 'condition') setName('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="target-effects-panel" aria-label={`Target ${target.name}`}>
      <header>
        <div>
          <span>DM OVERRIDE TARGET</span>
          <strong>{target.name}</strong>
        </div>
        <button type="button" onClick={onClearTarget} aria-label="Clear target">×</button>
      </header>

      {isDm ? (
        <label className="target-effect-source">
          <span>SOURCE</span>
          <select
            value={sourceActorId}
            onChange={(event) => onSourceActorChange(event.target.value)}
          >
            <option value="">DM / Environment</option>
            {sourceActors.map((actor) => (
              <option value={actor.id} key={actor.id}>{actor.name}</option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="target-effect-controls">
        <label>
          <span>EFFECT</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as TargetApplyKind)}>
            {Object.entries(EFFECT_LABELS).map(([effectKind, label]) => (
              <option value={effectKind} key={effectKind}>{label}</option>
            ))}
          </select>
        </label>

        {needsScope(kind) ? (
          <label>
            <span>APPLIES TO</span>
            <select value={scope} onChange={(event) => setScope(event.target.value as ActorEffectScope)}>
              {Object.entries(SCOPE_LABELS).map(([effectScope, label]) => (
                <option value={effectScope} key={effectScope}>{label}</option>
              ))}
            </select>
          </label>
        ) : null}

        {kind === 'condition' ? (
          <label>
            <span>CONDITION</span>
            <select
              value={name}
              onChange={(event) => setName(event.target.value)}
            >
              <option value="">Choose condition…</option>
              {MECHANICAL_CONDITIONS.map((condition) => (
                <option value={condition} key={condition}>{condition}</option>
              ))}
            </select>
          </label>
        ) : null}

        {needsValue(kind) ? (
          <label>
            <span>VALUE</span>
            <input
              type="number"
              min={kind === 'temp-hp' ? 1 : -100}
              max={kind === 'temp-hp' ? 999 : 100}
              value={value}
              onChange={(event) => setValue(Math.round(Number(event.target.value) || 0))}
            />
          </label>
        ) : null}

        <button type="button" className="target-effect-apply" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Applying…' : 'Apply'}
        </button>
      </div>

      {isDm && turnEconomy ? (
        <div className="target-turn-override" aria-label="DM Action Economy override">
          <span>TURN ECONOMY OVERRIDE</span>
          <div className="target-turn-override-grid">
            <button type="button" onClick={() => void onTurnOverride({ actionMax: turnEconomy.actionMax + 1 }, '+1 Action')}>+ Action</button>
            <button type="button" onClick={() => void onTurnOverride({ actionUsed: Math.min(turnEconomy.actionMax, turnEconomy.actionUsed + 1) }, 'Spend Action')}>Spend Action</button>
            <button type="button" onClick={() => void onTurnOverride({ actionUsed: Math.max(0, turnEconomy.actionUsed - 1) }, 'Restore Action')}>Restore Action</button>
            <button type="button" onClick={() => void onTurnOverride({ bonusActionMax: turnEconomy.bonusActionMax + 1 }, '+1 Bonus Action')}>+ Bonus</button>
            <button type="button" onClick={() => void onTurnOverride({ bonusActionUsed: Math.min(turnEconomy.bonusActionMax, turnEconomy.bonusActionUsed + 1) }, 'Spend Bonus Action')}>Spend Bonus</button>
            <button type="button" onClick={() => void onTurnOverride({ bonusActionUsed: Math.max(0, turnEconomy.bonusActionUsed - 1) }, 'Restore Bonus Action')}>Restore Bonus</button>
            <button type="button" onClick={() => void onTurnOverride({ reactionMax: turnEconomy.reactionMax + 1 }, '+1 Reaction')}>+ Reaction</button>
            <button type="button" onClick={() => void onTurnOverride({ reactionUsed: Math.min(turnEconomy.reactionMax, turnEconomy.reactionUsed + 1) }, 'Spend Reaction')}>Spend Reaction</button>
            <button type="button" onClick={() => void onTurnOverride({ reactionUsed: Math.max(0, turnEconomy.reactionUsed - 1) }, 'Restore Reaction')}>Restore Reaction</button>
            <button type="button" onClick={() => void onTurnOverride({ movementBonusFeet: turnEconomy.movementBonusFeet + 10 }, '+10 ft Movement')}>+10 ft Move</button>
            <button type="button" onClick={() => void onTurnOverride({ movementBonusFeet: turnEconomy.movementBonusFeet - 10 }, '-10 ft Movement')}>-10 ft Move</button>
            <button type="button" onClick={() => void onTurnOverride({ attackLimit: turnEconomy.attackLimit + 1 }, '+1 Attack in Action')}>+ Attack</button>
            <button type="button" className="is-reset" onClick={() => void onTurnReset()}>Reset Turn</button>
          </div>
        </div>
      ) : null}

      <div className="target-effect-statuses" aria-label="Active target effects">
        {statusLabels.length === 0 ? (
          <small>No public effects on this target.</small>
        ) : (
          statusLabels.map((label) => <span key={label}>{label}</span>)
        )}
      </div>

      {visibleEffects.length > 0 ? (
        <div className="target-effect-active-list">
          {visibleEffects.map((effect) => {
            const removable = isDm || (
              effect.sourceRole === 'player' &&
              Boolean(ownActor) &&
              effect.sourceActorId === ownActor?.id
            )

            return (
              <div key={effect.id}>
                <span>
                  <strong>{effect.name}</strong>
                  <small>from {effect.sourceActorName}</small>
                </span>
                {removable ? (
                  <button type="button" onClick={() => void onRemove(effect.id)} aria-label={`Remove ${effect.name}`}>Remove</button>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}
