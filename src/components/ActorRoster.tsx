import {
  type Actor,
  type ActorKind,
} from '../types/actor'

import {
  type SceneToken,
  type TokenAsset,
} from '../types/scene'

interface PresencePlayer {
  id: string
  name: string
}

interface ActorRosterProps {
  actors: Actor[]
  tokens: SceneToken[]
  tokenAssets: TokenAsset[]
  players: PresencePlayer[]
  activeMapId: string | null
  pendingActorId: string | null
  onUpdateActor: (
    actorId: string,
    patch: Partial<Actor>,
  ) => Promise<void>
  onArmPlacement: (actor: Actor) => void
  onCancelPlacement: () => void
  onOpenCharacterSheet?: (actorId: string) => void
  onDeleteActor: (actorId: string) => Promise<void>
  onMessage: (message: string) => void
}

const ABILITIES = [
  ['strength', 'STR'],
  ['dexterity', 'DEX'],
  ['constitution', 'CON'],
  ['intelligence', 'INT'],
  ['wisdom', 'WIS'],
  ['charisma', 'CHA'],
] as const

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value)
  const safe = Number.isFinite(parsed)
    ? parsed
    : fallback

  return Math.max(
    min,
    Math.min(
      max,
      Math.round(safe),
    ),
  )
}

