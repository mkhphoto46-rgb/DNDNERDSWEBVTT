import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import {
  type Actor,
} from '../types/actor'

import {
  type CombatState,
} from '../types/combat'

import {
  type DiceRollEntry,
} from '../types/dice'

import {
  type SceneToken,
} from '../types/scene'

interface InitiativePlayer {
  id: string
  name: string
  connected: boolean
}

interface InitiativePanelProps {
  isDm: boolean
  currentPlayerId: string | null
  players: InitiativePlayer[]
  combat: CombatState
  diceLog: DiceRollEntry[]
  actors: Actor[]
  tokens: SceneToken[]
  activeMapId: string | null
  onPrepareCombat: (actorIds: string[]) => Promise<void>
  onAssignPlayerActor: (actorId: string, playerId: string) => Promise<void>
  onRollPlayerInitiative: (actorId: string) => Promise<void>
  onRollDmInitiative: (actorId: string) => Promise<void>
  onBeginCombat: () => Promise<void>
  onSetInitiative: (actorId: string, initiative: number) => Promise<void>
  onMoveTie: (actorId: string, direction: 'up' | 'down') => Promise<void>
  onPreviousTurn: () => Promise<void>
  onNextTurn: () => Promise<void>
  onEndCombat: () => Promise<void>
}

function clampInitiative(value: string, fallback: number): number {
  const parsed = Number(value)

  return Number.isFinite(parsed)
    ? Math.max(-100, Math.min(100, Math.round(parsed)))
    : fallback
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value)
}

function rollSummary(entry: DiceRollEntry): string {
  if (entry.reason === 'initiative') {
    return `d20 ${entry.rawRoll} ${signed(entry.modifier)} = ${entry.total}`
  }

  if (entry.reason === 'death-save') {
    return `d20 ${entry.rawRoll}`
  }

  return String(entry.total)
}

