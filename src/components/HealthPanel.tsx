import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'


import {
  BookOpenText,
  Crosshair,
  Hourglass,
  Shield,
  Sparkles,
  Swords,
} from 'lucide-react'

import {
  DAMAGE_TYPES,
  type Actor,
  type DamageType,
} from '../types/actor'

import {
  type CombatState,
} from '../types/combat'

import {
  type SceneToken,
} from '../types/scene'

import {
  resolveHealthOperation,
  type AppliedDamageType,
  type HealthLogEntry,
  type HealthOperation,
  type HealthResolution,
} from '../lib/damage'

import {
  needsDeathSave,
  type DeathSaveResolution,
} from '../lib/death'

import {
  automaticCharacterDefenseSources,
  effectiveDamageDefenses,
} from '../lib/characterDefenseAutomation'

import {
  attackBonusForActor,
  attackProfilesForActor,
} from '../lib/combatActions'

import type {
  AttackOutcomeOverride,
  AttackResolution,
} from '../types/combatActions'

import type {
  TurnEconomyByActorId,
} from '../types/actionEconomy'

import {
  normalizeTurnEconomy,
  remainingTurnResource,
} from '../lib/actionEconomy'

interface HealthPanelProps {
  actors: Actor[]
  tokens: SceneToken[]
  activeMapId: string | null
  combat: CombatState
  turnEconomyByActorId: TurnEconomyByActorId
  selectedActorId: string
  onSelectedActorIdChange: (actorId: string) => void
  healthLog: HealthLogEntry[]
  onApplyHealth: (
    actorId: string,
    operation: HealthOperation,
    amount: number,
    damageType: AppliedDamageType,
    criticalHit: boolean,
  ) => Promise<HealthResolution>
  onRollDeathSave: (actorId: string) => Promise<DeathSaveResolution>
  onResolveAttack?: (request: {
    sourceActorId: string
    targetActorId: string
    attackId: string
    cover: 'none' | 'half' | 'three-quarters' | 'total'
    outcomeOverride: AttackOutcomeOverride
    ignoreEconomy: boolean
  }) => Promise<AttackResolution>
  onUpdateActor: (
    actorId: string,
    patch: Partial<Actor>,
  ) => Promise<void>
  onMessage: (message: string) => void
}

const DAMAGE_TYPE_LABELS: Record<DamageType, string> = {
  acid: 'Acid',
  bludgeoning: 'Bludgeoning',
  cold: 'Cold',
  fire: 'Fire',
  force: 'Force',
  lightning: 'Lightning',
  necrotic: 'Necrotic',
  piercing: 'Piercing',
  poison: 'Poison',
  psychic: 'Psychic',
  radiant: 'Radiant',
  slashing: 'Slashing',
  thunder: 'Thunder',
}

type HealthMode = 'damage' | 'heal' | 'temp'

function clampAmount(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? Math.max(0, Math.min(9999, Math.round(parsed)))
    : 0
}

function uniqueTypes(values: DamageType[] | undefined): DamageType[] {
  return [...new Set(values ?? [])]
}

function toggleDamageType(
  values: DamageType[] | undefined,
  type: DamageType,
): DamageType[] {
  const current = uniqueTypes(values)
  return current.includes(type)
    ? current.filter((entry) => entry !== type)
    : [...current, type]
}

function rawDefenseText(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map(rawDefenseText).filter(Boolean).join(' · ')
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  return String(value)
}

