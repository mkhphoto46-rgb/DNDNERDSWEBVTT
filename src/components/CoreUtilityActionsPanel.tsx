import { useEffect, useMemo, useState } from 'react'

import type { Actor, CharacterSkill } from '../types/actor'
import {
  ALL_CHARACTER_SKILLS,
  INFLUENCE_SKILLS,
  SEARCH_SKILLS,
  STUDY_SKILLS,
  type CoreUtilityAction,
  type HelpUtilityMode,
} from '../lib/utilityActions'

export interface UtilityActionRequest {
  action: CoreUtilityAction
  helpMode?: HelpUtilityMode
  targetActorId?: string
  skill?: CharacterSkill
  objectName?: string
}

interface CoreUtilityActionsPanelProps {
  actor: Actor
  actors: Actor[]
  defaultTargetActorId?: string
  onClose: () => void
  onResolve: (request: UtilityActionRequest) => Promise<void> | void
}

const ACTION_LABELS: Record<CoreUtilityAction, string> = {
  help: 'Help',
  hide: 'Hide',
  influence: 'Influence',
  search: 'Search',
  study: 'Study',
  utilize: 'Utilize',
}

const SKILL_LABELS: Record<CharacterSkill, string> = {
  acrobatics: 'Acrobatics',
  animalHandling: 'Animal Handling',
  arcana: 'Arcana',
  athletics: 'Athletics',
  deception: 'Deception',
  history: 'History',
  insight: 'Insight',
  intimidation: 'Intimidation',
  investigation: 'Investigation',
  medicine: 'Medicine',
  nature: 'Nature',
  perception: 'Perception',
  performance: 'Performance',
  persuasion: 'Persuasion',
  religion: 'Religion',
  sleightOfHand: 'Sleight of Hand',
  stealth: 'Stealth',
  survival: 'Survival',
}

function targetOptions(
  actor: Actor,
  actors: Actor[],
  action: CoreUtilityAction,
  helpMode: HelpUtilityMode,
): Actor[] {
  return actors.filter((candidate) => {
    if (candidate.id === actor.id) return false
    if (action === 'influence') return candidate.kind !== 'player'
    if (action === 'help' && helpMode === 'ability-check') {
      return (candidate.kind === 'player') === (actor.kind === 'player')
    }
    if (action === 'help' && helpMode === 'attack-roll') {
      return (candidate.kind === 'player') !== (actor.kind === 'player')
    }
    return true
  })
}

