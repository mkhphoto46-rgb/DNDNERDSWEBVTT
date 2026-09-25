import type { Actor } from '../types/actor'
import { spellById } from '../lib/characterRulesCatalog'
import type { ReadiedAction } from '../types/readyAction'

interface Props {
  actions: ReadiedAction[]
  actors: Actor[]
  isDm: boolean
  onTrigger: (readyActionId: string) => Promise<void> | void
  onCancel: (readyActionId: string) => Promise<void> | void
}

export function ReadyActionStatusPanel({ actions, actors, isDm, onTrigger, onCancel }: Props) {
  if (actions.length === 0) return null
  return <section aria-label="Readied actions" style={{ position: 'fixed', left: 18, bottom: 92, zIndex: 3900, width: 'min(390px, calc(100vw - 28px))', padding: 12, border: '1px solid rgba(201,149,75,.82)', borderRadius: 10, background: 'rgba(24,18,13,.96)', color: '#f4e4c2', boxShadow: '0 16px 42px rgba(0,0,0,.48)' }}>
    <small style={{ opacity: .72, letterSpacing: '.12em' }}>READIED ACTIONS</small>
    {actions.map((ready) => {
      const actor = actors.find((candidate) => candidate.id === ready.actorId)
      const readyLabel = ready.kind === 'attack'
        ? 'Attack'
        : ready.kind === 'spell'
          ? spellById(ready.spell?.spellId ?? '')?.name ?? 'Spell'
          : ready.utility?.action ?? 'Utility'
      return <div key={ready.id} style={{ marginTop: 9, paddingTop: 9, borderTop: '1px solid rgba(201,149,75,.25)', display: 'grid', gap: 4 }}>
        <strong>{actor?.name ?? 'Actor'} · {readyLabel}</strong>
        <span style={{ fontSize: 12 }}>Trigger: {ready.triggerText}</span>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          {isDm ? <button type="button" onClick={() => void onTrigger(ready.id)}>Trigger</button> : null}
          <button type="button" onClick={() => void onCancel(ready.id)}>Cancel</button>
        </div>
      </div>
    })}
  </section>
}