function healthResultSummary(result: HealthResolution): string {
  if (result.operation === 'heal') {
    if (result.healingBlockedByDeath) {
      return `No healing applied. The target is Dead; use DM Override to revive it.`
    }
    const wake = result.lifeStateBefore !== result.lifeStateAfter
      ? ` · ${result.lifeStateBefore.toUpperCase()} → ${result.lifeStateAfter.toUpperCase()}`
      : ''
    return `Healed ${result.healed}. HP ${result.currentHpBefore} → ${result.currentHpAfter}.${wake}`
  }

  if (result.operation === 'set-temp') {
    return `Temp HP ${result.tempHpBefore} → ${result.tempHpAfter}.`
  }

  const defenses = [
    result.immunityApplied ? 'IMMUNE' : '',
    result.resistanceApplied ? 'RESIST' : '',
    result.vulnerabilityApplied ? 'VULNERABLE' : '',
  ].filter(Boolean)

  const parts = [
    defenses.length > 0 ? defenses.join(' + ') : '',
    `${result.requestedAmount} → ${result.effectiveDamage} damage`,
    `Temp ${result.tempHpBefore} → ${result.tempHpAfter}`,
    `HP ${result.currentHpBefore} → ${result.currentHpAfter}`,
  ]

  if (result.criticalHit) parts.push('CRITICAL HIT')
  if (result.monsterDeath) parts.push('MONSTER DEAD AT 0 HP')
  if (result.instantDeath) parts.push('INSTANT DEATH')
  if (result.deathSaveFailuresAdded > 0) {
    parts.push(`Death failures +${result.deathSaveFailuresAdded}`)
  }
  if (result.lifeStateBefore !== result.lifeStateAfter) {
    parts.push(`${result.lifeStateBefore.toUpperCase()} → ${result.lifeStateAfter.toUpperCase()}`)
  }

  return parts.filter(Boolean).join(' · ')
}

