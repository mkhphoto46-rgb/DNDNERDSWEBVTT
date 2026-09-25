import { useMemo, useState } from 'react'
import { attackBonusForActor, attackProfilesForActor } from '../lib/combatActions'
import type { Actor } from '../types/actor'
import type { AttackResolution } from '../types/combatActions'

interface Props {
  actor: Actor
  target: Actor | null
  targets: Actor[]
  isDm: boolean
  onSelectTarget: (actorId: string | null) => void
  onClose: () => void
  onResolve: (request: { sourceActorId: string; targetActorId: string; attackId: string; cover: 'none'; outcomeOverride: 'rules'; ignoreEconomy: false }) => Promise<AttackResolution>
  onMessage: (message: string) => void
}

export function PlayerAttackHud({ actor, target, targets, isDm, onSelectTarget, onClose, onResolve, onMessage }: Props) {
  const attacks = useMemo(() => attackProfilesForActor(actor), [actor])
  const [attackId, setAttackId] = useState(attacks[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AttackResolution | null>(null)
  const attack = attacks.find((candidate) => candidate.id === attackId) ?? attacks[0] ?? null

  return <section className="player-attack-hud" aria-label="Combat attack resolver">
    <header><div><span>{isDm ? 'DM COMBAT ACTION' : 'COMBAT ACTION'}</span><strong>{target ? `Target: ${target.name}` : 'Choose a target token'}</strong></div><button type="button" onClick={onClose} aria-label="Close">×</button></header>
    {isDm ? <label><span>Target</span><select value={target?.id ?? ''} onChange={(event) => onSelectTarget(event.target.value || null)}><option value="">Choose target…</option>{targets.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name} · AC {candidate.ac}</option>)}</select></label> : null}
    <label><span>Attack</span><select value={attack?.id ?? ''} onChange={(event) => { setAttackId(event.target.value); setResult(null) }}>{attacks.map((profile) => <option value={profile.id} key={profile.id}>{profile.name} · {profile.damageFormula} {profile.damageType}</option>)}</select></label>
    {attack ? <div className="player-attack-meta"><span>d20 {attackBonusForActor(actor, attack) >= 0 ? '+' : ''}{attackBonusForActor(actor, attack)}</span><span>{attack.damageFormula} {attack.damageType}</span><span>{attack.rangeFeet}{attack.longRangeFeet ? `/${attack.longRangeFeet}` : ''} ft</span></div> : null}
    <button type="button" className="combat-resolve-button" disabled={busy || !target || !attack} onClick={() => {
      if (!target || !attack) return
      setBusy(true)
      void onResolve({ sourceActorId: actor.id, targetActorId: target.id, attackId: attack.id, cover: 'none', outcomeOverride: 'rules', ignoreEconomy: false })
        .then(setResult).catch((error) => onMessage(error instanceof Error ? error.message : 'Attack failed.')).finally(() => setBusy(false))
    }}>{busy ? 'Rolling…' : 'Roll Attack'}</button>
    {result ? <div className={`combat-resolution-result is-${result.outcome}`}><strong>{result.outcome.toUpperCase()}</strong><span>d20 {result.d20Rolls.join(' / ')} + {result.attackBonus} = {result.attackTotal} vs AC {result.targetAc}</span><small>{result.damage ? `${result.damage.formula}: ${result.damage.dice.flatMap((die) => die.rolls).join(' + ')}${result.damage.modifier ? ` ${result.damage.modifier >= 0 ? '+' : '−'} ${Math.abs(result.damage.modifier)}` : ''} = ${result.damage.total} · ${result.effectiveDamage} ${result.damageType} damage applied` : 'No damage'}</small></div> : null}
  </section>
}