export function ActorRoster({
  actors,
  tokens,
  tokenAssets,
  players,
  activeMapId,
  pendingActorId,
  onUpdateActor,
  onArmPlacement,
  onCancelPlacement,
  onOpenCharacterSheet,
  onDeleteActor,
  onMessage,
}: ActorRosterProps) {
  if (actors.length === 0) {
    return (
      <p className="empty-note">
        No Actors yet. Place a portrait from the Token Chest to create the first combatant.
      </p>
    )
  }

  return (
    <div className="actor-roster-list">
      {actors.map((actor) => {
        const linkedTokens =
          tokens.filter(
            (token) =>
              token.actorId === actor.id,
          )

        const onActiveMap =
          activeMapId
            ? linkedTokens.some(
                (token) =>
                  token.mapId === activeMapId,
              )
            : false

        const portraitIsExternal =
          Boolean(actor.portraitUrl) &&
          !tokenAssets.some(
            (asset) => asset.id === actor.portraitAssetId,
          )

        return (
          <article
            className="actor-card"
            key={actor.id}
          >
            <div className="actor-card-heading">
              {actor.portraitUrl ? (
                <img
                  src={actor.portraitUrl}
                  alt=""
                />
              ) : (
                <span className="actor-portrait-placeholder">?</span>
              )}

              <div>
                <strong>{actor.name}</strong>
                <small>
                  {actor.kind.toUpperCase()}
                  {' • '}
                  {linkedTokens.length} scene token{linkedTokens.length === 1 ? '' : 's'}
                </small>
              </div>
            </div>

            <div className="actor-core-grid">
              <label className="actor-name-field">
                <span>Name</span>
                <input
                  key={`${actor.id}:${actor.name}`}
                  type="text"
                  defaultValue={actor.name}
                  maxLength={80}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      event.currentTarget.blur()
                    }

                    if (event.key === 'Escape') {
                      event.preventDefault()
                      event.currentTarget.value = actor.name
                      event.currentTarget.blur()
                    }
                  }}
                  onBlur={(event) => {
                    const name = event.currentTarget.value.trim()

                    if (!name) {
                      event.currentTarget.value = actor.name
                      onMessage('Actor name cannot be empty.')
                      return
                    }

                    if (name === actor.name) return

                    void onUpdateActor(actor.id, { name })
                      .then(() => onMessage(`Actor renamed to ${name}.`))
                      .catch((error) => {
                        event.currentTarget.value = actor.name
                        onMessage(
                          error instanceof Error
                            ? error.message
                            : 'Actor name could not be saved.',
                        )
                      })
                  }}
                />
              </label>

              <label>
                <span>Type</span>
                <select
                  value={actor.kind}
                  onChange={(event) => {
                    const kind = event.target.value as ActorKind

                    void onUpdateActor(
                      actor.id,
                      kind === 'player'
                        ? { kind }
                        : { kind, ownerId: null },
                    )
                  }}
                >
                  <option value="player">Player</option>
                  <option value="npc">NPC</option>
                  <option value="enemy">Enemy</option>
                </select>
              </label>

              <label>
                <span>Owner</span>
                <select
                  value={actor.ownerId ?? ''}
                  onChange={(event) => {
                    const ownerId = event.target.value || null

                    void onUpdateActor(
                      actor.id,
                      ownerId
                        ? { ownerId, kind: 'player' }
                        : { ownerId },
                    )
                  }}
                >
                  <option value="">DM only</option>
                  {players.map((player) => (
                    <option
                      value={player.id}
                      key={player.id}
                    >
                      {player.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Portrait</span>
                <select
                  value={actor.portraitAssetId}
                  onChange={(event) => {
                    const asset = tokenAssets.find(
                      (candidate) => candidate.id === event.target.value,
                    )

                    void onUpdateActor(
                      actor.id,
                      asset
                        ? {
                            portraitAssetId: asset.id,
                            portraitUrl: asset.url,
                          }
                        : {
                            portraitAssetId: '',
                            portraitUrl: '',
                          },
                    )
                  }}
                >
                  <option value="">No portrait</option>
                  {portraitIsExternal ? (
                    <option value={actor.portraitAssetId}>
                      Compendium / Linked Portrait
                    </option>
                  ) : null}
                  {tokenAssets.map((asset) => (
                    <option value={asset.id} key={asset.id}>
                      {asset.displayName}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Level</span>
                <input
                  type="number"
                  min="1"
                  max="30"
                  step="1"
                  value={actor.level}
                  onChange={(event) =>
                    void onUpdateActor(
                      actor.id,
                      {
                        level: clampNumber(
                          event.target.value,
                          actor.level,
                          1,
                          30,
                        ),
                      },
                    )
                  }
                />
              </label>

              <label>
                <span>CR</span>
                <input
                  type="number"
                  min="0"
                  max="30"
                  step="0.125"
                  value={actor.challengeRating ?? ''}
                  placeholder="—"
                  onChange={(event) => {
                    const raw = event.target.value
                    void onUpdateActor(
                      actor.id,
                      {
                        challengeRating:
                          raw === ''
                            ? null
                            : Math.max(
                                0,
                                Math.min(
                                  30,
                                  Number(raw) || 0,
                                ),
                              ),
                      },
                    )
                  }}
                />
              </label>

              <label>
                <span>AC</span>
                <input
                  type="number"
                  min="0"
                  max="40"
                  step="1"
                  value={actor.ac}
                  onChange={(event) =>
                    void onUpdateActor(
                      actor.id,
                      {
                        ac: clampNumber(
                          event.target.value,
                          actor.ac,
                          0,
                          40,
                        ),
                      },
                    )
                  }
                />
              </label>

              <label>
                <span>Speed</span>
                <input
                  type="number"
                  min="5"
                  max="500"
                  step="5"
                  value={actor.speedFeet}
                  onChange={(event) =>
                    void onUpdateActor(
                      actor.id,
                      {
                        speedFeet: clampNumber(
                          event.target.value,
                          actor.speedFeet,
                          5,
                          500,
                        ),
                      },
                    )
                  }
                />
              </label>

              <label>
                <span>Initiative</span>
                <input
                  type="number"
                  min="-20"
                  max="20"
                  step="1"
                  value={actor.initiativeBonus}
                  onChange={(event) =>
                    void onUpdateActor(
                      actor.id,
                      {
                        initiativeBonus: clampNumber(
                          event.target.value,
                          actor.initiativeBonus,
                          -20,
                          20,
                        ),
                      },
                    )
                  }
                />
              </label>
            </div>

            <div className="actor-hp-grid">
              <label>
                <span>HP</span>
                <input
                  type="number"
                  min="0"
                  max={actor.maxHp}
                  value={actor.currentHp}
                  onChange={(event) =>
                    void onUpdateActor(
                      actor.id,
                      {
                        currentHp: clampNumber(
                          event.target.value,
                          actor.currentHp,
                          0,
                          actor.maxHp,
                        ),
                      },
                    )
                  }
                />
              </label>

              <label>
                <span>Max HP</span>
                <input
                  type="number"
                  min="1"
                  max="9999"
                  value={actor.maxHp}
                  onChange={(event) => {
                    const maxHp = clampNumber(
                      event.target.value,
                      actor.maxHp,
                      1,
                      9999,
                    )

                    void onUpdateActor(
                      actor.id,
                      {
                        maxHp,
                        currentHp:
                          Math.min(
                            actor.currentHp,
                            maxHp,
                          ),
                      },
                    )
                  }}
                />
              </label>

              <label>
                <span>Temp HP</span>
                <input
                  type="number"
                  min="0"
                  max="9999"
                  value={actor.tempHp}
                  onChange={(event) =>
                    void onUpdateActor(
                      actor.id,
                      {
                        tempHp: clampNumber(
                          event.target.value,
                          actor.tempHp,
                          0,
                          9999,
                        ),
                      },
                    )
                  }
                />
              </label>
            </div>

            <div className="actor-ability-grid">
              {ABILITIES.map(([ability, label]) => (
                <label key={ability}>
                  <span>{label}</span>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={actor.abilities[ability]}
                    onChange={(event) =>
                      void onUpdateActor(
                        actor.id,
                        {
                          abilities: {
                            ...actor.abilities,
                            [ability]: clampNumber(
                              event.target.value,
                              actor.abilities[ability],
                              1,
                              30,
                            ),
                          },
                        },
                      )
                    }
                  />
                </label>
              ))}
            </div>

            <div className="actor-card-actions">
              {actor.kind === 'player' && onOpenCharacterSheet ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onOpenCharacterSheet(actor.id)}
                >
                  Open Character Sheet
                </button>
              ) : null}

              {pendingActorId === actor.id ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={onCancelPlacement}
                >
                  Cancel Placement
                </button>
              ) : (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!activeMapId || onActiveMap || !actor.portraitUrl}
                  onClick={() => onArmPlacement(actor)}
                >
                  {onActiveMap
                    ? 'Already On Map'
                    : 'Place On Active Map'}
                </button>
              )}

              <button
                type="button"
                className="danger-button"
                onClick={() => void onDeleteActor(actor.id)}
              >
                Delete Actor
              </button>
            </div>
          </article>
        )
      })}
    </div>
  )
}