export function HealthPanel({
  actors,
  tokens,
  activeMapId,
  combat,
  turnEconomyByActorId,
  selectedActorId,
  onSelectedActorIdChange,
  healthLog,
  onApplyHealth,
  onRollDeathSave,
  onResolveAttack,
  onUpdateActor,
  onMessage,
}: HealthPanelProps) {
  const resolveAttack = onResolveAttack
  const orderedActors = useMemo(() => {
    const byId = new Map(actors.map((actor) => [actor.id, actor]))
    const ordered: Actor[] = []
    const seen = new Set<string>()

    const add = (actorId: string) => {
      if (seen.has(actorId)) return
      const actor = byId.get(actorId)
      if (!actor) return
      seen.add(actorId)
      ordered.push(actor)
    }

    if (combat.phase !== 'inactive') {
      for (const entry of combat.combatants) add(entry.actorId)
    }

    if (activeMapId) {
      for (const token of tokens) {
        if (token.mapId === activeMapId && token.visible) add(token.actorId)
      }
    }

    for (const actor of actors) add(actor.id)
    return ordered
  }, [actors, tokens, activeMapId, combat])

  const lastTurnActorIdRef = useRef<string | null>(
    combat.phase === 'active' ? combat.currentActorId : null,
  )

  const [mode, setMode] = useState<HealthMode>('damage')
  const [damageAmountDraft, setDamageAmountDraft] = useState('5')
  const [healAmountDraft, setHealAmountDraft] = useState('5')
  const [tempAmountDraft, setTempAmountDraft] = useState('5')
  const [damageType, setDamageType] = useState<AppliedDamageType>('untyped')
  const [criticalHit, setCriticalHit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [lastResult, setLastResult] = useState<HealthResolution | null>(null)
  const [attackSourceId, setAttackSourceId] = useState('')
  const [attackId, setAttackId] = useState('')
  const [cover, setCover] = useState<'none' | 'half' | 'three-quarters' | 'total'>('none')
  const [outcomeOverride, setOutcomeOverride] = useState<AttackOutcomeOverride>('rules')
  const [ignoreEconomy, setIgnoreEconomy] = useState(false)
  const [lastAttack, setLastAttack] = useState<AttackResolution | null>(null)

  useEffect(() => {
    const currentTurnActorId =
      combat.phase === 'active'
        ? combat.currentActorId
        : null

    if (
      !selectedActorId &&
      currentTurnActorId &&
      orderedActors.some((actor) => actor.id === currentTurnActorId)
    ) {
      lastTurnActorIdRef.current = currentTurnActorId
      onSelectedActorIdChange(currentTurnActorId)
      return
    }

    if (
      currentTurnActorId &&
      currentTurnActorId !== lastTurnActorIdRef.current &&
      orderedActors.some((actor) => actor.id === currentTurnActorId)
    ) {
      lastTurnActorIdRef.current = currentTurnActorId
      onSelectedActorIdChange(currentTurnActorId)
      return
    }

    if (combat.phase !== 'active') {
      lastTurnActorIdRef.current = null
    }

    if (!orderedActors.some((actor) => actor.id === selectedActorId)) {
      onSelectedActorIdChange(orderedActors[0]?.id ?? '')
    }
  }, [
    combat.phase,
    combat.currentActorId,
    orderedActors,
    selectedActorId,
    onSelectedActorIdChange,
  ])

  const actor = orderedActors.find((candidate) => candidate.id === selectedActorId) ?? null
  const attackSource = actors.find((candidate) => candidate.id === attackSourceId)
    ?? actors.find((candidate) => candidate.id === combat.currentActorId)
    ?? actors[0]
    ?? null
  const attackProfiles = attackSource ? attackProfilesForActor(attackSource) : []
  const selectedAttack = attackProfiles.find((candidate) => candidate.id === attackId)
    ?? attackProfiles[0]
    ?? null
  const attackEconomy = attackSource
    ? normalizeTurnEconomy(
        turnEconomyByActorId[attackSource.id],
        attackSource,
      )
    : null
  const attackActionRemaining = attackEconomy
    ? remainingTurnResource(attackEconomy, 'action')
    : 0
  const attackBonusRemaining = attackEconomy
    ? remainingTurnResource(attackEconomy, 'bonus-action')
    : 0
  const attackReactionRemaining = attackEconomy
    ? remainingTurnResource(attackEconomy, 'reaction')
    : 0
  const attackSequenceRemaining = attackEconomy
    ? Math.max(0, attackEconomy.attackLimit - attackEconomy.attacksUsed)
    : 0

  const damageAmount = clampAmount(damageAmountDraft)
  const healAmount = clampAmount(healAmountDraft)
  const tempAmount = clampAmount(tempAmountDraft)

  const run = async (
    operation: HealthOperation,
    amount: number,
  ) => {
    if (!actor || busy) return

    if (operation !== 'set-temp' && amount <= 0) {
      onMessage('Enter an amount greater than 0.')
      return
    }

    setBusy(true)

    try {
      const result = await onApplyHealth(
        actor.id,
        operation,
        amount,
        operation === 'damage' ? damageType : 'untyped',
        operation === 'damage' ? criticalHit : false,
      )
      setLastResult(result)
    } catch (error) {
      onMessage(
        error instanceof Error
          ? error.message
          : 'Health change could not be applied.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (orderedActors.length === 0) {
    return (
      <p className="empty-note">
        Add an Actor before using Damage & Healing.
      </p>
    )
  }

  if (!actor) return null

  const hpPercent = actor.maxHp > 0
    ? Math.max(0, Math.min(100, (actor.currentHp / actor.maxHp) * 100))
    : 0

  const damagePreview = resolveHealthOperation(
    actor,
    {
      operation: 'damage',
      amount: damageAmount,
      damageType,
      criticalHit,
    },
  ).resolution

  const healPreview = resolveHealthOperation(
    actor,
    {
      operation: 'heal',
      amount: healAmount,
      damageType: 'untyped',
    },
  ).resolution

  const tempPreview = resolveHealthOperation(
    actor,
    {
      operation: 'set-temp',
      amount: tempAmount,
      damageType: 'untyped',
    },
  ).resolution

  const statBlock = actor.monsterStatBlock ?? {}
  const rawResistances = rawDefenseText(statBlock.damage_resistances)
  const rawImmunities = rawDefenseText(statBlock.damage_immunities)
  const rawVulnerabilities = rawDefenseText(statBlock.damage_vulnerabilities)
  const automaticDefenseSources = automaticCharacterDefenseSources(actor)
  const effectiveDefenses = effectiveDamageDefenses(actor)

  const defenseGroup = (
    title: string,
    values: DamageType[] | undefined,
    field: 'damageResistances' | 'damageImmunities' | 'damageVulnerabilities',
  ) => (
    <div className="health-defense-group">
      <strong>{title}</strong>
      <div className="health-defense-grid">
        {DAMAGE_TYPES.map((type) => {
          const active = values?.includes(type) === true

          return (
            <button
              type="button"
              key={type}
              className={active ? 'health-defense-chip is-active' : 'health-defense-chip'}
              onClick={() => {
                const nextValues = toggleDamageType(values, type)
                const patch: Partial<Actor> =
                  field === 'damageResistances'
                    ? { damageResistances: nextValues }
                    : field === 'damageImmunities'
                      ? { damageImmunities: nextValues }
                      : { damageVulnerabilities: nextValues }

                void onUpdateActor(actor.id, patch).catch((error) => {
                  onMessage(
                    error instanceof Error
                      ? error.message
                      : `${title} could not be saved.`,
                  )
                })
              }}
            >
              {DAMAGE_TYPE_LABELS[type]}
            </button>
          )
        })}
      </div>
    </div>
  )

  return (
    <div className="health-console">
      <label className="health-target-select">
        <span><Crosshair aria-hidden="true" /> Target Actor</span>
        <select
          value={actor.id}
          onChange={(event) => {
            onSelectedActorIdChange(event.target.value)
            setLastResult(null)
          }}
        >
          {orderedActors.map((candidate) => (
            <option value={candidate.id} key={candidate.id}>
              {candidate.name} · {candidate.kind.toUpperCase()}
            </option>
          ))}
        </select>
      </label>

      <article className="health-target-card">
        <header>
          {actor.portraitUrl ? (
            <img src={actor.portraitUrl} alt="" />
          ) : (
            <span className="health-portrait-placeholder">?</span>
          )}
          <div>
            <strong>{actor.name}</strong>
            <small>
              {actor.kind.toUpperCase()} · AC {actor.ac}
              {combat.currentActorId === actor.id ? ' · CURRENT TURN' : ''}
            </small>
            <span className={`health-life-badge is-${actor.lifeState}`}>
              {actor.lifeState.toUpperCase()}
            </span>
          </div>
        </header>

        <div className="health-hp-line">
          <div>
            <span>HP</span>
            <strong>{actor.currentHp} / {actor.maxHp}</strong>
          </div>
          <div>
            <span>TEMP</span>
            <strong>{actor.tempHp}</strong>
          </div>
        </div>

        <div className="health-bar" aria-label={`${actor.currentHp} of ${actor.maxHp} HP`}>
          <i style={{ width: `${hpPercent}%` }} />
        </div>
      </article>

      {resolveAttack ? (
        <section className="combat-resolver-card" aria-label="Attack resolver">
        <header className="health-section-header">
          <span className="health-section-icon"><Swords aria-hidden="true" /></span>
          <div>
            <strong>Attack</strong>
            <small>{attackSource?.name ?? 'Choose attacker'} → {actor.name}</small>
          </div>
          <b>AC {actor.ac}</b>
        </header>

        <div className="combat-resolver-grid">
          <label>
            <span>Attacker</span>
            <select value={attackSource?.id ?? ''} onChange={(event) => { setAttackSourceId(event.target.value); setAttackId(''); setLastAttack(null) }}>
              {actors.filter((candidate) => candidate.lifeState === 'conscious').map((candidate) => (
                <option value={candidate.id} key={candidate.id}>{candidate.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Attack</span>
            <select value={selectedAttack?.id ?? ''} onChange={(event) => { setAttackId(event.target.value); setLastAttack(null) }}>
              {attackProfiles.map((profile) => (
                <option value={profile.id} key={profile.id}>
                  {profile.name} · {profile.damageFormula} {profile.damageType}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Cover</span>
            <select value={cover} onChange={(event) => setCover(event.target.value as typeof cover)}>
              <option value="none">No Cover</option>
              <option value="half">Half Cover (+2 AC)</option>
              <option value="three-quarters">¾ Cover (+5 AC)</option>
              <option value="total">Total Cover (DM override only)</option>
            </select>
          </label>
          <label>
            <span>DM Outcome</span>
            <select value={outcomeOverride} onChange={(event) => setOutcomeOverride(event.target.value as AttackOutcomeOverride)}>
              <option value="rules">Use Rules / Dice</option>
              <option value="miss">Force Miss</option>
              <option value="hit">Force Hit</option>
              <option value="critical">Force Critical</option>
            </select>
          </label>
        </div>

        {attackSource && attackEconomy ? (
          <div className="combat-economy-readout" aria-label={`${attackSource.name} Action Economy`}>
            <div className={attackActionRemaining > 0 ? 'is-ready' : 'is-spent'}>
              <span>Action</span>
              <strong>{attackActionRemaining}/{attackEconomy.actionMax}</strong>
            </div>
            <div className={attackBonusRemaining > 0 ? 'is-ready' : 'is-spent'}>
              <span>Bonus</span>
              <strong>{attackBonusRemaining}/{attackEconomy.bonusActionMax}</strong>
            </div>
            <div className={attackReactionRemaining > 0 ? 'is-ready' : 'is-spent'}>
              <span>Reaction</span>
              <strong>{attackReactionRemaining}/{attackEconomy.reactionMax}</strong>
            </div>
            <div className={attackSequenceRemaining > 0 ? 'is-ready' : 'is-spent'}>
              <span>Attacks</span>
              <strong>{attackSequenceRemaining}/{attackEconomy.attackLimit}</strong>
            </div>
          </div>
        ) : null}

        {attackSource && selectedAttack ? (
          <div className="combat-attack-preview">
            <span>d20 {attackBonusForActor(attackSource, selectedAttack) >= 0 ? '+' : ''}{attackBonusForActor(attackSource, selectedAttack)} vs AC {actor.ac + (cover === 'half' ? 2 : cover === 'three-quarters' ? 5 : 0)}</span>
            <span>{selectedAttack.damageFormula} {selectedAttack.damageType}</span>
            <span>Range {selectedAttack.rangeFeet}{selectedAttack.longRangeFeet ? `/${selectedAttack.longRangeFeet}` : ''} ft</span>
          </div>
        ) : null}

        <label className="health-critical-toggle">
          <input type="checkbox" checked={ignoreEconomy} onChange={(event) => setIgnoreEconomy(event.target.checked)} />
          <span>DM: ignore Action Economy for this roll</span>
        </label>
        <button
          type="button"
          className="combat-resolve-button"
          disabled={busy || !attackSource || !selectedAttack || attackSource.id === actor.id}
          onClick={() => {
            if (!attackSource || !selectedAttack) return
            setBusy(true)
            void resolveAttack({
              sourceActorId: attackSource.id,
              targetActorId: actor.id,
              attackId: selectedAttack.id,
              cover,
              outcomeOverride,
              ignoreEconomy,
            }).then(setLastAttack).catch((error) => onMessage(error instanceof Error ? error.message : 'Attack failed.')).finally(() => setBusy(false))
          }}
        >
          {busy ? 'Resolving…' : 'Roll Attack & Resolve Damage'}
        </button>

        {lastAttack ? (
          <div className={`combat-resolution-result is-${lastAttack.outcome}`} role="status">
            <strong>{lastAttack.outcome.toUpperCase()} · {lastAttack.attackName}</strong>
            <span>d20 {lastAttack.d20Rolls.join(' / ')} + {lastAttack.attackBonus} = {lastAttack.attackTotal} vs AC {lastAttack.targetAc}</span>
            {lastAttack.damage ? (
              <small>{lastAttack.damage.total} rolled → {lastAttack.effectiveDamage} {lastAttack.damageType} damage · HP {lastAttack.targetHpBefore} → {lastAttack.targetHpAfter}</small>
            ) : <small>No damage rolled.</small>}
            {lastAttack.outcomeOverride !== 'rules' ? <em>DM OVERRIDE: {lastAttack.outcomeOverride.toUpperCase()}</em> : null}
          </div>
        ) : null}
      </section>
      ) : null}

      <section className="death-state-console">
        <div className="death-state-heading">
          <span className="health-section-icon"><Hourglass aria-hidden="true" /></span>
          <div>
            <strong>{actor.deathRules === 'monster' ? 'Monster Death' : 'Death Saves'}</strong>
            <small>0 HP rules</small>
          </div>
          {actor.kind !== 'player' ? (
            <select
              value={actor.deathRules}
              aria-label="0 HP rule"
              onChange={(event) => {
                const next = event.target.value === 'character' ? 'character' : 'monster'
                void onUpdateActor(actor.id, next === 'character'
                  ? {
                      deathRules: 'character',
                      lifeState: actor.currentHp === 0 ? 'unconscious' : 'conscious',
                      deathSaveSuccesses: 0,
                      deathSaveFailures: 0,
                      lastDeathSaveRound: null,
                    }
                  : {
                      deathRules: 'monster',
                      lifeState: actor.currentHp === 0 ? 'dead' : 'conscious',
                      deathSaveSuccesses: 0,
                      deathSaveFailures: 0,
                      lastDeathSaveRound: null,
                    }).catch((error) => onMessage(error instanceof Error ? error.message : '0 HP rule could not be saved.'))
              }}
            >
              <option value="monster">Monster: dies at 0</option>
              <option value="character">Character: death saves</option>
            </select>
          ) : (
            <small>Player characters use Death Saving Throws.</small>
          )}
        </div>

        {actor.deathRules === 'character' ? (
          <div className="death-save-tracker">
            <div className="death-save-row is-success">
              <span>Successes</span>
              <b>{[0, 1, 2].map((index) => index < actor.deathSaveSuccesses ? '●' : '○').join(' ')}</b>
              <button
                type="button"
                disabled={actor.lifeState !== 'unconscious'}
                onClick={() => {
                  const next = Math.min(3, actor.deathSaveSuccesses + 1)
                  void onUpdateActor(actor.id, next >= 3
                    ? { lifeState: 'stable', deathSaveSuccesses: 0, deathSaveFailures: 0, lastDeathSaveRound: null }
                    : { deathSaveSuccesses: next }).catch((error) => onMessage(error instanceof Error ? error.message : 'Death save override failed.'))
                }}
              >+ Success</button>
            </div>
            <div className="death-save-row is-failure">
              <span>Failures</span>
              <b>{[0, 1, 2].map((index) => index < actor.deathSaveFailures ? '●' : '○').join(' ')}</b>
              <button
                type="button"
                disabled={actor.lifeState !== 'unconscious'}
                onClick={() => {
                  const next = Math.min(3, actor.deathSaveFailures + 1)
                  void onUpdateActor(actor.id, next >= 3
                    ? { lifeState: 'dead', currentHp: 0, deathSaveFailures: 3, lastDeathSaveRound: null }
                    : { deathSaveFailures: next }).catch((error) => onMessage(error instanceof Error ? error.message : 'Death save override failed.'))
                }}
              >+ Failure</button>
            </div>

            {needsDeathSave(actor) ? (
              actor.ownerId ? (
                <p className="death-save-waiting">Player rolls their own Death Save on their turn.</p>
              ) : (
                <button
                  type="button"
                  className="death-save-roll-button"
                  disabled={busy || combat.phase !== 'active' || combat.currentActorId !== actor.id || actor.lastDeathSaveRound === combat.round}
                  onClick={() => {
                    setBusy(true)
                    void onRollDeathSave(actor.id)
                      .then((result) => onMessage(`${actor.name}: Death Save d20 ${result.rawRoll} → ${result.outcome.toUpperCase()}.`))
                      .catch((error) => onMessage(error instanceof Error ? error.message : 'Death Save failed.'))
                      .finally(() => setBusy(false))
                  }}
                >
                  {actor.lastDeathSaveRound === combat.round ? 'Death Save Rolled This Round' : 'Roll Death Save (DM Private)'}
                </button>
              )
            ) : null}
          </div>
        ) : null}

        <div className="death-state-overrides" aria-label="DM life-state override">
          <button
            type="button"
            className={actor.lifeState === 'conscious' ? 'is-active' : ''}
            onClick={() => void onUpdateActor(actor.id, {
              currentHp: Math.max(1, actor.currentHp),
              lifeState: 'conscious',
              deathSaveSuccesses: 0,
              deathSaveFailures: 0,
              lastDeathSaveRound: null,
            })}
          >Conscious</button>
          <button
            type="button"
            className={actor.lifeState === 'unconscious' ? 'is-active' : ''}
            onClick={() => void onUpdateActor(actor.id, {
              currentHp: 0,
              lifeState: 'unconscious',
              deathRules: 'character',
              deathSaveSuccesses: Math.min(2, actor.deathSaveSuccesses),
              deathSaveFailures: Math.min(2, actor.deathSaveFailures),
              lastDeathSaveRound: null,
            })}
          >Unconscious</button>
          <button
            type="button"
            className={actor.lifeState === 'stable' ? 'is-active' : ''}
            onClick={() => void onUpdateActor(actor.id, {
              currentHp: 0,
              lifeState: 'stable',
              deathRules: 'character',
              deathSaveSuccesses: 0,
              deathSaveFailures: 0,
              lastDeathSaveRound: null,
            })}
          >Stable</button>
          <button
            type="button"
            className={actor.lifeState === 'dead' ? 'is-active is-dead' : 'is-dead'}
            onClick={() => void onUpdateActor(actor.id, {
              currentHp: 0,
              lifeState: 'dead',
              lastDeathSaveRound: null,
            })}
          >Dead</button>
        </div>
      </section>

      <div className="health-mode-tabs" role="tablist" aria-label="Health operation">
        <button
          type="button"
          className={mode === 'damage' ? 'is-active is-damage' : 'is-damage'}
          onClick={() => setMode('damage')}
        >
          <Swords aria-hidden="true" />
          <span>Damage</span>
        </button>
        <button
          type="button"
          className={mode === 'heal' ? 'is-active is-heal' : 'is-heal'}
          onClick={() => setMode('heal')}
        >
          <Sparkles aria-hidden="true" />
          <span>Heal</span>
        </button>
        <button
          type="button"
          className={mode === 'temp' ? 'is-active is-temp' : 'is-temp'}
          onClick={() => setMode('temp')}
        >
          <Shield aria-hidden="true" />
          <span>Temp HP</span>
        </button>
      </div>

      {mode === 'damage' ? (
        <section className="health-mode-card health-mode-damage">
          <div className="health-operation-grid">
            <label>
              <span>Damage Amount</span>
              <input
                type="number"
                min="0"
                max="9999"
                step="1"
                inputMode="numeric"
                value={damageAmountDraft}
                onChange={(event) => setDamageAmountDraft(event.target.value)}
              />
            </label>

            <label>
              <span>Damage Type</span>
              <select
                value={damageType}
                onChange={(event) => setDamageType(event.target.value as AppliedDamageType)}
              >
                <option value="untyped">Untyped / Ignore Defenses</option>
                {DAMAGE_TYPES.map((type) => (
                  <option value={type} key={type}>{DAMAGE_TYPE_LABELS[type]}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="health-critical-toggle">
            <input
              type="checkbox"
              checked={criticalHit}
              onChange={(event) => setCriticalHit(event.target.checked)}
            />
            <span>Critical Hit</span>
            <small>At 0 HP, a Critical Hit causes 2 failed Death Saves.</small>
          </label>

          <div className="health-preview is-damage">
            <strong>Damage Preview</strong>
            <span>{healthResultSummary(damagePreview)}</span>
          </div>

          <button
            type="button"
            className="health-damage-button health-primary-action"
            disabled={busy || damageAmount <= 0}
            onClick={() => void run('damage', damageAmount)}
          >
            Apply {damageAmount} Damage
          </button>
        </section>
      ) : null}

      {mode === 'heal' ? (
        <section className="health-mode-card health-mode-heal">
          <label className="health-single-input">
            <span>Healing Amount</span>
            <input
              type="number"
              min="0"
              max="9999"
              step="1"
              inputMode="numeric"
              value={healAmountDraft}
              onChange={(event) => setHealAmountDraft(event.target.value)}
            />
          </label>

          <div className="health-preview is-heal">
            <strong>Healing Preview</strong>
            <span>
              HP {healPreview.currentHpBefore} → {healPreview.currentHpAfter}
              {' · '}Actual healing {healPreview.healed}
              {healAmount > healPreview.healed ? ` · ${healAmount - healPreview.healed} excess ignored` : ''}
            </span>
          </div>

          <button
            type="button"
            className="health-heal-button health-primary-action"
            disabled={busy || healAmount <= 0}
            onClick={() => void run('heal', healAmount)}
          >
            Apply {healAmount} Healing
          </button>
        </section>
      ) : null}

      {mode === 'temp' ? (
        <section className="health-mode-card health-mode-temp">
          <label className="health-single-input">
            <span>Temp HP Grant</span>
            <input
              type="number"
              min="0"
              max="9999"
              step="1"
              inputMode="numeric"
              value={tempAmountDraft}
              onChange={(event) => setTempAmountDraft(event.target.value)}
            />
          </label>

          <div className="health-preview is-temp">
            <strong>Temp HP Preview</strong>
            <span>Temp HP {tempPreview.tempHpBefore} → {tempPreview.tempHpAfter}</span>
          </div>

          <button
            type="button"
            className="health-temp-button health-primary-action"
            disabled={busy}
            onClick={() => void run('set-temp', tempAmount)}
          >
            Grant {tempAmount} Temp HP
          </button>
        </section>
      ) : null}

      {lastResult ? (
        <div className="health-result" role="status">
          <strong>Last Resolution</strong>
          <span>{healthResultSummary(lastResult)}</span>
          {lastResult.overflowDamage > 0 ? (
            <small>Overflow past 0 HP: {lastResult.overflowDamage}.</small>
          ) : null}
        </div>
      ) : null}

      <details className="health-resolution-log">
        <summary>
          <span><BookOpenText aria-hidden="true" /> Health Log</span>
          <b>{healthLog.length}</b>
        </summary>

        {healthLog.length === 0 ? (
          <p>No damage, healing, or Temp HP changes yet.</p>
        ) : (
          <div className="health-log-list">
            {[...healthLog].reverse().slice(0, 20).map((entry) => (
              <article key={entry.id}>
                <strong>{entry.actorName}</strong>
                <span>{healthResultSummary(entry.resolution)}</span>
                <small>{entry.createdAt ? new Date(entry.createdAt).toLocaleTimeString() : ''}</small>
              </article>
            ))}
          </div>
        )}
      </details>

      <details className="health-defense-editor">
        <summary>
          <span><Shield aria-hidden="true" /> Damage Defenses</span>
          <b>
            R {effectiveDefenses.resistances.length}
            {' · '}I {effectiveDefenses.immunities.length}
            {' · '}V {effectiveDefenses.vulnerabilities.length}
          </b>
        </summary>

        <p>
          Imported monster defenses and supported player species/class features are resolved automatically. Untyped damage bypasses typed defenses.
        </p>

        {automaticDefenseSources.length > 0 ? (
          <div className="health-automatic-defenses">
            <strong>Automatic sources</strong>
            {automaticDefenseSources.map((source) => (
              <article key={source.id} className={source.active ? 'is-active' : 'is-inactive'}>
                <div>
                  <b>{source.label}</b>
                  <small>{source.note}</small>
                </div>
                <span>
                  {source.mode.toUpperCase()}: {source.damageTypes.map((type) => DAMAGE_TYPE_LABELS[type]).join(', ')}
                </span>
              </article>
            ))}
          </div>
        ) : null}

        {defenseGroup('DM Override Resistance', actor.damageResistances, 'damageResistances')}
        {defenseGroup('DM Override Immunity', actor.damageImmunities, 'damageImmunities')}
        {defenseGroup('DM Override Vulnerability', actor.damageVulnerabilities, 'damageVulnerabilities')}

        {(rawResistances || rawImmunities || rawVulnerabilities) ? (
          <div className="health-raw-defenses">
            <strong>Imported SRD text</strong>
            {rawResistances ? <small>Resistance: {rawResistances}</small> : null}
            {rawImmunities ? <small>Immunity: {rawImmunities}</small> : null}
            {rawVulnerabilities ? <small>Vulnerability: {rawVulnerabilities}</small> : null}
            <em>Conditional defenses are shown here but are not treated as unconditional defenses.</em>
          </div>
        ) : null}
      </details>

      <p className="health-override-note">
        DM override remains available in Actors / Character Sheet for direct HP, Max HP and Temp HP edits.
      </p>
    </div>
  )
}