export function CoreUtilityActionsPanel({
  actor,
  actors,
  defaultTargetActorId = '',
  onClose,
  onResolve,
}: CoreUtilityActionsPanelProps) {
  const [action, setAction] = useState<CoreUtilityAction>('search')
  const [helpMode, setHelpMode] = useState<HelpUtilityMode>('ability-check')
  const [targetActorId, setTargetActorId] = useState(defaultTargetActorId)
  const [skill, setSkill] = useState<CharacterSkill>('perception')
  const [objectName, setObjectName] = useState('')
  const [busy, setBusy] = useState(false)

  const availableTargets = useMemo(
    () => targetOptions(actor, actors, action, helpMode),
    [actor, actors, action, helpMode],
  )

  const helperSkills = useMemo(() => {
    const sheet = actor.characterSheet
    if (!sheet) return [] as CharacterSkill[]
    return ALL_CHARACTER_SKILLS.filter(
      (candidate) =>
        sheet.skillProficiencies.includes(candidate) ||
        sheet.skillExpertise.includes(candidate),
    )
  }, [actor])

  const actionSkills: readonly CharacterSkill[] =
    action === 'search'
      ? SEARCH_SKILLS
      : action === 'study'
        ? STUDY_SKILLS
        : action === 'influence'
          ? INFLUENCE_SKILLS
          : action === 'hide'
            ? ['stealth']
            : action === 'help' && helpMode === 'ability-check'
              ? helperSkills
              : []

  useEffect(() => {
    if (actionSkills.length > 0 && !actionSkills.includes(skill)) {
      setSkill(actionSkills[0])
    }
  }, [action, helpMode, actionSkills, skill])

  useEffect(() => {
    if (
      targetActorId &&
      availableTargets.some((candidate) => candidate.id === targetActorId)
    ) {
      return
    }
    setTargetActorId(
      availableTargets.find((candidate) => candidate.id === defaultTargetActorId)?.id ??
      availableTargets[0]?.id ??
      '',
    )
  }, [availableTargets, defaultTargetActorId, targetActorId])

  const needsTarget =
    action === 'influence' ||
    action === 'help'
  const needsSkill =
    action === 'hide' ||
    action === 'search' ||
    action === 'study' ||
    action === 'influence' ||
    (action === 'help' && helpMode === 'ability-check')

  const submit = async () => {
    const request: UtilityActionRequest = { action }
    if (action === 'help') request.helpMode = helpMode
    if (needsTarget) request.targetActorId = targetActorId
    if (needsSkill) request.skill = action === 'hide' ? 'stealth' : skill
    if (action === 'utilize') request.objectName = objectName.trim()

    setBusy(true)
    try {
      await onResolve(request)
    } finally {
      setBusy(false)
    }
  }

  const canSubmit =
    !busy &&
    (!needsTarget || Boolean(targetActorId)) &&
    (!needsSkill || (actionSkills.length > 0 && Boolean(skill))) &&
    (action !== 'utilize' || Boolean(objectName.trim()))

  return (
    <section
      aria-label="Core utility actions"
      style={{
        position: 'fixed',
        right: 20,
        bottom: 92,
        zIndex: 4000,
        width: 'min(390px, calc(100vw - 28px))',
        maxHeight: 'min(650px, calc(100vh - 130px))',
        overflowY: 'auto',
        padding: 14,
        border: '1px solid rgba(201,149,75,.85)',
        borderRadius: 12,
        background: 'rgba(24,18,13,.97)',
        boxShadow: '0 18px 48px rgba(0,0,0,.5)',
        color: '#f4e4c2',
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <div>
          <small style={{ display: 'block', opacity: .72, letterSpacing: '.12em' }}>2024 CORE ACTIONS</small>
          <strong>{actor.name}</strong>
        </div>
        <button type="button" onClick={onClose} aria-label="Close utility actions">×</button>
      </header>

      <label style={{ display: 'grid', gap: 5, marginTop: 12 }}>
        <span>Action</span>
        <select value={action} onChange={(event) => setAction(event.target.value as CoreUtilityAction)}>
          {Object.entries(ACTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>

      {action === 'help' ? (
        <label style={{ display: 'grid', gap: 5, marginTop: 10 }}>
          <span>Help Type</span>
          <select value={helpMode} onChange={(event) => setHelpMode(event.target.value as HelpUtilityMode)}>
            <option value="ability-check">Assist Ability Check</option>
            <option value="attack-roll">Assist Attack Roll</option>
          </select>
        </label>
      ) : null}

      {needsTarget ? (
        <label style={{ display: 'grid', gap: 5, marginTop: 10 }}>
          <span>{action === 'help' && helpMode === 'attack-roll' ? 'Distract Enemy' : action === 'help' ? 'Help Ally' : 'Creature'}</span>
          <select value={targetActorId} onChange={(event) => setTargetActorId(event.target.value)}>
            <option value="">Choose…</option>
            {availableTargets.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
            ))}
          </select>
        </label>
      ) : null}

      {needsSkill ? (
        <label style={{ display: 'grid', gap: 5, marginTop: 10 }}>
          <span>Skill</span>
          <select
            value={action === 'hide' ? 'stealth' : skill}
            disabled={action === 'hide'}
            onChange={(event) => setSkill(event.target.value as CharacterSkill)}
          >
            {actionSkills.map((candidate) => (
              <option key={candidate} value={candidate}>{SKILL_LABELS[candidate]}</option>
            ))}
          </select>
          {action === 'help' && helpMode === 'ability-check' && helperSkills.length === 0 ? (
            <small style={{ opacity: .72 }}>This Actor has no recorded skill proficiency available for Help.</small>
          ) : null}
        </label>
      ) : null}

      {action === 'utilize' ? (
        <label style={{ display: 'grid', gap: 5, marginTop: 10 }}>
          <span>Nonmagical Object</span>
          <input
            value={objectName}
            onChange={(event) => setObjectName(event.target.value.slice(0, 100))}
            placeholder="Door lever, healer's kit, caltrops…"
            maxLength={100}
          />
        </label>
      ) : null}

      <p style={{ margin: '12px 0', fontSize: 12, lineHeight: 1.45, opacity: .76 }}>
        {action === 'hide'
          ? 'Stealth is rolled against DC 15. Cover/obscurement and line of sight remain DM/vision-engine checks, so Invisible is not auto-granted here.'
          : action === 'influence'
            ? 'The roll is authoritative; willingness, attitude, and final outcome remain DM-adjudicated.'
            : action === 'utilize'
              ? 'This spends the Action. The object decides any additional roll or effect.'
              : action === 'help'
                ? helpMode === 'attack-roll'
                  ? 'The distracted enemy must be within 5 ft. The next eligible allied attack gains Advantage.'
                  : 'Choose one of the helper’s recorded proficiencies. The ally’s next matching check gains Advantage.'
                : 'The server rolls the listed 2024 skill options; the DM resolves what the check discovers.'}
      </p>

      <button type="button" disabled={!canSubmit} onClick={() => void submit()}>
        {busy ? 'Resolving…' : `Use ${ACTION_LABELS[action]}`}
      </button>
    </section>
  )
}
