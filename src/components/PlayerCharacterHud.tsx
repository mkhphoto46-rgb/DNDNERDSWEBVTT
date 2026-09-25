import type { Actor } from '../types/actor'
import { xpProgress } from '../lib/progression'

interface PlayerCharacterHudProps {
  actor: Actor
  onClose: () => void
  onOpenSheet: () => void
  onOpenSpellbook: () => void
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value)
}

export function PlayerCharacterHud({
  actor,
  onClose,
  onOpenSheet,
  onOpenSpellbook,
}: PlayerCharacterHudProps) {
  const sheet = actor.characterSheet
  const xp = sheet?.experiencePoints ?? 0
  const progress = xpProgress(actor.level, xp)
  const hpPercent = Math.max(0, Math.min(100, (actor.currentHp / Math.max(1, actor.maxHp)) * 100))
  const classLabel = [
    sheet?.className || 'Class not chosen',
    sheet?.classRulesVersion ? `${sheet.classRulesVersion}` : '',
  ].filter(Boolean).join(' · ')

  return (
    <section className="player-character-hud" aria-label="Quick character">
      <header>
        <div className="player-character-hud-portrait">
          {actor.portraitUrl ? (
            <img src={actor.portraitUrl} alt="" />
          ) : (
            <span>{actor.name.slice(0, 1).toUpperCase()}</span>
          )}
        </div>
        <div>
          <small>QUICK CHARACTER</small>
          <strong>{actor.name}</strong>
          <span>{classLabel} · Lv {actor.level}</span>
        </div>
        <button type="button" className="player-character-hud-close" onClick={onClose} aria-label="Close quick character">×</button>
      </header>

      <div className="player-character-hud-hp">
        <div>
          <span>HP</span>
          <strong>{actor.currentHp} / {actor.maxHp}</strong>
          {actor.tempHp > 0 ? <em>+{actor.tempHp} Temp</em> : null}
        </div>
        <div className="player-character-hud-hp-track" aria-label={`Hit points ${Math.round(hpPercent)} percent`}>
          <i style={{ width: `${hpPercent}%` }} />
        </div>
      </div>

      <div className="player-character-hud-stats">
        <div><span>AC</span><b>{actor.ac}</b></div>
        <div><span>Speed</span><b>{actor.speedFeet} ft</b></div>
        <div><span>PB</span><b>{signed(actor.proficiencyBonus)}</b></div>
        <div><span>Init</span><b>{signed(actor.initiativeBonus)}</b></div>
      </div>

      <div className="player-character-hud-identity">
        {sheet?.subclassName ? <span>{sheet.subclassName}</span> : null}
        {sheet?.species ? <span>{sheet.species}</span> : null}
        {sheet?.background ? <span>{sheet.background}</span> : null}
      </div>

      <div className="player-character-hud-xp">
        <div>
          <span>XP</span>
          <small>{progress.next === null ? `${xp.toLocaleString()} · Max level` : `${xp.toLocaleString()} / ${progress.next.toLocaleString()}`}</small>
        </div>
        <div className="player-character-hud-xp-track"><i style={{ width: `${progress.percent}%` }} /></div>
      </div>

      {actor.conditions.length > 0 ? (
        <div className="player-character-hud-conditions">
          {actor.conditions.slice(0, 5).map((condition) => <span key={condition}>{condition}</span>)}
        </div>
      ) : null}

      <footer>
        <button type="button" onClick={onOpenSheet}>Full Sheet</button>
        <button type="button" onClick={onOpenSpellbook}>Spellbook</button>
      </footer>
    </section>
  )
}