export function InitiativePanel({
  isDm,
  currentPlayerId,
  players,
  combat,
  diceLog,
  actors,
  tokens,
  activeMapId,
  onPrepareCombat,
  onAssignPlayerActor,
  onRollPlayerInitiative,
  onRollDmInitiative,
  onBeginCombat,
  onSetInitiative,
  onMoveTie,
  onPreviousTurn,
  onNextTurn,
  onEndCombat,
}: InitiativePanelProps) {
  const actorMap = useMemo(
    () => new Map(actors.map((actor) => [actor.id, actor])),
    [actors],
  )

  const playerNameById = useMemo(
    () => new Map(players.map((player) => [player.id, player.name])),
    [players],
  )

  const rosterPlayers = useMemo(
    () => [...players].sort((left, right) => {
      if (left.connected !== right.connected) {
        return left.connected ? -1 : 1
      }

      return left.name.localeCompare(right.name)
    }),
    [players],
  )

  const suggestedActorIds = useMemo(() => {
    if (!activeMapId) {
      return actors.map((actor) => actor.id)
    }

    const ids = new Set(
      tokens
        .filter(
          (token) =>
            token.mapId === activeMapId &&
            token.visible,
        )
        .map((token) => token.actorId),
    )

    const onMap = actors
      .filter((actor) => ids.has(actor.id))
      .map((actor) => actor.id)

    return onMap.length > 0
      ? onMap
      : actors.map((actor) => actor.id)
  }, [actors, tokens, activeMapId])

  const [setupOpen, setSetupOpen] = useState(false)
  const [selectedActorIds, setSelectedActorIds] = useState<string[]>(suggestedActorIds)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!setupOpen) {
      setSelectedActorIds(suggestedActorIds)
    }
  }, [suggestedActorIds, setupOpen])

  useEffect(() => {
    if (combat.phase !== 'inactive') {
      setSetupOpen(false)
    }
  }, [combat.phase])

  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)

    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  const latestInitiativeRollFor = (actorId: string) =>
    [...diceLog]
      .reverse()
      .find(
        (roll) =>
          roll.reason === 'initiative' &&
          roll.actorId === actorId,
      )

  const rollFeed = (
    <details className="initiative-roll-feed initiative-roll-feed-details">
      <summary>
        <span>Dice Log</span>
        <b>{diceLog.length}</b>
      </summary>
      <div className="initiative-roll-feed-heading">
        <small>{isDm ? 'DM sees all structured rolls. Player rolls are public; DM/NPC rolls stay private unless they are damage.' : 'Player rolls are public to the table, including Death Saves and Concentration Saves.'}</small>
      </div>
      {diceLog.length === 0 ? (
        <em>No rolls yet.</em>
      ) : (
        <div className="initiative-roll-feed-list">
          {[...diceLog].reverse().slice(0, 20).map((entry) => (
            <div
              key={entry.id}
              className={entry.visibility === 'public' ? 'initiative-roll-entry' : 'initiative-roll-entry is-private'}
            >
              <span>
                <b>{entry.actorName ?? entry.rollerName}</b>
                <small>
                  {entry.reason === 'initiative'
                    ? 'Initiative'
                    : entry.reason === 'death-save'
                      ? 'Death Save'
                      : 'd20'}
                  {entry.visibility === 'dm'
                    ? ' · DM PRIVATE'
                    : entry.visibility === 'player-dm'
                      ? ' · PLAYER + DM'
                      : ' · PUBLIC'}
                </small>
              </span>
              <strong>{rollSummary(entry)}</strong>
            </div>
          ))}
        </div>
      )}
    </details>
  )

  const playerActors = actors.filter((actor) => actor.kind === 'player')
  const dmActors = actors.filter((actor) => actor.kind !== 'player')

  const selectionRow = (actor: Actor) => {
    const checked = selectedActorIds.includes(actor.id)
    const onActiveMap = tokens.some(
      (token) =>
        token.actorId === actor.id &&
        token.mapId === activeMapId &&
        token.visible,
    )
    const ownerName = actor.ownerId
      ? playerNameById.get(actor.ownerId) ?? 'Player offline'
      : 'Unassigned'

    return (
      <label key={actor.id} className="initiative-setup-row">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => {
            setSelectedActorIds((current) =>
              event.target.checked
                ? [...new Set([...current, actor.id])]
                : current.filter((id) => id !== actor.id),
            )
          }}
        />
        <span>
          <b>{actor.name}</b>
          <small>
            {actor.kind === 'player' ? `PLAYER · ${ownerName}` : actor.kind.toUpperCase()}
            {' · '}
            INIT {signed(actor.initiativeBonus)}
            {onActiveMap ? ' · MAP' : ''}
          </small>
        </span>
      </label>
    )
  }

  if (combat.phase === 'inactive') {
    const rosterWithoutActor = rosterPlayers.filter(
      (player) => !playerActors.some((actor) => actor.ownerId === player.id),
    )

    return (
      <section className="initiative-panel initiative-panel-idle">
        <div className="initiative-panel-heading">
          <span>COMBAT</span>
          <strong>Initiative</strong>
        </div>

        {!isDm ? (
          <small className="initiative-empty-note">No active encounter.</small>
        ) : setupOpen ? (
          <div className="initiative-setup initiative-setup-clean">
            <div className="initiative-setup-title-row">
              <div>
                <strong>Choose combatants</strong>
                <small>Player characters roll for themselves after you prepare initiative.</small>
              </div>
              <button
                type="button"
                className="initiative-cancel-link"
                onClick={() => setSetupOpen(false)}
                disabled={busy}
              >
                Cancel
              </button>
            </div>

            {rosterWithoutActor.length > 0 ? (
              <div className="initiative-roster-warning">
                <b>Players without a linked Player Actor</b>
                <span>{rosterWithoutActor.map((player) => player.name).join(', ')}</span>
              </div>
            ) : null}

            <section className="initiative-selection-group">
              <header>
                <span>PLAYERS</span>
                <b>{playerActors.length}</b>
              </header>
              <div className="initiative-setup-list">
                {playerActors.length === 0 ? (
                  <em>No Player Actors exist yet.</em>
                ) : (
                  playerActors.map(selectionRow)
                )}
              </div>
            </section>

            <section className="initiative-selection-group">
              <header>
                <span>ENEMIES & NPCs</span>
                <b>{dmActors.length}</b>
              </header>
              <div className="initiative-setup-list">
                {dmActors.length === 0 ? (
                  <em>No enemies or NPCs available.</em>
                ) : (
                  dmActors.map(selectionRow)
                )}
              </div>
            </section>

            <div className="initiative-setup-actions initiative-setup-actions-clean">
              <button
                type="button"
                className="initiative-primary-button"
                disabled={busy || selectedActorIds.length === 0}
                onClick={() => void run(() => onPrepareCombat(selectedActorIds))}
              >
                Prepare Initiative
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="initiative-primary-button"
            onClick={() => setSetupOpen(true)}
          >
            Start Combat
          </button>
        )}

        {rollFeed}
      </section>
    )
  }

  if (combat.phase === 'setup') {
    const allReady = combat.combatants.every((entry) => entry.initiative !== null)
    const combatantByActorId = new Map(
      combat.combatants.map((entry) => [entry.actorId, entry]),
    )
    const playerCombatants = combat.combatants.filter(
      (entry) => actorMap.get(entry.actorId)?.kind === 'player',
    )
    const dmCombatants = combat.combatants.filter(
      (entry) => actorMap.get(entry.actorId)?.kind !== 'player',
    )
    const playerReadyCount = playerCombatants.filter((entry) => entry.initiative !== null).length
    const dmReadyCount = dmCombatants.filter((entry) => entry.initiative !== null).length
    const dmRollTargets = dmCombatants.filter((entry) => entry.initiative === null)
    const assignableCombatantActors = combat.combatants
      .map((entry) => actorMap.get(entry.actorId) ?? null)
      .filter((actor): actor is Actor => Boolean(actor && !actor.ownerId))
    const ownCombatants = playerCombatants.filter((entry) => {
      const actor = actorMap.get(entry.actorId)
      return Boolean(
        actor &&
        currentPlayerId &&
        actor.ownerId === currentPlayerId,
      )
    })

    const playerRows = rosterPlayers.map((player) => {
      const ownedActors = playerActors.filter((candidate) => candidate.ownerId === player.id)
      const actor =
        ownedActors.find((candidate) => combatantByActorId.has(candidate.id))
        ?? ownedActors[0]
        ?? null
      const entry = actor ? combatantByActorId.get(actor.id) ?? null : null
      return { player, actor, entry }
    })

    const offlineOrUnassignedPlayerEntries = playerCombatants.filter((entry) => {
      const actor = actorMap.get(entry.actorId)
      return !actor?.ownerId || !rosterPlayers.some((player) => player.id === actor.ownerId)
    })

    return (
      <section className="initiative-panel initiative-panel-setup-phase initiative-console">
        <div className="initiative-console-header">
          <div>
            <span>INITIATIVE SETUP</span>
            <strong>Waiting for Rolls</strong>
          </div>
          {isDm ? (
            <button
              type="button"
              className="initiative-cancel-button initiative-cancel-button-top"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Cancel this encounter setup? Submitted initiative rolls will be cleared. Actors and tokens will remain.')) {
                  void run(onEndCombat)
                }
              }}
            >
              Cancel Encounter
            </button>
          ) : null}
        </div>

        {isDm ? (
          <>
            <div className="initiative-readiness-strip">
              <div>
                <span>PLAYER ROLLS</span>
                <b>{playerReadyCount}/{playerCombatants.length}</b>
              </div>
              <div>
                <span>DM ROLLS</span>
                <b>{dmReadyCount}/{dmCombatants.length}</b>
              </div>
            </div>

            <div className="initiative-console-groups">
              <section className="initiative-console-group initiative-console-players">
                <header>
                  <div>
                    <span>PLAYERS</span>
                    <small>Each player rolls their own character.</small>
                  </div>
                  <b>{Math.max(rosterPlayers.length, playerCombatants.length)}</b>
                </header>

                <div className="initiative-console-list">
                  {rosterPlayers.length === 0 && playerCombatants.length === 0 ? (
                    <div className="initiative-empty-state">No Player Actors or registered players are available yet.</div>
                  ) : null}

                  {playerRows.map(({ player, actor, entry }) => {
                    const latestRoll = actor ? latestInitiativeRollFor(actor.id) : undefined
                    const stateClass = entry?.initiative !== null && entry
                      ? 'is-ready'
                      : actor && entry
                        ? 'is-waiting'
                        : 'is-not-in-encounter'

                    return (
                      <article key={player.id} className={`initiative-participant-row ${stateClass}`}>
                        <span className="initiative-participant-avatar">
                          {player.name.slice(0, 1).toUpperCase()}
                        </span>
                        <div className="initiative-participant-copy">
                          <strong>{player.name}</strong>
                          <small>
                            {actor
                              ? `${actor.name} · INIT ${signed(actor.initiativeBonus)}`
                              : 'No Player Actor assigned'}
                            {' · '}
                            {player.connected ? 'ONLINE' : 'OFFLINE'}
                          </small>
                          {entry?.initiative !== null && entry && latestRoll ? (
                            <em>{rollSummary(latestRoll)}</em>
                          ) : null}
                        </div>
                        <span className="initiative-status-badge">
                          {!actor
                            ? 'NO ACTOR'
                            : !entry
                              ? 'NOT IN ENCOUNTER'
                              : entry.initiative === null
                                ? 'WAITING'
                                : `READY · ${entry.initiative}`}
                        </span>
                        {!actor && assignableCombatantActors.length > 0 ? (
                          <label className="initiative-assign-player-field">
                            <span>Link combatant</span>
                            <select
                              value=""
                              disabled={busy}
                              aria-label={`Link a selected combatant to ${player.name}`}
                              onChange={(event) => {
                                const actorId = event.target.value
                                if (!actorId) return
                                void run(() => onAssignPlayerActor(actorId, player.id))
                              }}
                            >
                              <option value="">Choose…</option>
                              {assignableCombatantActors.map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  {candidate.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                        {actor && entry ? (
                          <label className="initiative-manual-field">
                            <span>Manual</span>
                            <input
                              className="initiative-value-input"
                              type="number"
                              min={-100}
                              max={100}
                              placeholder="—"
                              defaultValue={entry.initiative ?? ''}
                              key={`${entry.actorId}:${entry.initiative ?? 'empty'}`}
                              aria-label={`${actor.name} initiative DM override`}
                              title="DM manual override"
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') event.currentTarget.blur()
                                if (event.key === 'Escape') {
                                  event.currentTarget.value = entry.initiative === null ? '' : String(entry.initiative)
                                  event.currentTarget.blur()
                                }
                              }}
                              onBlur={(event) => {
                                if (event.currentTarget.value === '') {
                                  event.currentTarget.value = entry.initiative === null ? '' : String(entry.initiative)
                                  return
                                }
                                const initiative = clampInitiative(event.currentTarget.value, entry.initiative ?? 0)
                                event.currentTarget.value = String(initiative)
                                if (initiative !== entry.initiative) {
                                  void run(() => onSetInitiative(entry.actorId, initiative))
                                }
                              }}
                            />
                          </label>
                        ) : null}
                      </article>
                    )
                  })}

                  {offlineOrUnassignedPlayerEntries.map((entry) => {
                    const actor = actorMap.get(entry.actorId)
                    if (!actor) return null
                    const latestRoll = latestInitiativeRollFor(actor.id)
                    const ownerLabel = actor.ownerId
                      ? playerNameById.get(actor.ownerId) ?? 'Player offline'
                      : 'Unassigned Player Actor'

                    return (
                      <article key={entry.actorId} className={`initiative-participant-row ${entry.initiative === null ? 'is-waiting' : 'is-ready'}`}>
                        <span className="initiative-participant-avatar">?</span>
                        <div className="initiative-participant-copy">
                          <strong>{actor.name}</strong>
                          <small>{ownerLabel} · INIT {signed(actor.initiativeBonus)}</small>
                          {entry.initiative !== null && latestRoll ? <em>{rollSummary(latestRoll)}</em> : null}
                        </div>
                        <span className="initiative-status-badge">
                          {entry.initiative === null ? 'WAITING' : `READY · ${entry.initiative}`}
                        </span>
                        <label className="initiative-manual-field">
                          <span>Manual</span>
                          <input
                            className="initiative-value-input"
                            type="number"
                            min={-100}
                            max={100}
                            placeholder="—"
                            defaultValue={entry.initiative ?? ''}
                            key={`${entry.actorId}:${entry.initiative ?? 'empty'}`}
                            aria-label={`${actor.name} initiative DM override`}
                            title="DM manual override"
                            onBlur={(event) => {
                              if (event.currentTarget.value === '') {
                                event.currentTarget.value = entry.initiative === null ? '' : String(entry.initiative)
                                return
                              }
                              const initiative = clampInitiative(event.currentTarget.value, entry.initiative ?? 0)
                              event.currentTarget.value = String(initiative)
                              if (initiative !== entry.initiative) {
                                void run(() => onSetInitiative(entry.actorId, initiative))
                              }
                            }}
                          />
                        </label>
                      </article>
                    )
                  })}
                </div>
              </section>

              <section className="initiative-console-group initiative-console-enemies">
                <header>
                  <div>
                    <span>ENEMIES & NPCs</span>
                    <small>Only the DM rolls these initiatives.</small>
                  </div>
                  <b>{dmCombatants.length}</b>
                </header>

                <div className="initiative-console-list">
                  {dmCombatants.length === 0 ? (
                    <div className="initiative-empty-state">No enemies or NPCs selected.</div>
                  ) : (
                    dmCombatants.map((entry) => {
                      const actor = actorMap.get(entry.actorId)
                      const latestRoll = latestInitiativeRollFor(entry.actorId)
                      return (
                        <article key={entry.actorId} className={`initiative-participant-row ${entry.initiative === null ? 'is-waiting' : 'is-ready'}`}>
                          <span className="initiative-participant-avatar is-enemy">⚔</span>
                          <div className="initiative-participant-copy">
                            <strong>{actor?.name ?? 'Unknown Actor'}</strong>
                            <small>{actor?.kind?.toUpperCase() ?? 'NPC'} · INIT {signed(actor?.initiativeBonus ?? 0)}</small>
                            {entry.initiative !== null && latestRoll ? <em>{rollSummary(latestRoll)}</em> : null}
                          </div>
                          <button
                            type="button"
                            className="initiative-die-button"
                            disabled={busy}
                            onClick={() => void run(() => onRollDmInitiative(entry.actorId))}
                          >
                            {entry.initiative === null
                              ? `Roll d20 ${signed(actor?.initiativeBonus ?? 0)}`
                              : 'Reroll'}
                          </button>
                          <label className="initiative-manual-field">
                            <span>Manual</span>
                            <input
                              className="initiative-value-input"
                              type="number"
                              min={-100}
                              max={100}
                              placeholder="—"
                              defaultValue={entry.initiative ?? ''}
                              key={`${entry.actorId}:${entry.initiative ?? 'empty'}`}
                              aria-label={`${actor?.name ?? 'Combatant'} initiative DM override`}
                              title="DM manual override"
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') event.currentTarget.blur()
                                if (event.key === 'Escape') {
                                  event.currentTarget.value = entry.initiative === null ? '' : String(entry.initiative)
                                  event.currentTarget.blur()
                                }
                              }}
                              onBlur={(event) => {
                                if (event.currentTarget.value === '') {
                                  event.currentTarget.value = entry.initiative === null ? '' : String(entry.initiative)
                                  return
                                }
                                const initiative = clampInitiative(event.currentTarget.value, entry.initiative ?? 0)
                                event.currentTarget.value = String(initiative)
                                if (initiative !== entry.initiative) {
                                  void run(() => onSetInitiative(entry.actorId, initiative))
                                }
                              }}
                            />
                          </label>
                        </article>
                      )
                    })
                  )}
                </div>
              </section>
            </div>

            <div className="initiative-console-actions">
              <button
                type="button"
                className="initiative-secondary-button"
                disabled={busy || dmRollTargets.length === 0}
                onClick={() => void run(async () => {
                  for (const entry of dmRollTargets) {
                    await onRollDmInitiative(entry.actorId)
                  }
                })}
              >
                Roll Remaining Enemies
              </button>
              <button
                type="button"
                className="initiative-primary-button"
                disabled={busy || !allReady}
                onClick={() => void run(onBeginCombat)}
              >
                Begin Battle · Round 1
              </button>
            </div>
          </>
        ) : (
          <div className="initiative-player-roll-zone">
            {ownCombatants.length === 0 ? (
              <div className="initiative-player-wait-card">
                <strong>You are connected</strong>
                <small>Your Player Actor is not part of this encounter. The DM can add it before battle begins.</small>
              </div>
            ) : (
              ownCombatants.map((entry) => {
                const actor = actorMap.get(entry.actorId)
                const latestRoll = latestInitiativeRollFor(entry.actorId)

                return (
                  <div key={entry.actorId} className="initiative-player-roll-card">
                    <span>YOUR INITIATIVE</span>
                    <strong>{actor?.name ?? 'Your Character'}</strong>
                    <small>Initiative modifier {signed(actor?.initiativeBonus ?? 0)}</small>
                    {entry.initiative === null ? (
                      <button
                        type="button"
                        className="initiative-player-roll-button"
                        disabled={busy}
                        onClick={() => void run(() => onRollPlayerInitiative(entry.actorId))}
                      >
                        Roll d20 {signed(actor?.initiativeBonus ?? 0)}
                      </button>
                    ) : (
                      <div className="initiative-player-roll-result">
                        <b>{entry.initiative}</b>
                        <small>
                          {latestRoll
                            ? rollSummary(latestRoll)
                            : 'Initiative submitted'}
                        </small>
                      </div>
                    )}
                  </div>
                )
              })
            )}
            <small className="initiative-player-note">Waiting for the Dungeon Master to begin Round 1.</small>
          </div>
        )}

        {rollFeed}
      </section>
    )
  }

  return (
    <section className="initiative-panel initiative-panel-active">
      <div className="initiative-panel-heading">
        <span>INITIATIVE</span>
        <strong>Round {combat.round}</strong>
      </div>

      <div className="initiative-combatants">
        {combat.combatants.map((entry, index) => {
          const actor = actorMap.get(entry.actorId)
          const isCurrent = combat.currentActorId === entry.actorId
          const previous = combat.combatants[index - 1]
          const next = combat.combatants[index + 1]
          const canMoveUp =
            entry.initiative !== null &&
            previous?.initiative === entry.initiative
          const canMoveDown =
            entry.initiative !== null &&
            next?.initiative === entry.initiative
          const ownerName = actor?.ownerId
            ? playerNameById.get(actor.ownerId)
            : null

          return (
            <article
              key={entry.actorId}
              className={isCurrent ? 'initiative-row is-current' : 'initiative-row'}
              title={actor?.name ?? entry.actorId}
            >
              <span className="initiative-turn-mark" aria-hidden="true">
                {isCurrent ? '▶' : index + 1}
              </span>

              <span className="initiative-row-avatar" aria-hidden="true">
                {actor?.portraitUrl
                  ? <img src={actor.portraitUrl} alt="" />
                  : <b>{(actor?.name ?? '?').slice(0, 1).toUpperCase()}</b>}
              </span>

              <div className="initiative-row-copy">
                <strong>{actor?.name ?? 'Unknown Actor'}</strong>
                <small>
                  {actor?.kind === 'player' && ownerName
                    ? `PLAYER · ${ownerName}`
                    : actor?.kind?.toUpperCase() ?? 'COMBATANT'}
                </small>
              </div>

              {isDm ? (
                <input
                  className="initiative-value-input"
                  type="number"
                  min={-100}
                  max={100}
                  defaultValue={entry.initiative ?? 0}
                  key={`${entry.actorId}:${entry.initiative}`}
                  aria-label={`${actor?.name ?? 'Combatant'} initiative`}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    if (event.key === 'Escape') {
                      event.currentTarget.value = String(entry.initiative ?? 0)
                      event.currentTarget.blur()
                    }
                  }}
                  onBlur={(event) => {
                    const initiative = clampInitiative(
                      event.currentTarget.value,
                      entry.initiative ?? 0,
                    )
                    event.currentTarget.value = String(initiative)
                    if (initiative !== entry.initiative) {
                      void run(() => onSetInitiative(entry.actorId, initiative))
                    }
                  }}
                />
              ) : (
                <b className="initiative-value">{entry.initiative ?? '—'}</b>
              )}

              {isDm && (canMoveUp || canMoveDown) ? (
                <span className="initiative-tie-controls">
                  <button
                    type="button"
                    disabled={busy || !canMoveUp}
                    onClick={() => void run(() => onMoveTie(entry.actorId, 'up'))}
                    aria-label={`Move ${actor?.name ?? 'combatant'} up in initiative tie`}
                    title="Move up in tie"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={busy || !canMoveDown}
                    onClick={() => void run(() => onMoveTie(entry.actorId, 'down'))}
                    aria-label={`Move ${actor?.name ?? 'combatant'} down in initiative tie`}
                    title="Move down in tie"
                  >
                    ↓
                  </button>
                </span>
              ) : null}
            </article>
          )
        })}
      </div>

      {isDm ? (
        <div className="initiative-turn-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(onPreviousTurn)}
          >
            Previous
          </button>
          <button
            type="button"
            className="initiative-next-button"
            disabled={busy}
            onClick={() => void run(onNextTurn)}
          >
            Next Turn
          </button>
          <button
            type="button"
            className="initiative-end-button"
            disabled={busy}
            onClick={() => {
              if (window.confirm('End this combat? Actor and token state will remain.')) {
                void run(onEndCombat)
              }
            }}
          >
            End Battle
          </button>
        </div>
      ) : (
        <small className="initiative-player-note">
          {combat.currentActorId
            ? `${actorMap.get(combat.currentActorId)?.name ?? 'Another combatant'} is acting.`
            : 'Waiting for the Dungeon Master.'}
        </small>
      )}

      {rollFeed}
    </section>
  )
}
